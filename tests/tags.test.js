import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAG_COLORS, TAG_ICONS, MAX_TAG_META, ICON_WORD_COUNT, iconFor, cleanTagMeta, tagsInOrder, nextColor, metaFor,
  syncTagMeta, setTagMeta, tagStats, tagOfQuery, tagKey,
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
  assert.ok(MAX_TAG_META >= 100);
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
  assert.deepEqual(clean, {
    дом: { color: 'teal', icon: 'home' },
    работа: { color: 'green', icon: null },
    imgsrcx: { color: 'sky', icon: 'star' },
  });
  assert.equal(Object.getPrototypeOf(clean), Object.prototype);
  const huge = {};
  for (let i = 0; i < MAX_TAG_META + 50; i += 1) huge[`t${i}`] = { color: 'teal' };
  assert.equal(Object.keys(cleanTagMeta(huge)).length, MAX_TAG_META);
});

test('метка с именем свойства объекта не ломает словарь', () => {
  const meta = syncTagMeta({}, [todo(['__proto__', 'constructor', 'toString'])]);
  assert.equal(Object.getPrototypeOf(meta), Object.prototype);
  assert.ok(!Object.hasOwn(meta, '__proto__'));
  assert.equal(meta.constructor.color, TAG_COLORS[0]);
  assert.equal(metaFor({}, '__proto__').icon, null);
  assert.ok(TAG_COLORS.includes(metaFor({}, '__proto__').color));
  assert.equal(setTagMeta(meta, '__proto__', { color: 'sky' }), meta);
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

test('список меток: открытые задачи, всего, порядок', () => {
  const todos = [todo(['дом']), todo(['Дом', 'работа']), todo(['работа'], { done: true }), todo(['книги'], { done: true }), todo(['арт'])];
  assert.deepEqual(tagStats(todos).map((r) => [r.tag, r.open, r.total]), [['дом', 2, 2], ['работа', 1, 2], ['арт', 1, 1], ['книги', 0, 1]]);
  assert.deepEqual(tagStats([]), []);
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
