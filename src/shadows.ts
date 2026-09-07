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
// - The camera's centre is SNAPPED to whole shadow texels every frame. Without
//   it, moving the player slides the sampling grid under the world and every
//   shadow edge crawls and fizzes. This is the single most important line in
//   the file.
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
  matrix: { value: THREE.Matrix4 };
  /** x: on (0/1), y: one texel in UV, z: how much light a shadow takes away. */
  params: { value: THREE.Vector3 };
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
  private readonly prevClear = new THREE.Color();
  private readonly scratch = new THREE.Vector3();
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
   * @param sunDir  Unit vector from the world toward the sun.
   * @param focus   Where to centre the box (the player's eye).
   * @param sunUp   Sun height, -1..1. Shadows fade out as it touches the
   *                horizon and are gone at night: a hard-edged shadow cast by
   *                a sun that is not visible is the classic shader-pack bug.
   */
  update(sunDir: THREE.Vector3, focus: THREE.Vector3, sunUp: number): void {
    if (!this.enabled || !this.target || !this.depthMat) return;

    const strength = 0.62 * THREE.MathUtils.smoothstep(sunUp, 0.03, 0.22);
    this.out.params.value.z = strength;
    this.out.params.value.x = strength > 0.004 ? 1 : 0;
    if (strength <= 0.004) return;   // night: nothing to draw, nothing to read

    this.centre.copy(focus);

    const cam = this.camera;
    cam.position.copy(this.centre).addScaledVector(sunDir, BACK_OFF);
    // A sun straight overhead makes the default up vector degenerate.
    cam.up.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.999) cam.up.set(0, 0, 1);
    cam.lookAt(this.centre);
    cam.updateMatrixWorld(true);

    // Texel snapping. Take the centre into light space, round it onto the
    // shadow-map grid, and take it back out. Everything the map covers then
    // moves in whole-texel steps as the player walks, so a shadow edge stays
    // welded to the block it belongs to instead of shimmering along it.
    const texel = (EXTENT * 2) / MAP_SIZE;
    const snapped = this.scratch.copy(this.centre).applyMatrix4(cam.matrixWorldInverse);
    snapped.x = Math.round(snapped.x / texel) * texel;
    snapped.y = Math.round(snapped.y / texel) * texel;
    snapped.applyMatrix4(cam.matrixWorld);
    cam.position.copy(snapped).addScaledVector(sunDir, BACK_OFF);
    cam.lookAt(snapped);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    this.out.matrix.value
      .copy(this.bias)
      .multiply(cam.projectionMatrix)
      .multiply(cam.matrixWorldInverse);

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
