// Задачи живут только в браузере. Два способа их не потерять:
// 1) просим браузер не стирать данные сайта при нехватке места (storage.persist);
// 2) тихо напоминаем скачать копию, если её давно не было. Без окон и без давления:
//    одна строка в меню, которая сама исчезает после скачивания.
// Чистые функции, хранилище и navigator передаются снаружи (тесты в tests/backup.test.js).

export const LAST_BACKUP_KEY = 'todo-list:last-backup';
export const BACKUP_DAYS = 14; // через сколько дней без копии напоминать
export const BACKUP_MIN_TASKS = 3; // при одной-двух задачах терять почти нечего

const DAY = 24 * 60 * 60 * 1000;

export function readLastBackup(storage = globalThis.localStorage) {
  try {
    const n = Number(storage?.getItem(LAST_BACKUP_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// Вызывать после скачивания файла с задачами.
export function markBackup(storage = globalThis.localStorage, now = Date.now()) {
  try {
    storage?.setItem(LAST_BACKUP_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

// 'never': копии не было, а первой своей задаче больше BACKUP_DAYS дней;
// 'old': последняя копия старше BACKUP_DAYS дней; null: напоминать не нужно.
// Примеры с первого визита (поле sample) не считаем, выполненные считаем: это тоже история.
export function backupNudge(todos, { lastAt = null, now = Date.now(), days = BACKUP_DAYS, minTasks = BACKUP_MIN_TASKS } = {}) {
  const own = (Array.isArray(todos) ? todos : []).filter((t) => t && !t.sample);
  if (own.length < minTasks) return null;
  const limit = days * DAY;
  if (lastAt) return now - lastAt >= limit ? 'old' : null;
  const oldest = Math.min(...own.map((t) => (Number.isFinite(t.createdAt) ? t.createdAt : now)));
  return now - oldest >= limit ? 'never' : null;
}

// Сколько полных дней прошло с последней копии (для текста «копии не было 20 дней»).
export function daysSince(at, now = Date.now()) {
  return at ? Math.max(0, Math.floor((now - at) / DAY)) : null;
}

// Просим браузер хранить данные постоянно. Chrome решает сам без вопроса пользователю,
// Firefox может спросить, поэтому вызывать после действия пользователя (первая своя задача).
// Возвращает true, если данные уже защищены или браузер согласился.
export async function requestPersist(nav = globalThis.navigator) {
  const storage = nav?.storage;
  if (!storage?.persist) return false;
  try {
    if (storage.persisted && (await storage.persisted())) return true;
    return Boolean(await storage.persist());
  } catch {
    return false;
  }
}
