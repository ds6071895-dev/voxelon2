// Pixel-art equipment and resources for Bedwars.
//
// House rules for these 16px sprites: every material gets a four-step ramp with
// the light from the top left, a one-pixel specular, and an outline that is a
// dark shade of the neighbouring material rather than one flat black, so a
// sword reads as steel and a handle as leather instead of as clip-art.
import { Tile } from './blocks';
import { Grid, hex, mix, type Paint, type RGBA } from './tile_art';

type Ramp = [RGBA, RGBA, RGBA, RGBA]; // dark, mid, light, specular
const ramp4 = (a: number, b: number, c: number, d: number): Ramp => [hex(a), hex(b), hex(c), hex(d)];
const darker = (c: RGBA, k: number): RGBA => [c[0] * k, c[1] * k, c[2] * k, 255];

/** Outline every transparent pixel touching the art, in a dark shade of what it touches. */
function outline(g: Grid, k = 0.42): void {
  const add: [number, number, RGBA][] = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (g.get(x, y)) continue;
    const near = g.get(x + 1, y) ?? g.get(x, y + 1) ?? g.get(x - 1, y) ?? g.get(x, y - 1);
    if (near) add.push([x, y, darker(near, k)]);
  }
  for (const [x, y, c] of add) g.put(x, y, c);
}
const sprite = (draw: (g: Grid) => void): Paint => p => { const g = new Grid(); draw(g); outline(g); g.to(p); };
const rect = (g: Grid, x: number, y: number, w: number, h: number, c: RGBA): void => {
  for (let a = x; a < x + w; a++) for (let b = y; b < y + h; b++) g.put(a, b, c);
};
const line = (g: Grid, pts: [number, number][], c: RGBA): void => { for (const [x, y] of pts) g.put(x, y, c); };

const WOOD = ramp4(0x6b4524, 0x8f6535, 0xb98a4e, 0xdcb677);
const STONE = ramp4(0x5d666d, 0x818c93, 0xa9b4b9, 0xd3dade);
const IRON = ramp4(0x7d8b99, 0xb4c1cc, 0xdbe6ee, 0xffffff);
const GOLD = ramp4(0xb5791a, 0xe3a826, 0xf8cd4d, 0xfff2a8);
const DIAMOND = ramp4(0x1a9aa8, 0x38cfd9, 0x8af1ef, 0xe6fffc);
const EMERALD = ramp4(0x0f7a3e, 0x20b25f, 0x59e08e, 0xcaffdf);
const PLANK = ramp4(0x9a6b34, 0xc79a58, 0xe6c286, 0xf8e6b8);
const LEATHER = ramp4(0x4a2e18, 0x6b4426, 0x8d6137, 0xb3854f);

// ── Swords: blade from the lower left hilt to the upper right tip ────────────
const sword = (blade: Ramp, guard: Ramp): Paint => sprite(g => {
  for (let i = 0; i < 8; i++) {
    g.put(13 - i, 2 + i, blade[2]);                 // lit edge
    if (i > 0) g.put(13 - i, 3 + i, blade[1]);      // body
    if (i > 1) g.put(13 - i, 4 + i, blade[0]);      // shaded flank
  }
  g.put(13, 2, blade[3]); g.put(12, 3, blade[3]); g.put(11, 4, blade[3]); // glint along the edge
  line(g, [[3, 10], [4, 11], [5, 12], [6, 13], [7, 14]], guard[1]);
  line(g, [[3, 11], [4, 12], [5, 13], [6, 14]], guard[0]);
  g.put(3, 10, guard[2]); g.put(4, 11, guard[2]);
  line(g, [[4, 13], [3, 14]], LEATHER[1]); g.put(4, 14, LEATHER[0]);
  g.put(2, 15, guard[1]); g.put(3, 15, guard[0]);
});

// ── Pickaxes and axes: handle bottom left to top right ──────────────────────
const handle = (g: Grid, from: number, to: number): void => {
  for (let i = from; i <= to; i++) { g.put(2 + i, 14 - i, LEATHER[2]); g.put(2 + i, 15 - i, LEATHER[0]); }
  g.put(2 + from, 14 - from, LEATHER[3]);
};
const pickaxe = (head: Ramp): Paint => sprite(g => {
  handle(g, 0, 9);
  const arc: [number, number][] = [[4, 4], [5, 3], [6, 2], [7, 2], [8, 2], [9, 2], [10, 3], [11, 4], [12, 5], [12, 6], [12, 7]];
  arc.forEach(([x, y], i) => { g.put(x, y, i < 4 ? head[2] : head[1]); g.put(x, y + 1, i < 4 ? head[1] : head[0]); });
  g.put(5, 3, head[3]); g.put(7, 2, head[3]);
  g.put(3, 5, head[0]); g.put(12, 8, head[0]);
});
const axe = (head: Ramp): Paint => sprite(g => {
  handle(g, 0, 8);
  const rows: [number, number, number][] = [[3, 7, 12], [4, 6, 13], [5, 6, 13], [6, 6, 13], [7, 7, 12], [8, 8, 11]];
  for (const [y, a, b] of rows) for (let x = a; x <= b; x++) g.put(x, y, x - a < 2 ? head[2] : x > b - 2 ? head[0] : head[1]);
  g.put(7, 4, head[3]); g.put(8, 4, head[3]);
});
const shears = sprite(g => {
  const red = ramp4(0x7a1f1a, 0xb83a2e, 0xe0584a, 0xff9a86);
  // Two blades crossing at the pivot, opening upward.
  for (let i = 0; i < 8; i++) {
    g.put(4 + i, 1 + i, IRON[2]); g.put(5 + i, 1 + i, IRON[1]);
    g.put(11 - i, 1 + i, IRON[1]); g.put(12 - i, 1 + i, IRON[0]);
  }
  g.put(4, 1, IRON[3]); g.put(11, 1, IRON[3]); g.put(7, 4, IRON[3]);
  g.put(8, 5, hex(0x3a424b)); g.put(7, 5, hex(0x3a424b));
  // Ring handles, hole in the middle.
  for (const x0 of [1, 10]) {
    rect(g, x0, 9, 5, 6, red[1]); rect(g, x0 + 1, 10, 3, 4, hex(0x000000));
    line(g, [[x0, 9], [x0 + 1, 9], [x0 + 2, 9], [x0 + 3, 9], [x0 + 4, 9], [x0, 10], [x0, 11]], red[2]);
    line(g, [[x0 + 4, 12], [x0 + 4, 13], [x0 + 4, 14], [x0 + 1, 14], [x0 + 2, 14], [x0 + 3, 14]], red[0]);
    for (let y = 10; y <= 13; y++) for (let x = x0 + 1; x <= x0 + 3; x++) g.px[y * 16 + x] = null;
  }
});

// ── Consumables ─────────────────────────────────────────────────────────────
const TNT_GLYPHS: Record<string, string[]> = { T: ['###', '.#.', '.#.', '.#.', '.#.'], N: ['#.#', '###', '###', '#.#', '#.#'] };
const tnt = sprite(g => {
  const red = ramp4(0x7e1d1a, 0xb9302a, 0xe0503f, 0xff8c72);
  rect(g, 2, 4, 12, 11, red[1]);
  rect(g, 2, 4, 2, 11, red[2]); rect(g, 12, 4, 2, 11, red[0]);
  rect(g, 2, 13, 12, 2, red[0]);
  for (const x of [5, 8, 10]) line(g, [[x, 4], [x, 5], [x, 12]], red[0]);
  rect(g, 2, 7, 12, 5, hex(0xf0e6cf)); rect(g, 2, 11, 12, 1, hex(0xc9bd9f));
  let cx = 3;
  for (const ch of 'TNT') {
    TNT_GLYPHS[ch].forEach((row, dy) => [...row].forEach((v, dx) => { if (v === '#') g.put(cx + dx, 7 + dy, hex(0x3a2c2c)); }));
    cx += 4;
  }
  rect(g, 7, 2, 2, 3, WOOD[1]); g.put(7, 2, WOOD[2]);
  line(g, [[9, 1], [10, 0], [8, 0]], GOLD[3]); g.put(9, 2, hex(0xff9d2e));
});
const pearl = sprite(g => {
  const pal = [hex(0x103f4f), hex(0x1b6f78), hex(0x2fae9b), hex(0x6fe0b8), hex(0xc4ffe6)];
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    const dx = x - 7.4, dy = y - 7.4, d = Math.hypot(dx, dy);
    if (d > 6.6) continue;
    // Light from the upper left; a violet swirl crosses the middle.
    const lit = 1 - (Math.hypot(x - 5.2, y - 5)) / 9.5;
    let c = pal[Math.max(0, Math.min(4, Math.round(lit * 4 + (((x ^ y) & 1) ? 0.18 : -0.1))))];
    if (Math.abs(dy + 0.55 * dx - 1) < 0.7 && d > 1.5) c = mix(c, hex(0x7a52d6), 0.55);
    g.put(x, y, c);
  }
  g.put(4, 4, pal[4]); g.put(5, 3, pal[4]); g.put(4, 5, pal[3]);
});
const apple = sprite(g => {
  for (let y = 4; y < 14; y++) for (let x = 2; x < 14; x++) {
    const dx = (x - 7.6) / 5.7, dy = (y - 9.2) / 5.1;
    if (dx * dx + dy * dy > 1 || (y === 4 && Math.abs(x - 7.6) < 1.1)) continue;
    const lit = 1 - Math.hypot(x - 5.6, y - 7.2) / 9;
    g.put(x, y, GOLD[Math.max(0, Math.min(3, Math.round(lit * 3.2 + (((x + y) & 1) ? 0.1 : -0.1))))]);
  }
  g.put(5, 6, GOLD[3]); g.put(5, 7, GOLD[3]); g.put(6, 6, GOLD[3]);
  rect(g, 7, 1, 1, 4, LEATHER[1]); rect(g, 8, 2, 1, 2, LEATHER[0]);
  line(g, [[9, 2], [10, 1], [11, 1], [10, 2], [11, 2]], hex(0x4f9a3a));
  g.put(10, 1, hex(0x7cc95e));
});
const armor = (m: Ramp, chain = false): Paint => sprite(g => {
  // A chestplate: shoulder caps, neckline, plated torso, belt line.
  const body: [number, number, number][] = [[2, 2, 6], [2, 9, 13], [3, 1, 14], [4, 1, 14], [5, 2, 13], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 3, 12], [10, 3, 12], [11, 4, 11], [12, 4, 11], [13, 5, 10]];
  for (const [y, a, b] of body) for (let x = a; x <= b; x++) {
    const shade = x <= a + 1 ? m[2] : x >= b - 1 ? m[0] : y < 5 ? m[2] : m[1];
    g.put(x, y, shade);
  }
  for (let y = 2; y < 6; y++) for (let x = 7; x <= 8; x++) g.px[y * 16 + x] = null; // neck opening
  for (let y = 6; y <= 12; y++) { g.put(7, y, m[0]); g.put(8, y, m[0]); }
  rect(g, 4, 12, 8, 1, m[0]); rect(g, 4, 11, 8, 1, m[2]);
  g.put(4, 6, m[3]); g.put(5, 5, m[3]); g.put(3, 3, m[3]);
  if (chain) for (let y = 7; y < 12; y++) for (let x = 4; x < 12; x++) if (x !== 7 && x !== 8 && (x + y) % 2 === 0) g.put(x, y, darker(m[1], 0.7));
});

// ── Resources: silhouettes differ, not only colours ─────────────────────────
const ingot = (m: Ramp): Paint => sprite(g => {
  // A bar seen from a corner: lit top, front face, shaded end.
  for (let x = 3; x <= 12; x++) { g.put(x, 6, m[2]); g.put(x, 7, m[2]); }
  for (let x = 5; x <= 13; x++) g.put(x, 5, m[3]);
  for (let x = 2; x <= 11; x++) for (let y = 8; y <= 11; y++) g.put(x, y, y === 8 ? m[2] : y === 11 ? m[0] : m[1]);
  for (let y = 6; y <= 10; y++) { g.put(12, y, m[0]); g.put(13, y - 1, m[0]); }
  g.put(3, 9, m[3]); g.put(4, 9, m[3]); g.put(2, 7, m[2]);
});
const gem = (m: Ramp, hexagon: boolean): Paint => sprite(g => {
  const cx = 7.5, cy = 8;
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    const dx = Math.abs(x - cx) / 6.4, dy = Math.abs(y - cy) / (hexagon ? 6.2 : 6.6);
    const inside = hexagon ? dx <= 1 && dy <= 1 && dx + dy <= 1.45 : dx + dy <= 1.05;
    if (!inside) continue;
    // Facets: the upper left lit, the lower right shaded, a bright centre ridge.
    const f = (cx - x) * 0.55 + (cy - y) * 0.6;
    const base = f > 2.4 ? m[3] : f > 0.6 ? m[2] : f > -2 ? m[1] : m[0];
    g.put(x, y, base);
  }
  if (hexagon) { rect(g, 6, 4, 4, 1, m[3]); line(g, [[4, 8], [5, 7], [10, 7], [11, 8]], m[2]); line(g, [[7, 9], [8, 9], [7, 10], [8, 10]], m[0]); }
  else { line(g, [[7, 3], [8, 3], [6, 5], [9, 5]], m[3]); line(g, [[4, 7], [5, 7], [10, 7], [11, 7]], m[2]); line(g, [[7, 8], [8, 8], [7, 9], [8, 9], [7, 11], [8, 11]], m[0]); }
  g.put(5, 5, m[3]); g.put(4, 6, m[3]);
});

export const BEDWARS_ART: Partial<Record<Tile, Paint>> = {
  [Tile.WoodSword]: sword(WOOD, ramp4(0x4a2e18, 0x6b4426, 0x8d6137, 0xb3854f)),
  [Tile.StoneSword]: sword(STONE, WOOD),
  [Tile.IronSword]: sword(IRON, STONE),
  [Tile.DiamondSword]: sword(DIAMOND, GOLD),
  [Tile.WoodPickaxe]: pickaxe(PLANK),
  [Tile.IronPickaxe]: pickaxe(IRON),
  [Tile.WoodAxe]: axe(PLANK),
  [Tile.Shears]: shears,
  [Tile.BedwarsTNT]: tnt,
  [Tile.TeleportPearl]: pearl,
  [Tile.HealingApple]: apple,
  [Tile.ChainArmor]: armor(ramp4(0x4d5864, 0x7a8896, 0xa4b2bf, 0xdce6ee), true),
  [Tile.IronArmor]: armor(IRON),
  [Tile.DiamondArmor]: armor(DIAMOND),
  [Tile.IronIngot]: ingot(IRON),
  [Tile.GoldIngot]: ingot(GOLD),
  [Tile.DiamondGem]: gem(DIAMOND, false),
  [Tile.EmeraldGem]: gem(EMERALD, true),
};
