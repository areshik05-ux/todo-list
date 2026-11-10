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
  if (repeat === 'month') return `FREQ=MONTHLY;BYMONTHDAY=${Number.isInteger(repeatDay) ? repeatDay : Number(due.slice(8))}`;
  if (repeat === 'year') return 'FREQ=YEARLY';
  return null;
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
    'PRODID:-//arina-todo-list//Tasks//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(todo.id ?? stamp(now))}@arina-todo-list`,
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
