import { normalizeTitle } from './todos.js';

export const STORAGE_KEY = 'todo-list:v1';

// В localStorage может лежать что угодно: старая версия, ручная правка
// через DevTools, обрезанная запись. Берём только валидные задачи.
function isValidTodo(t) {
  return t && typeof t.id === 'string' && typeof t.title === 'string' && normalizeTitle(t.title) !== '';
}

export function parseTodos(raw) {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isValidTodo).map((t) => ({
      id: t.id,
      title: normalizeTitle(t.title),
      done: Boolean(t.done),
      createdAt: Number(t.createdAt) || 0,
    }));
  } catch {
    return [];
  }
}

export function loadTodos(storage = globalThis.localStorage) {
  try {
    return parseTodos(storage.getItem(STORAGE_KEY));
  } catch {
    // приватный режим Safari или запрещённые cookies
    return [];
  }
}

export function saveTodos(todos, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(todos));
    return true;
  } catch {
    return false;
  }
}
