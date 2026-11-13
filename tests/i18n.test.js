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
  assert.equal(ru.t('found', { n: 1 }), 'Нашлась 1 задача');
  assert.equal(ru.t('found', { n: 3 }), 'Нашлось 3 задачи');
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

test('две точки подряд не ставятся: «20 нояб.» в конце предложения', () => {
  const date = ru.groupDate('2026-11-23', TODAY);
  assert.ok(date.endsWith('.'), date);
  assert.equal(ru.t('task.dueButton', { date }), `Срок: ${date} Перенести`);
  assert.equal(en.t('task.dueButton', { date: 'Mon, 23 Nov' }), 'Due: Mon, 23 Nov. Reschedule');
});

test('короткие русские слова не висят в конце строки', () => {
  const nb = '\u00A0';
  assert.equal(ru.t('footer.offline'), `Работает и${nb}без${nb}интернета.`);
  assert.equal(ru.t('footer.code'), `код на${nb}GitHub`);
  assert.equal(ru.t('status.progress', { done: 1, total: 3, left: 2 }), `Сделано 1 из${nb}3. Осталось: 2.`);
  // название задачи не трогаем, английский тоже
  assert.equal(ru.t('toast.completed', { title: 'Позвонить в банк' }), 'Готово: «Позвонить в банк»');
  assert.equal(en.t('footer.offline'), 'Works offline too.');
  // примеры попадают в поле ввода как есть
  assert.equal(ru.t('sample.bank'), 'Позвонить в банк');
});
