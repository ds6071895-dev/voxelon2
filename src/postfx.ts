// Post-processing stack for the `max` ("Shaders") graphics preset.
//
// Everything below this preset draws straight to the canvas — one pass, no
// intermediate buffers, which is what keeps VOXELON playable on a laptop iGPU.
// Turning shaders on redirects the frame through an offscreen HDR buffer so the
// image can be worked on as a whole:
//
//   RenderPass -> UnrealBloomPass -> grade (tonemap/vignette/aberration)
//                                 -> OutputPass (linear -> sRGB)
//
// The buffer is half-float on purpose. Bloom is a threshold on brightness, and
// an 8-bit buffer has already clipped every highlight to 1.0 before the pass
// gets to look at it, so sun, lava and torchlight would all bloom identically.
//
// The whole thing is built on first enable and thrown away on disable: the
// render targets are full-resolution and multisampled, which is real VRAM to be
// holding onto for a setting the player has turned off.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * The grade pass. Bloom adds light; this decides what the light looks like.
 *
 * The order matters and is the same one a film pipeline uses:
 *
 *   exposure -> ACES tonemap -> contrast -> split tone -> vibrance -> lens
 *
 * Tone mapping has to come before the contrast and colour work, not after it.
 * ACES is a curve from an open-ended range of light down into the 0..1 a
 * screen can show; anything done to the picture BEFORE that curve is done to
 * light, and anything after it is done to the image. Grading light and then
 * squashing it is what produces the washed-out "everything is bright" look,
 * because the curve pulls all the contrast back out again.
 *
 * The split tone is the piece that reads as a shader pack rather than as a
 * filter: shadows go a touch blue and highlights a touch warm, which is what
 * daylight actually does and what the eye reads as sunlight.
 */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** How night it is, 0..1. See the night block in the fragment shader. */
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uNight;
    varying vec2 vUv;

    // Narkowicz's fit of the ACES filmic curve - one polynomial, no LUT.
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      // Distance from centre, aspect-ignorant on purpose: the artefacts should
      // follow the frame's shape, not a perfect circle inside it.
      vec2 fromCentre = vUv - 0.5;
      float r = length(fromCentre) * 1.4142;

      // Chromatic aberration: sample the channels along slightly different
      // radii. Zero in the middle third of the screen, growing to a fraction of
      // a pixel at the corners.
      float ca = 0.0013 * smoothstep(0.4, 1.0, r);
      vec3 color = vec3(
        texture2D(tDiffuse, vUv - fromCentre * ca).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv + fromCentre * ca).b
      );

      // Exposure, ABOVE one. ACES is a shoulder curve: it spends most of its
      // range compressing the top end, so feeding it a scene at 0.92 hands back
      // midtones darker than the preset one rung down and the shader mode ends
      // up the gloomiest setting in the menu. Over-exposing into the curve puts
      // the light back where the eye expects it while the shoulder still keeps
      // the sun and the lava from clipping flat.
      vec3 graded = aces(color * 1.16);

      // A small lift, then a gentle contrast pivoted just under mid grey.
      // The lift opens the bottom of the range so deep shade reads as shade
      // rather than as a hole, and it is kept small on purpose: push it far
      // enough to raise TRUE black off zero and the whole frame turns milky,
      // which is the opposite of the brighter picture it is there to buy. The
      // contrast then takes the last of it back out at the very bottom, so
      // black is still black and only the near-blacks keep the gain.
      graded = graded * 0.97 + 0.03;
      graded = clamp((graded - 0.46) * 1.06 + 0.46, 0.0, 1.0);

      // Split tone: cool shadows, warm highlights. The single biggest reason
      // sunlight in a shader pack reads as sunlight.
      float l = luma(graded);
      graded *= mix(vec3(0.955, 0.985, 1.075), vec3(1.055, 1.012, 0.945),
                    smoothstep(0.12, 0.78, l));

      // Vibrance rather than flat saturation: colour that is already vivid is
      // left alone and the muted majority of a voxel palette is opened up, so
      // grass and water gain without the lava and the flags going neon. The
      // curve stays weighted towards the muted end - what makes the world read
      // as more colourful is the grass and the sea moving, not the few things
      // that were already saturated moving further.
      // Luma is re-read here rather than reused from the split tone above:
      // this is an EXTRAPOLATION away from grey, so it pushes any error in the
      // grey it measures from straight into the result, and the split tone has
      // moved every channel since l was taken.
      float mx = max(graded.r, max(graded.g, graded.b));
      float mn = min(graded.r, min(graded.g, graded.b));
      graded = clamp(mix(vec3(luma(graded)), graded, 1.0 + 0.82 * (1.0 - (mx - mn))),
                     0.0, 1.0);

      // NIGHT, and it is a different picture rather than a darker one.
      //
      // Three things happen to a real night frame, and only the first is
      // brightness. The eye goes scotopic — the colour cones stop reporting, so
      // everything dim drains toward silver-blue while the few genuinely bright
      // things (a torch, lava, the moon) keep their colour and become the whole
      // subject of the shot. Contrast collapses in the darks, because there is
      // no light down there to separate anything with. And the frame reads
      // COOL, top to bottom, in a way daylight's split tone never does.
      //
      // Keyed on luminance so the two halves separate: the more of the frame
      // that is dark, the more of it goes blue, and a torch-lit face stays warm
      // in the middle of it. That contrast is the whole effect — a uniform blue
      // wash over everything would just be a filter.
      if (uNight > 0.002) {
        float nl = luma(graded);
        float dim = 1.0 - smoothstep(0.05, 0.46, nl);
        vec3 scotopic = vec3(nl) * vec3(0.72, 0.91, 1.36);
        graded = mix(graded, scotopic, uNight * dim * 0.62);
        // Flatten the very bottom of the range and lift it off true black, so
        // shade at night reads as depth you could walk into rather than as a
        // hole punched in the frame.
        graded = mix(graded, graded * 0.88 + vec3(0.014, 0.019, 0.032),
                     uNight * dim);
        // A touch more falloff at the corners: night has no fill light, and the
        // eye reads the darker frame edge as the dark going on past the screen.
        graded *= 1.0 - 0.10 * uNight * smoothstep(0.25, 1.2, r);
      }

      // Vignette: a hint of one. Past a certain depth it stops reading as a
      // lens and starts reading as the corners of the world being unlit, which
      // fights everything above.
      graded *= 1.0 - 0.13 * smoothstep(0.5, 1.3, r);

      gl_FragColor = vec4(graded, 1.0);
    }
  `,
};

export class PostFX {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private gradePass: ShaderPass | null = null;
  private enabled = false;
  private night = 0;

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
    // The active camera swaps between first and third person mid-game.
    this.renderPass.camera = camera;
    this.composer.render();
  }

  /**
   * How night it is, 0..1. Drives the grade's night block AND the bloom, which
   * is where most of the beauty actually comes from: by day the threshold sits
   * deliberately above a sunlit grass block so only the sun and the lava glow,
   * but at night nothing in the world reaches that, and a night with no bloom
   * at all is the flattest frame the renderer ever produces. Lowering the bar
   * after dark hands the glow to the things that own the night — the moon, the
   * aurora, a torch, a lava fall — and to nothing else.
   *
   * Safe to call every frame and when the stack is off; both are cheap.
   */
  setNight(night: number): void {
    this.night = Number.isFinite(night) ? Math.max(0, Math.min(1, night)) : 0;
    if (this.gradePass) this.gradePass.uniforms.uNight.value = this.night;
    if (this.bloomPass) {
      this.bloomPass.threshold = 0.86 - 0.30 * this.night;
      this.bloomPass.strength = 0.22 + 0.16 * this.night;
    }
  }

  /** Match a new viewport or pixel-ratio cap. Safe to call when off. */
  setSize(width: number, height: number): void {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  private build(): void {
    if (this.composer) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // Multisampled because the passes read from this buffer instead of the
    // canvas, which means the context's own MSAA never resolves anything. A
    // voxel world is all hard silhouettes; losing edge AA here would be a
    // visible downgrade from the preset one rung below.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    // Threshold and strength are both deliberately conservative. Bloom is a
    // property of things that are ACTUALLY bright - the sun, its halo, lava,
    // a torch - and the old settings (0.45 at a 0.62 threshold) sat below a
    // sunlit grass block in linear light, so most of the frame bloomed into
    // most of the rest of it and the whole world came back washed out and
    // over-bright. Raising the threshold above ordinary lit surfaces puts the
    // glow back where it belongs.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.22,  // strength
      0.55,  // radius
      0.86   // threshold, in linear light
    );
    composer.addPass(this.bloomPass);
    this.gradePass = new ShaderPass(GRADE_SHADER);
    composer.addPass(this.gradePass);
    // Converts the linear HDR buffer back to the renderer's output colour
    // space. Without it the whole frame renders washed out.
    composer.addPass(new OutputPass());
    this.composer = composer;
    // The stack can be switched on at any hour, so it starts at whatever the
    // clock last reported rather than at noon.
    this.setNight(this.night);
    // The constructor sizes itself from the target, which is already in device
    // pixels; re-state it in CSS pixels so the pixel ratio is not applied twice.
    this.setSize(window.innerWidth, window.innerHeight);
  }

  private teardown(): void {
    // EffectComposer.dispose() frees its own two buffers but not the passes',
    // and UnrealBloomPass alone holds a mip chain of render targets.
    for (const pass of this.composer?.passes ?? []) pass.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.gradePass = null;
  }
}
