import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCENTS, DEFAULT_ACCENT, isAccent, cleanAccent, stepChoice, gridStep } from '../js/accents.js';
import { DICTS } from '../js/i18n.js';

test('цвета приложения: семь, кобальт первый и по умолчанию', () => {
  assert.equal(ACCENTS.length, 7);
  assert.equal(ACCENTS[0], 'cobalt');
  assert.equal(DEFAULT_ACCENT, 'cobalt');
  assert.ok(ACCENTS.every(isAccent));
  assert.equal(isAccent('toString'), false);
  assert.equal(isAccent(undefined), false);
  assert.equal(cleanAccent('lilac'), 'lilac');
  assert.equal(cleanAccent('LILAC'), 'cobalt');
  assert.equal(cleanAccent({}), 'cobalt');
});

test('boot.js знает тот же список цветов, что и accents.js', () => {
  const boot = readFileSync(new URL('../js/boot.js', import.meta.url), 'utf8');
  const list = JSON.parse(/var ACCENTS = (\[[^\]]+\])/.exec(boot)[1].replace(/'/g, '"'));
  assert.deepEqual(list, ACCENTS);
});

test('у каждого цвета есть название на двух языках, блоки в theme.css и кружок в окне', () => {
  const theme = readFileSync(new URL('../css/theme.css', import.meta.url), 'utf8');
  const style = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ACCENTS) {
    assert.ok(DICTS.ru[`accent.${id}`] && DICTS.en[`accent.${id}`], id);
    assert.ok(style.includes(`.sw-${id} {`) && style.includes(`:root[data-theme="dark"] .sw-${id} {`), id);
    assert.ok(html.includes(`data-accent-choice="${id}"`), id);
    if (id === DEFAULT_ACCENT) continue;
    assert.ok(theme.includes(`:root[data-accent="${id}"] {`), id);
    assert.ok(theme.includes(`:root[data-theme="dark"][data-accent="${id}"] {`), id);
  }
});

test('стрелки в группе выбора идут по кругу', () => {
  const list = ['light', 'dark', 'auto'];
  assert.equal(stepChoice(list, 'light', 1), 'dark');
  assert.equal(stepChoice(list, 'auto', 1), 'light');
  assert.equal(stepChoice(list, 'light', -1), 'auto');
  assert.equal(stepChoice(list, 'нет такого', 1), 'dark');
  assert.equal(stepChoice(ACCENTS, 'graphite', 2), 'sky');
});

test('офлайн-копия (sw.js) включает каждый модуль из js/', async () => {
  const { readdirSync } = await import('node:fs');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const file of readdirSync(new URL('../js/', import.meta.url))) {
    if (file.endsWith('.js')) assert.ok(sw.includes(`'js/${file}'`), file);
  }
});

test('стрелки в сетке выбора: по кругу вбок, на ряд вверх и вниз, у края на месте', () => {
  // цвета приложения: 7 в две колонки
  assert.equal(gridStep(6, 7, 2, 'ArrowDown'), 6, 'Графит внизу: ниже некуда');
  assert.equal(gridStep(0, 7, 2, 'ArrowUp'), 0, 'Кобальт наверху: выше некуда');
  assert.equal(gridStep(1, 7, 2, 'ArrowDown'), 3);
  assert.equal(gridStep(5, 7, 2, 'ArrowDown'), 5, 'под последним во втором столбце пусто');
  assert.equal(gridStep(6, 7, 2, 'ArrowRight'), 0, 'вбок по кругу');
  assert.equal(gridStep(0, 7, 2, 'ArrowLeft'), 6);
  // один ряд (тема, 8 цветов метки): вверх и вниз как влево и вправо
  assert.equal(gridStep(7, 8, 8, 'ArrowUp'), 6);
  assert.equal(gridStep(7, 8, 8, 'ArrowDown'), 0);
  assert.equal(gridStep(1, 3, 3, 'ArrowDown'), 2);
  assert.equal(gridStep(4, 29, 7, 'Home'), 0);
  assert.equal(gridStep(4, 29, 7, 'End'), 28);
  assert.equal(gridStep(4, 29, 7, 'Enter'), null);
});
