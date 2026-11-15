// Метки как списки: у каждой свой цвет и значок. Чистые функции, страницу не трогают
// (тесты в tests/tags.test.js). Хранится словарь { "дом": { color, icon } } в настройках:
// ключ метки в нижнем регистре, «Дом» и «дом» одна метка, как и при поиске.

import { normalizeTags } from './parse.js';

// Мягкие цвета меток. Нет розового, красного и янтарного: это цвета P1, P2 и удаления.
// Сами цвета (фон и текст, светлая и тёмная тема) в css/theme.css, --tag-<id>-tint и --tag-<id>-ink.
export const TAG_COLORS = ['teal', 'violet', 'green', 'indigo', 'olive', 'plum', 'sky', 'slate'];

// Линейные значки в одном стиле со спрайтом (index.html, #t-<id>). Флажок, календарь,
// часы и галочка здесь не нужны: они уже значат приоритет, срок, прошлые дни и «сделано».
export const TAG_ICONS = [
  'home', 'briefcase', 'cart', 'gift', 'heart', 'pill', 'dumbbell', 'book', 'cap', 'wallet',
  'card', 'plane', 'car', 'paw', 'leaf', 'cup', 'phone', 'mail', 'people', 'baby',
  'music', 'camera', 'code', 'bulb', 'star', 'pin', 'wrench', 'broom',
];

// Столько записей держим всего: метки в работе не теряются никогда, а лишние (метку переименовали
// и передумали) уходят, когда записей больше. Из хранилища и файла читаем не больше MAX_TAG_META_READ.
export const MAX_TAG_META = 300;
export const MAX_TAG_META_READ = 1000;

export const tagKey = (tag) => String(tag ?? '').toLowerCase();

// Своя запись метки. Метка может называться «__proto__» или «constructor»: берём только
// собственные поля словаря, а пишем через defineProperty (присваивание «__proto__» сменило бы прототип).
const own = (meta, key) => (meta && Object.hasOwn(meta, key) ? meta[key] : undefined);
function put(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
  return obj;
}
// копия словаря: spread сам задаёт собственные поля, и «__proto__» в том числе
const copy = (meta) => ({ ...(meta ?? {}) });

// Знакомые слова сразу получают значок. Сравнение целым словом, «ё» = «е».
const ICON_WORDS = {
  home: 'дом дома домашнее домашние квартира home house household',
  briefcase: 'работа работы офис проект проекты карьера work job office project projects career',
  cart: 'покупки покупка магазин продукты shopping shop groceries grocery',
  gift: 'подарки подарок праздник праздники gifts gift birthday',
  heart: 'здоровье забота health wellbeing selfcare',
  pill: 'врач врачи аптека лекарства медицина doctor pharmacy meds medicine',
  dumbbell: 'спорт тренировки тренировка зал фитнес бег sport sports gym fitness workout running',
  book: 'книги книга чтение books book reading',
  cap: 'учеба учиться школа универ университет курсы уроки study school uni university course courses learning homework',
  wallet: 'деньги финансы бюджет банк money finance finances budget bank',
  card: 'платежи оплата счета налоги bills payments taxes',
  plane: 'поездка поездки путешествия путешествие отпуск travel trip trips vacation',
  car: 'машина авто автомобиль car auto',
  paw: 'питомцы питомец кот кошка собака животные pets pet cat dog',
  leaf: 'растения сад дача цветы plants garden',
  cup: 'еда готовка кухня рецепты кафе кофе food cooking kitchen recipes cafe coffee',
  phone: 'звонки звонок созвоны созвон calls call phone',
  mail: 'почта письма письмо email mail inbox',
  people: 'семья родные друзья family friends people',
  baby: 'дети ребенок малыш kids kid baby children',
  music: 'музыка music',
  camera: 'фото фотографии photo photos photography',
  code: 'код программирование разработка dev code coding programming',
  bulb: 'идеи идея ideas idea',
  star: 'важное избранное мечты цели important favorites goals dreams',
  pin: 'дела поручения места errands places',
  wrench: 'ремонт repair repairs fix diy',
  broom: 'уборка чистота cleaning chores',
};

const WORD_ICON = new Map();
for (const [icon, words] of Object.entries(ICON_WORDS)) for (const word of words.split(' ')) WORD_ICON.set(word, icon);

export const ICON_WORD_COUNT = WORD_ICON.size;

// «Работа» → briefcase, «#ДОМ» → home, незнакомое слово → null (значок выберет человек)
export function iconFor(tag) {
  const word = tagKey(String(tag ?? '').replace(/^#+/, '')).replace(/ё/g, 'е');
  return WORD_ICON.get(word) ?? null;
}

function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (!TAG_COLORS.includes(entry.color)) return null;
  return { color: entry.color, icon: TAG_ICONS.includes(entry.icon) ? entry.icon : null };
}

// Словарь из хранилища или файла: только известные цвета и значки, ключи как у меток.
export function cleanTagMeta(raw, max = MAX_TAG_META_READ) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [name, entry] of Object.entries(raw)) {
    const [tag] = normalizeTags([name]);
    const clean = cleanEntry(entry);
    if (!tag || !clean) continue;
    const key = tagKey(tag);
    if (Object.hasOwn(out, key)) continue;
    put(out, key, clean);
    n += 1;
    if (n >= max) break;
  }
  return out;
}

// Метки задач в порядке первого появления (по дате создания задачи), без повторов.
export function tagsInOrder(todos) {
  const seen = new Map();
  const sorted = [...(todos ?? [])].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const todo of sorted) {
    for (const tag of todo.tags ?? []) if (!seen.has(tagKey(tag))) seen.set(tagKey(tag), tag);
  }
  return [...seen.values()];
}

// Следующий цвет: тот, что реже всего встречается у меток в работе; при равенстве по порядку набора.
// Так первые восемь меток получают восемь разных цветов, а соседние не совпадают.
export function nextColor(meta, inUse = Object.keys(meta ?? {})) {
  const count = new Map(TAG_COLORS.map((c) => [c, 0]));
  for (const key of inUse) {
    const color = own(meta, tagKey(key))?.color;
    if (count.has(color)) count.set(color, count.get(color) + 1);
  }
  let best = TAG_COLORS[0];
  for (const color of TAG_COLORS) if (count.get(color) < count.get(best)) best = color;
  return best;
}

// Как будет выглядеть метка: своя запись или то, что она получит при первом появлении.
export function metaFor(meta, tag, inUse) {
  return own(meta, tagKey(tag)) ?? { color: nextColor(meta, inUse), icon: iconFor(tag) };
}

// Всем меткам из задач по записи: новые получают цвет по порядку и значок по слову.
// Лишние записи (метка больше нигде не встречается) живут, пока их не больше MAX_TAG_META:
// метку переименовали и вернули, а цвет и значок на месте. Возвращает тот же объект, если ничего не поменялось.
export function syncTagMeta(meta, todos, max = MAX_TAG_META) {
  const current = meta ?? {};
  const tags = tagsInOrder(todos);
  const used = new Set(tags.map(tagKey));
  let next = null;
  // цвета меток, которые уже есть в задачах, учитываются при раздаче новым
  const inUse = tags.map(tagKey).filter((key) => Object.hasOwn(current, key));
  for (const tag of tags) {
    const key = tagKey(tag);
    if (Object.hasOwn(next ?? current, key)) continue;
    next ??= copy(current);
    put(next, key, { color: nextColor(next, inUse), icon: iconFor(tag) });
    inUse.push(key);
  }
  const result = next ?? current;
  const keys = Object.keys(result);
  // уходят только неиспользуемые, старые первыми (порядок ключей = порядок появления)
  let extra = Math.min(keys.length - max, keys.filter((key) => !used.has(key)).length);
  if (extra <= 0) return result;
  const pruned = {};
  for (const key of keys) {
    if (extra > 0 && !used.has(key)) {
      extra -= 1;
      continue;
    }
    put(pruned, key, result[key]);
  }
  return pruned;
}

// Цвета и значки из файла копии: только для меток, которые есть в задачах после загрузки,
// и свои записи важнее чужих (свой выбор, сделанный после копии, загрузка не перетирает).
export function mergeImportedMeta(own, imported, todos) {
  const used = new Set(tagsInOrder(todos).map(tagKey));
  let next = null;
  for (const [key, entry] of Object.entries(imported ?? {})) {
    if (!used.has(key) || Object.hasOwn(own ?? {}, key)) continue;
    next ??= copy(own);
    put(next, key, entry);
  }
  return next ?? own;
}

// Как будут выглядеть метки задачи после сохранения: тот же расчёт, что и при сохранении
// (syncTagMeta), поэтому превью в редакторе и в поле ввода = итог. Несколько новых меток
// получают разные цвета по порядку, как и получат на самом деле.
// task: { id, tags, createdAt }; задачи с таким id ещё нет (новая): она встаёт последней.
export function previewTags(meta, todos, task) {
  const tags = normalizeTags(task.tags ?? []);
  const list = todos ?? [];
  const known = task.id != null && list.some((todo) => todo.id === task.id);
  const future = known
    ? list.map((todo) => (todo.id === task.id ? { ...todo, tags } : todo))
    : [...list, { id: task.id ?? null, tags, createdAt: task.createdAt ?? Number.MAX_SAFE_INTEGER }];
  const after = syncTagMeta(meta ?? {}, future, Infinity);
  return tags.map((tag) => ({ tag, ...own(after, tagKey(tag)) }));
}

// Поменять цвет или значок одной метки. Неизвестное значение не меняет ничего.
export function setTagMeta(meta, tag, patch) {
  const key = tagKey(tag);
  const base = own(meta, key) ?? { color: nextColor(meta), icon: iconFor(tag) };
  const entry = { ...base };
  if ('color' in patch && TAG_COLORS.includes(patch.color)) entry.color = patch.color;
  if ('icon' in patch && (patch.icon === null || TAG_ICONS.includes(patch.icon))) entry.icon = patch.icon;
  if (entry.color === base.color && entry.icon === base.icon && own(meta, key)) return meta;
  return put(copy(meta), key, entry);
}

// Метки для списка в боковой панели: имя, как его написали в первый раз, сколько открытых и всего.
// Сначала те, у которых больше задач (всего, со сделанными), потом по алфавиту, числа по значению
// («метка2» раньше «метка11»). Отметка задачи порядок не меняет: список не прыгает под рукой.
export function tagStats(todos, locale = 'ru') {
  const map = new Map();
  for (const tag of tagsInOrder(todos)) map.set(tagKey(tag), { tag, key: tagKey(tag), open: 0, total: 0 });
  for (const todo of todos ?? []) {
    for (const tag of todo.tags ?? []) {
      const row = map.get(tagKey(tag));
      row.total += 1;
      if (!todo.done) row.open += 1;
    }
  }
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return [...map.values()].sort((a, b) => b.total - a.total || collator.compare(a.tag, b.tag) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Поиск вида «#дом» (одна метка): какая это метка, иначе null.
export function tagOfQuery(query) {
  const m = /^#([^\s#]+)$/.exec(String(query ?? '').trim());
  return m ? m[1] : null;
}
