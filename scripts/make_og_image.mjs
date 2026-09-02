// Generates public/og.png — the link-preview card social platforms show when a
// VOXELON URL is shared. Procedural like everything else in this repo: a tiny
// hand-rolled PNG encoder plus a 5x7 block font, so there is no binary asset to
// check in and no external image dependency. Re-run with `npm run og-image`.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200, H = 630;

// --- 5x7 block font ---------------------------------------------------------
// Only the glyphs the card actually needs. '#' is ink, '.' is empty.
const GLYPHS = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  G: '.###.|#...#|#....|#..##|#...#|#...#|.###.',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  '·': '.....|.....|.....|..#..|.....|.....|.....',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
};

// --- framebuffer ------------------------------------------------------------
const px = new Uint8Array(W * H * 3);
const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = r; px[i + 1] = g; px[i + 2] = b;
};
const rect = (x0, y0, w, h, [r, g, b]) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, r, g, b);
};
const text = (s, x0, y0, scale, [r, g, b], gap = 1) => {
  let x = x0;
  for (const ch of s.toUpperCase()) {
    const rows = (GLYPHS[ch] ?? GLYPHS[' ']).split('|');
    for (let ry = 0; ry < rows.length; ry++)
      for (let rx = 0; rx < rows[ry].length; rx++)
        if (rows[ry][rx] === '#') rect(x + rx * scale, y0 + ry * scale, scale, scale, [r, g, b]);
    x += (5 + gap) * scale;
  }
  return x - gap * scale; // right edge of the drawn run
};
const textWidth = (s, scale, gap = 1) => s.length * (5 + gap) * scale - gap * scale;

// --- the card ---------------------------------------------------------------
const INK = [0x0f, 0x1a, 0x24], INK2 = [0x16, 0x23, 0x2f], GOLD = [0xd7, 0x8a, 0x0c];
const MUTED = [0x7f, 0x93, 0xa6], CRIMSON = [0xe2, 0x3b, 0x3b], AZURE = [0x3b, 0x78, 0xe2];

// Vertical ink gradient.
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const c = [0, 1, 2].map((i) => Math.round(INK[i] + (INK2[i] - INK[i]) * t));
  rect(0, y, W, 1, c);
}
// Faint voxel grid, so the card reads as a block game at thumbnail size.
for (let y = 0; y < H; y += 30) rect(0, y, W, 1, [0x1c, 0x2b, 0x38]);
for (let x = 0; x < W; x += 30) rect(x, 0, 1, H, [0x1c, 0x2b, 0x38]);

// Blocky terrain silhouette along the bottom edge.
let hgt = 5;
for (let cx = 0; cx < W / 30; cx++) {
  hgt = Math.max(2, Math.min(7, hgt + (Math.sin(cx * 1.7) > 0 ? 1 : -1)));
  rect(cx * 30, H - hgt * 30, 30, hgt * 30, [0x18, 0x2a, 0x22]);
  rect(cx * 30, H - hgt * 30, 30, 30, [0x24, 0x3d, 0x2c]); // grass cap
}

// Wordmark, centred.
const MARK = 'VOXELON';
const ms = 14;
const mx = Math.round((W - textWidth(MARK, ms)) / 2);
text(MARK, mx, 150, ms, GOLD);

// Gold rule under the wordmark, with the two faction colours at its ends.
rect(mx, 150 + 7 * ms + 34, textWidth(MARK, ms), 5, GOLD);
rect(mx - 60, 150 + 7 * ms + 34, 46, 5, CRIMSON);
rect(mx + textWidth(MARK, ms) + 14, 150 + 7 * ms + 34, 46, 5, AZURE);

// Tagline.
const TAG = 'MINE DEEP · BUILD HIGH · TAKE GROUND';
const ts = 4;
text(TAG, Math.round((W - textWidth(TAG, ts)) / 2), 150 + 7 * ms + 80, ts, MUTED);

// --- PNG encode -------------------------------------------------------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour RGB

// One filter byte (0 = None) per scanline.
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0;
  Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og.png');
fs.writeFileSync(out, png);
console.log(`og image -> ${out} (${W}x${H}, ${(png.length / 1024).toFixed(1)} KB)`);
