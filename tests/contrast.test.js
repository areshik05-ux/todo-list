// Контраст всех цветов приложения в обеих темах (WCAG 2.2): текст от 4.5:1, линии,
// значки и заливки, которые что-то значат, от 3:1. Цвета берутся прямо из css/theme.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCENTS } from '../js/accents.js';

const css = readFileSync(new URL('../css/theme.css', import.meta.url), 'utf8');

// блоки верхнего уровня, которые начинаются с :root (вложенные в @media с отступом не берём)
const blocks = [...css.matchAll(/^(:root[^{]*)\{([^}]*)\}/gm)].map(([, sel, body]) => ({
  sel: sel.trim(),
  vars: Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])),
}));
const block = (sel) => blocks.find((b) => b.sel === sel)?.vars ?? {};

export function tokens(theme, accent) {
  const layers = [block(':root')];
  if (theme === 'dark') layers.push(block(':root[data-theme="dark"]'));
  layers.push(block(`:root[data-accent="${accent}"]`));
  if (theme === 'dark') layers.push(block(`:root[data-theme="dark"][data-accent="${accent}"]`));
  const raw = Object.assign({}, ...layers);
  const resolve = (v, depth = 0) => {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (!m) return v;
    assert.ok(depth < 10 && raw[m[1]], `нет значения для ${m[1]}`);
    return resolve(raw[m[1]], depth + 1);
  };
  return new Proxy({}, { get: (_, k) => resolve(raw[k] ?? assert.fail(`нет ${String(k)}`)) });
}

const lum = (hex) => {
  const n = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [передний, задний, минимум, где это видно]
const PAIRS = [
  ['--on-blue', '--blue', 4.5, 'текст на кнопке'],
  ['--on-blue', '--blue-hover', 4.5, 'текст на кнопке при наведении'],
  ['--accent-line', '--surface', 3, 'фокус, дуга кольца'],
  ['--accent-line', '--bg', 3, 'фокус и значки разделов в боковой панели'],
  ['--accent-line', '--blue-tint', 3, 'фокус на выбранном'],
  ['--accent-line', '--ring-track', 3, 'дуга кольца к дорожке'],
  ['--accent-line', '--hover', 3, 'значок раздела при наведении'],
  ['--blue-ink', '--surface', 4.5, 'текст цветом'],
  ['--blue-ink', '--bg', 4.5, 'текст цветом в боковой панели'],
  ['--blue-ink', '--hover', 4.5, 'текст цветом при наведении'],
  ['--blue-ink', '--blue-tint', 4.5, 'выбранный раздел, чипы'],
  ['--text', '--blue-tint', 4.5, 'текст на выбранном'],
  ['--text-2', '--blue-tint', 4.5, 'подпись на выбранном'],
  ['--text', '--mark', 4.5, 'найденное слово'],
  ['--text-2', '--mark', 4.5, 'найденное слово в подписи'],
  ['--toast-action', '--toast-bg', 4.5, '«Вернуть» в сообщении'],
  ['--pink', '--surface', 3, 'галочка, кольцо P1'],
  ['--pink', '--raised', 3, 'закрытый день на листке'],
  ['--pink', '--bg', 3, 'значок «Готово» в боковой панели'],
  ['--pink', '--hover', 3, 'значок «Готово» при наведении'],
  ['--on-pink', '--pink', 3, 'галочка внутри кружка'],
  ['--pink', '--ring-track', 3, 'полное кольцо'],
  ['--pink-ink', '--surface', 4.5, 'подпись P1'],
  ['--pink-ink', '--hover', 4.5, 'подпись P1 при наведении'],
  ['--pink-ink', '--pink-tint', 4.5, 'чип P1, закрытый день'],
  ['--pink-ink', '--blue-tint', 4.5, '«Готово» выбранным разделом'],
  ['--text-2', '--pink-tint', 4.5, 'подпись на розовом фоне'],
];

test('все цвета приложения в светлой и тёмной теме держат контраст', () => {
  const fails = [];
  for (const accent of ACCENTS) {
    for (const theme of ['light', 'dark']) {
      const tk = tokens(theme, accent);
      for (const [fg, bg, min, where] of PAIRS) {
        const r = ratio(tk[fg], tk[bg]);
        if (r < min) fails.push(`${accent}/${theme}: ${fg} к ${bg} ${r.toFixed(2)} < ${min} (${where})`);
      }
    }
  }
  assert.deepEqual(fails, []);
});

test('кобальт без атрибута = прежняя палитра v4', () => {
  const tk = tokens('light', 'cobalt');
  assert.equal(tk['--blue'], '#1f5fd6');
  assert.equal(tk['--focus'], '#1f5fd6');
  assert.equal(tk['--pink'], '#d6306e');
  assert.equal(tokens('dark', 'cobalt')['--accent-line'], '#6fa1ff');
});

test('в тёмной теме каждого цвета свои значения, светлые не протекают', () => {
  for (const accent of ACCENTS.slice(1)) {
    const light = block(`:root[data-accent="${accent}"]`);
    const dark = block(`:root[data-theme="dark"][data-accent="${accent}"]`);
    assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort(), accent);
  }
});
