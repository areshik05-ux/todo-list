import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadTodos, saveTodos, parseTodos, loadSettings, saveSettings, parseSettings,
  exportJSON, importJSON, storageAvailable, isFirstVisit, loadTodosReport, STORAGE_KEY, LEGACY_KEY, BACKUP_KEY,
} from '../js/storage.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    raw: data,
  };
}

const brokenStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

const full = (id, extra = {}) => ({
  id, title: id, done: false, createdAt: 1, completedAt: null, due: null, priority: 0, tags: [], notes: '', steps: [], repeat: null, repeatDay: null, ...extra,
});

test('сохранённый список читается обратно без изменений', () => {
  const storage = memoryStorage();
  const todos = [full('a', { due: '2026-11-11', priority: 2, tags: ['дом'] }), full('b', { done: true, completedAt: 5 })];
  assert.equal(saveTodos(todos, storage), true);
  assert.deepEqual(loadTodos(storage), todos);
  assert.equal(JSON.parse(storage.raw.get(STORAGE_KEY)).version, 3);
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
  assert.deepEqual(loadSettings(brokenStorage), { lang: null, theme: 'light', sort: 'manual', planFolded: false, closedDay: null });
  assert.equal(saveSettings({}, brokenStorage), false);
  assert.equal(storageAvailable(brokenStorage), false);
  assert.equal(storageAvailable(memoryStorage()), true);
});

test('запрет на само обращение к localStorage (Chrome без cookies) не роняет загрузку', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError'); },
  });
  try {
    assert.deepEqual(loadTodos(), []);
    assert.equal(saveTodos([]), false);
    assert.equal(storageAvailable(), false);
    assert.deepEqual(loadSettings(), { lang: null, theme: 'light', sort: 'manual', planFolded: false, closedDay: null });
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('настройки: неизвестные значения заменяются на значения по умолчанию', () => {
  assert.deepEqual(parseSettings('{"lang":"en","theme":"dark","sort":"due"}'), { lang: 'en', theme: 'dark', sort: 'due', planFolded: false, closedDay: null });
  assert.deepEqual(parseSettings('{"lang":"de","theme":"pink","sort":"x"}'), { lang: null, theme: 'light', sort: 'manual', planFolded: false, closedDay: null });
  assert.deepEqual(parseSettings('{"planFolded":true,"closedDay":"2026-11-11"}'),
    { lang: null, theme: 'light', sort: 'manual', planFolded: true, closedDay: '2026-11-11' });
  assert.deepEqual(parseSettings('{"planFolded":"yes","closedDay":"вчера"}'),
    { lang: null, theme: 'light', sort: 'manual', planFolded: false, closedDay: null });
  assert.deepEqual(parseSettings('мусор'), { lang: null, theme: 'light', sort: 'manual', planFolded: false, closedDay: null });
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
  // «done»: "yes» не делает задачу выполненной
  assert.equal(importJSON('[{"id":"x","title":"a","done":"yes"}]', []).todos[0].done, false);
});

test('v3: шаги, заметка, повтор и пометка примера переживают сохранение, мусор в них чистится', () => {
  const storage = memoryStorage();
  const todo = full('a', {
    due: '2026-11-10', repeat: 'week', repeatDay: 5, notes: 'строка\nвторая', sample: 'trip',
    steps: [{ id: 's1', title: 'шаг', done: true }],
  });
  saveTodos([todo], storage);
  assert.deepEqual(loadTodos(storage), [todo]);
  const dirty = parseTodos(JSON.stringify([{ id: 'b', title: 'x', repeat: 'hourly', steps: 'nope', notes: 5, sample: 'Not Valid!' }]));
  assert.deepEqual(dirty, [full('b', { title: 'x', createdAt: 0 })]);
  const noDue = parseTodos(JSON.stringify([{ id: 'c', title: 'x', repeat: 'day' }]));
  assert.equal(noDue[0].repeat, null, 'повтор без срока не берём');
});

test('первый визит: только если нет ни v2, ни v1', () => {
  assert.equal(isFirstVisit(memoryStorage()), true);
  assert.equal(isFirstVisit(memoryStorage({ [STORAGE_KEY]: '[]' })), false);
  assert.equal(isFirstVisit(memoryStorage({ [LEGACY_KEY]: '[]' })), false);
  assert.equal(isFirstVisit(brokenStorage), false);
});

test('сделанный раз повторяющейся задачи хранит связь со следующим, мусор в ней отбрасывается', () => {
  const done = full('d', { done: true, completedAt: 5, series: { repeat: 'week', repeatDay: 1, next: 'n' } });
  assert.deepEqual(parseTodos(JSON.stringify([done])), [done]);
  const bad = parseTodos(JSON.stringify([{ ...done, series: { repeat: 'x', next: 'n' } }]));
  assert.equal('series' in bad[0], false);
  const open = parseTodos(JSON.stringify([{ ...done, done: false }]));
  assert.equal('series' in open[0], false, 'у открытой задачи связи нет');
  const week = parseTodos(JSON.stringify([full('w', { due: '2026-11-13', repeat: 'week' })]));
  assert.equal(week[0].repeatDay, 5, 'день недели берётся из срока, если его не было');
});

test('испорченная запись: копия в запасной ключ, сигнал для предупреждения', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{"todos": [obrezano' });
  assert.deepEqual(loadTodosReport(storage), { todos: [], corrupt: true, backedUp: true });
  assert.equal(storage.raw.get(BACKUP_KEY), '{"todos": [obrezano');
  storage.setItem(STORAGE_KEY, '{"oops": 1}');
  loadTodosReport(storage);
  assert.equal(storage.raw.get(BACKUP_KEY), '{"todos": [obrezano', 'первую копию не затираем');
  const ok = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 3, todos: [full('a')] }) });
  assert.deepEqual(loadTodosReport(ok), { todos: [full('a')], corrupt: false });
  assert.deepEqual(loadTodosReport(memoryStorage()), { todos: [], corrupt: false });
  assert.deepEqual(loadTodosReport(brokenStorage), { todos: [], corrupt: false });
});

test('список без единой годной задачи тоже считается испорченным, копии не затираются', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '[1,2,3]' });
  assert.equal(loadTodosReport(storage).corrupt, true);
  assert.equal(storage.raw.get(BACKUP_KEY), '[1,2,3]');
  storage.setItem(STORAGE_KEY, '[{"title":"без id"}]');
  assert.equal(loadTodosReport(storage).corrupt, true);
  const extra = [...storage.raw.keys()].filter((k) => k.startsWith(BACKUP_KEY + ':'));
  assert.equal(extra.length, 1, 'вторая порча в отдельной копии');
  assert.equal(loadTodosReport(memoryStorage({ [STORAGE_KEY]: '[]' })).corrupt, false, 'пустой список не порча');
});

test('после копии испорченной записи список начинается заново: перезагрузка не плодит копии', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{битое' });
  assert.equal(loadTodosReport(storage).corrupt, true);
  assert.deepEqual(loadTodosReport(storage), { todos: [], corrupt: false }, 'вторая загрузка уже чистая');
  assert.equal([...storage.raw.keys()].filter((k) => k.startsWith(BACKUP_KEY)).length, 1);
  const full = memoryStorage({ [STORAGE_KEY]: '{битое' });
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(loadTodosReport(full).corrupt, true, 'места на копию нет: предупреждение всё равно');
  assert.equal(full.raw.get(STORAGE_KEY), '{битое', 'и запись не тронута');
});

test('нет места на копию испорченной записи: честный флаг и сама запись для скачивания', () => {
  const full = memoryStorage({ [STORAGE_KEY]: '{битое' });
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.deepEqual(loadTodosReport(full), { todos: [], corrupt: true, backedUp: false, raw: '{битое' });
});
