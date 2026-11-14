import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAG_COLORS, TAG_ICONS, MAX_TAG_META, MAX_TAG_META_READ, ICON_WORD_COUNT, iconFor, cleanTagMeta, tagsInOrder, nextColor, metaFor,
  syncTagMeta, setTagMeta, tagStats, tagOfQuery, tagKey, mergeImportedMeta,
} from '../js/tags.js';
import { DICTS } from '../js/i18n.js';

const todo = (tags, extra = {}) => ({ id: String(Math.random()), title: 'x', done: false, createdAt: 1, tags, ...extra });

test('значок по знакомому слову на двух языках, целым словом, без учёта регистра и ё', () => {
  assert.equal(iconFor('дом'), 'home');
  assert.equal(iconFor('Работа'), 'briefcase');
  assert.equal(iconFor('#work'), 'briefcase');
  assert.equal(iconFor('учёба'), 'cap');
  assert.equal(iconFor('ПОКУПКИ'), 'cart');
  assert.equal(iconFor('health'), 'heart');
  assert.equal(iconFor('поездка'), 'plane');
  assert.equal(iconFor('trip'), 'plane');
  assert.equal(iconFor('деньги'), 'wallet');
  assert.equal(iconFor('книги'), 'book');
  assert.equal(iconFor('дела'), 'pin');
  assert.equal(iconFor('errands'), 'pin');
  assert.equal(iconFor('домофон'), null, 'только целое слово');
  assert.equal(iconFor('срочно'), null);
  assert.equal(iconFor(''), null);
  assert.equal(iconFor(undefined), null);
  assert.ok(ICON_WORD_COUNT >= 60, 'около 30 понятий, у каждого слова на двух языках');
});

test('у каждого значка есть рисунок в спрайте и название на двух языках, флажка и календаря нет', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(TAG_ICONS.length, 28);
  for (const icon of TAG_ICONS) {
    assert.ok(html.includes(`<symbol id="t-${icon}"`), icon);
    assert.ok(DICTS.ru[`icon.${icon}`] && DICTS.en[`icon.${icon}`], icon);
  }
  for (const taken of ['flag', 'calendar', 'clock', 'check', 'back']) assert.ok(!TAG_ICONS.includes(taken), taken);
  for (const color of TAG_COLORS) assert.ok(DICTS.ru[`tagColor.${color}`] && DICTS.en[`tagColor.${color}`], color);
});

test('цвета меток не повторяют цвета приоритетов и удаления', () => {
  assert.equal(TAG_COLORS.length, 8);
  for (const bad of ['pink', 'red', 'raspberry', 'amber', 'orange', 'yellow']) assert.ok(!TAG_COLORS.includes(bad), bad);
});

test('новые метки получают цвета по порядку появления: первые восемь разные', () => {
  const todos = ['дом', 'работа', 'спорт', 'книги', 'деньги', 'семья', 'музыка', 'идеи', 'код'].map((t, i) => todo([t], { createdAt: i }));
  const meta = syncTagMeta({}, todos);
  const colors = ['дом', 'работа', 'спорт', 'книги', 'деньги', 'семья', 'музыка', 'идеи'].map((t) => meta[t].color);
  assert.deepEqual(colors, TAG_COLORS);
  assert.equal(meta.код.color, TAG_COLORS[0], 'девятая по кругу');
  assert.equal(meta.дом.icon, 'home');
  assert.equal(meta.код.icon, 'code');
});

test('порядок появления по дате создания задачи, а не по месту в списке', () => {
  const todos = [todo(['поздняя'], { createdAt: 50 }), todo(['ранняя', 'Поздняя'], { createdAt: 10 })];
  assert.deepEqual(tagsInOrder(todos), ['ранняя', 'Поздняя']);
  const meta = syncTagMeta({}, todos);
  assert.equal(meta.ранняя.color, TAG_COLORS[0]);
  assert.equal(meta.поздняя.color, TAG_COLORS[1]);
});

test('свой выбор не перетирается, а занятые цвета учитываются', () => {
  const meta = { дом: { color: 'teal', icon: 'star' } };
  const next = syncTagMeta(meta, [todo(['дом', 'работа'])]);
  assert.deepEqual(next.дом, { color: 'teal', icon: 'star' });
  assert.equal(next.работа.color, 'violet');
  assert.equal(syncTagMeta(next, [todo(['Дом', 'работа'])]), next, 'ничего нового: тот же объект');
});

test('метка, которой больше нет в задачах, помнит цвет; лишние старые уходят', () => {
  const meta = syncTagMeta({}, [todo(['старая']), todo(['новая'])]);
  const after = syncTagMeta(meta, [todo(['новая'])]);
  assert.ok(after.старая, 'переименовали и вернули: цвет на месте');
  const many = {};
  for (let i = 0; i < 10; i += 1) many[`m${i}`] = { color: 'teal', icon: null };
  const pruned = syncTagMeta(many, [todo(['m0', 'свежая'])], 5);
  assert.equal(Object.keys(pruned).length, 5);
  assert.ok(pruned.m0 && pruned.свежая, 'используемые остаются');
  assert.ok(!pruned.m1, 'самые старые неиспользуемые ушли первыми');
  assert.ok(MAX_TAG_META >= 300);
});

test('метки в работе не теряют запись, сколько бы их ни было', () => {
  const todos = Array.from({ length: 220 }, (_, i) => todo([`метка${i}`], { createdAt: i }));
  const meta = syncTagMeta({}, todos, 200);
  assert.equal(Object.keys(meta).length, 220, 'все 220 в работе остаются, хотя предел 200');
  const starred = setTagMeta(meta, 'метка204', { icon: 'star' });
  assert.equal(syncTagMeta(starred, todos, 200), starred, 'ничего не убрали: тот же объект, без лишней записи');
  // как после перезагрузки: словарь из хранилища читается целиком, свой значок на месте
  const reloaded = cleanTagMeta(JSON.parse(JSON.stringify(starred)));
  assert.deepEqual(reloaded.метка204, { color: starred.метка204.color, icon: 'star' });
  assert.ok(MAX_TAG_META_READ >= 1000);
});

test('словарь из хранилища и файла проверяется', () => {
  assert.deepEqual(cleanTagMeta(null), {});
  assert.deepEqual(cleanTagMeta('дом'), {});
  assert.deepEqual(cleanTagMeta([{ color: 'teal' }]), {});
  // как из файла: JSON.parse делает «__proto__» обычным полем, а не прототипом
  const raw = JSON.parse(`{
    "Дом": { "color": "teal", "icon": "home" },
    "дом": { "color": "violet", "icon": "star" },
    "#работа": { "color": "green", "icon": "rocket" },
    "плохая": { "color": "pink", "icon": "home" },
    "пустая": null,
    "<img src=x>": { "color": "sky", "icon": "star" },
    "__proto__": { "color": "teal", "icon": "home" },
    "": { "color": "teal" }
  }`);
  assert.ok(Object.hasOwn(raw, '__proto__'));
  const clean = cleanTagMeta(raw);
  assert.deepEqual(Object.keys(clean), ['дом', 'работа', 'imgsrcx', '__proto__']);
  assert.deepEqual(clean.дом, { color: 'teal', icon: 'home' });
  assert.deepEqual(clean.работа, { color: 'green', icon: null });
  assert.deepEqual(clean.imgsrcx, { color: 'sky', icon: 'star' });
  // «__proto__» хранится обычным полем, прототип словаря прежний
  assert.ok(Object.hasOwn(clean, '__proto__'));
  assert.equal(Object.getPrototypeOf(clean), Object.prototype);
  const huge = {};
  for (let i = 0; i < MAX_TAG_META_READ + 50; i += 1) huge[`t${i}`] = { color: 'teal' };
  assert.equal(Object.keys(cleanTagMeta(huge)).length, MAX_TAG_META_READ);
});

test('метка с именем свойства объекта работает как любая другая', () => {
  const meta = syncTagMeta({}, [todo(['__proto__', 'constructor', 'toString'])]);
  assert.equal(Object.getPrototypeOf(meta), Object.prototype);
  assert.ok(Object.hasOwn(meta, '__proto__'), 'своя запись, а не прототип');
  assert.equal(meta.__proto__, Object.getOwnPropertyDescriptor(meta, '__proto__').value);
  assert.equal(Object.getOwnPropertyDescriptor(meta, '__proto__').value.color, TAG_COLORS[0]);
  assert.equal(meta.constructor.color, TAG_COLORS[1]);
  assert.equal(metaFor({}, '__proto__').icon, null);
  // цвет и значок меняются, прототип не трогается, запись переживает JSON
  const plum = setTagMeta(meta, '__proto__', { color: 'plum', icon: 'star' });
  assert.notEqual(plum, meta);
  assert.deepEqual(Object.getOwnPropertyDescriptor(plum, '__proto__').value, { color: 'plum', icon: 'star' });
  assert.equal(Object.getPrototypeOf(plum), Object.prototype);
  const back = cleanTagMeta(JSON.parse(JSON.stringify(plum)));
  assert.deepEqual(Object.getOwnPropertyDescriptor(back, '__proto__').value, { color: 'plum', icon: 'star' });
  assert.equal(syncTagMeta(plum, [todo(['__proto__', 'constructor', 'toString'])]), plum, 'цвет не пересчитывается');
});

test('смена цвета и значка: только известные значения, без значка можно', () => {
  const meta = { дом: { color: 'teal', icon: 'home' } };
  assert.deepEqual(setTagMeta(meta, 'Дом', { color: 'plum' }).дом, { color: 'plum', icon: 'home' });
  assert.deepEqual(setTagMeta(meta, 'дом', { icon: null }).дом, { color: 'teal', icon: null });
  assert.equal(setTagMeta(meta, 'дом', { color: 'neon' }), meta);
  assert.equal(setTagMeta(meta, 'дом', { icon: 'rocket' }), meta);
  assert.equal(meta.дом.color, 'teal', 'исходный словарь не меняется');
  const fresh = setTagMeta(meta, 'спорт', { icon: 'star' });
  assert.deepEqual(fresh.спорт, { color: 'violet', icon: 'star' });
});

test('предпросмотр метки в поле ввода совпадает с тем, что она получит', () => {
  const meta = syncTagMeta({}, [todo(['дом'])]);
  const preview = metaFor(meta, 'спорт', ['дом']);
  const after = syncTagMeta(meta, [todo(['дом']), todo(['спорт'], { createdAt: 2 })]);
  assert.deepEqual(preview, after.спорт);
});

test('список меток: открытые задачи, всего, порядок по числу задач, потом по алфавиту', () => {
  const todos = [todo(['дом']), todo(['Дом', 'работа']), todo(['работа'], { done: true }), todo(['книги'], { done: true }), todo(['арт'])];
  assert.deepEqual(tagStats(todos).map((r) => [r.tag, r.open, r.total]), [['дом', 2, 2], ['работа', 1, 2], ['арт', 1, 1], ['книги', 0, 1]]);
  assert.deepEqual(tagStats([]), []);
});

test('порядок меток не меняется, когда задачи отмечаются, а числа идут по значению', () => {
  const todos = ['метка2', 'метка11', 'метка1', 'Банк', 'архив'].map((tag, i) => todo([tag], { id: String(i), createdAt: i }));
  const order = tagStats(todos).map((r) => r.tag);
  assert.deepEqual(order, ['архив', 'Банк', 'метка1', 'метка2', 'метка11']);
  const ticked = todos.map((x) => (x.tags[0] === 'метка1' ? { ...x, done: true } : x));
  assert.deepEqual(tagStats(ticked).map((r) => r.tag), order);
  assert.deepEqual(tagStats(['b2', 'b10', 'a'].map((tag) => todo([tag])), 'en').map((r) => r.tag), ['a', 'b2', 'b10']);
});

test('имя метки в списке такое, каким его написали в первый раз', () => {
  // новые задачи стоят сверху списка, а имя берётся у самой ранней
  const todos = [todo(['ДОМ'], { createdAt: 30 }), todo(['Дом'], { createdAt: 20 }), todo(['дом'], { createdAt: 10 })];
  assert.deepEqual(tagStats(todos).map((r) => [r.tag, r.total]), [['дом', 3]]);
});

test('цвета меток из файла копии: только новые и только для меток в задачах', () => {
  const own = { дом: { color: 'plum', icon: 'star' } };
  const imported = { дом: { color: 'green', icon: 'leaf' }, работа: { color: 'sky', icon: 'code' }, мусор: { color: 'teal', icon: null } };
  const todos = [todo(['дом']), todo(['работа'])];
  const merged = mergeImportedMeta(own, imported, todos);
  assert.deepEqual(merged.дом, { color: 'plum', icon: 'star' }, 'свой выбор важнее файла');
  assert.deepEqual(merged.работа, { color: 'sky', icon: 'code' }, 'новая метка берёт цвет из файла');
  assert.ok(!Object.hasOwn(merged, 'мусор'), 'метки, которой нет в задачах, нет и в словаре');
  assert.deepEqual(own, { дом: { color: 'plum', icon: 'star' } }, 'свой словарь не меняется');
  assert.equal(mergeImportedMeta(own, { дом: { color: 'green', icon: null } }, todos), own, 'ничего нового: тот же объект');
  const junk = {};
  for (let i = 0; i < 300; i += 1) junk[`t${i}`] = { color: 'teal', icon: null };
  assert.equal(mergeImportedMeta(own, junk, todos), own);
});

test('поиск «#метка» узнаётся как фильтр по метке', () => {
  assert.equal(tagOfQuery('#дом'), 'дом');
  assert.equal(tagOfQuery(' #work '), 'work');
  assert.equal(tagOfQuery('#дом молоко'), null);
  assert.equal(tagOfQuery('дом'), null);
  assert.equal(tagOfQuery('##'), null);
  assert.equal(tagKey('ДоМ'), 'дом');
});

test('цвет считается по меткам в работе', () => {
  assert.equal(nextColor({}), 'teal');
  assert.equal(nextColor({ a: { color: 'teal' } }, ['a']), 'violet');
  assert.equal(nextColor({ a: { color: 'teal' } }, []), 'teal', 'неиспользуемые не занимают цвет');
});
