// Рисует PNG-иконки для установки на телефон (тот же знак, что favicon.svg).
// Без зависимостей: считаю покрытие пикселя сам и пакую PNG через zlib.
// Запуск: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const GREEN = [0x1f, 0x7a, 0x52];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Знак в координатах 32×32, как в favicon.svg. maskable: без скругления, знак меньше (безопасная зона 80%).
function draw(size, { maskable = false } = {}) {
  const scale = size / 32;
  const shrink = maskable ? 0.72 : 1;
  const pts = [[9, 16.5], [13.5, 21], [23, 11.5]].map(([x, y]) => [16 + (x - 16) * shrink, 16 + (y - 16) * shrink]);
  const half = 1.5 * shrink;
  const radius = maskable ? 0 : 7;
  const SS = 4; // сглаживание: 4×4 подвыборки на пиксель
  return png(size, (x, y) => {
    let inside = 0;
    let mark = 0;
    for (let i = 0; i < SS; i += 1) {
      for (let j = 0; j < SS; j += 1) {
        const px = (x + (i + 0.5) / SS) / scale;
        const py = (y + (j + 0.5) / SS) / scale;
        const qx = Math.max(radius - px, 0, px - (32 - radius));
        const qy = Math.max(radius - py, 0, py - (32 - radius));
        if (Math.hypot(qx, qy) > radius) continue;
        inside += 1;
        if (segDist(px, py, pts[0], pts[1]) <= half || segDist(px, py, pts[1], pts[2]) <= half) mark += 1;
      }
    }
    const total = SS * SS;
    if (!inside) return [0, 0, 0, 0];
    const k = mark / inside;
    const rgb = GREEN.map((c, n) => Math.round(c * (1 - k) + WHITE[n] * k));
    return [...rgb, Math.round((inside / total) * 255)];
  });
}

writeFileSync('icons/icon-192.png', draw(192));
writeFileSync('icons/icon-512.png', draw(512));
writeFileSync('icons/icon-maskable-512.png', draw(512, { maskable: true }));
writeFileSync('icons/apple-touch-icon.png', draw(180, { maskable: true }));
console.log('icons ok');
