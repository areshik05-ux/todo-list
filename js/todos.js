// Логика списка без DOM: каждая функция возвращает новый массив,
// поэтому её легко проверить тестами и сохранить в localStorage.

export const MAX_TITLE_LENGTH = 200;

export function normalizeTitle(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function addTodo(todos, text) {
  const title = normalizeTitle(text);
  if (!title) return todos;
  return [{ id: makeId(), title, done: false, createdAt: Date.now() }, ...todos];
}

export function toggleTodo(todos, id) {
  return todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
}

export function renameTodo(todos, id, text) {
  const title = normalizeTitle(text);
  if (!title) return todos;
  return todos.map((t) => (t.id === id ? { ...t, title } : t));
}

export function removeTodo(todos, id) {
  return todos.filter((t) => t.id !== id);
}

export function clearCompleted(todos) {
  return todos.filter((t) => !t.done);
}

export const FILTERS = {
  all: () => true,
  active: (t) => !t.done,
  done: (t) => t.done,
};

export function filterTodos(todos, filter) {
  return todos.filter(FILTERS[filter] ?? FILTERS.all);
}

export function countActive(todos) {
  return todos.filter((t) => !t.done).length;
}

// 1 задача, 2 задачи, 5 задач, 11 задач, 21 задача
export function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
