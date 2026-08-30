// Downsize source Arena artwork to the largest size it is rendered at. This
// intentionally uses only Node built-ins so maintainers can regenerate the
// assets without installing a native image package.
import fs from 'node:fs';
import zlib from 'node:zlib';

const files = [
  'public/minigames/duels-v2.png',
  'public/minigames/bedwars-v2.png',
  'public/minigames/capture-the-flag-v2.png',
];
const TARGET_WIDTH = 800;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(data) {
  if (!data.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  for (let at = 8; at < data.length;) {
    const length = data.readUInt32BE(at);
    const type = data.toString('ascii', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]; colorType = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNG is unsupported');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += length + 12;
  }
  if (bitDepth !== 8 || colorType !== 2) throw new Error('expected 8-bit RGB PNG');
  const bpp = 3, stride = width * bpp;
  const packed = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0, src = 0; y < height; y++) {
    const filter = packed[src++];
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++, src++) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= bpp ? prev[x - bpp] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upLeft);
      row[x] = (packed[src] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function resize(source) {
  if (source.width <= TARGET_WIDTH) return source;
  const width = TARGET_WIDTH;
  const height = Math.round(source.height * width / source.width);
  const pixels = Buffer.alloc(width * height * 3);
  // Area averaging stays crisp at card size and avoids aliasing fine voxel art.
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor(y * source.height / height);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * source.height / height));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor(x * source.width / width);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * source.width / width));
      let r = 0, g = 0, b = 0, count = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const src = (sy * source.width + sx) * 3;
        r += source.pixels[src]; g += source.pixels[src + 1]; b += source.pixels[src + 2]; count++;
      }
      const dst = (y * width + x) * 3;
      pixels[dst] = Math.round(r / count);
      pixels[dst + 1] = Math.round(g / count);
      pixels[dst + 2] = Math.round(b / count);
    }
  }
  return { width, height, pixels };
}

function encodePng(image) {
  const stride = image.width * 3;
  const scanlines = Buffer.alloc((stride + 1) * image.height);
  // Sub filtering is simple and compresses this artwork much better than raw rows.
  for (let y = 0; y < image.height; y++) {
    const dst = y * (stride + 1);
    scanlines[dst] = 1;
    const src = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 3 ? image.pixels[src + x - 3] : 0;
      scanlines[dst + 1 + x] = (image.pixels[src + x] - left) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0); ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const file of files) {
  const before = fs.statSync(file).size;
  const source = decodePng(fs.readFileSync(file));
  const resized = resize(source);
  if (resized === source) continue;
  const output = encodePng(resized);
  fs.writeFileSync(file, output);
  console.log(`${file}: ${source.width}x${source.height} ${(before / 1024).toFixed(0)} KiB -> ` +
    `${resized.width}x${resized.height} ${(output.length / 1024).toFixed(0)} KiB`);
}
