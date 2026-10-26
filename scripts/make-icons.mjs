// Renders the app icon (crescent moon + stars) to PNGs without dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const SS = 4; // supersampling for anti-aliasing
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr; g += pg; b += pb;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r / SS ** 2;
      raw[o + 1] = g / SS ** 2;
      raw[o + 2] = b / SS ** 2;
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const STARS = [[0.25, 0.28, 0.018], [0.72, 0.2, 0.012], [0.8, 0.62, 0.015], [0.3, 0.75, 0.01], [0.58, 0.82, 0.012]];

// scale < 1 shrinks the artwork for maskable icons (safe zone).
function icon(scale) {
  return (u, v) => {
    const top = [27, 42, 107], bottom = [10, 14, 38];
    let col = top.map((c, i) => c + (bottom[i] - c) * v);
    const x = 0.5 + (u - 0.5) / scale;
    const y = 0.5 + (v - 0.5) / scale;
    for (const [sx, sy, sr] of STARS) {
      if (Math.hypot(x - sx, y - sy) < sr) col = [230, 236, 255];
    }
    const inMoon = Math.hypot(x - 0.5, y - 0.5) < 0.27;
    const inBite = Math.hypot(x - 0.62, y - 0.4) < 0.23;
    if (inMoon && !inBite) col = [255, 226, 140];
    return col;
  };
}

mkdirSync('icons', { recursive: true });
for (const size of [180, 192, 512]) writeFileSync(`icons/icon-${size}.png`, png(size, icon(1)));
writeFileSync('icons/maskable-512.png', png(512, icon(0.8)));
console.log('icons written');
