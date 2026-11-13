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
// «2027 г.», «2027 года» после года уходят вместе с датой
const YEAR_G = '(?: ?(?:г\\.?|года|году)(?![\\p{L}\\p{N}_.]))?';
// 25.11, 25.11.2026, 25.11.26, 25/11. Месяц строго двумя цифрами, чтобы «1.5 литра» не стало 1 мая.
// По краям даты не цифры через точку: иначе из «10.10.10.10» или «25.11/26.11» дата
// взялась бы из хвоста, а при неудаче дальше регулярка отступила бы с «25.11.2027»
// на «25.11» и потеряла год.
const NUM_DATE = `(?<!\\d[./])(\\d{1,2})[./](\\d{2})(?:[./](\\d{4}|\\d{2})${YEAR_G})?(?![./]?\\d)`;
const END_DATE = '(\\d{1,2})[./](\\d{2})(?:[./](\\d{4}|\\d{2}))?(?![./]?\\d)';
// «26» в «25.11.26» это 2026 год
const yearOf = (y) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : undefined);
const thisYear = (today) => Number(today.slice(0, 4));

// Дата из цифр. Короткий год берём, только если дата ещё впереди и не дальше чем через
// 10 лет: «Обновить до 2.12.21», «Версия 10.10.10», «Release 1.10.25» это номера версий,
// а не сроки в прошлом. Полный год («до 01.12.2025») берём как написан.
function numericDate(today, day, month, year) {
  const key = dayMonthKey(today, Number(day), Number(month), yearOf(year));
  if (!key || year?.length !== 2) return key;
  return key >= today && Number(key.slice(0, 4)) <= thisYear(today) + 10 ? key : null;
}

// «Акция с 10.11 по 20.11»: если диапазон уже идёт, срок по его концу, а не начало
// через год. Иначе срок по началу, как у одиночной даты. Без года диапазон мог начаться
// и в прошлом году: «с 25.12 по 05.01» второго января идёт до 5 января.
function rangeDue(today, d1, m1, y1, d2, m2, y2) {
  // год только у конца («с 25.12 по 05.01.2027»): начало в том же году или в предыдущем
  const endFirst = Number(m1) * 100 + Number(d1) > Number(m2) * 100 + Number(d2);
  const startYear = !y1 && y2 ? yearOf(y2) - (endFirst ? 1 : 0) : undefined;
  const years = y1 ? [yearOf(y1)] : startYear ? [startYear] : [thisYear(today) - 1, thisYear(today)];
  for (const year of years) {
    const start = dayMonthKey(today, Number(d1), Number(m1), year);
    if (!start || start >= today) continue;
    let end = dayMonthKey(today, Number(d2), Number(m2), y2 ? yearOf(y2) : year);
    if (end && !y2 && end < start) end = dayMonthKey(today, Number(d2), Number(m2), year + 1);
    if (end && end >= today) return end;
  }
  return startYear ? dayMonthKey(today, Number(d1), Number(m1), startYear) : numericDate(today, d1, m1, y1);
}
const rangeDate = (m, today) => rangeDue(today, m[1], m[2], m[3], m[4], m[5], m[6]);
// «с 25 декабря по 5 января», «с 25 по 31 декабря»: без первого месяца он тот же, что у второго
const rangeWordDate = (m, today) => rangeDue(today, m[1], monthIndex(m[2] ?? m[5]), m[3], m[4], monthIndex(m[5]), m[6]);
// «2.10 г. соли», «1.05 м. кабеля», «1.10 ч.1»: с точкой это тоже единица, если число
// похоже на дробь (день до 12 без нуля впереди) и дальше не название с заглавной.
// «25.11 г. Москва», «05.12 м. Пушкинская», «2.10 г. Москва» остаются датами.
const DOTTED_UNIT = /^\s?[гмч]\.(?!\s?\p{Lu})/u;
const looksLikeMeasure = (m) => !m[3] && Number(m[1]) <= 12 && !m[1].startsWith('0')
  && DOTTED_UNIT.test(m.input.slice(m.index + m[0].length));
// «2.10 кг», «1.25 л», «3.50 $»: после числа единица, значит это не дата.
// «г.», «м.», «ч.» с точкой это «год», «метро», «час»: «25.11 г. Москва» остаётся датой
const NOT_UNIT = '(?!\\s?(?:кг|гр|г(?!\\.)|мг|л|мл|м(?!\\.)|см|мм|км|шт|руб|р|коп|ч(?!\\.)|мин|сек|kg|g|mg|lbs?|oz|l|ml|m|cm|mm|km|pcs|h|min|sec|%|\\$|€|₽)(?![\\p{L}\\p{N}_]))';
// «среда» ещё и окружение: «влияние на среду обитания», «в среду разработки» не срок.
// Отсекаем только эти слова после «среду», «на пятницу в 10:00» остаётся сроком.
const NOT_ENVIRONMENT = '(?!\\s+(?:обитания|окружения|разработки|исполнения|выполнения|обучения|тестирования|программирования|проживания|общения|сборки|запуска)(?![\\p{L}\\p{N}_]))';
// предлог перед сроком уходит вместе с ним: «к 25.11», «до завтра», «на пятницу», «on friday».
// «Договор от 01.12.2026» не срок, а дата документа: после «от» дату не берём.
const PRE = '(?<!(?:^|[^\\p{L}\\p{N}_])от )(?:on |by |к |до |на )?';

// Каждое правило: регулярка, функция, которая по совпадению и «сегодня» даёт дату,
// и признак keep: текст остаётся в названии (диапазон «с 25.12 по 05.01» нужен целиком).
const DATE_RULES = [
  [re('(?:к |до |на )?сегодня|(?:by )?today'), (_, t) => t],
  [re('(?:к |до |на )?послезавтра|day after tomorrow'), (_, t) => addDays(t, 2)],
  [re('(?:к |до |на )?завтра|(?:by )?tomorrow|tmr'), (_, t) => addDays(t, 1)],
  [re('через неделю|next week|in a week'), (_, t) => addDays(t, 7)],
  [re(`через (${NUM}) (?:день|дня|дней)|in (${NUM}) days?`),
    (m, t) => addDays(t, toNumber(m[1] ?? m[2]))],
  [re(`через (${NUM}) (?:недел[юиь]|недели)|in (${NUM}) weeks?`),
    (m, t) => addDays(t, 7 * toNumber(m[1] ?? m[2]))],
  ...WEEKDAYS.map(([day, ru, dative, genitive, short, en]) => [
    // по-русски только с предлогом: «в среду» срок, а «настроить среду» нет;
    // английское сокращение только с on/next: «mon» само по себе не день
    re(`(?:в|во|на) (?:${ru}|${short})${day === 3 ? NOT_ENVIRONMENT : ''}|к ${dative}|до ${genitive}|(?:on |next |by )?(?:${en.split('|')[0]})|(?:on |next )${en.split('|')[1]}`),
    (_, t) => nextWeekday(t, day),
  ]),
  // «Отпуск с 25.12 по 05.01», «Курс от 01.12 по 05.12»: срок по первой дате
  // (или по последней, если диапазон уже идёт), а сам диапазон остаётся в названии
  [re(`(?:с|от|from) ${NUM_DATE} (?:по|до|to|till|until) ${END_DATE}${NOT_UNIT}`), rangeDate, { keep: true }],
  [re(`(?:с|от|from) (\\d{1,2})(?: (${MONTH_RU}|${MONTH_EN})(?: (\\d{4})${YEAR_G})?)? (?:по|до|to|till|until) (\\d{1,2}) (${MONTH_RU}|${MONTH_EN})(?: (\\d{4})${YEAR_G})?`),
    rangeWordDate, { keep: true }],
  // «on» перед датой тоже срезаем: «pay rent on 25.11» → «pay rent».
  [re(`${PRE}${NUM_DATE}${NOT_UNIT}`),
    (m, t) => (looksLikeMeasure(m) ? null : numericDate(t, m[1], m[2], m[3]))],
  // 25 ноября, 25 nov, 25 november 2026
  [re(`${PRE}(\\d{1,2}) (${MONTH_RU}|${MONTH_EN})(?: (\\d{4})${YEAR_G})?`),
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
// в метке нужна хотя бы одна буква: «Issue #42» номер, а не метка
const TAG_RE = /(?<![\p{L}\p{N}_#])#((?=[\p{N}_-]*\p{L})[\p{L}\p{N}_-]{1,30})(?![\p{L}\p{N}_-])/gu;

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
  // неразрывный пробел (из подсказки, справки, Option+Space на Mac) считаем обычным
  const text = String(input ?? '').replace(/[  ]/g, ' ');
  const taken = [];
  const tokens = [];
  const accept = (type, match) => {
    if (skip.has(match.text.toLowerCase())) {
      // снятый крестиком диапазон закрывает и даты внутри него
      if (match.keep) taken.push(match);
      return false;
    }
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
    .flatMap(([regex, make, opts]) => collect(regex, text, (m) => make(m, today)).map((d) => ({ ...d, ...opts })))
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
  for (const t of [...taken].filter((x) => !x.keep).sort((a, b) => b.start - a.start)) {
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
