// Быстрый ввод как в Todoist: «Позвонить маме завтра !1 #семья».
// Слова про срок, приоритет и метки вырезаются из названия и становятся полями задачи.
// Понимаем русский и английский одновременно, независимо от языка интерфейса.

import { addDays, dayMonthKey, nextWeekday, weekdayOf } from './dates.js';
import { firstDue } from './repeat.js';

export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 30;

// \b в JS не знает кириллицу, поэтому границы слова задаём сами.
const L = '(?<![\\p{L}\\p{N}_])';
const R = '(?![\\p{L}\\p{N}_])';
const re = (body) => new RegExp(L + '(?:' + body + ')' + R, 'giu');

const WEEKDAYS = [
  // [номер дня, «в …», «к …», «до …», сокращение, английские формы]
  [1, 'понедельник', 'понедельнику', 'понедельника', 'пн', 'monday|mon'],
  [2, 'вторник', 'вторнику', 'вторника', 'вт', 'tuesday|tue'],
  // «к среде» не берём: «готовиться к среде» чаще про окружение, чем про день
  [3, 'среду|среда', '(?!)', 'среды', 'ср', 'wednesday|wed'],
  [4, 'четверг', 'четвергу', 'четверга', 'чт', 'thursday|thu'],
  [5, 'пятницу|пятница', 'пятнице', 'пятницы', 'пт', 'friday|fri'],
  [6, 'субботу|суббота', 'субботе', 'субботы', 'сб', 'saturday|sat'],
  [0, 'воскресенье', 'воскресенью', 'воскресенья', 'вс', 'sunday|(?!)'],
];

const MONTHS_RU = ['январ[ья]', 'феврал[ья]', 'марта?', 'апрел[ья]', 'ма[йя]', 'июн[ья]',
  'июл[ья]', 'августа?', 'сентябр[ья]', 'октябр[ья]', 'ноябр[ья]', 'декабр[ья]'];
const MONTHS_EN = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'june?',
  'july?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'];

function monthIndex(word) {
  const w = word.toLowerCase();
  for (let i = 0; i < 12; i += 1) {
    if (new RegExp(`^(?:${MONTHS_RU[i]}|${MONTHS_EN[i]})$`, 'u').test(w)) return i + 1;
  }
  return 0;
}

const NUM_WORDS = { один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, one: 1, two: 2, three: 3, four: 4, five: 5 };
const toNumber = (s) => NUM_WORDS[s.toLowerCase()] ?? Number(s);

const MONTH_RU = MONTHS_RU.join('|');
const MONTH_EN = MONTHS_EN.join('|');
// «may 5» не берём: в «I may 5 times» это не май
const MONTH_EN_LEAD = MONTHS_EN.filter((m) => m !== 'may').join('|');
const NUM = '\\d{1,2}|один|одну|два|две|три|четыре|пять|one|two|three|four|five';

// Каждое правило: регулярка и функция, которая по совпадению и «сегодня» даёт дату.
const DATE_RULES = [
  [re('(?:к |до )?сегодня|(?:by )?today'), (_, t) => t],
  [re('(?:к |до )?послезавтра|day after tomorrow'), (_, t) => addDays(t, 2)],
  [re('(?:к |до )?завтра|(?:by )?tomorrow|tmr'), (_, t) => addDays(t, 1)],
  [re('через неделю|next week|in a week'), (_, t) => addDays(t, 7)],
  [re(`через (${NUM}) (?:день|дня|дней)|in (${NUM}) days?`),
    (m, t) => addDays(t, toNumber(m[1] ?? m[2]))],
  [re(`через (${NUM}) (?:недел[юиь]|недели)|in (${NUM}) weeks?`),
    (m, t) => addDays(t, 7 * toNumber(m[1] ?? m[2]))],
  ...WEEKDAYS.map(([day, ru, dative, genitive, short, en]) => [
    // по-русски только с предлогом: «в среду» срок, а «настроить среду» нет;
    // английское сокращение только с on/next: «mon» само по себе не день
    re(`(?:в|во) (?:${ru}|${short})|к ${dative}|до ${genitive}|(?:on |next |by )?(?:${en.split('|')[0]})|(?:on |next )${en.split('|')[1]}`),
    (_, t) => nextWeekday(t, day),
  ]),
  // 25.11, 25.11.2026, 25/11. Месяц строго двумя цифрами, чтобы «1.5 литра» не стало 1 мая.
  // «on» перед датой тоже срезаем: «pay rent on 25.11» → «pay rent».
  [re('(?:on |by |к |до )?(\\d{1,2})[./](\\d{2})(?:[./](\\d{4}))?'),
    (m, t) => dayMonthKey(t, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined)],
  // 25 ноября, 25 nov, 25 november 2026
  [re(`(?:on |by |к |до )?(\\d{1,2}) (${MONTH_RU}|${MONTH_EN})(?: (\\d{4}))?`),
    (m, t) => dayMonthKey(t, Number(m[1]), monthIndex(m[2]), m[3] ? Number(m[3]) : undefined)],
  // nov 25, november 25
  [re(`(?:on )?(${MONTH_EN_LEAD}) (\\d{1,2})(?: (\\d{4}))?`),
    (m, t) => dayMonthKey(t, Number(m[2]), monthIndex(m[1]), m[3] ? Number(m[3]) : undefined)],
];

// Повтор: «каждый день», «по будням», «каждую пятницу», «every monday».
// Одиночные daily/weekly не берём: «Daily Mail» не повтор.
const REPEAT_WEEKDAYS = [
  [1, 'каждый понедельник|по понедельникам', 'monday'],
  [2, 'каждый вторник|по вторникам', 'tuesday'],
  [3, 'каждую среду|по средам', 'wednesday'],
  [4, 'каждый четверг|по четвергам', 'thursday'],
  [5, 'каждую пятницу|по пятницам', 'friday'],
  [6, 'каждую субботу|по субботам', 'saturday'],
  [0, 'каждое воскресенье|по воскресеньям', 'sunday'],
];
const sameOrNextWeekday = (today, day) => (weekdayOf(today) === day ? today : nextWeekday(today, day));
// [регулярка, шаг повтора, первый срок, день недели]
const REPEAT_RULES = [
  // «каждый день рождения» не повтор
  [re('каждый день(?! рождения)|ежедневно|every day(?! of)|everyday'), 'day', (t) => firstDue('day', t), null],
  [re('по будням|каждый будний день|every weekday|on weekdays'), 'weekday', (t) => firstDue('weekday', t), null],
  [re('каждую неделю|еженедельно|every week'), 'week', (t) => t, null],
  [re('каждый месяц|ежемесячно|every month'), 'month', (t) => t, null],
  [re('каждый год|ежегодно|every year'), 'year', (t) => t, null],
  ...REPEAT_WEEKDAYS.map(([day, ru, en]) => [
    re(`${ru}|every ${en}|on ${en}s`), 'week', (t) => sameOrNextWeekday(t, day), day,
  ]),
];

const PRIORITY_RE = re('!([1-3])|p([1-3])');
const TAG_RE = /(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_-]{1,30})(?![\p{L}\p{N}_-])/gu;

function collect(regex, text, make) {
  const found = [];
  regex.lastIndex = 0;
  for (const m of text.matchAll(regex)) {
    const value = make(m);
    if (value === null || value === undefined) continue;
    found.push({ start: m.index, end: m.index + m[0].length, text: m[0], value });
  }
  return found;
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * @returns {{ title: string, due: string|null, priority: 0|1|2|3, tags: string[],
 *   repeat: string|null, repeatDay: number|null, tokens: Array<{ type: 'date'|'priority'|'tag'|'repeat', text: string, value: any }> }}
 */
// ignore: слова, которые пользователь попросил не распознавать (крестик на чипе).
export function parseQuickAdd(input, today, { ignore = [] } = {}) {
  const skip = new Set(ignore.map((w) => w.toLowerCase()));
  const text = String(input ?? '');
  const taken = [];
  const tokens = [];
  const accept = (type, match) => {
    if (skip.has(match.text.toLowerCase())) return false;
    if (taken.some((t) => overlaps(t, match))) return false;
    taken.push(match);
    tokens.push({ type, text: match.text, value: match.value, start: match.start });
    return true;
  };

  // Повтор разбираем раньше срока: в «каждый понедельник» слово «понедельник» не отдельный срок.
  let repeat = null;
  let repeatStart = null;
  let repeatDay = null;
  const repeats = REPEAT_RULES
    .flatMap(([regex, kind, start, day]) => collect(regex, text, () => ({ kind, start: start(today), day })))
    .sort((a, b) => a.start - b.start);
  for (const r of repeats) {
    if (accept('repeat', { ...r, value: r.value.kind })) {
      ({ kind: repeat, start: repeatStart, day: repeatDay } = r.value);
      break;
    }
  }

  // Срок: берём самое раннее упоминание в строке, остальное остаётся текстом.
  const dates = DATE_RULES
    .flatMap(([regex, make]) => collect(regex, text, (m) => make(m, today)))
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  let due = null;
  for (const d of dates) {
    if (accept('date', d)) { due = d.value; break; }
  }

  let priority = 0;
  for (const p of collect(PRIORITY_RE, text, (m) => Number(m[1] ?? m[2]))) {
    if (accept('priority', p)) { priority = p.value; break; }
  }

  const tags = [];
  for (const tag of collect(TAG_RE, text, (m) => m[1])) {
    const exists = tags.some((x) => x.toLowerCase() === tag.value.toLowerCase());
    if (tags.length >= MAX_TAGS && !exists) continue;
    if (!accept('tag', tag)) continue;
    // повтор метки вырезаем из названия, но второй раз не показываем
    if (exists) tokens.pop();
    else tags.push(tag.value);
  }

  let title = text;
  for (const t of [...taken].sort((a, b) => b.start - a.start)) {
    title = title.slice(0, t.start) + ' ' + title.slice(t.end);
  }
  // «Встреча завтра.» → «Встреча.»: знак препинания не висит после вырезанного слова
  title = title.replace(/\s+/g, ' ').replace(/ ([.,;:!?])/g, '$1').trim();

  // Если вся строка состояла из служебных слов («завтра»), не теряем её:
  // считаем это названием, а не сроком.
  if (!title) {
    return { title: text.replace(/\s+/g, ' ').trim(), due: null, priority: 0, tags: [], repeat: null, repeatDay: null, tokens: [] };
  }
  if (repeat && !due) due = repeatStart;

  tokens.sort((a, b) => a.start - b.start);
  return { title, due, priority, tags, repeat, repeatDay, tokens: tokens.map(({ start, ...rest }) => rest) };
}

export function normalizeTags(list) {
  const out = [];
  for (const raw of list ?? []) {
    const tag = String(raw).replace(/^#+/, '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, MAX_TAG_LENGTH);
    if (!tag || out.some((x) => x.toLowerCase() === tag.toLowerCase())) continue;
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

// «работа, дом #срочно» → ['работа', 'дом', 'срочно'] (для поля меток в редакторе)
export function splitTags(text) {
  return normalizeTags(String(text ?? '').split(/[\s,;]+/));
}
