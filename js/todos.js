// Логика списка без DOM: каждая функция возвращает новый массив,
// поэтому её легко проверить тестами и сохранить в localStorage.
// Порядок массива и есть ручной порядок задач.

import { isDateKey } from './dates.js';
import { normalizeTags } from './parse.js';

export const MAX_TITLE_LENGTH = 200;
export const PRIORITIES = [0, 1, 2, 3]; // 0 без приоритета, 1 самый высокий

export function normalizeTitle(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const cleanDue = (due) => (isDateKey(due) ? due : null);
const cleanPriority = (p) => (PRIORITIES.includes(Number(p)) ? Number(p) : 0);

export function addTodo(todos, fields, now = Date.now()) {
  const { title: rawTitle, due = null, priority = 0, tags = [] } =
    typeof fields === 'string' ? { title: fields } : fields;
  const title = normalizeTitle(rawTitle);
  if (!title) return todos;
  const todo = {
    id: makeId(),
    title,
    done: false,
    createdAt: now,
    completedAt: null,
    due: cleanDue(due),
    priority: cleanPriority(priority),
    tags: normalizeTags(tags),
  };
  return [todo, ...todos];
}

export function toggleTodo(todos, id, now = Date.now()) {
  return todos.map((t) => (t.id === id
    ? { ...t, done: !t.done, completedAt: t.done ? null : now }
    : t));
}

// Правка любых полей. Пустое название не сохраняем: задача без названия бессмысленна.
export function updateTodo(todos, id, changes) {
  return todos.map((t) => {
    if (t.id !== id) return t;
    const next = { ...t };
    if ('title' in changes) {
      const title = normalizeTitle(changes.title);
      if (title) next.title = title;
    }
    if ('due' in changes) next.due = cleanDue(changes.due);
    if ('priority' in changes) next.priority = cleanPriority(changes.priority);
    if ('tags' in changes) next.tags = normalizeTags(changes.tags);
    return next;
  });
}

export function renameTodo(todos, id, text) {
  return updateTodo(todos, id, { title: text });
}

export function removeTodo(todos, id) {
  return todos.filter((t) => t.id !== id);
}

export function clearCompleted(todos) {
  return todos.filter((t) => !t.done);
}

// Переставить задачу перед другой (или в конец, если beforeId = null).
// Работает по всему массиву, даже если на экране видна только часть задач.
export function moveTodo(todos, id, beforeId) {
  const item = todos.find((t) => t.id === id);
  if (!item || id === beforeId) return todos;
  const rest = todos.filter((t) => t.id !== id);
  const index = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
  if (index === -1) return [...rest, item];
  return [...rest.slice(0, index), item, ...rest.slice(index)];
}

// Поставить сразу после другой задачи (перетащили в самый низ группы).
export function moveTodoAfter(todos, id, afterId) {
  const rest = todos.filter((t) => t.id !== id);
  const index = rest.findIndex((t) => t.id === afterId);
  if (index === -1 || id === afterId) return todos;
  return moveTodo(todos, id, rest[index + 1]?.id ?? null);
}

// Сдвинуть на одну позицию среди видимых задач (для клавиатуры: Alt+↑ / Alt+↓).
export function moveWithin(todos, visibleIds, id, step) {
  const pos = visibleIds.indexOf(id);
  const target = pos + step;
  if (pos === -1 || target < 0 || target >= visibleIds.length) return todos;
  if (step < 0) return moveTodo(todos, id, visibleIds[target]);
  const afterTarget = visibleIds[target + 1];
  if (afterTarget) return moveTodo(todos, id, afterTarget);
  // ниже последней видимой: ставим сразу после неё в общем массиве
  const all = todos.filter((t) => t.id !== id);
  const i = all.findIndex((t) => t.id === visibleIds[target]);
  return moveTodo(todos, id, all[i + 1]?.id ?? null);
}

/* Разделы */

export const VIEWS = ['all', 'today', 'upcoming', 'done'];

const isDueBy = (t, today) => t.due !== null && t.due <= today;
const completedOn = (t, today, dayKeyOf) => t.completedAt !== null && dayKeyOf(t.completedAt) === today;

export function inView(todo, view, today, dayKeyOf) {
  switch (view) {
    case 'today':
      return todo.done
        ? isDueBy(todo, today) && completedOn(todo, today, dayKeyOf)
        : isDueBy(todo, today);
    case 'upcoming':
      return !todo.done && todo.due !== null && todo.due > today;
    case 'done':
      return todo.done;
    default:
      return !todo.done;
  }
}

export function countViews(todos, today) {
  const counts = { all: 0, today: 0, upcoming: 0, done: 0, overdue: 0 };
  for (const t of todos) {
    if (t.done) { counts.done += 1; continue; }
    counts.all += 1;
    if (isDueBy(t, today)) counts.today += 1;
    if (t.due !== null && t.due < today) counts.overdue += 1;
    if (t.due !== null && t.due > today) counts.upcoming += 1;
  }
  return counts;
}

// Прогресс дня: сколько из сегодняшних задач уже закрыто.
export function todayProgress(todos, today, dayKeyOf) {
  const list = todos.filter((t) => inView(t, 'today', today, dayKeyOf));
  return { done: list.filter((t) => t.done).length, total: list.length };
}

/* Поиск и сортировка */

// «#работа» ищет по метке, остальное по названию и меткам. Регистр не важен.
export function matchesQuery(todo, query) {
  const words = String(query ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return words.every((word) => {
    if (word.startsWith('#') && word.length > 1) {
      return todo.tags.some((tag) => tag.toLowerCase() === word.slice(1));
    }
    return todo.title.toLowerCase().includes(word)
      || todo.tags.some((tag) => tag.toLowerCase().includes(word));
  });
}

export const SORTS = ['manual', 'due', 'priority'];

const byDue = (a, b) => {
  if (a.due === b.due) return 0;
  if (a.due === null) return 1;
  if (b.due === null) return -1;
  return a.due < b.due ? -1 : 1;
};
const byPriority = (a, b) => (a.priority || 4) - (b.priority || 4);

export function sortTodos(todos, sort) {
  const indexed = todos.map((t, i) => [t, i]);
  const cmp = sort === 'due' ? (a, b) => byDue(a, b) || byPriority(a, b)
    : sort === 'priority' ? (a, b) => byPriority(a, b) || byDue(a, b)
      : () => 0;
  return indexed.sort(([a, i], [b, j]) => cmp(a, b) || i - j).map(([t]) => t);
}

// Выполненные: сначала закрытые последними.
export function sortDone(todos) {
  return [...todos].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export function groupByDue(todos) {
  const groups = [];
  for (const t of todos) {
    const last = groups.at(-1);
    if (last && last.due === t.due) last.items.push(t);
    else groups.push({ due: t.due, items: [t] });
  }
  return groups;
}
