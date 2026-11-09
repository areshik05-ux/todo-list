import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadTodos, saveTodos, parseTodos, loadSettings, saveSettings, parseSettings,
  exportJSON, importJSON, STORAGE_KEY, LEGACY_KEY,
} from '../js/storage.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    raw: data,
  };
}

const brokenStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

const full = (id, extra = {}) => ({
  id, title: id, done: false, createdAt: 1, completedAt: null, due: null, priority: 0, tags: [], ...extra,
});

test('сохранённый список читается обратно без изменений', () => {
  const storage = memoryStorage();
  const todos = [full('a', { due: '2026-11-11', priority: 2, tags: ['дом'] }), full('b', { done: true, completedAt: 5 })];
  assert.equal(saveTodos(todos, storage), true);
  assert.deepEqual(loadTodos(storage), todos);
  assert.equal(JSON.parse(storage.raw.get(STORAGE_KEY)).version, 2);
});

test('задачи из первой версии переносятся и не теряются', () => {
  const v1 = JSON.stringify([
    { id: 'a', title: 'Старая', done: false, createdAt: 1 },
    { id: 'b', title: 'Сделанная', done: true, createdAt: 2 },
  ]);
  const storage = memoryStorage({ [LEGACY_KEY]: v1 });
  const todos = loadTodos(storage);
  assert.deepEqual(todos, [
    full('a', { title: 'Старая' }),
    full('b', { title: 'Сделанная', done: true, createdAt: 2, completedAt: 2 }),
  ]);
  assert.ok(storage.raw.has(STORAGE_KEY), 'перенос сохранён в новый ключ');
  assert.equal(storage.raw.get(LEGACY_KEY), v1, 'старая запись не тронута');
});

test('если v2 уже есть, v1 больше не читается', () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({ version: 2, todos: [] }),
    [LEGACY_KEY]: JSON.stringify([{ id: 'a', title: 'Старая' }]),
  });
  assert.deepEqual(loadTodos(storage), []);
});

test('битые данные не роняют приложение', () => {
  assert.deepEqual(parseTodos('{не json'), []);
  assert.deepEqual(parseTodos('{"todos": 5}'), []);
  assert.deepEqual(parseTodos('null'), []);
  assert.deepEqual(parseTodos(''), []);
});

test('из списка берутся только валидные задачи, поля чистятся', () => {
  const raw = JSON.stringify({
    todos: [
      { id: 'ok', title: '  Нормальная  ', due: '2026-13-01', priority: '2', tags: 'не массив' },
      { id: 'ok', title: 'Дубль id' },
      { id: 1, title: 'id не строка' },
      { id: 'b', title: '   ' },
      { id: 'c' },
      null,
      'строка',
    ],
  });
  assert.deepEqual(parseTodos(raw), [full('ok', { title: 'Нормальная', createdAt: 0, priority: 2 })]);
});

test('запрещённое хранилище: пустой список и сигнал о неудаче записи', () => {
  assert.deepEqual(loadTodos(brokenStorage), []);
  assert.equal(saveTodos([full('a')], brokenStorage), false);
  assert.deepEqual(loadSettings(brokenStorage), { lang: null, theme: 'light', sort: 'manual' });
  assert.equal(saveSettings({}, brokenStorage), false);
});

test('настройки: неизвестные значения заменяются на значения по умолчанию', () => {
  assert.deepEqual(parseSettings('{"lang":"en","theme":"dark","sort":"due"}'), { lang: 'en', theme: 'dark', sort: 'due' });
  assert.deepEqual(parseSettings('{"lang":"de","theme":"pink","sort":"x"}'), { lang: null, theme: 'light', sort: 'manual' });
  assert.deepEqual(parseSettings('мусор'), { lang: null, theme: 'light', sort: 'manual' });
});

test('экспорт и импорт: файл читается обратно, совпадающие id заменяются', () => {
  const current = [full('a'), full('b')];
  const file = exportJSON([full('b', { title: 'Новая b' }), full('c')], new Date(0));
  const result = importJSON(file, current);
  assert.equal(result.count, 2);
  assert.deepEqual(result.todos.map((t) => [t.id, t.title]), [['b', 'Новая b'], ['c', 'c'], ['a', 'a']]);
});

test('импорт чужого или пустого файла ничего не меняет', () => {
  assert.equal(importJSON('не json', []), null);
  assert.equal(importJSON('{"todos": []}', []), null);
  assert.equal(importJSON('{"hello": 1}', []), null);
  // голый массив из v1 тоже принимается
  assert.equal(importJSON('[{"id":"x","title":"Из v1"}]', []).count, 1);
});
