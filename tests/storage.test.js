import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTodos, saveTodos, parseTodos, STORAGE_KEY } from '../js/storage.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

const brokenStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

test('сохранённый список читается обратно без изменений', () => {
  const storage = memoryStorage();
  const todos = [
    { id: 'a', title: 'Первая', done: false, createdAt: 1 },
    { id: 'b', title: 'Вторая', done: true, createdAt: 2 },
  ];
  assert.equal(saveTodos(todos, storage), true);
  assert.deepEqual(loadTodos(storage), todos);
});

test('пустое хранилище даёт пустой список', () => {
  assert.deepEqual(loadTodos(memoryStorage()), []);
});

test('битый JSON и чужие данные не ломают приложение', () => {
  assert.deepEqual(parseTodos('{не json'), []);
  assert.deepEqual(parseTodos('{"id":1}'), []);
  assert.deepEqual(parseTodos('null'), []);
});

test('невалидные записи отбрасываются, валидные остаются', () => {
  const raw = JSON.stringify([
    { id: 'ok', title: 'Норм', done: 1 },
    { id: 'no-title' },
    { id: 'blank', title: '   ' },
    { title: 'без id' },
    null,
  ]);
  assert.deepEqual(parseTodos(raw), [{ id: 'ok', title: 'Норм', done: true, createdAt: 0 }]);
});

test('если хранилище недоступно, ошибки не вылетают наружу', () => {
  assert.deepEqual(loadTodos(brokenStorage), []);
  assert.equal(saveTodos([], brokenStorage), false);
});

test('ключ хранилища с версией, чтобы потом можно было мигрировать', () => {
  assert.match(STORAGE_KEY, /:v\d+$/);
});
