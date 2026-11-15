// Выбор меток без «#»: окно «Метки» (поле ввода и редактор задачи) и подсказка после «#» в поле.
// Чистые функции, страницу не трогают (тесты в tests/picker.test.js). Источник правды в поле ввода
// по-прежнему текст: выбранная метка дописывается в него как «#метка», и разбор (parse.js) видит её
// так же, как набранную руками. Убранная метка убирается из текста.

import { normalizeTags, MAX_TAGS } from './parse.js';
import { tagKey } from './tags.js';

// для поиска: без регистра, «ё» = «е»
const fold = (s) => tagKey(s).replace(/ё/g, 'е');

const WORD = '[\\p{L}\\p{N}_-]';

// Начало метки прямо перед курсором («Купить #мо|»): что подсказывать и откуда заменять.
// Курсор посреди слова или после «#» внутри другого слова: null.
export function tagAtCaret(text, caret) {
  const value = String(text ?? '');
  const at = Math.max(0, Math.min(caret ?? value.length, value.length));
  const m = new RegExp(`(?<![\\p{L}\\p{N}_#])#(${WORD}{0,30})$`, 'u').exec(value.slice(0, at));
  if (!m) return null;
  if (new RegExp(`^${WORD}`, 'u').test(value.slice(at))) return null;
  return { prefix: m[1], start: m.index };
}

// Подсказка после «#»: свои метки, которые начинаются с набранного, сначала частые (rows уже
// в этом порядке, tagStats), без тех, что у задачи уже есть.
export function suggestTags(rows, prefix, chosen = [], limit = 6) {
  const p = fold(prefix ?? '');
  const taken = new Set(chosen.map(tagKey));
  return (rows ?? []).filter((row) => !taken.has(row.key) && fold(row.tag).startsWith(p)).slice(0, limit);
}

// Выбрали подсказку: набранное начало заменяется меткой, за ней пробел, курсор после него.
export function completeTag(text, at, tag) {
  const value = String(text ?? '');
  const end = at.start + 1 + at.prefix.length;
  const rest = value.slice(end);
  const insert = `#${tag}${rest.startsWith(' ') ? '' : ' '}`;
  return { text: value.slice(0, at.start) + insert + rest, caret: at.start + insert.length + (rest.startsWith(' ') ? 1 : 0) };
}

// Окно «Метки» в поле ввода: дописать метку в конец текста.
export function addTagText(text, tag) {
  const value = String(text ?? '');
  return `${value}${!value || /\s$/.test(value) ? '' : ' '}#${tag}`;
}

// Убрать метку из текста: каждое «#метка» (без учёта регистра) вместе с пробелом перед ним.
export function removeTagText(text, tag) {
  const key = tagKey(tag);
  const re = new RegExp(`(\\s?)(?<![\\p{L}\\p{N}_#])#(${WORD}{1,30})(?!${WORD})`, 'gu');
  return String(text ?? '').replace(re, (all, space, name) => (tagKey(name) === key ? '' : all)).replace(/^\s+/, '');
}

// Строки окна «Метки»: выбранные новые метки (их ещё нет в задачах) сверху, потом свои метки
// в порядке боковой панели; поиск по части имени. create: имя новой метки, если набранного нет.
export function pickerOptions(rows, query, chosen = []) {
  const known = new Set((rows ?? []).map((row) => row.key));
  const fresh = normalizeTags(chosen).filter((tag) => !known.has(tagKey(tag))).map((tag) => ({ tag, key: tagKey(tag) }));
  const all = [...fresh, ...(rows ?? []).map(({ tag, key }) => ({ tag, key }))];
  const q = fold(String(query ?? '').trim().replace(/^#+/, ''));
  const list = q ? all.filter((option) => fold(option.tag).includes(q)) : all;
  const [name] = normalizeTags([String(query ?? '').trim()]);
  // в поле ввода «#123» не метка (нужна хоть одна буква): такую и создавать не предлагаем
  const create = name && /\p{L}/u.test(name) && !all.some((option) => option.key === tagKey(name)) ? name : null;
  return { list, create };
}

// Какая подсказка выделена сразу. Первая, чтобы Enter дописал метку, которую видно выделенной
// («#по» + Enter → «#покупки»). Набрано уже целое имя первой: ничего, Enter добавляет задачу.
export function suggestActive(items, prefix) {
  if (!items?.length) return -1;
  return fold(items[0].tag) === fold(prefix ?? '') ? -1 : 0;
}

// Метки задачи из поля ввода: набранные «#словом» и выбранные в окне «Метки» (они в текст
// не пишутся и в название не попадают). Без повторов, не больше MAX_TAGS.
export function mergeTags(typed, picked) {
  return normalizeTags([...(typed ?? []), ...(picked ?? [])]).slice(0, MAX_TAGS);
}
