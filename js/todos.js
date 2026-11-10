// Логика списка без DOM: каждая функция возвращает новый массив,
// поэтому её легко проверить тестами и сохранить в localStorage.
// Порядок массива и есть ручной порядок задач.

import { isDateKey, addDays, weekdayOf } from './dates.js';
import { normalizeTags } from './parse.js';
import { isRepeat, firstDue, nextDue, repeatDayFor } from './repeat.js';

export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_STEPS = 30;
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
const cleanRepeat = (r) => (isRepeat(r) ? r : null);

// Заметка: переносы строк сохраняем, пустые хвосты убираем.
export function normalizeNotes(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, MAX_NOTES_LENGTH);
}

// Шаги внутри задачи (чек-лист). Пустые выбрасываем, id не повторяются.
export function normalizeSteps(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const title = normalizeTitle(raw.title);
    if (!title) continue;
    let id = typeof raw.id === 'string' && raw.id && raw.id.length <= 100 ? raw.id : makeId();
    if (seen.has(id)) id = makeId();
    seen.add(id);
    out.push({ id, title, done: raw.done === true });
    if (out.length === MAX_STEPS) break;
  }
  return out;
}


// Любое действие человека с примером делает его своей задачей:
// «Убрать примеры» её уже не тронет.
// Всегда новая копия: исходный объект не меняется.
function own(todo) {
  const { sample, ...rest } = todo;
  return rest;
}

export function addTodo(todos, fields, now = Date.now()) {
  const {
    title: rawTitle, due = null, priority = 0, tags = [], notes = '', steps = [],
    repeat = null, repeatDay = null, today = null, sample = null,
  } = typeof fields === 'string' ? { title: fields } : fields;
  const title = normalizeTitle(rawTitle);
  if (!title) return todos;
  const rep = cleanRepeat(repeat);
  const start = cleanDue(due) ?? (rep && today ? firstDue(rep, today) : null);
  const todo = {
    id: makeId(),
    title,
    done: false,
    createdAt: now,
    completedAt: null,
    due: start,
    priority: cleanPriority(priority),
    tags: normalizeTags(tags),
    notes: normalizeNotes(notes),
    steps: normalizeSteps(steps),
    repeat: rep,
    repeatDay: repeatDayFor(rep, repeatDay, start),
  };
  if (sample) todo.sample = sample; // пример с первого визита, см. samples.js
  return [todo, ...todos];
}

// Отпечаток задачи: по нему видно, трогал ли человек следующий раз повтора.
export const fingerprint = (t) => JSON.stringify([
  t.title, t.due, t.priority, t.tags, t.notes, t.steps.map((s) => [s.title, s.done]), t.repeat, t.repeatDay,
]);

// Снять или поставить отметку. Сняли отметку со сделанного раза повторяющейся
// задачи: следующий раз, если его ещё не трогали, убираем, а повтор возвращаем,
// чтобы не осталось двух открытых копий.
export function toggleTodo(todos, id, now = Date.now()) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return todos;
  if (!todo.done) return todos.map((t) => (t.id === id ? { ...own(t), done: true, completedAt: now } : t));
  const { series, ...rest } = own(todo);
  const reopened = { ...rest, done: false, completedAt: null };
  const next = series && todos.find((t) => t.id === series.next && !t.done && (!series.fp || fingerprint(t) === series.fp));
  if (series && next) {
    reopened.repeat = series.repeat;
    reopened.repeatDay = series.repeatDay;
  }
  return todos
    .filter((t) => !next || t.id !== next.id)
    .map((t) => (t.id === id ? reopened : t));
}

// Отметить выполненной. У повторяющейся задачи сделанная копия уходит в «Готово»
// (там видна история), а на её месте встаёт следующий раз с новым сроком и
// неотмеченными шагами. Возвращает список и следующую задачу (или null).
export function completeTodo(todos, id, today, now = Date.now()) {
  const index = todos.findIndex((t) => t.id === id);
  const todo = todos[index];
  if (!todo || todo.done) return { todos, next: null };
  const mine = own(todo);
  const done = { ...mine, done: true, completedAt: now, repeat: null, repeatDay: null };
  if (!todo.repeat) return { todos: [...todos.slice(0, index), done, ...todos.slice(index + 1)], next: null };
  const next = {
    ...mine,
    id: makeId(),
    createdAt: now,
    due: nextDue(todo.repeat, todo.due, today, todo.repeatDay),
    steps: todo.steps.map((s) => ({ ...s, done: false })),
  };
  done.series = { repeat: todo.repeat, repeatDay: todo.repeatDay, next: next.id, fp: fingerprint(next) };
  return { todos: [...todos.slice(0, index), next, done, ...todos.slice(index + 1)], next };
}

export function toggleStep(todos, id, stepId) {
  return todos.map((t) => (t.id === id
    ? { ...own(t), steps: t.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) }
    : t));
}

// Шаги из вставленного текста: каждая непустая строка становится шагом.
// Возвращает список и строки, которые не влезли в лимит.
export function addSteps(todos, id, text) {
  const titles = String(text ?? '').split(/\r?\n/).map(normalizeTitle).filter(Boolean);
  const todo = todos.find((t) => t.id === id);
  if (!titles.length || !todo) return { todos, rest: [] };
  const room = Math.max(0, MAX_STEPS - todo.steps.length);
  if (!room) return { todos, rest: titles };
  const added = titles.slice(0, room).map((title) => ({ title, done: false }));
  return {
    todos: todos.map((t) => (t.id === id ? { ...own(t), steps: normalizeSteps([...t.steps, ...added]) } : t)),
    rest: titles.slice(room),
  };
}

export function stepProgress(todo) {
  return { done: todo.steps.filter((s) => s.done).length, total: todo.steps.length };
}

// Просроченное одним нажатием на сегодня: без чувства вины за кучу красного.
export function rescheduleOverdue(todos, today) {
  return todos.map((t) => (!t.done && t.due !== null && t.due < today ? { ...own(t), due: today } : t));
}

// Правка любых полей. Пустое название не сохраняем: задача без названия бессмысленна.
export function updateTodo(todos, id, changes) {
  return todos.map((t) => {
    if (t.id !== id) return t;
    const next = own(t);
    if ('title' in changes) {
      const title = normalizeTitle(changes.title);
      if (title) next.title = title;
    }
    if ('due' in changes) next.due = cleanDue(changes.due);
    if ('priority' in changes) next.priority = cleanPriority(changes.priority);
    if ('tags' in changes) next.tags = normalizeTags(changes.tags);
    if ('notes' in changes) next.notes = normalizeNotes(changes.notes);
    if ('steps' in changes) next.steps = normalizeSteps(changes.steps);
    if ('repeat' in changes) next.repeat = cleanRepeat(changes.repeat);
    // повтор без срока не имеет смысла: начинаем с сегодня
    if (next.repeat && !next.due && changes.today) next.due = firstDue(next.repeat, changes.today);
    // в редакторе день недели повтора следует за сроком, при быстром переносе (только due) остаётся
    if ('repeat' in changes || 'repeatDay' in changes) next.repeatDay = repeatDayFor(next.repeat, changes.repeatDay, next.due);
    return next;
  });
}

export function removeTodo(todos, id) {
  return todos.filter((t) => t.id !== id);
}

export function removeSamples(todos) {
  return todos.filter((t) => !t.sample);
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
      || todo.tags.some((tag) => tag.toLowerCase().includes(word))
      || todo.notes.toLowerCase().includes(word)
      || todo.steps.some((s) => s.title.toLowerCase().includes(word));
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

/* День: что можно взять на сегодня, неделя вперёд, итог недели */

// Задачи, которые можно взять на сегодня: без срока и на ближайшие 7 дней.
// Сначала с датой (ближайшие выше), потом без даты в своём порядке.
// Просроченные сюда не входят: они и так в «Сегодня».
export function suggestForToday(todos, today, days = 7) {
  const horizon = addDays(today, days);
  const open = todos.filter((t) => !t.done);
  const dated = open.filter((t) => t.due !== null && t.due > today && t.due <= horizon);
  const undated = open.filter((t) => t.due === null);
  return [...sortTodos(dated, 'due'), ...undated];
}

// Все открытые задачи со сроком по сегодня (и просроченные) переносятся на target.
export function moveOpenTo(todos, today, target) {
  return todos.map((t) => (!t.done && isDueBy(t, today) ? { ...own(t), due: target } : t));
}

// Понедельник недели, в которую входит день.
export function weekStart(day) {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

// Сколько сделано с понедельника этой недели по сегодня.
export function doneThisWeek(todos, today, dayKeyOf) {
  const start = weekStart(today);
  return todos.filter((t) => {
    if (!t.done || t.completedAt === null) return false;
    const day = dayKeyOf(t.completedAt);
    return day >= start && day <= today;
  }).length;
}

// Нагрузка на 7 дней вперёд: сегодня считает и просроченные, прошлых дней нет.
export function weekLoad(todos, today, days = 7) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const count = todos.filter((t) => !t.done && (i === 0 ? isDueBy(t, today) : t.due === date)).length;
    return { date, count };
  });
}

// Приветствие по часу: утро 5–11, день 12–17, вечер 18–4.
export function greetingKey(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

// Выполненные по дням закрытия, свежие сверху.
export function groupDoneByDay(todos, dayKeyOf) {
  const groups = [];
  for (const t of sortDone(todos.filter((x) => x.done))) {
    const day = t.completedAt === null ? null : dayKeyOf(t.completedAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(t);
    else groups.push({ day, items: [t] });
  }
  return groups;
}
