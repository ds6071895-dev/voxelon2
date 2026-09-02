// Generates every raster brand asset VOXELON ships: the link-preview card and
// the PNG app icons that browsers which won't take an SVG favicon fall back to.
// Procedural like everything else in this repo — a tiny hand-rolled PNG encoder
// plus a 5x7 block font — so there is no binary asset to check in by hand and no
// image dependency. Re-run with `npm run brand`.
//
// The geometry here is a transcription of public/favicon.svg: same cube, same
// faces, same gold seam. That file is the mark's definition; this script is the
// rasteriser for the places an SVG can't go.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ── Palette ─────────────────────────────────────────────────────────────────
// Shared verbatim with the game's title screen.
const VOID = [0x05, 0x07, 0x0c], DEEP = [0x11, 0x1a, 0x28];
const GOLD = [0xff, 0xc0, 0x43], GOLD_LIT = [0xff, 0xe6, 0xa8], GOLD_DEEP = [0xf0, 0xa8, 0x25];
const CRIMSON = [0xff, 0x4d, 0x55], CRIMSON_DEEP = [0xa9, 0x1f, 0x26];
const AZURE = [0x4d, 0x9b, 0xff], AZURE_DEEP = [0x1b, 0x4a, 0x8c];
const INK = [0xe9, 0xef, 0xf8], MUTED = [0x6f, 0x84, 0x9f], LINE = [0x1c, 0x2b, 0x3d];

// ── 5x7 block font ──────────────────────────────────────────────────────────
// Only the glyphs the card actually needs. '#' is ink, '.' is empty.
const GLYPHS = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
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
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  '·': '.....|.....|.....|..#..|.....|.....|.....',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
};

// ── Canvas: RGBA, rendered at SS× and box-filtered down ─────────────────────
// Supersampling is what lets a hand-rolled rasteriser draw a clean diagonal
// cube edge and a rounded icon corner without a single line of AA maths.
function canvas(w, h, ss = 3) {
  const W = w * ss, H = h * ss;
  const px = new Uint8ClampedArray(W * H * 4);

  const blend = (x, y, [r, g, b], a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 4, ia = 1 - a;
    px[i] = px[i] * ia + r * a;
    px[i + 1] = px[i + 1] * ia + g * a;
    px[i + 2] = px[i + 2] * ia + b * a;
    px[i + 3] = px[i + 3] * ia + 255 * a;
  };

  const api = {
    W, H, ss,
    /** Solid (or gradient) axis-aligned rectangle in unscaled units. */
    rect(x, y, w2, h2, c, c2 = null) {
      const X = Math.round(x * ss), Y = Math.round(y * ss);
      const W2 = Math.round(w2 * ss), H2 = Math.round(h2 * ss);
      for (let j = 0; j < H2; j++) {
        const t = H2 > 1 ? j / (H2 - 1) : 0;
        const col = c2 ? mix(c, c2, t) : c;
        for (let i2 = 0; i2 < W2; i2++) blend(X + i2, Y + j, col);
      }
    },
    /** Convex polygon, scanline filled. Points are [x, y] in unscaled units. */
    poly(points, c, c2 = null, axis = 'y') {
      const p = points.map(([x, y]) => [x * ss, y * ss]);
      let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
      for (const [x, y] of p) {
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      }
      for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
        const xs = [];
        for (let i = 0; i < p.length; i++) {
          const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
          if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
        if (xs.length < 2) continue;
        xs.sort((a, b) => a - b);
        for (let s = Math.round(xs[0]); s < Math.round(xs[xs.length - 1]); s++) {
          const t = axis === 'y'
            ? (y - y0) / Math.max(1, y1 - y0)
            : (s - x0) / Math.max(1, x1 - x0);
          blend(s, y, c2 ? mix(c, c2, t) : c);
        }
      }
    },
    /** Rounded rectangle — the icon plate. */
    roundRect(x, y, w2, h2, r, c, c2 = null) {
      const X = x * ss, Y = y * ss, W2 = w2 * ss, H2 = h2 * ss, R = r * ss;
      for (let j = 0; j < H2; j++) {
        const cy = Math.min(Math.max(Y + j + .5, Y + R), Y + H2 - R);
        const col = c2 ? mix(c, c2, j / Math.max(1, H2 - 1)) : c;
        for (let i = 0; i < W2; i++) {
          const cx = Math.min(Math.max(X + i + .5, X + R), X + W2 - R);
          const dx = X + i + .5 - cx, dy = Y + j + .5 - cy;
          if (dx * dx + dy * dy <= R * R) blend(X + i, Y + j, col);
        }
      }
    },
    /** A stroked line, drawn as a quad so it can be any thickness. */
    line(ax, ay, bx, by, width, c) {
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (width / 2), ny = (dx / len) * (width / 2);
      api.poly([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]], c);
    },
    /** Block text. Returns the right edge so runs can be chained. */
    text(s, x0, y0, scale, c, gap = 1) {
      let x = x0;
      for (const ch of s.toUpperCase()) {
        const rows = (GLYPHS[ch] ?? GLYPHS[' ']).split('|');
        for (let ry = 0; ry < rows.length; ry++)
          for (let rx = 0; rx < rows[ry].length; rx++)
            if (rows[ry][rx] === '#') api.rect(x + rx * scale, y0 + ry * scale, scale, scale, c);
        x += (5 + gap) * scale;
      }
      return x - gap * scale;
    },
    /** Downsample and encode. */
    png() {
      const out = new Uint8Array(w * h * 4);
      const n = ss * ss;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
          const k = (((y * ss + j) * W) + (x * ss + i)) * 4;
          r += px[k]; g += px[k + 1]; b += px[k + 2]; a += px[k + 3];
        }
        const k = (y * w + x) * 4;
        out[k] = r / n; out[k + 1] = g / n; out[k + 2] = b / n; out[k + 3] = a / n;
      }
      return encodePng(w, h, out);
    },
  };
  return api;
}

const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t))));

// ── The mark ────────────────────────────────────────────────────────────────
// Coordinates are the favicon.svg 64-unit viewBox, scaled by `s` and offset.
function drawMark(c, ox, oy, s) {
  const P = (x, y) => [ox + x * s, oy + y * s];
  c.poly([P(32, 7), P(53, 18), P(32, 29), P(11, 18)], GOLD_LIT, GOLD_DEEP);      // top
  c.poly([P(11, 18), P(32, 29), P(32, 51), P(11, 40)], CRIMSON, CRIMSON_DEEP);   // left
  c.poly([P(53, 18), P(32, 29), P(32, 51), P(53, 40)], AZURE, AZURE_DEEP);       // right
  const [sx, sy] = P(32, 29), [ex, ey] = P(32, 51);
  c.line(sx, sy, ex, ey, 2.6 * s, GOLD);                                         // the front line
}

function iconPng(size) {
  const c = canvas(size, size, 3);
  const u = size / 64;
  c.roundRect(0, 0, size, size, 14 * u, DEEP, VOID);
  drawMark(c, 0, 0, u);
  return c.png();
}

// ── The link-preview card ───────────────────────────────────────────────────
function ogPng() {
  const W = 1200, H = 630;
  const c = canvas(W, H, 2);
  c.rect(0, 0, W, H, [0x07, 0x0a, 0x11], VOID);
  // Faction glow leaning in from either edge, the way the title screen backdrop does.
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const dl = Math.hypot((x - 40) / 620, (y + 60) / 460);
    const dr = Math.hypot((x - 1160) / 620, (y + 20) / 460);
    if (dl < 1) c.rect(x, y, 2, 2, mix(VOID, CRIMSON, (1 - dl) * .22));
    if (dr < 1) c.rect(x, y, 2, 2, mix(VOID, AZURE, (1 - dr) * .22));
  }
  for (let y = 0; y < H; y += 30) c.rect(0, y, W, 1, LINE);
  for (let x = 0; x < W; x += 30) c.rect(x, 0, 1, H, LINE);
  // Blocky terrain silhouette along the bottom edge: two summed sines so the
  // skyline rolls instead of sawtoothing column to column.
  for (let cx = 0; cx < W / 30; cx++) {
    const hgt = Math.round(2.4 + Math.sin(cx * .38) * 1.1 + Math.sin(cx * .11 + 2) * .8);
    const top = H - Math.max(1, hgt) * 30;
    c.rect(cx * 30, top, 30, H - top, [0x13, 0x20, 0x1c]);
    c.rect(cx * 30, top, 30, 30, [0x22, 0x3d, 0x2b]);   // grass cap
    c.rect(cx * 30, top, 30, 3, [0x31, 0x55, 0x39]);    // lit edge
  }

  drawMark(c, W / 2 - 78, 46, 156 / 64);

  const ms = 13;
  const mw = 7 * 6 * ms - ms;
  const mx = Math.round((W - mw) / 2);
  // The wordmark wears the war: VOXEL crimson, ON azure, exactly like the title screen.
  const x = c.text('VOXEL', mx, 244, ms, CRIMSON);
  c.text('ON', x + ms, 244, ms, AZURE);

  // The front line under the wordmark: crimson | gold | azure.
  const ry = 244 + 7 * ms + 30;
  c.rect(mx, ry, mw * .46, 6, CRIMSON);
  c.rect(mx + mw * .46, ry, mw * .08, 6, GOLD);
  c.rect(mx + mw * .54, ry, mw * .46, 6, AZURE);

  const TAG = 'MINE DEEP · BUILD HIGH · TAKE GROUND';
  const ts = 4, tw = TAG.length * 6 * ts - ts;
  c.text(TAG, Math.round((W - tw) / 2), ry + 36, ts, INK);

  const SUB = 'ONE PERSISTENT WORLD · TWO FACTIONS · NO DOWNLOAD';
  const ss2 = 3, sw = SUB.length * 6 * ss2 - ss2;
  c.text(SUB, Math.round((W - sw) / 2), ry + 36 + 7 * ts + 24, ss2, MUTED);
  return c.png();
}

// ── PNG encode (8-bit RGBA) ─────────────────────────────────────────────────
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
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, truecolour + alpha
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: None
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Emit ────────────────────────────────────────────────────────────────────
const assets = [
  ['og.png', ogPng()],
  ['icon-512.png', iconPng(512)],
  ['icon-192.png', iconPng(192)],
  ['apple-touch-icon.png', iconPng(180)],
  ['favicon-32.png', iconPng(32)],
];
for (const [name, buf] of assets) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`brand -> public/${name} (${(buf.length / 1024).toFixed(1)} KB)`);
}
