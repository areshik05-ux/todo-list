import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTodo, toggleTodo, updateTodo, removeTodo, clearCompleted,
  moveTodo, moveTodoAfter, moveWithin, inView, countViews, todayProgress, matchesQuery,
  sortTodos, sortDone, normalizeTitle, MAX_TITLE_LENGTH,
  completeTodo, toggleStep, stepProgress, rescheduleOverdue, normalizeNotes, normalizeSteps, MAX_STEPS,
  removeSamples, addSteps,
} from '../js/todos.js';
import { toKey } from '../js/dates.js';

const TODAY = '2026-11-10';
const dayKeyOf = (ms) => toKey(new Date(ms));
const NOON = new Date(2026, 10, 10, 12).getTime();

const make = (id, extra = {}) => ({
  id, title: id, done: false, createdAt: 0, completedAt: null, due: null, priority: 0, tags: [], notes: '', steps: [], repeat: null, repeatDay: null, ...extra,
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
  assert.equal(updateTodo(list, 'a', { title: '  Новое  ' })[0].title, 'Новое');
  assert.equal(updateTodo(list, 'a', { title: '   ' })[0].title, 'a');
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

test('выполненные идут от последних', () => {
  const done = [make('a', { completedAt: 1 }), make('b', { completedAt: 3 }), make('c', { completedAt: 2 })];
  assert.deepEqual(sortDone(done).map((t) => t.id), ['b', 'c', 'a']);
});

test('повторяющаяся задача: сделанная копия уходит в «Готово», следующий раз встаёт на её место', () => {
  const list = [make('a'), make('r', { due: TODAY, repeat: 'week', steps: [{ id: 's1', title: 'шаг', done: true }] }), make('b')];
  const { todos, next } = completeTodo(list, 'r', TODAY, NOON);
  assert.deepEqual(todos.map((t) => t.id), ['a', next.id, 'r', 'b']);
  assert.deepEqual([next.due, next.repeat, next.done, next.steps[0].done], ['2026-11-17', 'week', false, false]);
  const done = todos.find((t) => t.id === 'r');
  assert.deepEqual([done.done, done.completedAt, done.repeat], [true, NOON, null]);
  assert.equal(list[1].done, false, 'исходный массив не меняется');
});

test('обычная задача отмечается без копии, повторная отметка ничего не делает', () => {
  const { todos, next } = completeTodo([make('a')], 'a', TODAY, NOON);
  assert.equal(next, null);
  assert.deepEqual([todos.length, todos[0].done], [1, true]);
  assert.equal(completeTodo(todos, 'a', TODAY).todos, todos);
});

test('новая повторяющаяся задача без срока начинается сегодня', () => {
  const [a] = addTodo([], { title: 'Зарядка', repeat: 'day', today: TODAY });
  assert.deepEqual([a.due, a.repeat], [TODAY, 'day']);
  const [b] = addTodo([], { title: 'x', repeat: 'hourly', today: TODAY });
  assert.deepEqual([b.due, b.repeat], [null, null]);
  const edited = updateTodo([make('c')], 'c', { repeat: 'weekday', today: '2026-11-14' });
  assert.deepEqual([edited[0].due, edited[0].repeat], ['2026-11-16', 'weekday']);
});

test('шаги: отметка, прогресс, чистка и лимит', () => {
  const list = [make('a', { steps: [{ id: 's1', title: 'один', done: false }, { id: 's2', title: 'два', done: true }] })];
  assert.deepEqual(stepProgress(list[0]), { done: 1, total: 2 });
  assert.deepEqual(stepProgress(toggleStep(list, 'a', 's1')[0]), { done: 2, total: 2 });
  const clean = normalizeSteps([{ id: 'x', title: '  ' }, { id: 'x', title: 'a' }, { id: 'x', title: 'b' }, null, 'str']);
  assert.equal(clean.length, 2);
  assert.notEqual(clean[0].id, clean[1].id, 'повторный id заменяется');
  assert.equal(normalizeSteps(Array.from({ length: 50 }, (_, i) => ({ title: String(i) }))).length, MAX_STEPS);
});

test('заметка: переносы строк сохраняются, лишние пустые строки убираются', () => {
  assert.equal(normalizeNotes('  строка 1  \r\n\n\n\nстрока 2\t '), 'строка 1\n\nстрока 2');
  assert.equal(normalizeNotes(null), '');
});

test('поиск находит слова в заметке и шагах', () => {
  const todo = make('a', { title: 'Переезд', notes: 'Позвонить грузчикам', steps: [{ id: 's', title: 'Коробки', done: false }] });
  assert.equal(matchesQuery(todo, 'грузчик'), true);
  assert.equal(matchesQuery(todo, 'коробки'), true);
});

test('просроченное одним нажатием на сегодня', () => {
  const list = [make('old', { due: '2026-11-01' }), make('fut', { due: '2026-11-20' }), make('doneOld', { due: '2026-11-01', done: true })];
  assert.deepEqual(rescheduleOverdue(list, TODAY).map((t) => t.due), [TODAY, '2026-11-20', '2026-11-01']);
});

test('снятие отметки со сделанного раза: следующий раз убирается, повтор возвращается', () => {
  const list = [make('r', { due: TODAY, repeat: 'week', repeatDay: 2 })];
  const { todos, next } = completeTodo(list, 'r', TODAY, NOON);
  assert.equal(todos.length, 2);
  const back = toggleTodo(todos, 'r');
  assert.deepEqual(back.map((t) => [t.id, t.done, t.repeat, t.repeatDay, t.due]), [['r', false, 'week', 2, TODAY]]);
  assert.equal('series' in back[0], false);
  // следующий раз уже отметили: его не трогаем, снятая копия остаётся обычной задачей
  const both = toggleTodo(toggleTodo(todos, next.id), 'r');
  assert.equal(both.length, 2);
  assert.equal(both.find((t) => t.id === 'r').repeat, null);
});

test('перенос одного раза не меняет день недели повтора', () => {
  const [fri] = addTodo([], { title: 'Отчёт', due: '2026-11-13', repeat: 'week' });
  assert.equal(fri.repeatDay, 5);
  const moved = rescheduleOverdue([{ ...fri, due: '2026-11-09' }], TODAY);
  assert.equal(moved[0].repeatDay, 5);
  const { next } = completeTodo(moved, fri.id, TODAY);
  assert.equal(next.due, '2026-11-13', 'следующий раз снова в пятницу');
  // в редакторе срок и повтор задаются заново: день следует за сроком
  const edited = updateTodo([fri], fri.id, { due: '2026-11-16', repeat: 'week' });
  assert.equal(edited[0].repeatDay, 1);
  assert.equal(updateTodo([fri], fri.id, { due: '2026-11-16' })[0].repeatDay, 5, 'быстрый перенос день не меняет');
});

test('примеры: убираются одной кнопкой, любое действие делает пример своей задачей', () => {
  const [a, b] = addTodo(addTodo([], { title: 'пример', sample: 'trip', due: TODAY, repeat: 'day', steps: [{ title: 'шаг' }] }), 'своя');
  assert.equal(b.sample, 'trip');
  assert.equal('sample' in a, false);
  assert.deepEqual(removeSamples([a, b]).map((t) => t.title), ['своя']);
  const mine = (list) => 'sample' in list.find((t) => t.id === b.id);
  assert.equal(mine(updateTodo([b], b.id, { title: 'моя' })), false, 'правка');
  assert.equal(mine(toggleStep([b], b.id, b.steps[0].id)), false, 'шаг');
  assert.equal(mine(rescheduleOverdue([{ ...b, due: '2026-11-01' }], TODAY)), false, 'перенос');
  assert.equal(mine(addSteps([b], b.id, 'ещё').todos), false, 'новый шаг');
  const done = completeTodo([b], b.id, TODAY);
  assert.equal('sample' in done.next, false, 'следующий раз уже свой');
  assert.equal(mine(done.todos), false);
});

test('вставка списка в шаги: строка = шаг, лишнее сверх лимита возвращается', () => {
  const list = [make('a', { steps: [{ id: 's', title: 'было', done: true }] })];
  const { todos } = addSteps(list, 'a', 'Паспорт\r\n\n  Билеты  \nЗарядка');
  assert.deepEqual(todos[0].steps.map((s) => s.title), ['было', 'Паспорт', 'Билеты', 'Зарядка']);
  assert.equal(addSteps(list, 'a', ' \n ').todos, list);
  const many = Array.from({ length: 35 }, (_, i) => `шаг ${i}`).join('\n');
  const res = addSteps(list, 'a', many);
  assert.equal(res.todos[0].steps.length, MAX_STEPS);
  assert.equal(res.rest.length, 35 - (MAX_STEPS - 1));
  assert.equal(res.rest[0], `шаг ${MAX_STEPS - 1}`);
});

test('снятие отметки не удаляет следующий раз, если его уже поправили', () => {
  const { todos, next } = completeTodo([make('r', { due: TODAY, repeat: 'day' })], 'r', TODAY, NOON);
  const edited = updateTodo(todos, next.id, { notes: 'важная заметка' });
  const back = toggleTodo(edited, 'r');
  assert.equal(back.length, 2, 'правленый следующий раз остаётся');
  assert.equal(back.find((t) => t.id === next.id).notes, 'важная заметка');
  assert.equal(back.find((t) => t.id === 'r').repeat, null, 'повтор остаётся у следующего раза, а не у двух задач');
});
