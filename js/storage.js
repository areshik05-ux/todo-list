import { normalizeTitle, normalizeNotes, normalizeSteps, PRIORITIES } from './todos.js';
import { isRepeat, isRepeatDay, repeatDayFor } from './repeat.js';
import { isDateKey } from './dates.js';
import { normalizeTags } from './parse.js';

export const STORAGE_KEY = 'todo-list:v2';
export const LEGACY_KEY = 'todo-list:v1';
export const SETTINGS_KEY = 'todo-list:settings';

// В localStorage может лежать что угодно: старая версия, ручная правка
// через DevTools, обрезанная запись. Берём только валидные задачи,
// недостающие поля заполняем значениями по умолчанию.
// В Chrome с запретом cookies даже чтение window.localStorage бросает SecurityError,
// поэтому хранилище берём только внутри try.
const local = (storage) => storage ?? globalThis.localStorage;

export function cleanTodo(t) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || !t.id || t.id.length > 100) return null;
  const title = normalizeTitle(t.title);
  if (typeof t.title !== 'string' || !title) return null;
  const done = t.done === true;
  const createdAt = Number.isFinite(Number(t.createdAt)) ? Number(t.createdAt) : 0;
  let completedAt = Number.isFinite(Number(t.completedAt)) && t.completedAt !== null ? Number(t.completedAt) : null;
  // у задач из v1 нет даты выполнения: берём дату создания, лучше не знаем
  if (done && completedAt === null) completedAt = createdAt;
  if (!done) completedAt = null;
  const repeat = !done && isRepeat(t.repeat) && isDateKey(t.due) ? t.repeat : null;
  return {
    id: t.id,
    title,
    done,
    createdAt,
    completedAt,
    due: isDateKey(t.due) ? t.due : null,
    priority: PRIORITIES.includes(Number(t.priority)) ? Number(t.priority) : 0,
    tags: Array.isArray(t.tags) ? normalizeTags(t.tags) : [],
    notes: typeof t.notes === 'string' ? normalizeNotes(t.notes) : '',
    steps: normalizeSteps(t.steps),
    // у сделанной задачи повтора нет: следующий раз уже создан отдельной задачей
    repeat,
    repeatDay: repeat ? repeatDayFor(repeat, t.repeatDay, t.due) : null,
    ...(typeof t.sample === 'string' && SAMPLE_RE.test(t.sample) ? { sample: t.sample } : {}),
    ...(done && cleanSeries(t.series) ? { series: cleanSeries(t.series) } : {}),
  };
}

const SAMPLE_RE = /^[a-z]{1,20}$/;

// Связь сделанного раза повторяющейся задачи со следующим (для снятия отметки).
function cleanSeries(s) {
  if (!s || !isRepeat(s.repeat) || typeof s.next !== 'string' || !s.next || s.next.length > 100) return null;
  return {
    repeat: s.repeat,
    repeatDay: isRepeatDay(s.repeat, s.repeatDay) ? s.repeatDay : null,
    next: s.next,
    ...(typeof s.fp === 'string' && s.fp.length <= 20000 ? { fp: s.fp } : {}),
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

export const DATA_VERSION = 3;

export function serialize(todos) {
  return JSON.stringify({ version: DATA_VERSION, todos });
}

// Первый визит: ни v2, ни v1 в хранилище нет. Тогда показываем примеры задач.
export function isFirstVisit(storage) {
  try {
    return local(storage).getItem(STORAGE_KEY) === null && local(storage).getItem(LEGACY_KEY) === null;
  } catch {
    return false;
  }
}

// Запись есть, но это не список задач (обрезана, испорчена руками):
// прежде чем начать заново, кладём её копию рядом, чтобы ничего не пропало молча.
export const BACKUP_KEY = 'todo-list:backup';

export function isCorrupt(raw) {
  if (raw === null || raw === '') return false;
  try {
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : data?.todos;
    // не список или список, в котором нет ни одной годной задачи
    return !Array.isArray(list) || (list.length > 0 && cleanList(list).length === 0);
  } catch {
    return true;
  }
}

// { todos, corrupt }: corrupt = запись была испорчена и сохранена в BACKUP_KEY.
export function loadTodosReport(storage) {
  try {
    const raw = local(storage).getItem(STORAGE_KEY);
    if (!isCorrupt(raw)) return { todos: loadTodos(storage), corrupt: false };
    // каждая испорченная запись в свою копию: первую не затираем
    const key = local(storage).getItem(BACKUP_KEY) === null ? BACKUP_KEY : `${BACKUP_KEY}:${Date.now()}`;
    local(storage).setItem(key, raw);
    return { todos: [], corrupt: true };
  } catch {
    return { todos: [], corrupt: false };
  }
}

export function loadTodos(storage) {
  try {
    const raw = local(storage).getItem(STORAGE_KEY);
    if (raw !== null) return parseTodos(raw);
    // первый запуск v2: переносим задачи из v1, старую запись не трогаем
    const legacy = parseTodos(local(storage).getItem(LEGACY_KEY));
    if (legacy.length) saveTodos(legacy, storage);
    return legacy;
  } catch {
    // приватный режим Safari или запрещённые cookies
    return [];
  }
}

// Можно ли вообще писать: в приватном режиме или с запретом cookies нельзя.
export function storageAvailable(storage) {
  try {
    local(storage).setItem('todo-list:probe', '1');
    local(storage).removeItem('todo-list:probe');
    return true;
  } catch {
    return false;
  }
}

export function saveTodos(todos, storage) {
  try {
    local(storage).setItem(STORAGE_KEY, serialize(todos));
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

export function loadSettings(storage) {
  try {
    return parseSettings(local(storage).getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage) {
  try {
    local(storage).setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/* Экспорт и импорт */

export function exportJSON(todos, now = new Date()) {
  return JSON.stringify({ app: 'todo-list', version: DATA_VERSION, exportedAt: now.toISOString(), todos }, null, 2);
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
