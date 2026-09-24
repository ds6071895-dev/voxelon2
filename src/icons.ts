// Item icon rendering shared by the hotbar and the inventory UI:
// isometric mini-blocks for cube blocks, 3D gadget previews, and flat sprites
// for everything else.

import * as THREE from 'three';
import { Block, BLOCKS, Tile } from './blocks';
import { createGadgetModel, isModeledGadget } from './gadgetmodels';
import { createGunModel } from './gunmodels';
import { createBoatRig } from './boatmodel';
import { Item, ITEMS } from './items';
import { TILE_PX, tileOrigin } from './textures';

const ICON_GRASS = '#91bd59';
const ICON_FOLIAGE = '#71a83d';

const modelIconCache = new Map<number, HTMLCanvasElement>();
let modelIconRenderer: THREE.WebGLRenderer | null | undefined;
const ICON_RES = 128;

/** Render a real 3D model once (gadgets, throwables, the torch, guns), then
 * reuse the resulting transparent image in every hotbar and inventory slot.
 * `view` picks the camera: a 3/4 isometric look for compact props, or a
 * right-side profile with the muzzle raised for long guns. */
function drawModelIcon(
  ctx: CanvasRenderingContext2D, itemId: number, view: 'iso' | 'profile',
  build: () => THREE.Object3D,
): boolean {
  const cached = modelIconCache.get(itemId);
  if (cached) {
    blitIcon(ctx, cached);
    return true;
  }
  if (modelIconRenderer === null) return false;
  if (modelIconRenderer === undefined) {
    try {
      modelIconRenderer = new THREE.WebGLRenderer({
        alpha: true, antialias: true, preserveDrawingBuffer: true,
      });
      modelIconRenderer.setClearColor(0x000000, 0);
      modelIconRenderer.setPixelRatio(1);
      modelIconRenderer.setSize(ICON_RES, ICON_RES, false);
      modelIconRenderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch {
      modelIconRenderer = null;
      return false;
    }
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  const model = build();
  model.position.set(0, 0, 0);
  model.scale.setScalar(1);
  if (view === 'profile') {
    // Right flank toward the camera, barrel to the right, a touch of top and
    // muzzle face so it reads as a solid object, not a silhouette.
    camera.position.set(4, 1.5, -1.1);
    model.rotation.set(0.42, 0, 0);
  } else {
    camera.position.set(3, 2.5, 4);
    model.rotation.set(
      itemId === Item.JumpBoost ? -0.12 : 0.18,
      itemId === Item.JumpBoost ? -0.55 : -0.72,
      // The torch leans across the slot diagonally, flame to the top right.
      itemId === Item.JumpBoost ? -0.08 : itemId === Block.Torch ? -0.62 : 0.12,
    );
  }
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  // Fit the model's real projected silhouette (every vertex in camera space),
  // so long guns fill the slot and small throwables are not lost in it.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    }
  });
  if (!Number.isFinite(minX)) return false;
  const extent = Math.max(0.001, (maxX - minX) / 2, (maxY - minY) / 2);
  const scale = 0.9 / extent;
  model.scale.setScalar(scale);
  // Camera-space x/y scale linearly with the model about the look-at origin,
  // so re-centre by sliding the ortho frustum rather than the model.
  const cx = (minX + maxX) / 2 * scale, cy = (minY + maxY) / 2 * scale;
  camera.left = cx - 1; camera.right = cx + 1;
  camera.top = cy + 1; camera.bottom = cy - 1;
  camera.near = -20; camera.far = 40;
  camera.updateProjectionMatrix();
  scene.add(model);
  modelIconRenderer.render(scene, camera);

  const image = document.createElement('canvas');
  image.width = image.height = ICON_RES;
  image.getContext('2d')!.drawImage(modelIconRenderer.domElement, 0, 0);
  modelIconCache.set(itemId, image);
  blitIcon(ctx, image);
  return true;
}

/** Draw a cached model render into a slot with a crisp dark rim + a soft drop
 *  shadow, so it separates from any slot colour like the pixel sprites do. */
function blitIcon(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = Math.max(1, w / 32);
  ctx.shadowOffsetY = Math.max(0.5, w / 48);
  ctx.drawImage(image, 0, 0, w, h);
  ctx.restore();
}

/** Dimensional low-poly side view matching the in-world gun models. */
function drawGunIcon(ctx: CanvasRenderingContext2D, itemId: number): void {
  const edge = '#11151a', dark = '#252a30', steel = '#59636d';
  const rect = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = edge; ctx.strokeRect(x, y, w, h);
  };
  const poly = (points: [number, number][], color: string): void => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  };
  ctx.lineJoin = 'miter'; ctx.lineCap = 'square';
  ctx.strokeStyle = edge; ctx.lineWidth = 1.25;

  if (itemId === Item.Pistol) {
    rect(7, 9, 19, 6, steel); rect(9, 8, 15, 2, '#89949d');
    rect(17, 11, 5, 3, '#111418');
    poly([[10, 15], [17, 15], [15, 27], [10, 25]], dark);
    rect(11, 18, 2, 5, '#70472b'); rect(24, 12, 3, 3, '#111418');
    return;
  }
  if (itemId === Item.SMG) {
    rect(8, 9, 16, 8, '#315a72'); rect(10, 8, 13, 2, '#477d96');
    rect(23, 11, 5, 3, '#111418'); rect(5, 11, 3, 2, dark);
    ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.strokeRect(2, 8, 6, 7);
    ctx.strokeStyle = edge; ctx.lineWidth = 1.25;
    poly([[12, 17], [17, 17], [16, 28], [12, 27]], dark);
    poly([[7, 17], [11, 17], [9, 25], [6, 24]], '#3e474d');
    return;
  }
  if (itemId === Item.Shotgun) {
    rect(4, 8, 23, 3, '#89949d'); rect(4, 12, 23, 3, steel);
    rect(12, 15, 7, 5, steel); rect(19, 16, 6, 3, '#9a7a4d');
    poly([[4, 15], [12, 15], [10, 20], [3, 22], [1, 20]], '#70472b');
    rect(26, 8, 2, 3, '#111418'); rect(26, 12, 2, 3, '#111418');
    return;
  }
  if (itemId === Item.RocketLauncher) {
    rect(3, 8, 26, 9, '#53634b'); rect(7, 7, 17, 3, '#748169');
    rect(2, 7, 4, 11, dark); rect(27, 7, 3, 11, dark);
    rect(10, 4, 10, 4, dark); rect(11, 18, 5, 9, dark);
    rect(17, 18, 4, 6, '#252a30'); rect(9, 9, 12, 2, '#9a7a4d');
    return;
  }
  if (itemId === Item.Sniper) {
    rect(3, 11, 25, 3, '#111418'); rect(11, 13, 10, 6, steel);
    rect(8, 5, 13, 4, dark); rect(9, 9, 2, 3, edge); rect(18, 9, 2, 3, edge);
    rect(20, 6, 2, 2, '#2d7896');
    poly([[2, 14], [12, 14], [10, 19], [3, 21], [1, 19]], '#70472b');
    poly([[12, 18], [17, 18], [16, 27], [12, 26]], dark);
    rect(27, 10, 3, 5, '#3e474d');
    return;
  }
  if (itemId === Item.BurstRifle) {
    rect(7, 10, 19, 7, '#315a72'); rect(18, 8, 9, 4, dark);
    rect(25, 12, 4, 3, '#111418');
    ctx.strokeStyle = edge; ctx.lineWidth = 2.5;
    ctx.strokeRect(9, 5, 10, 5); ctx.lineWidth = 1.25;
    rect(11, 8, 6, 2, '#477d96');
    poly([[12, 17], [17, 17], [19, 27], [14, 27]], dark);
    poly([[2, 13], [7, 11], [7, 17], [2, 19]], dark);
    return;
  }
  // Automatic rifle: warm wood furniture and a curved magazine distinguish it.
  rect(8, 10, 18, 7, '#3e474d'); rect(18, 9, 11, 3, '#111418');
  rect(17, 13, 8, 5, '#70472b'); rect(25, 11, 5, 3, '#111418');
  poly([[2, 12], [8, 10], [8, 17], [3, 20], [1, 18]], '#70472b');
  poly([[11, 17], [16, 17], [18, 27], [14, 28], [12, 23]], dark);
  rect(9, 8, 9, 2, '#89949d');
}

function tileSource(
  atlasCanvas: HTMLCanvasElement, tile: number, tint: string | null
): CanvasImageSource {
  // The atlas pads every tile with a gutter, so the art's origin is NOT
  // tile * TILE_PX — ask the atlas where it actually put it.
  const { x: sx, y: sy } = tileOrigin(tile);
  const off = document.createElement('canvas');
  off.width = off.height = TILE_PX;
  const octx = off.getContext('2d')!;
  octx.drawImage(atlasCanvas, sx, sy, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
  if (tint) {
    octx.globalCompositeOperation = 'multiply';
    octx.fillStyle = tint;
    octx.fillRect(0, 0, TILE_PX, TILE_PX);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(atlasCanvas, sx, sy, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
  }
  return off;
}

/** Draw a slab/stairs item icon: the wood tile clipped to the block's side
 *  profile (a bottom band for slabs; an L step for stairs), with a lighter
 *  "sawn" top edge and a dark outline so the shape reads at hotbar size. */
function drawShapeIcon(
  ctx: CanvasRenderingContext2D, atlasCanvas: HTMLCanvasElement,
  tile: number, stairs: boolean
): void {
  const src = tileSource(atlasCanvas, tile, null);
  // Rects in the 32x32 icon making up the profile (x, y, w, h).
  const rects: [number, number, number, number][] = stairs
    ? [[4, 16, 24, 12], [16, 6, 12, 10]] // bottom step (full) + upper-right step
    : [[4, 17, 24, 11]];                 // single half-height slab band
  ctx.save();
  ctx.beginPath();
  for (const [rx, ry, rw, rh] of rects) ctx.rect(rx, ry, rw, rh);
  ctx.clip();
  ctx.drawImage(src, 4, 4, 24, 24); // plank texture, clipped to the profile
  ctx.restore();
  // Lighter sawn edge along each step's top, then a dark outline per rect.
  for (const [rx, ry, rw] of rects) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(rx, ry, rw, 2);
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 1;
  for (const [rx, ry, rw, rh] of rects) ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
}

/** Size + clear an icon canvas: 96px smooth for model renders, 32px pixelated
 *  for everything drawn on the 32px grid. */
function prepareIconCanvas(icon: HTMLCanvasElement, hd: boolean): CanvasRenderingContext2D {
  const size = hd ? ICON_RES : 32;
  if (icon.width !== size || icon.height !== size) { icon.width = size; icon.height = size; }
  icon.style.imageRendering = hd ? 'auto' : '';
  const ctx = icon.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, icon.width, icon.height);
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Empty a slot, including icons previously rendered at model resolution. */
export function clearItemIcon(icon: HTMLCanvasElement): void {
  prepareIconCanvas(icon, false);
}

/** Draw an item's icon into a 32x32 canvas. */
export function renderItemIcon(
  icon: HTMLCanvasElement, atlasCanvas: HTMLCanvasElement, itemId: number
): void {
  const info = ITEMS[itemId];
  // 3D-rendered icons (guns, gadgets, throwables, the torch, the boat) get a
  // high-res backing store drawn smooth; every slot sizes its canvas in CSS,
  // so only the sharpness changes. Pixel-art icons stay 32px and crisp.
  const model = !!info && modelIconRenderer !== null &&
    (!!info.gun || isModeledGadget(itemId) || itemId === Item.Boat);
  const ctx = prepareIconCanvas(icon, model);
  if (!info) return;

  if (model) {
    const drawn = info.gun
      ? drawModelIcon(ctx, itemId, 'profile', () => createGunModel(itemId))
      : itemId === Item.Boat
        ? drawModelIcon(ctx, itemId, 'iso', () => {
          const boat = createBoatRig();
          boat.group.visible = true;
          return boat.group;
        })
        : drawModelIcon(ctx, itemId, 'iso', () => createGadgetModel(itemId));
    if (drawn) return;
    prepareIconCanvas(icon, false); // no WebGL after all: pixel-art fallback
  }

  if (info.gun) {
    drawGunIcon(ctx, itemId);
    return;
  }

  const block = info.kind === 'block' ? BLOCKS[info.block!] : null;

  // Slabs/stairs: draw the wood texture clipped to the block's profile so the
  // hotbar icon actually reads as a slab/stair instead of a full plank square.
  if (block && (block.shape === 'slab' || block.shape === 'stairs')) {
    drawShapeIcon(ctx, atlasCanvas, block.side, block.shape === 'stairs');
    return;
  }

  if (!block || block.shape !== 'cube') {
    // Flat sprite (pure items, plants, torches).
    const tile: Tile = block ? block.side : info.sprite ?? Tile.Stone;
    const tint = block?.tint === 'grass' ? ICON_GRASS : null;
    ctx.drawImage(tileSource(atlasCanvas, tile, tint), 4, 4, 24, 24);
    return;
  }

  const tintFor = (topFace: boolean): string | null => {
    if (block.tint === 'foliage') return ICON_FOLIAGE;
    if (block.tint === 'grass' && topFace) return ICON_GRASS;
    return null;
  };
  const draw = (
    tile: number, m: [number, number, number, number, number, number],
    brightness: number, topFace: boolean
  ) => {
    ctx.setTransform(...m);
    ctx.filter = `brightness(${Math.round(brightness * 100)}%)`;
    ctx.drawImage(tileSource(atlasCanvas, tile, tintFor(topFace)), 0, 0, TILE_PX, TILE_PX);
  };
  // top: quad (0,8)-(16,0)-(32,8)-(16,16); left/right faces below it.
  draw(block.top, [1, -0.5, 1, 0.5, 0, 8], 1.0, true);
  draw(block.side, [1, 0.5, 0, 1, 0, 8], 0.8, false);
  draw(block.side, [1, -0.5, 0, 1, 16, 16], 0.6, false);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
}
