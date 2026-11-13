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

test('приветствие по часу: границы 5, 12 и 18, после полуночи вечер', () => {
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

test('строка дня: ветки по порядку', async () => {
  const { dayStatus } = await import('../js/todos.js');
  const keys = (d) => dayStatus({ all: 1, open: 0, done: 0, total: 0, suggestions: 0, week: 0, ...d }).map(([k]) => k);
  assert.deepEqual(keys({ all: 0 }), ['status.empty']);
  assert.deepEqual(keys({ suggestions: 2 }), ['status.pick']);
  assert.deepEqual(keys({}), ['status.free']);
  assert.deepEqual(keys({ suggestions: 3, restMoved: true }), ['status.moved']);
  assert.deepEqual(keys({ open: 1, total: 1 }), ['status.planned']);
  assert.deepEqual(keys({ open: 6, total: 6 }), ['status.planned', 'status.full']);
  assert.deepEqual(keys({ open: 5, done: 2, total: 7 }), ['status.progress']);
  assert.deepEqual(keys({ open: 6, done: 1, total: 7 }), ['status.progress', 'status.full']);
  assert.deepEqual(keys({ done: 3, total: 3, week: 3 }), ['status.allDone', 'status.rest']);
  assert.deepEqual(keys({ done: 3, total: 3, week: 9 }), ['status.allDone', 'status.rest', 'status.week']);
  // перенос на завтра не меняет строку, если на сегодня что-то осталось
  assert.deepEqual(keys({ open: 1, total: 1, restMoved: true }), ['status.planned']);
  // часть сделана, остальное перенесено: не «всё сделано», а «сделано N, остальное на завтра»
  assert.deepEqual(dayStatus({ all: 3, open: 0, done: 1, total: 1, suggestions: 2, week: 1, restMoved: true }),
    [['status.doneSome', { n: 1 }], ['status.moved', {}]]);
});

test('блок «Можно взять»: скрыт, свёрнут после закрытия дня и вечернего переноса, открыт', async () => {
  const { planMode } = await import('../js/todos.js');
  assert.equal(planMode({ open: 0, closed: false, suggestions: 0 }), 'hidden');
  assert.equal(planMode({ open: 6, closed: false, suggestions: 3 }), 'hidden');
  assert.equal(planMode({ open: 0, closed: false, suggestions: 3 }), 'open');
  assert.equal(planMode({ open: 0, closed: true, suggestions: 3 }), 'folded');
  assert.equal(planMode({ open: 0, closed: false, suggestions: 3 }, { restMoved: true }), 'folded');
  assert.equal(planMode({ open: 0, closed: false, suggestions: 3 }, { restMoved: true, again: true }), 'open');
});

test('перестановка: последняя открытая не уходит под сделанную', async () => {
  const { moveWithin } = await import('../js/todos.js');
  const list = [make('a'), make('b'), make('dn', { done: true, completedAt: 1 }), make('c')];
  // в «Сегодня» стрелки ходят только среди открытых строк
  const openIds = ['a', 'b', 'c'];
  assert.equal(moveWithin(list, openIds, 'c', 1), list);
  assert.deepEqual(moveWithin(list, openIds, 'b', 1).map((t) => t.id), ['a', 'dn', 'c', 'b']);
  assert.deepEqual(moveWithin(list, openIds, 'c', -1).map((t) => t.id), ['a', 'c', 'b', 'dn']);
});
