// Задача со сроком → файл .ics для календаря телефона или компьютера.
// Уведомлений без сервера не бывает, а календарь напомнит сам: событие на весь день
// с напоминанием в 9:00, повтор переводится в правило календаря (RRULE).
// Чистые функции без DOM: файл скачивает app.js, тесты в tests/calendar.test.js.

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const compact = (key) => key.replaceAll('-', '');

// Следующий день после YYYY-MM-DD (DTEND события на весь день не включается).
function nextDay(key) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// RFC 5545, 3.3.11: экранируем \ ; , и перевод строки.
export function escapeText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// RFC 5545, 3.1: строка не длиннее 75 байт UTF-8, продолжение начинается с пробела.
// Режем по символам, чтобы не разорвать букву кириллицы или эмодзи пополам.
export function foldLine(line) {
  const enc = new TextEncoder();
  const parts = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const len = enc.encode(ch).length;
    const limit = parts.length ? 74 : 75; // у продолжения 1 байт уходит на пробел
    if (size + len > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function repeatRule(repeat, repeatDay, due) {
  if (repeat === 'day') return 'FREQ=DAILY';
  if (repeat === 'weekday') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (repeat === 'week') {
    const day = Number.isInteger(repeatDay) ? repeatDay : new Date(`${due}T00:00:00Z`).getUTCDay();
    return `FREQ=WEEKLY;BYDAY=${BYDAY[day]}`;
  }
  if (repeat === 'month') {
    const day = Number.isInteger(repeatDay) ? repeatDay : Number(due.slice(8));
    // В приложении «31-го» в коротком месяце значит последний день (28 февраля, 30 апреля).
    // В календаре несуществующая дата просто пропускается, поэтому для 29–31 правило
    // «последний из подходящих дней месяца», а 31 и есть «последний день».
    if (day === 31) return 'FREQ=MONTHLY;BYMONTHDAY=-1';
    if (day >= 29) return `FREQ=MONTHLY;BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`;
    return `FREQ=MONTHLY;BYMONTHDAY=${day}`;
  }
  if (repeat === 'year') {
    // 29 февраля в невисокосный год: 28-е, как в приложении
    if (due.slice(5) === '02-29') return 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1';
    return 'FREQ=YEARLY';
  }
  return null;
}

// UID должен быть одним и тем же для всей серии: у повторяющейся задачи каждый
// следующий раз получает новый id, и календарь завёл бы вторую серию.
// Для повтора берём отпечаток названия и правила (FNV-1a), для обычной задачи её id.
export function eventUid(todo) {
  if (!todo.repeat) return String(todo.id ?? '');
  let hash = 0x811c9dc5;
  for (const ch of `${todo.title}|${todo.repeat}|${todo.repeatDay ?? ''}`) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `series-${hash.toString(16).padStart(8, '0')}`;
}

function stamp(now) {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function description(todo, lang) {
  const lines = [];
  if (todo.notes) lines.push(todo.notes);
  const steps = Array.isArray(todo.steps) ? todo.steps : [];
  if (steps.length) {
    if (lines.length) lines.push('');
    lines.push(lang === 'en' ? 'Steps:' : 'Шаги:');
    for (const s of steps) lines.push(`${s.done ? '[x]' : '[ ]'} ${s.title}`);
  }
  return lines.join('\n');
}

// null, если у задачи нет срока: без даты событие в календаре не создать.
export function toICS(todo, { now = Date.now(), lang = 'ru', alarm = true } = {}) {
  if (!todo || typeof todo.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(todo.due)) return null;
  const rule = repeatRule(todo.repeat, todo.repeatDay, todo.due);
  const text = description(todo, lang);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//arina-todo-list//Tasks//${lang === 'en' ? 'EN' : 'RU'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(eventUid(todo) || stamp(now))}@arina-todo-list`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${compact(todo.due)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(todo.due))}`,
    `SUMMARY:${escapeText(todo.title ?? '')}`,
  ];
  if (text) lines.push(`DESCRIPTION:${escapeText(text)}`);
  if (rule) lines.push(`RRULE:${rule}`);
  if (todo.priority === 1) lines.push('PRIORITY:1');
  lines.push('TRANSP:TRANSPARENT'); // задача не занимает время в календаре
  if (alarm) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(todo.title ?? '')}`,
      'TRIGGER;RELATED=START:PT9H', // 9:00 в день срока
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// Имя файла из названия задачи: буквы и цифры любого языка, остальное в дефис.
export function icsFileName(todo) {
  const base = String(todo?.title ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${base || 'task'}.ics`;
}

export const ICS_TYPE = 'text/calendar;charset=utf-8';
