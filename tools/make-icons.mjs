// Рисует PNG-иконки для установки на телефон (тот же знак, что favicon.svg):
// голубая плитка, белый листок календаря с двумя кольцами и розовая галочка.
// Без зависимостей: считаю покрытие пикселя сам и пакую PNG через zlib.
// Запуск: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// те же цвета, что --blue и --pink светлой темы в css/theme.css
const BLUE = [0x1f, 0x5f, 0xd6];
const WHITE = [0xff, 0xff, 0xff];
const PINK = [0xd6, 0x30, 0x6e];

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

// точка внутри прямоугольника [x, y, w, h] со скруглением r
function inRect(px, py, [x, y, w, h], r) {
  const qx = Math.max(x + r - px, 0, px - (x + w - r));
  const qy = Math.max(y + r - py, 0, py - (y + h - r));
  return px >= x && px <= x + w && py >= y && py <= y + h && Math.hypot(qx, qy) <= r;
}

// Знак в координатах 32×32, как в favicon.svg. maskable: плитка во весь квадрат, знак меньше (безопасная зона 80%).
const PAGE = [5, 9, 22, 18];
const RINGS = [[9.5, 5, 3, 6], [19.5, 5, 3, 6]];
const TICK = [[10.5, 18.5], [14, 22], [21.5, 14.5]];

function colorAt(px, py, maskable) {
  const k = maskable ? 0.72 : 1;
  if (!maskable && !inRect(px, py, [0, 0, 32, 32], 7)) return null;
  // знак рисуется в своей системе координат, сжатой к центру
  const x = 16 + (px - 16) / k;
  const y = 16 + (py - 16) / k;
  if (segDist(x, y, TICK[0], TICK[1]) <= 1.5 || segDist(x, y, TICK[1], TICK[2]) <= 1.5) {
    if (inRect(x, y, PAGE, 3)) return PINK;
  }
  if (inRect(x, y, PAGE, 3) || RINGS.some((ring) => inRect(x, y, ring, 1.5))) return WHITE;
  return BLUE;
}

function draw(size, { maskable = false } = {}) {
  const scale = size / 32;
  const SS = 4; // сглаживание: 4×4 подвыборки на пиксель
  return png(size, (x, y) => {
    const sum = [0, 0, 0];
    let inside = 0;
    for (let i = 0; i < SS; i += 1) {
      for (let j = 0; j < SS; j += 1) {
        const c = colorAt((x + (i + 0.5) / SS) / scale, (y + (j + 0.5) / SS) / scale, maskable);
        if (!c) continue;
        inside += 1;
        for (let n = 0; n < 3; n += 1) sum[n] += c[n];
      }
    }
    if (!inside) return [0, 0, 0, 0];
    return [...sum.map((v) => Math.round(v / inside)), Math.round((inside / (SS * SS)) * 255)];
  });
}

writeFileSync('icons/icon-192.png', draw(192));
writeFileSync('icons/icon-512.png', draw(512));
writeFileSync('icons/icon-maskable-512.png', draw(512, { maskable: true }));
writeFileSync('icons/apple-touch-icon.png', draw(180, { maskable: true }));
console.log('icons ok');
