// Generates simple PNG app icons (no external deps) for the PWA manifest.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Draws the LifeOS mark: dark rounded field with a light ascending bar motif.
function render(size) {
  const px = (x, y) => {
    const bg = [16, 18, 22];
    const fg = [232, 234, 238];
    const accent = [122, 162, 247];
    const pad = Math.round(size * 0.22);
    const barW = Math.round(size * 0.11);
    const gap = Math.round(size * 0.055);
    const baseY = size - pad;
    const heights = [0.28, 0.46, 0.66];
    for (let i = 0; i < 3; i++) {
      const bx = pad + i * (barW + gap);
      const bh = Math.round(size * heights[i]);
      if (x >= bx && x < bx + barW && y <= baseY && y >= baseY - bh) {
        return i === 2 ? accent : fg;
      }
    }
    return bg;
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = px(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
for (const size of [64, 192, 512]) {
  writeFileSync(`public/icon-${size}.png`, render(size));
}
writeFileSync('public/apple-touch-icon.png', render(180));
console.log('icons written');
