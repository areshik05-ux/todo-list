import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTodo, toggleTodo, renameTodo, updateTodo, removeTodo, clearCompleted,
  moveTodo, moveTodoAfter, moveWithin, inView, countViews, todayProgress, matchesQuery,
  sortTodos, sortDone, groupByDue, normalizeTitle, MAX_TITLE_LENGTH,
} from '../js/todos.js';
import { toKey } from '../js/dates.js';

const TODAY = '2026-11-10';
const dayKeyOf = (ms) => toKey(new Date(ms));
const NOON = new Date(2026, 10, 10, 12).getTime();

const make = (id, extra = {}) => ({
  id, title: id, done: false, createdAt: 0, completedAt: null, due: null, priority: 0, tags: [], ...extra,
});

test('новая задача встаёт в начало списка и не выполнена', () => {
  const list = addTodo(addTodo([], 'Купить хлеб'), 'Позвонить маме');
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'Позвонить маме');
  assert.equal(list[0].done, false);
  assert.notEqual(list[0].id, list[1].id);
});

test('новая задача принимает срок, приоритет и метки, мусор отбрасывает', () => {
  const [a] = addTodo([], { title: 'Отчёт', due: '2026-11-12', priority: 1, tags: ['работа', '#Работа', 'дом'] });
  assert.deepEqual([a.due, a.priority, a.tags], ['2026-11-12', 1, ['работа', 'дом']]);
  const [b] = addTodo([], { title: 'Х', due: '2026-02-30', priority: 9 });
  assert.deepEqual([b.due, b.priority, b.tags], [null, 0, []]);
});

test('пустая задача и задача из пробелов не добавляются', () => {
  assert.deepEqual(addTodo([], ''), []);
  assert.deepEqual(addTodo([], '   \n\t '), []);
  assert.deepEqual(addTodo([], { title: '  ' }), []);
});

test('лишние пробелы убираются, длинный текст обрезается', () => {
  assert.equal(normalizeTitle('  купить   молоко '), 'купить молоко');
  assert.equal(normalizeTitle('я'.repeat(500)).length, MAX_TITLE_LENGTH);
});

test('отметка выполнения ставит и снимает дату выполнения', () => {
  const [todo] = addTodo([], 'Задача');
  const once = toggleTodo([todo], todo.id, 123);
  assert.equal(once[0].done, true);
  assert.equal(once[0].completedAt, 123);
  const twice = toggleTodo(once, todo.id);
  assert.equal(twice[0].done, false);
  assert.equal(twice[0].completedAt, null);
});

test('переименование: пустое название не сохраняется', () => {
  const list = [make('a')];
  assert.equal(renameTodo(list, 'a', '  Новое  ')[0].title, 'Новое');
  assert.equal(renameTodo(list, 'a', '   ')[0].title, 'a');
});

test('правка меняет только переданные поля', () => {
  const list = [make('a', { due: '2026-11-11', priority: 2, tags: ['x'] })];
  const next = updateTodo(list, 'a', { priority: 1 });
  assert.deepEqual([next[0].due, next[0].priority, next[0].tags], ['2026-11-11', 1, ['x']]);
  assert.equal(updateTodo(list, 'a', { due: null })[0].due, null);
  assert.equal(list[0].priority, 2, 'исходный массив не меняется');
});

test('удаление и очистка выполненных', () => {
  const list = [make('a'), make('b', { done: true }), make('c')];
  assert.deepEqual(removeTodo(list, 'b').map((t) => t.id), ['a', 'c']);
  assert.deepEqual(clearCompleted(list).map((t) => t.id), ['a', 'c']);
});

test('перестановка: перед другой задачей и в конец', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => make(id));
  assert.deepEqual(moveTodo(list, 'd', 'b').map((t) => t.id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveTodo(list, 'a', null).map((t) => t.id), ['b', 'c', 'd', 'a']);
  assert.equal(moveTodo(list, 'x', 'a'), list);
  assert.deepEqual(moveTodoAfter(list, 'a', 'c').map((t) => t.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveTodoAfter(list, 'a', 'd').map((t) => t.id), ['b', 'c', 'd', 'a']);
});

test('Alt+стрелки двигают задачу среди видимых, скрытые остаются на месте', () => {
  // видимы a, c, d; b скрыта фильтром
  const list = ['a', 'b', 'c', 'd'].map((id) => make(id));
  const visible = ['a', 'c', 'd'];
  assert.deepEqual(moveWithin(list, visible, 'a', 1).map((t) => t.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveWithin(list, visible, 'd', -1).map((t) => t.id), ['a', 'b', 'd', 'c']);
  assert.deepEqual(moveWithin(list, visible, 'c', 1).map((t) => t.id), ['a', 'b', 'd', 'c']);
  assert.equal(moveWithin(list, visible, 'a', -1), list, 'выше первой некуда');
  assert.equal(moveWithin(list, visible, 'd', 1), list, 'ниже последней некуда');
});

test('разделы: Все, Сегодня, Предстоящие, Готово', () => {
  const list = [
    make('nodate'),
    make('overdue', { due: '2026-11-08' }),
    make('today', { due: TODAY }),
    make('later', { due: '2026-11-20' }),
    make('doneToday', { due: TODAY, done: true, completedAt: NOON }),
    make('doneOld', { due: '2026-11-01', done: true, completedAt: NOON - 5 * 86_400_000 }),
  ];
  const ids = (view) => list.filter((t) => inView(t, view, TODAY, dayKeyOf)).map((t) => t.id);
  assert.deepEqual(ids('all'), ['nodate', 'overdue', 'today', 'later']);
  assert.deepEqual(ids('today'), ['overdue', 'today', 'doneToday']);
  assert.deepEqual(ids('upcoming'), ['later']);
  assert.deepEqual(ids('done'), ['doneToday', 'doneOld']);
  assert.deepEqual(countViews(list, TODAY), { all: 4, today: 2, upcoming: 1, done: 2, overdue: 1 });
  assert.deepEqual(todayProgress(list, TODAY, dayKeyOf), { done: 1, total: 3 });
});

test('поиск по словам и по метке', () => {
  const todo = make('a', { title: 'Позвонить в Банк', tags: ['Дела', 'срочно'] });
  assert.equal(matchesQuery(todo, 'банк'), true);
  assert.equal(matchesQuery(todo, 'позвонить банк'), true);
  assert.equal(matchesQuery(todo, 'почта'), false);
  assert.equal(matchesQuery(todo, '#дела'), true);
  assert.equal(matchesQuery(todo, '#дел'), false, 'метка ищется целиком');
  assert.equal(matchesQuery(todo, 'сроч'), true, 'слово без решётки ищет и в метках');
  assert.equal(matchesQuery(todo, '   '), true);
});

test('сортировка по сроку и приоритету устойчива, без срока в конце', () => {
  const list = [
    make('a'),
    make('b', { due: '2026-11-12', priority: 3 }),
    make('c', { due: '2026-11-11' }),
    make('d', { due: '2026-11-12', priority: 1 }),
    make('e', { priority: 1 }),
  ];
  assert.deepEqual(sortTodos(list, 'due').map((t) => t.id), ['c', 'd', 'b', 'e', 'a']);
  assert.deepEqual(sortTodos(list, 'priority').map((t) => t.id), ['d', 'e', 'b', 'c', 'a']);
  assert.deepEqual(sortTodos(list, 'manual').map((t) => t.id), ['a', 'b', 'c', 'd', 'e']);
});

test('выполненные идут от последних, группы по дате склеивают соседей', () => {
  const done = [make('a', { completedAt: 1 }), make('b', { completedAt: 3 }), make('c', { completedAt: 2 })];
  assert.deepEqual(sortDone(done).map((t) => t.id), ['b', 'c', 'a']);
  const groups = groupByDue([make('a', { due: 'x' }), make('b', { due: 'x' }), make('c', { due: 'y' })]);
  assert.deepEqual(groups.map((g) => [g.due, g.items.length]), [['x', 2], ['y', 1]]);
});
