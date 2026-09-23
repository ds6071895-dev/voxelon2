// SUN SHADOWS for the `max` ("Shaders") preset.
//
// This is the thing that separates a Minecraft shader pack from a colour
// filter: the sun casts. Trees lay shadows across the ground, a hill shades the
// valley behind it, and the shadows swing round and stretch out as the day
// runs. None of that is available from three.js's built-in shadow system here,
// because the terrain is drawn with MeshBasicMaterial (the voxel light model is
// injected into it by hand in world.ts) and an unlit material neither receives
// nor knows about lights. So the pass is written out in full instead:
//
//   1. An orthographic camera looks down the sun direction at the player.
//   2. The terrain, and only the terrain, is drawn into a depth buffer from
//      there. Layer 1 is the marker for "casts a shadow"; every chunk mesh is
//      on it and nothing else is, which is what keeps the pass to one cheap
//      draw list instead of the whole scene.
//   3. The chunk shader projects each fragment back into that buffer and
//      compares depths.
//
// Two details are what make it look right rather than merely present:
//
// - The camera's centre is SNAPPED to whole shadow texels every frame, against
//   a basis built from the sun rather than from the player. Without that, the
//   sampling grid slides under the world as the player walks and every shadow
//   edge crawls and fizzes along with them. It is the most important thing in
//   the file, and the easiest to write in a way that silently does nothing -
//   see the long note in `update`.
// - Depth is packed into RGBA rather than read from a depth texture, so the
//   pass works the same on every GPU and driver this game is likely to meet.

import * as THREE from 'three';

/** Shadow-map edge, in texels. 2048 over a 160-block box is a shade under 13
 *  texels per block: sharp enough for a fence post, cheap enough for a laptop. */
const MAP_SIZE = 2048;
/** Half-width of the world box the map covers, in blocks. */
const EXTENT = 80;
/** How far back down the sun ray the camera sits. Has to clear the tallest
 *  thing that might cast into the box. */
const BACK_OFF = 320;

/** The layer chunk meshes are put on to be included in the shadow pass. */
export const SHADOW_CASTER_LAYER = 1;

/**
 * The three uniforms the chunk shader reads to sample this map. They are owned
 * by World, not by this class: a uniform holder is bound into a shader program
 * the first time the material compiles, so it has to exist before the chunk
 * materials are built and can never be swapped for another object afterwards.
 * This pass writes into them.
 */
export interface ShadowUniforms {
  map: { value: THREE.Texture | null };
  /** World -> shadow texture space, with a translation by `origin` already
   *  folded in, so the shader feeds it ORIGIN-RELATIVE positions. See `origin`. */
  matrix: { value: THREE.Matrix4 };
  /** x: on (0/1), y: one texel in UV, z: shadow strength 0..1 (horizon fade). */
  params: { value: THREE.Vector3 };
  /**
   * THE SHADING ORIGIN, and the reason arenas stopped fizzing.
   *
   * A minigame arena is stamped at x = 262 144 (`PARTY_BASE_X`), and a float32
   * near 2^18 has a spacing of 1/32 of a block. Every chunk fragment's world
   * position is therefore QUANTIZED to 1/32 there — which is invisible for a
   * distance test, and fatal for the two places the chunk shader differentiates
   * or cancels one: `dFdx(worldPos)` (the face normal, recovered from the
   * screen-space derivative of a value that steps in 1/32 jumps rather than
   * varying smoothly across a pixel) and the shadow lookup (a matrix multiply
   * whose 1.6e3-sized intermediates cancel down to a 0..1 coordinate). Both come
   * back as noise, which is what the grainy daylight ground in Parkour was.
   *
   * So the shader never handles an absolute position in those paths. It works
   * relative to this point — the eye, rounded to whole blocks, which are exact
   * in float32 to 2^24 — and everything it measures stays within a few hundred
   * blocks of zero, where float32 has room to spare. Written every frame by
   * `update`, INCLUDING when the pass itself is off: the face normal needs it
   * on every preset.
   */
  origin: { value: THREE.Vector3 };
}

export class SunShadow {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly atlas: THREE.Texture;
  private readonly out: ShadowUniforms;
  private target: THREE.WebGLRenderTarget | null = null;
  private depthMat: THREE.MeshDepthMaterial | null = null;
  private readonly camera = new THREE.OrthographicCamera(
    -EXTENT, EXTENT, EXTENT, -EXTENT, 1, BACK_OFF + EXTENT * 2
  );
  // NDC (-1..1) -> texture space (0..1), folded into the matrix so the shader
  // does one multiply and no rescaling.
  private readonly bias = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1
  );
  private readonly centre = new THREE.Vector3();
  /** Translation by `out.origin`, folded into the matrix handed to the shader. */
  private readonly originShift = new THREE.Matrix4();
  private readonly prevClear = new THREE.Color();
  private readonly scratch = new THREE.Vector3();
  // The light's own axes, rebuilt each frame from the sun direction alone.
  private readonly lightUp = new THREE.Vector3();
  private readonly lightX = new THREE.Vector3();
  private readonly lightY = new THREE.Vector3();
  private enabled = false;

  constructor(
    renderer: THREE.WebGLRenderer, scene: THREE.Scene, atlas: THREE.Texture,
    uniforms: ShadowUniforms
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.atlas = atlas;
    this.out = uniforms;
    this.camera.layers.set(SHADOW_CASTER_LAYER);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.build();
    else this.teardown();
    if (!on) this.out.params.value.x = 0;
  }

  private build(): void {
    if (this.target) return;
    this.target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
      // Nearest, because the packed bytes of one texel are a single number:
      // filtering between two of them averages the byte lanes and produces a
      // depth that belongs to neither texel. The softening is done by the PCF
      // taps in the chunk shader instead, which average the COMPARISONS.
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    this.depthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      // The atlas and the cutout test come along so that leaves and glass cast
      // the shadow of their actual shape. A solid block shadow under every tree
      // is the tell-tale sign of a cheap shadow pass.
      map: this.atlas,
      alphaTest: 0.5,
    });
    this.out.map.value = this.target.texture;
    this.out.params.value.y = 1 / MAP_SIZE;
  }

  private teardown(): void {
    this.target?.dispose();
    this.target = null;
    this.depthMat?.dispose();
    this.depthMat = null;
    this.out.map.value = null;
  }

  /**
   * Redraw the map for this frame.
   *
   * @param sunDir  Unit vector from the world toward the CASTING BODY — the
   *                sun by day, the moon by night.
   * @param focus   Where to centre the box (the player's eye).
   * @param sunUp   How high that body sits, -1..1. Shadows fade out as it
   *                touches the horizon: a hard-edged shadow cast by something
   *                that is not visible is the classic shader-pack bug.
   * @param moon    True while the moon is the caster. Moonlight is a fraction
   *                of a sunbeam and its shadows have to read like it — present,
   *                soft, and nowhere near as deep as noon's.
   */
  update(
    sunDir: THREE.Vector3, focus: THREE.Vector3, sunUp: number, moon = false
  ): void {
    // The shading origin is NOT gated on the pass being enabled: every preset's
    // chunk shader measures from it, shadows or no shadows. See ShadowUniforms.
    // A non-finite focus would take the whole terrain shader down with it, so a
    // bad frame keeps the last good origin instead — it only has to be NEAR the
    // player to do its job, never exact.
    if (Number.isFinite(focus.x) && Number.isFinite(focus.y)
      && Number.isFinite(focus.z)) {
      this.out.origin.value.set(
        Math.round(focus.x), Math.round(focus.y), Math.round(focus.z));
    }
    if (!this.enabled || !this.target || !this.depthMat) return;

    // How much of the DIRECT light a shadow takes away, faded out as the body
    // nears the horizon. It can go all the way now: the chunk shader lights
    // shade with the sky dome's own irradiance, so a full shadow reads as cool
    // blue daylight, never as a hole. The moon's shadows are as sharp as the
    // sun's — its direct light is simply a small fraction of the sun's.
    const strength = (moon ? 0.9 : 1.0)
      * THREE.MathUtils.smoothstep(sunUp, 0.03, 0.22);
    this.out.params.value.z = strength;
    this.out.params.value.x = strength > 0.004 ? 1 : 0;
    // Both bodies at the horizon, or the moon too low: nothing worth drawing,
    // and the shader reads uShadowParams.x and skips the lookup entirely.
    if (strength <= 0.004) return;

    this.centre.copy(focus);

    const cam = this.camera;
    // A sun straight overhead makes the default up vector degenerate.
    const up = this.lightUp.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.999) up.set(0, 0, 1);

    // TEXEL SNAPPING, and it has to be done against a basis that does not
    // itself depend on where the box is centred. Aiming the camera at the
    // player and THEN rounding the player's own light-space position is
    // circular: `lookAt` puts the target on the light-space origin by
    // definition, so the coordinates being rounded are already (0, 0) and the
    // rounding does nothing at all. The grid then slides continuously under
    // the world as the player walks and every shadow in the frame creeps along
    // with them, which is exactly the artefact snapping exists to remove.
    //
    // Build the axes from the SUN instead - they turn over the course of the
    // day but not with the player - measure the centre along them, round those
    // two numbers onto the shadow-map grid, and rebuild the point. The map's
    // sampling grid is then welded to the world and steps a whole texel at a
    // time, so a shadow edge stays put on the block that casts it.
    const ax = this.lightX.crossVectors(up, sunDir).normalize();
    const ay = this.lightY.crossVectors(sunDir, ax);
    const texel = (EXTENT * 2) / MAP_SIZE;
    const snapped = this.scratch
      .setScalar(0)
      .addScaledVector(ax, Math.round(this.centre.dot(ax) / texel) * texel)
      .addScaledVector(ay, Math.round(this.centre.dot(ay) / texel) * texel)
      // Depth along the sun ray is not sampled on a grid, so it is kept exact.
      .addScaledVector(sunDir, this.centre.dot(sunDir));

    // lookAt with this same `up` reproduces (ax, ay, sunDir) as the camera's
    // own axes, so the snap above lands on the grid the projection actually
    // uses rather than on a near-miss of it.
    cam.up.copy(up);
    cam.position.copy(snapped).addScaledVector(sunDir, BACK_OFF);
    cam.lookAt(snapped);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    // World -> shadow UV, then a translation by the shading origin folded onto
    // the RIGHT so the shader can hand it an origin-relative position: the
    // product is exactly what `M * vec4(rel + origin, 1)` would have been, but
    // with the huge cancelling intermediates done here in float64 instead of in
    // a float32 fragment shader. See ShadowUniforms.origin.
    this.out.matrix.value
      .copy(this.bias)
      .multiply(cam.projectionMatrix)
      .multiply(cam.matrixWorldInverse)
      .multiply(this.originShift.makeTranslation(
        this.out.origin.value.x, this.out.origin.value.y, this.out.origin.value.z));

    // Draw. Only layer 1 is in this camera's view, so the sky dome, the clouds,
    // the water and every UI-side mesh sit this pass out.
    const prevTarget = this.renderer.getRenderTarget();
    const prevOverride = this.scene.overrideMaterial;
    const prevFog = this.scene.fog;
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.getClearColor(this.prevClear);
    this.scene.overrideMaterial = this.depthMat;
    this.scene.fog = null;
    this.renderer.setRenderTarget(this.target);
    // White clears to the far plane once unpacked, so anything the map does not
    // cover reads as "nothing in the way" rather than as a shadow.
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(prevTarget);
    // The clear colour is renderer-wide state and the sky is painted with it.
    this.renderer.setClearColor(this.prevClear, prevAlpha);
    this.scene.overrideMaterial = prevOverride;
    this.scene.fog = prevFog;
  }

  dispose(): void {
    this.teardown();
  }
}
