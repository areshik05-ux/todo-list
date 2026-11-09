import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTodo, toggleTodo, renameTodo, removeTodo, clearCompleted,
  filterTodos, countActive, plural, normalizeTitle, MAX_TITLE_LENGTH,
} from '../js/todos.js';

test('новая задача встаёт в начало списка и не выполнена', () => {
  const list = addTodo(addTodo([], 'Купить хлеб'), 'Позвонить маме');
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'Позвонить маме');
  assert.equal(list[0].done, false);
  assert.notEqual(list[0].id, list[1].id);
});

test('пустая задача и задача из пробелов не добавляются', () => {
  assert.deepEqual(addTodo([], ''), []);
  assert.deepEqual(addTodo([], '   \n\t '), []);
});

test('лишние пробелы убираются, длинный текст обрезается', () => {
  assert.equal(normalizeTitle('  купить   молоко '), 'купить молоко');
  assert.equal(normalizeTitle('я'.repeat(500)).length, MAX_TITLE_LENGTH);
});

test('отметка выполнения переключается туда и обратно', () => {
  const [todo] = addTodo([], 'Задача');
  const once = toggleTodo([todo], todo.id);
  assert.equal(once[0].done, true);
  assert.equal(toggleTodo(once, todo.id)[0].done, false);
});

test('функции не меняют исходный массив', () => {
  const list = Object.freeze(addTodo([], 'Задача'));
  const id = list[0].id;
  assert.doesNotThrow(() => {
    toggleTodo(list, id);
    removeTodo(list, id);
    renameTodo(list, id, 'Другая');
    clearCompleted(list);
  });
  assert.equal(list[0].done, false);
});

test('удаление убирает только нужную задачу', () => {
  const list = addTodo(addTodo([], 'Первая'), 'Вторая');
  const rest = removeTodo(list, list[0].id);
  assert.deepEqual(rest.map((t) => t.title), ['Первая']);
});

test('переименование в пустую строку игнорируется', () => {
  const list = addTodo([], 'Старое');
  assert.equal(renameTodo(list, list[0].id, '  ')[0].title, 'Старое');
  assert.equal(renameTodo(list, list[0].id, 'Новое')[0].title, 'Новое');
});

test('фильтры и счётчик активных', () => {
  let list = addTodo(addTodo(addTodo([], 'a'), 'b'), 'c');
  list = toggleTodo(list, list[1].id);
  assert.equal(filterTodos(list, 'all').length, 3);
  assert.equal(filterTodos(list, 'active').length, 2);
  assert.deepEqual(filterTodos(list, 'done').map((t) => t.title), ['b']);
  assert.equal(filterTodos(list, 'неизвестный').length, 3);
  assert.equal(countActive(list), 2);
  assert.equal(clearCompleted(list).length, 2);
});

test('склонение слова «задача»', () => {
  const forms = ['задача', 'задачи', 'задач'];
  const cases = { 0: 'задач', 1: 'задача', 2: 'задачи', 4: 'задачи', 5: 'задач', 11: 'задач', 12: 'задач', 21: 'задача', 22: 'задачи', 111: 'задач' };
  for (const [n, word] of Object.entries(cases)) {
    assert.equal(plural(Number(n), forms), word, `для ${n}`);
  }
});
