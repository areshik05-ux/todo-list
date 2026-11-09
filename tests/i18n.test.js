import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createI18n, detectLang, DICTS } from '../js/i18n.js';

const ru = createI18n('ru');
const en = createI18n('en');
const TODAY = '2026-11-10';

test('в словарях одинаковые ключи', () => {
  assert.deepEqual(Object.keys(DICTS.ru).sort(), Object.keys(DICTS.en).sort());
});

test('русские склонения: 1, 2, 5, 11, 21, 22 задачи', () => {
  const forms = [1, 2, 5, 11, 21, 22, 0].map((n) => ru.t('tasks', { n }));
  assert.deepEqual(forms, ['1 задача', '2 задачи', '5 задач', '11 задач', '21 задача', '22 задачи', '0 задач']);
  assert.equal(ru.t('left', { n: 1 }), 'Осталась 1 задача');
  assert.equal(ru.t('left', { n: 3 }), 'Осталось 3 задачи');
});

test('английские склонения', () => {
  assert.equal(en.t('tasks', { n: 1 }), '1 task');
  assert.equal(en.t('tasks', { n: 21 }), '21 tasks');
});

test('подстановка параметров и запасной ключ', () => {
  assert.equal(ru.t('toast.deleted', { title: 'Хлеб' }), 'Удалено: «Хлеб»');
  assert.equal(en.t('no.such.key'), 'no.such.key');
});

test('язык по браузеру', () => {
  assert.equal(detectLang(['ru-RU', 'en']), 'ru');
  assert.equal(detectLang(['uk']), 'ru');
  assert.equal(detectLang(['de-DE', 'en-US']), 'en');
  assert.equal(detectLang(['fr']), 'en');
  assert.equal(detectLang([]), 'en');
});

test('подписи сроков', () => {
  assert.equal(ru.relativeDate('2026-11-10', TODAY), 'Сегодня');
  assert.equal(ru.relativeDate('2026-11-11', TODAY), 'Завтра');
  assert.equal(ru.relativeDate('2026-11-09', TODAY), 'Вчера');
  assert.equal(ru.relativeDate('2026-11-13', TODAY), 'Пятница');
  assert.equal(en.relativeDate('2026-11-13', TODAY), 'Friday');
  assert.match(ru.relativeDate('2026-11-25', TODAY), /^25 нояб/);
  assert.match(en.relativeDate('2027-01-03', TODAY), /2027$/);
  assert.equal(ru.relativeDate('мусор', TODAY), '');
});
