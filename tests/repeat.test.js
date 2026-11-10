import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDue, firstDue, isRepeat } from '../js/repeat.js';
import { addMonths, weekdayOf, nextMonday } from '../js/dates.js';

const TODAY = '2026-11-10'; // вторник

test('следующий срок: день, будни, неделя', () => {
  assert.equal(nextDue('day', TODAY, TODAY), '2026-11-11');
  assert.equal(nextDue('day', '2026-11-12', TODAY), '2026-11-13', 'сделали заранее: от срока, а не от сегодня');
  assert.equal(nextDue('weekday', '2026-11-13', '2026-11-13'), '2026-11-16', 'после пятницы понедельник');
  assert.equal(nextDue('week', '2026-11-09', TODAY), '2026-11-16', 'день недели сохраняется');
  assert.equal(nextDue('week', TODAY, TODAY), '2026-11-17');
});

test('просроченный повтор не копит пропуски, а встаёт на ближайший раз', () => {
  assert.equal(nextDue('day', '2026-11-01', TODAY), '2026-11-11');
  assert.equal(nextDue('week', '2026-10-05', TODAY), '2026-11-16', 'понедельник остаётся понедельником');
  assert.equal(nextDue('month', '2026-08-25', TODAY), '2026-11-25');
});

test('месяц и год: короткие месяцы и 29 февраля', () => {
  assert.equal(nextDue('month', '2026-01-31', '2026-01-31'), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(nextDue('year', '2028-02-29', '2028-02-29'), '2029-02-28');
  assert.equal(nextDue('month', '2026-12-15', '2026-12-15'), '2027-01-15', 'через границу года');
});

test('первый срок и проверка значения', () => {
  assert.equal(firstDue('day', TODAY), TODAY);
  assert.equal(firstDue('weekday', '2026-11-14'), '2026-11-16', 'в субботу будни начинаются с понедельника');
  assert.equal(isRepeat('week'), true);
  assert.equal(isRepeat('hourly'), false);
  assert.equal(nextDue('nonsense', TODAY, TODAY), null);
  assert.equal(weekdayOf(TODAY), 2);
  assert.equal(nextMonday(TODAY), '2026-11-16');
  assert.equal(nextMonday('2026-11-16'), '2026-11-23', 'в понедельник следующая неделя');
});
