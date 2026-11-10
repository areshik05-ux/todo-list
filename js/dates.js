// Срок задачи храню строкой «ГГГГ-ММ-ДД» в местном времени: её можно
// сравнивать как строку, и она не съезжает на день при смене часового пояса.

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');

export function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Полдень, а не полночь: так перевод часов не превращает дату во вчерашнюю.
export function fromKey(key) {
  const m = KEY_RE.exec(key ?? '');
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return toKey(date) === key ? date : null;
}

export function isDateKey(value) {
  return typeof value === 'string' && fromKey(value) !== null;
}

export function todayKey(now = new Date()) {
  return toKey(now);
}

export function addDays(key, days) {
  const date = fromKey(key);
  date.setDate(date.getDate() + days);
  return toKey(date);
}

export function daysBetween(fromKeyValue, toKeyValue) {
  const a = fromKey(fromKeyValue);
  const b = fromKey(toKeyValue);
  return Math.round((b - a) / 86_400_000);
}

// Ближайший такой день недели после сегодняшнего (0 = воскресенье).
// «В пятницу», сказанное в пятницу, значит следующую пятницу.
export function nextWeekday(today, weekday) {
  const current = fromKey(today).getDay();
  const diff = ((weekday - current + 7) % 7) || 7;
  return addDays(today, diff);
}

// День и месяц без года: если дата в этом году уже прошла, имеется в виду следующий.
export function dayMonthKey(today, day, month, year) {
  const base = fromKey(today);
  const y = year ?? base.getFullYear();
  const key = `${y}-${pad(month)}-${pad(day)}`;
  if (!isDateKey(key)) return null;
  if (year === undefined && key < today) return dayMonthKey(today, day, month, y + 1);
  return key;
}

// День недели ключа: 0 = воскресенье.
export function weekdayOf(key) {
  return fromKey(key).getDay();
}

// Плюс n месяцев с тем же числом; 31 января + 1 месяц = 28 (29) февраля.
export function addMonths(key, months) {
  const date = fromKey(key);
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, last));
  return toKey(target);
}

// Ближайший понедельник после сегодняшнего: «на следующей неделе».
export function nextMonday(today) {
  return nextWeekday(today, 1);
}

// Тот же месяц, другое число; если такого числа нет (31 февраля), последний день месяца.
export function withDay(key, day) {
  const date = fromKey(key);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate();
  date.setDate(Math.min(day, last));
  return toKey(date);
}
