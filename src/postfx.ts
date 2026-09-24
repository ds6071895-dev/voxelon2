// Post-processing stack for the `max` ("Shaders") graphics preset.
//
// Everything below this preset draws straight to the canvas — one pass, no
// intermediate buffers, which is what keeps VOXELON playable on a laptop iGPU.
// Turning shaders on redirects the frame through an offscreen HDR buffer so the
// image can be worked on as a whole:
//
//   RenderPass -> UnrealBloom -> Grade (god rays, expose, ACES, colour, lens)
//              -> OutputPass (linear -> sRGB)
//
// SCALING DOWN. The stack has three TIERS (0 full, 1 balanced, 2 lite) so the
// same look survives on an iGPU or a phone: the scene buffer drops from 4x MSAA
// at full resolution to 2x at 80% to no MSAA at 64%, the lite bloom chain runs
// at half of that, and the god-ray march shortens from 28 to 20 to 16 taps. The
// tier is chosen by `ShaderBudget` (below) from measured frame times, so a
// strong GPU never loses anything and a weak one still gets the grade, the
// bloom and the rays — just computed on fewer pixels. The god rays used to be a
// pass of their own (a full-screen half-float read + write); they now live in
// the grade, and cost nothing at all while the sun is off screen.
//
// The buffer is half-float on purpose: the sky dome writes the sun disc at ~26x
// a lit block, and both the god rays and the bloom are thresholds on that
// brightness. An 8-bit buffer would have clipped all of it to 1.0 first.
//
// Built on first enable and thrown away on disable: the targets are
// full-resolution and multisampled, which is real VRAM for a setting that is off.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Sky } from './sky';

const PASS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Crepuscular rays, screen-space (inside the grade). Every pixel marches
 * toward the sun's position on screen and sums how much VERY bright sky it
 * crosses on the way. Where leaves, a ridge or a tower stand between the pixel
 * and the sun, the march crosses them instead and comes back dark, so the light
 * breaks into shafts around every silhouette. The threshold sits far above
 * anything the terrain reaches, so only the sun, its corona and the sky right
 * round it ever feed the rays.
 */
/**
 * The grade: what the light LOOKS like.
 *
 *   exposure -> ACES -> contrast -> split tone -> vibrance -> night -> lens
 *
 * Tone mapping comes first so the colour work is done to the picture, not to
 * light the curve would squash the contrast back out of. Day is warm in the
 * highlights and cool in the shade, the way sunlight actually reads; night is a
 * different picture rather than a darker one (see the night block).
 */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uNight: { value: 0 },
    uExposure: { value: 1.12 },
    uTime: { value: 0 },
    /** 0..1, how golden the hour is: warms and softens the whole frame. */
    uGolden: { value: 0 },
    uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
    uRayStrength: { value: 0 },
    uRayColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uAspect: { value: 1 },
    uRaySteps: { value: 28 },
    /** Chromatic fringe on (1) or off (0) — two extra taps per pixel. */
    uFringe: { value: 1 },
  },
  vertexShader: PASS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uNight;
    uniform float uExposure;
    uniform float uTime;
    uniform float uGolden;
    uniform vec2 uSunPos;
    uniform float uRayStrength;
    uniform vec3 uRayColor;
    uniform float uAspect;
    uniform float uRaySteps;
    uniform float uFringe;
    varying vec2 vUv;

    float ign(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    /** Linear-light god rays toward uSunPos (see the note above). The branch
     *  is on a uniform, so a frame without the sun on screen skips it whole. */
    vec3 godRays() {
      vec2 toSun = uSunPos - vUv;
      float reach = length(toSun * vec2(uAspect, 1.0));
      float falloff = exp(-reach * 1.35);
      if (falloff < 0.02) return vec3(0.0);
      vec2 stepUv = toSun * (0.92 / uRaySteps);
      vec2 uv = vUv + stepUv * ign(gl_FragCoord.xy);
      float decay = 1.0;
      float fade = pow(0.962, 28.0 / uRaySteps);
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 28; i++) {
        if (float(i) >= uRaySteps) break;
        uv += stepUv;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
        float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
        acc += s * (smoothstep(1.15, 4.0, l) * decay);
        decay *= fade;
      }
      acc /= uRaySteps;
      return min(acc, vec3(6.0)) * uRayColor * uRayStrength * falloff;
    }

    // Narkowicz's fit of the ACES filmic curve.
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 fromCentre = vUv - 0.5;
      float r = length(fromCentre) * 1.4142;

      // Chromatic aberration at the very corners only (and only where it is
      // wide enough to see — the middle of the frame takes one tap).
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float ca = 0.0012 * smoothstep(0.45, 1.0, r) * uFringe;
      if (ca > 0.00005) {
        color.r = texture2D(tDiffuse, vUv - fromCentre * ca).r;
        color.b = texture2D(tDiffuse, vUv + fromCentre * ca).b;
      }
      if (uRayStrength > 0.002) color += godRays();

      vec3 g = aces(color * uExposure);

      // Gentle S-curve round mid grey, with a small lift under the blacks so
      // deep shade reads as shade rather than as a hole.
      g = g * 0.975 + 0.012;
      g = clamp((g - 0.45) * 1.07 + 0.45, 0.0, 1.0);

      // Split tone: cool shadows, warm highlights — stronger at golden hour.
      float l = luma(g);
      vec3 shadowTint = mix(vec3(0.95, 0.985, 1.07), vec3(0.93, 0.95, 1.10), uGolden);
      vec3 highTint = mix(vec3(1.045, 1.01, 0.955), vec3(1.10, 1.00, 0.86), uGolden);
      g *= mix(shadowTint, highTint, smoothstep(0.1, 0.8, l));

      // Vibrance: lift the muted majority, leave the already-vivid alone.
      float mx = max(g.r, max(g.g, g.b));
      float mn = min(g.r, min(g.g, g.b));
      g = clamp(mix(vec3(luma(g)), g, 1.0 + 0.55 * (1.0 - (mx - mn))), 0.0, 1.0);

      // NIGHT. The dim majority of the frame drains to silver-blue while the
      // few genuinely bright things — fire, lava, the moon — keep their colour
      // and become the subject. Keyed on luminance, not the clock.
      if (uNight > 0.002) {
        float nl = luma(g);
        float dim = 1.0 - smoothstep(0.06, 0.5, nl);
        g = mix(g, vec3(nl) * vec3(0.80, 0.90, 1.22), uNight * dim * 0.35);
        g = mix(g, g * 0.9 + vec3(0.010, 0.016, 0.030), uNight * dim);
        // Film grain in the dark, where the eye itself would see noise.
        float grain = hash(vUv * 731.0 + fract(uTime * 7.13)) - 0.5;
        g += grain * 0.028 * uNight * dim;
      }

      // Vignette.
      g *= 1.0 - (0.14 + 0.10 * uNight) * smoothstep(0.45, 1.3, r);

      gl_FragColor = vec4(max(g, 0.0), 1.0);
    }
  `,
};

/** Scene-buffer scale, MSAA samples and god-ray taps per tier. */
const TIER_SCALE = [1, 0.8, 0.64] as const;
const TIER_SAMPLES = [4, 2, 0] as const;
const TIER_RAY_STEPS = [28, 20, 16] as const;

/** Unreal bloom whose mip chain can start an octave lower. A glow is a blur;
 *  on the cheaper tiers computing it on a quarter of the pixels is near
 *  invisible, and the chain is five blur passes deep, so it is the single
 *  biggest saving in the stack. Only the lite tier halves it. */
class LeanBloomPass extends UnrealBloomPass {
  scale = 1;
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
  }
}

/**
 * ShaderBudget — picks the PostFX/shadow tier from how the frames are actually
 * landing. It steps DOWN quickly when the frame time sits well over budget for
 * a couple of seconds, and steps back UP only after a long clean stretch, with
 * a back-off that doubles every time an upgrade immediately had to be undone —
 * so a machine on the edge settles instead of oscillating.
 */
export class ShaderBudget {
  tier = 0;
  private slow = 0;
  private fast = 0;
  private avg = 1 / 60;
  private holdUp = 8;
  private lastUpAt = -1e9;
  private clock = 0;

  /** Feed one frame. Returns true when the tier changed. */
  sample(dt: number): boolean {
    if (!(dt > 0) || dt > 0.25) return false; // a hitch or a background tab
    this.clock += dt;
    this.avg += (dt - this.avg) * 0.06;
    if (this.avg > 1 / 42) { this.slow += dt; this.fast = 0; }
    else if (this.avg < 1 / 57) { this.fast += dt; this.slow = 0; }
    else { this.slow = Math.max(0, this.slow - dt); this.fast = Math.max(0, this.fast - dt * 0.5); }
    if (this.slow > 2 && this.tier < 2) {
      // An upgrade that could not hold: wait longer before the next one.
      if (this.clock - this.lastUpAt < 12) this.holdUp = Math.min(120, this.holdUp * 2);
      this.tier++;
      this.slow = 0;
      this.avg = 1 / 50;
      return true;
    }
    if (this.fast > this.holdUp && this.tier > 0) {
      this.tier--;
      this.fast = 0;
      this.lastUpAt = this.clock;
      return true;
    }
    return false;
  }

  reset(): void {
    this.tier = 0; this.slow = 0; this.fast = 0; this.avg = 1 / 60; this.holdUp = 8;
  }
}

const _sunNdc = new THREE.Vector3();
const _camDir = new THREE.Vector3();

export class PostFX {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: LeanBloomPass | null = null;
  private gradePass: ShaderPass | null = null;
  private enabled = false;
  private night = 0;
  private golden = 0;
  private readonly sunPos = new THREE.Vector2(0.5, 0.5);
  private rayStrength = 0;
  private readonly rayColor = new THREE.Color(1, 0.9, 0.7);
  private readonly clock = new THREE.Clock();
  private readonly _size = new THREE.Vector2();
  /** 0 full, 1 balanced, 2 lite — see the header and ShaderBudget. */
  private tier = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.build();
    else this.teardown();
  }

  /** Draw one frame. Falls straight through to the plain renderer whenever the
   *  stack is off, so callers have exactly one render path to think about. */
  render(camera: THREE.Camera): void {
    if (!this.composer || !this.renderPass) {
      this.renderer.render(this.scene, camera);
      return;
    }
    this.renderPass.camera = camera;
    if (this.gradePass) this.gradePass.uniforms.uTime.value = this.clock.getElapsedTime();
    this.composer.render();
  }

  /**
   * Read this frame's sky: how night it is, how golden the hour, and where the
   * light source sits on screen for the god rays. Safe to call every frame and
   * while the stack is off; it is a projection and a handful of scalars.
   */
  setSky(sky: Sky, camera: THREE.Camera): void {
    const n = Number.isFinite(sky.nightAmount) ? sky.nightAmount : 0;
    this.night = Math.max(0, Math.min(1, n));
    this.golden = Math.max(0, 1 - Math.abs(sky.sunHeight) / 0.32) * (sky.sunHeight > -0.08 ? 1 : 0);

    // Rays come from the sun by day and, far fainter, from the moon at night.
    const body = sky.moonlit ? sky.lightDir : sky.sunDir;
    camera.getWorldDirection(_camDir);
    const facing = _camDir.dot(body);
    _sunNdc.copy(camera.position).addScaledVector(body, 1000).project(camera);
    const onScreen = facing > 0.05
      && Math.abs(_sunNdc.x) < 1.6 && Math.abs(_sunNdc.y) < 1.6;
    this.sunPos.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5);
    const height = THREE.MathUtils.smoothstep(sky.lightHeight, 0.0, 0.12);
    const edge = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(_sunNdc.x), Math.abs(_sunNdc.y)), 0.9, 1.6);
    this.rayStrength = onScreen
      ? (sky.moonlit ? 0.35 : 1.0) * height * edge * THREE.MathUtils.smoothstep(facing, 0.05, 0.4)
      : 0;
    // Warm and low at golden hour, white at noon, cool under the moon.
    if (sky.moonlit) this.rayColor.setRGB(0.55, 0.68, 1.0);
    else this.rayColor.setRGB(1.0, 0.86 - 0.18 * this.golden, 0.68 - 0.3 * this.golden);
    this.pushUniforms();
  }

  private pushUniforms(): void {
    if (this.gradePass) {
      this.gradePass.uniforms.uNight.value = this.night;
      this.gradePass.uniforms.uGolden.value = this.golden;
      // Nights are exposed up a little: the picture should read as night by
      // colour and contrast, not by being too dark to play.
      this.gradePass.uniforms.uExposure.value = 1.02 + 0.3 * this.night;
    }
    if (this.gradePass) {
      const u = this.gradePass.uniforms;
      (u.uSunPos.value as THREE.Vector2).copy(this.sunPos);
      u.uRayStrength.value = this.rayStrength * 0.55;
      (u.uRayColor.value as THREE.Color).copy(this.rayColor);
      const size = this.renderer.getSize(this._size);
      u.uAspect.value = size.x / Math.max(1, size.y);
      u.uRaySteps.value = TIER_RAY_STEPS[this.tier];
      u.uFringe.value = this.tier < 2 ? 1 : 0;
    }
    if (this.bloomPass) {
      // By day only the sun and the emitters bloom; after dark the bar drops
      // so the moon, fire and lava own the night.
      this.bloomPass.threshold = 1.05 - 0.55 * this.night;
      this.bloomPass.strength = 0.26 + 0.2 * this.night + 0.08 * this.golden;
      // A half-resolution chain spreads every mip an octave wider; pull the
      // radius in so the lite glow keeps the full tier's shape.
      this.bloomPass.radius = this.tier > 1 ? 0.22 : 0.6;
    }
  }

  /** Back-compat for callers that only know the night amount. */
  setNight(night: number): void {
    this.night = Number.isFinite(night) ? Math.max(0, Math.min(1, night)) : 0;
    this.pushUniforms();
  }

  /** Match a new viewport or pixel-ratio cap. Safe to call when off. The
   *  scene buffer renders at the tier's scale of the canvas; the final pass
   *  stretches it back up (bilinear), which on a lower tier reads as a touch
   *  softer, not as jaggier. */
  setSize(width: number, height: number): void {
    if (!this.composer) return;
    if (this.bloomPass) this.bloomPass.scale = this.tier > 1 ? 0.5 : 1;
    this.composer.setPixelRatio(this.renderer.getPixelRatio() * TIER_SCALE[this.tier]);
    this.composer.setSize(width, height);
  }

  get currentTier(): number { return this.tier; }

  /** Move to a cheaper (higher) or richer (lower) tier. MSAA is bound to the
   *  buffer, so a change of sample count rebuilds the stack — rare by design. */
  setTier(tier: number): void {
    const t = Math.max(0, Math.min(2, Math.round(tier)));
    if (t === this.tier) return;
    const rebuild = TIER_SAMPLES[t] !== TIER_SAMPLES[this.tier];
    this.tier = t;
    if (!this.composer) return;
    if (rebuild) { this.teardown(); this.build(); }
    else this.setSize(window.innerWidth, window.innerHeight);
    this.pushUniforms();
  }

  private build(): void {
    if (this.composer) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // Multisampled: the passes read this buffer instead of the canvas, so the
    // context's own MSAA never resolves anything.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: TIER_SAMPLES[this.tier],
    });
    const composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    this.bloomPass = new LeanBloomPass(new THREE.Vector2(size.x, size.y), 0.26, 0.6, 1.05);
    composer.addPass(this.bloomPass);
    this.gradePass = new ShaderPass(GRADE_SHADER);
    composer.addPass(this.gradePass);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.pushUniforms();
    // The constructor sizes itself from the target, already in device pixels;
    // re-state it in CSS pixels so the pixel ratio is not applied twice.
    this.setSize(window.innerWidth, window.innerHeight);
  }

  private teardown(): void {
    for (const pass of this.composer?.passes ?? []) pass.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.gradePass = null;
  }
}
