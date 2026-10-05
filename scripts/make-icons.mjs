// Generates the PWA icons (blue tile with three rising bars) with no image library:  node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};

// Pixel coverage in unit space (0..1). `full` = no rounded corners (maskable / apple-touch: the OS applies its own mask).
function shade(x, y, full) {
  const r = 0.22;
  if (!full) {
    const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (dx * dx + dy * dy > r * r) return null; // transparent corner
  }
  const bars = [[0.27, 0.56], [0.455, 0.42], [0.64, 0.28]]; // [left, top]; width 0.12, bottom 0.72 (inside the maskable safe zone)
  for (const [l, t] of bars) if (x >= l && x <= l + 0.12 && y >= t && y <= 0.72) return [255, 255, 255];
  return [0, 122, 255];
}

function png(size, full) {
  const ss = 3, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) {
        const s = shade((px + (i + 0.5) / ss) / size, (py + (j + 0.5) / ss) / size, full);
        if (s) { r += s[0]; g += s[1]; b += s[2]; a++; }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4, n = ss * ss;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = Math.round(255 * a / n);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('public/icons/icon-192.png', png(192, false));
writeFileSync('public/icons/icon-512.png', png(512, false));
writeFileSync('public/icons/maskable-512.png', png(512, true));
writeFileSync('public/icons/apple-touch-icon.png', png(180, true));
console.log('icons written');
