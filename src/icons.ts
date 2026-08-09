// Item icon rendering shared by the hotbar and the inventory UI:
// isometric mini-blocks for cube blocks, flat sprites for everything else.

import { BLOCKS, Tile } from './blocks';
import { Item, ITEMS } from './items';
import { TILE_PX, ATLAS_TILES } from './textures';

const ICON_GRASS = '#91bd59';
const ICON_FOLIAGE = '#71a83d';

/** Dimensional low-poly side view matching the in-world gun models. */
function drawGunIcon(ctx: CanvasRenderingContext2D, itemId: number): void {
  const long = itemId !== Item.Pistol && itemId !== Item.SMG;
  const rocket = itemId === Item.RocketLauncher;
  const shotgun = itemId === Item.Shotgun;
  const sniper = itemId === Item.Sniper;
  const x0 = long ? 3 : 7, x1 = long ? 28 : 25;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#11151a'; ctx.lineWidth = 1.5;
  ctx.fillStyle = rocket ? '#53634b' : shotgun ? '#70472b' : '#46515b';
  ctx.beginPath();
  ctx.moveTo(x0, 11); ctx.lineTo(x1, 11); ctx.lineTo(x1 - 2, 17);
  ctx.lineTo(x0 + 5, 18); ctx.lineTo(x0, 15); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Bright top face creates the same chunky 3D read as the box model.
  ctx.fillStyle = rocket ? '#77866a' : '#77838d';
  ctx.beginPath(); ctx.moveTo(x0, 11); ctx.lineTo(x0 + 3, 8);
  ctx.lineTo(x1, 8); ctx.lineTo(x1, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#252a30';
  ctx.beginPath(); ctx.moveTo(13, 17); ctx.lineTo(18, 17);
  ctx.lineTo(17, 27); ctx.lineTo(13, 25); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (shotgun) {
    ctx.fillStyle = '#aeb6bd'; ctx.fillRect(3, 8, 21, 3); ctx.strokeRect(3, 8, 21, 3);
  }
  if (sniper || itemId === Item.BurstRifle || rocket) {
    ctx.fillStyle = '#161a1f'; ctx.fillRect(10, 4, 11, 4); ctx.strokeRect(10, 4, 11, 4);
  }
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
