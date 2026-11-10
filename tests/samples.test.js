import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleTodos, translateSamples } from '../js/samples.js';
import { createI18n } from '../js/i18n.js';
import { cleanList } from '../js/storage.js';

const TODAY = '2026-11-10';

test('примеры на обоих языках: три задачи, шаги, повтор, ничего просроченного', () => {
  for (const lang of ['ru', 'en']) {
    const { t } = createI18n(lang);
    const list = sampleTodos(t, TODAY, 1);
    assert.equal(list.length, 3);
    assert.ok(list.every((todo) => typeof todo.sample === 'string' && todo.notes && todo.due >= TODAY), lang);
    assert.ok(list.every((todo) => !todo.title.startsWith('sample.')), 'все тексты переведены');
    assert.equal(list[0].steps.length, 3);
    assert.equal(list[1].repeat, 'day');
    assert.deepEqual(cleanList(list), list, 'примеры проходят проверку хранилища без изменений');
  }
});

test('нетронутые примеры переводятся при смене языка, свои задачи нет', () => {
  const en = createI18n('en');
  const ru = createI18n('ru');
  const list = sampleTodos(en.t, TODAY, 1);
  const own = { ...list[2], id: 'mine', title: 'My task' };
  delete own.sample;
  const next = translateSamples([...list, own], ru.t);
  assert.equal(next[0].title, ru.t('sample.trip'));
  assert.equal(next[0].steps[1].title, ru.t('sample.tripStep2'));
  assert.equal(next[0].steps[0].done, true, 'отметки шагов на месте');
  assert.deepEqual(next[2].tags, [ru.t('sample.bankTag')]);
  assert.equal(next[3].title, 'My task');
  assert.equal(translateSamples([own], ru.t)[0], own);
});
