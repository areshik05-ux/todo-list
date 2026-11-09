import { normalizeTitle, PRIORITIES } from './todos.js';
import { isDateKey } from './dates.js';
import { normalizeTags } from './parse.js';

export const STORAGE_KEY = 'todo-list:v2';
export const LEGACY_KEY = 'todo-list:v1';
export const SETTINGS_KEY = 'todo-list:settings';

// В localStorage может лежать что угодно: старая версия, ручная правка
// через DevTools, обрезанная запись. Берём только валидные задачи,
// недостающие поля заполняем значениями по умолчанию.
export function cleanTodo(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || !t.id || t.id.length > 100) return null;
  const title = normalizeTitle(t.title);
  if (typeof t.title !== 'string' || !title) return null;
  const done = Boolean(t.done);
  const createdAt = Number.isFinite(Number(t.createdAt)) ? Number(t.createdAt) : 0;
  let completedAt = Number.isFinite(Number(t.completedAt)) && t.completedAt !== null ? Number(t.completedAt) : null;
  // у задач из v1 нет даты выполнения: берём дату создания, лучше не знаем
  if (done && completedAt === null) completedAt = createdAt;
  if (!done) completedAt = null;
  return {
    id: t.id,
    title,
    done,
    createdAt,
    completedAt,
    due: isDateKey(t.due) ? t.due : null,
    priority: PRIORITIES.includes(Number(t.priority)) ? Number(t.priority) : 0,
    tags: Array.isArray(t.tags) ? normalizeTags(t.tags) : [],
  };
}

export function cleanList(data) {
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of data) {
    const todo = cleanTodo(raw);
    if (!todo || seen.has(todo.id)) continue;
    seen.add(todo.id);
    out.push(todo);
  }
  return out;
}

// v2 хранит объект с версией, v1 хранил голый массив. Понимаем оба.
export function parseTodos(raw) {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return cleanList(Array.isArray(data) ? data : data?.todos);
  } catch {
    return [];
  }
}

export function serialize(todos) {
  return JSON.stringify({ version: 2, todos });
}

export function loadTodos(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null) return parseTodos(raw);
    // первый запуск v2: переносим задачи из v1, старую запись не трогаем
    const legacy = parseTodos(storage.getItem(LEGACY_KEY));
    if (legacy.length) saveTodos(legacy, storage);
    return legacy;
  } catch {
    // приватный режим Safari или запрещённые cookies
    return [];
  }
}

export function saveTodos(todos, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, serialize(todos));
    return true;
  } catch {
    return false;
  }
}

/* Настройки: язык, тема, сортировка */

export const DEFAULT_SETTINGS = { lang: null, theme: 'light', sort: 'manual' };

export function parseSettings(raw) {
  try {
    const data = JSON.parse(raw ?? '{}') ?? {};
    return {
      lang: ['ru', 'en'].includes(data.lang) ? data.lang : null,
      theme: ['light', 'dark'].includes(data.theme) ? data.theme : 'light',
      sort: ['manual', 'due', 'priority'].includes(data.sort) ? data.sort : 'manual',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    return parseSettings(storage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/* Экспорт и импорт */

export function exportJSON(todos, now = new Date()) {
  return JSON.stringify({ app: 'todo-list', version: 2, exportedAt: now.toISOString(), todos }, null, 2);
}

// Импортированные задачи заменяют задачи с тем же id, новые встают сверху.
// Возвращает null, если файл не наш или пустой.
export function importJSON(text, current) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const incoming = cleanList(Array.isArray(data) ? data : data?.todos);
  if (!incoming.length) return null;
  const ids = new Set(incoming.map((t) => t.id));
  return { todos: [...incoming, ...current.filter((t) => !ids.has(t.id))], count: incoming.length };
}
