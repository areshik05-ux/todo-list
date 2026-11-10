import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestForToday, moveOpenTo, weekStart, doneThisWeek, weekLoad, greetingKey, groupDoneByDay,
} from '../js/todos.js';
import { toKey } from '../js/dates.js';

const TODAY = '2026-11-11'; // среда
const dayKeyOf = (ms) => toKey(new Date(ms));
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

const make = (id, extra = {}) => ({
  id, title: id, done: false, createdAt: 0, completedAt: null, due: null, priority: 0, tags: [], notes: '', steps: [], repeat: null, repeatDay: null, ...extra,
});

test('взять на сегодня: сначала ближайшие даты, потом без срока в своём порядке', () => {
  const list = [
    make('nodate1'),
    make('fri', { due: '2026-11-13' }),
    make('tomorrow', { due: '2026-11-12' }),
    make('nodate2'),
  ];
  assert.deepEqual(suggestForToday(list, TODAY).map((t) => t.id), ['tomorrow', 'fri', 'nodate1', 'nodate2']);
});

test('взять на сегодня: без просроченных, сегодняшних, сделанных и дальше 7 дней', () => {
  const list = [
    make('overdue', { due: '2026-11-09' }),
    make('today', { due: TODAY }),
    make('done', { done: true, completedAt: 1 }),
    make('day7', { due: '2026-11-18' }),
    make('day8', { due: '2026-11-19' }),
  ];
  assert.deepEqual(suggestForToday(list, TODAY).map((t) => t.id), ['day7']);
});

test('перенести оставшиеся: открытые по сегодня и просроченные уходят на завтра, будущие и сделанные на месте', () => {
  const list = [
    make('overdue', { due: '2026-11-01' }),
    make('today', { due: TODAY, repeat: 'week', repeatDay: 3 }),
    make('later', { due: '2026-11-20' }),
    make('nodate'),
    make('done', { due: TODAY, done: true, completedAt: 1 }),
  ];
  const next = moveOpenTo(list, TODAY, '2026-11-12');
  assert.deepEqual(next.map((t) => t.due), ['2026-11-12', '2026-11-12', '2026-11-20', null, TODAY]);
  assert.equal(next[1].repeat, 'week');
  assert.equal(next[1].repeatDay, 3, 'день повтора не меняется от переноса');
});

test('неделя начинается с понедельника', () => {
  assert.equal(weekStart('2026-11-11'), '2026-11-09');
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2026-11-15'), '2026-11-09', 'воскресенье относится к прошлой неделе');
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
});

test('сделано за неделю считает с понедельника 00:00 по сегодня', () => {
  const list = [
    make('sun', { done: true, completedAt: at(2026, 11, 8, 23) }),
    make('mon', { done: true, completedAt: at(2026, 11, 9, 0) }),
    make('wed', { done: true, completedAt: at(2026, 11, 11, 9) }),
    make('open'),
  ];
  assert.equal(doneThisWeek(list, TODAY, dayKeyOf), 2);
});

test('нагрузка недели: 7 дней от сегодня, сегодня включает просроченные', () => {
  const list = [
    make('overdue', { due: '2026-11-10' }),
    make('today', { due: TODAY }),
    make('tomorrow', { due: '2026-11-12' }),
    make('tomorrowDone', { due: '2026-11-12', done: true, completedAt: 1 }),
    make('far', { due: '2026-11-30' }),
  ];
  const load = weekLoad(list, TODAY);
  assert.equal(load.length, 7);
  assert.deepEqual(load.slice(0, 3), [
    { date: TODAY, count: 2 },
    { date: '2026-11-12', count: 1 },
    { date: '2026-11-13', count: 0 },
  ]);
  assert.equal(load[6].date, '2026-11-17');
});

test('приветствие по часу: границы 5, 12 и 18', () => {
  assert.deepEqual([4, 5, 11, 12, 17, 18, 23, 0].map(greetingKey),
    ['evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'evening']);
});

test('готовые по дням закрытия, свежие сверху', () => {
  const list = [
    make('a', { done: true, completedAt: at(2026, 11, 10, 9) }),
    make('b', { done: true, completedAt: at(2026, 11, 11, 9) }),
    make('c', { done: true, completedAt: at(2026, 11, 11, 15) }),
    make('open'),
  ];
  const groups = groupDoneByDay(list, dayKeyOf);
  assert.deepEqual(groups.map((g) => [g.day, g.items.map((t) => t.id)]), [
    ['2026-11-11', ['c', 'b']],
    ['2026-11-10', ['a']],
  ]);
});
