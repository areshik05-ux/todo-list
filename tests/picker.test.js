import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagAtCaret, suggestTags, completeTag, addTagText, removeTagText, pickerOptions } from '../js/picker.js';
import { parseQuickAdd } from '../js/parse.js';
import { tagStats } from '../js/tags.js';

const TODAY = '2026-11-13';
const rows = tagStats([
  { tags: ['дом'], done: false, createdAt: 1 }, { tags: ['дом', 'работа'], done: false, createdAt: 2 },
  { tags: ['Ёлка'], done: true, createdAt: 3 }, { tags: ['дача'], done: false, createdAt: 4 },
]);

test('начало метки перед курсором', () => {
  assert.deepEqual(tagAtCaret('Купить #мо', 10), { prefix: 'мо', start: 7 });
  assert.deepEqual(tagAtCaret('#', 1), { prefix: '', start: 0 });
  assert.equal(tagAtCaret('Купить #молоко завтра', 10), null, 'курсор посреди слова');
  assert.equal(tagAtCaret('почта a#b', 9), null, '«#» внутри слова не метка');
  assert.equal(tagAtCaret('Купить молоко', 13), null);
  assert.deepEqual(tagAtCaret('Купить #до завтра', 10), { prefix: 'до', start: 7 }, 'дальше пробел: можно подсказывать');
});

test('подсказка: начало слова, сначала частые, без уже выбранных, ё = е', () => {
  assert.deepEqual(suggestTags(rows, 'д').map((r) => r.tag), ['дом', 'дача']);
  assert.deepEqual(suggestTags(rows, 'Д', ['дом']).map((r) => r.tag), ['дача']);
  assert.deepEqual(suggestTags(rows, 'ел').map((r) => r.tag), ['Ёлка']);
  assert.deepEqual(suggestTags(rows, '').map((r) => r.tag), ['дом', 'дача', 'Ёлка', 'работа']);
  assert.deepEqual(suggestTags(rows, 'зз'), []);
  assert.equal(suggestTags(rows, '', [], 2).length, 2);
});

test('выбор подсказки заменяет набранное начало, курсор после пробела', () => {
  assert.deepEqual(completeTag('Купить #мо', { prefix: 'мо', start: 7 }, 'молоко'), { text: 'Купить #молоко ', caret: 15 });
  assert.deepEqual(completeTag('Купить #до завтра', { prefix: 'до', start: 7 }, 'дом'), { text: 'Купить #дом завтра', caret: 12 });
  const parsed = parseQuickAdd(completeTag('Позвонить маме #', { prefix: '', start: 15 }, 'семья').text, TODAY);
  assert.deepEqual(parsed.tags, ['семья']);
  assert.equal(parsed.title, 'Позвонить маме');
});

test('метка из окна дописывается в текст и убирается из него, разбор видит то же самое', () => {
  assert.equal(addTagText('', 'дом'), '#дом');
  assert.equal(addTagText('Купить хлеб', 'дом'), 'Купить хлеб #дом');
  assert.equal(addTagText('Купить хлеб ', 'дом'), 'Купить хлеб #дом');
  const text = addTagText(addTagText('Купить хлеб завтра !1', 'дом'), 'покупки');
  const parsed = parseQuickAdd(text, TODAY);
  assert.deepEqual(parsed.tags, ['дом', 'покупки']);
  assert.equal(parsed.title, 'Купить хлеб');
  assert.equal(parsed.priority, 1);
  assert.equal(removeTagText(text, 'ДОМ'), 'Купить хлеб завтра !1 #покупки');
  assert.equal(removeTagText('#дом Купить #дом', 'дом'), 'Купить');
  assert.equal(removeTagText('Купить #домик #дом', 'дом'), 'Купить #домик', 'только целое имя');
  assert.equal(removeTagText('почта a#дом', 'дом'), 'почта a#дом', '«#» внутри слова не метка');
});

test('строки окна «Метки»: новые выбранные сверху, поиск по части имени, создать новую', () => {
  const all = pickerOptions(rows, '', ['оил', 'дом']);
  assert.deepEqual(all.list.map((o) => o.tag), ['оил', 'дом', 'дача', 'Ёлка', 'работа']);
  assert.equal(all.create, null);
  const found = pickerOptions(rows, 'а');
  assert.deepEqual(found.list.map((o) => o.tag), ['дача', 'Ёлка', 'работа']);
  assert.equal(found.create, 'а');
  assert.deepEqual(pickerOptions(rows, 'елк').list.map((o) => o.tag), ['Ёлка']);
  assert.equal(pickerOptions(rows, '#Дом').create, null, 'такая уже есть');
  assert.equal(pickerOptions(rows, ' #Сад! ').create, 'Сад');
  assert.equal(pickerOptions(rows, '123').create, null, 'без буквы в поле ввода это не метка');
  assert.equal(pickerOptions(rows, '!!!').create, null);
  assert.deepEqual(pickerOptions([], '').list, []);
});
