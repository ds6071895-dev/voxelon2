// Item icon rendering shared by the hotbar and the inventory UI:
// isometric mini-blocks for cube blocks, 3D gadget previews, and flat sprites
// for everything else.

import * as THREE from 'three';
import { BLOCKS, Tile } from './blocks';
import { createGadgetModel, isModeledGadget } from './gadgetmodels';
import { Item, ITEMS } from './items';
import { TILE_PX, ATLAS_TILES } from './textures';

const ICON_GRASS = '#91bd59';
const ICON_FOLIAGE = '#71a83d';

const gadgetIconCache = new Map<number, HTMLCanvasElement>();
let gadgetIconRenderer: THREE.WebGLRenderer | null | undefined;

/** Render the existing in-world gadget geometry once, then reuse the resulting
 * transparent image in every hotbar and inventory slot. */
function drawGadgetIcon(ctx: CanvasRenderingContext2D, itemId: number): boolean {
  const cached = gadgetIconCache.get(itemId);
  if (cached) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cached, 0, 0, 32, 32);
    return true;
  }
  if (gadgetIconRenderer === null) return false;
  if (gadgetIconRenderer === undefined) {
    try {
      gadgetIconRenderer = new THREE.WebGLRenderer({
        alpha: true, antialias: true, preserveDrawingBuffer: true,
      });
      gadgetIconRenderer.setClearColor(0x000000, 0);
      gadgetIconRenderer.setPixelRatio(1);
      gadgetIconRenderer.setSize(96, 96, false);
      gadgetIconRenderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch {
      gadgetIconRenderer = null;
      return false;
    }
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  camera.position.set(3, 2.5, 4);
  camera.lookAt(0, 0, 0);
  const model = createGadgetModel(itemId);
  model.rotation.set(
    itemId === Item.JumpBoost ? -0.12 : 0.18,
    itemId === Item.JumpBoost ? -0.55 : -0.72,
    itemId === Item.JumpBoost ? -0.08 : 0.12,
  );
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const scale = 0.84 / Math.max(0.001, radius);
  model.position.copy(center).multiplyScalar(-scale);
  model.scale.setScalar(scale);
  scene.add(model);
  gadgetIconRenderer.render(scene, camera);

  const image = document.createElement('canvas');
  image.width = image.height = 96;
  image.getContext('2d')!.drawImage(gadgetIconRenderer.domElement, 0, 0);
  gadgetIconCache.set(itemId, image);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, 0, 0, 32, 32);
  return true;
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
  const sx = (tile % ATLAS_TILES) * TILE_PX;
  const sy = Math.floor(tile / ATLAS_TILES) * TILE_PX;
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

/** Draw an item's icon into a 32x32 canvas. */
export function renderItemIcon(
  icon: HTMLCanvasElement, atlasCanvas: HTMLCanvasElement, itemId: number
): void {
  const ctx = icon.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, icon.width, icon.height);
  ctx.imageSmoothingEnabled = false;
  const info = ITEMS[itemId];
  if (!info) return;

  if (isModeledGadget(itemId) && drawGadgetIcon(ctx, itemId)) return;

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
