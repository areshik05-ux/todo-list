import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toKey, fromKey, isDateKey, addDays, daysBetween, nextWeekday, dayMonthKey } from '../js/dates.js';

test('ключ даты туда и обратно, несуществующие даты отбрасываются', () => {
  assert.equal(toKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(toKey(fromKey('2026-11-10')), '2026-11-10');
  assert.equal(isDateKey('2026-02-30'), false);
  assert.equal(isDateKey('2028-02-29'), true);
  assert.equal(isDateKey('10.11.2026'), false);
  assert.equal(isDateKey(null), false);
});

test('прибавление дней через границы месяца и года', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-11-10', '2026-12-10'), 30);
  // переход на летнее время в Европе 29.03.2026 не сбивает счёт
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
});

test('ближайший день недели всегда в будущем', () => {
  // 10.11.2026 вторник
  assert.equal(nextWeekday('2026-11-10', 5), '2026-11-13');
  assert.equal(nextWeekday('2026-11-10', 2), '2026-11-17', 'вторник во вторник значит через неделю');
  assert.equal(nextWeekday('2026-11-10', 1), '2026-11-16');
});

test('день и месяц без года: прошедшая дата уходит на следующий год', () => {
  assert.equal(dayMonthKey('2026-11-10', 25, 11), '2026-11-25');
  assert.equal(dayMonthKey('2026-11-10', 10, 11), '2026-11-10', 'сегодня остаётся сегодня');
  assert.equal(dayMonthKey('2026-11-10', 5, 1), '2027-01-05');
  assert.equal(dayMonthKey('2026-11-10', 31, 2), null);
  assert.equal(dayMonthKey('2026-11-10', 1, 1, 2026), '2026-01-01', 'с явным годом не переносим');
});
