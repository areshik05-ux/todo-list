import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleTodos } from '../js/samples.js';
import { createI18n } from '../js/i18n.js';
import { cleanList } from '../js/storage.js';

const TODAY = '2026-11-10';

test('примеры на обоих языках: три задачи, шаги, повтор, ничего просроченного', () => {
  for (const lang of ['ru', 'en']) {
    const { t } = createI18n(lang);
    const list = sampleTodos(t, TODAY, 1);
    assert.equal(list.length, 3);
    assert.ok(list.every((todo) => todo.sample && todo.notes && todo.due >= TODAY), lang);
    assert.ok(list.every((todo) => !todo.title.startsWith('sample.')), 'все тексты переведены');
    assert.equal(list[0].steps.length, 3);
    assert.equal(list[1].repeat, 'day');
    assert.deepEqual(cleanList(list), list, 'примеры проходят проверку хранилища без изменений');
  }
});
