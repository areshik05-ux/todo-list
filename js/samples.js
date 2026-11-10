// Примеры задач при первом визите: учат шагам, повтору и быстрому вводу
// прямо в списке, без отдельного обучения. Помечены sample: их можно убрать
// одной кнопкой, а поправленный пример становится обычной задачей.
// Ничего просроченного: в первый день не за что себя винить.

import { addTodo } from './todos.js';
import { addDays } from './dates.js';

export function sampleTodos(t, today, now = Date.now()) {
  let list = [];
  const add = (fields) => { list = addTodo(list, { ...fields, sample: true }, now); };
  // addTodo кладёт новую задачу наверх, поэтому добавляем с конца
  add({
    title: t('sample.bank'), due: addDays(today, 1), priority: 1, tags: [t('sample.bankTag')], notes: t('sample.bankNote'),
  });
  add({ title: t('sample.stretch'), due: today, repeat: 'day', notes: t('sample.stretchNote') });
  add({
    title: t('sample.trip'),
    due: today,
    notes: t('sample.tripNote'),
    steps: [
      { title: t('sample.tripStep1'), done: true },
      { title: t('sample.tripStep2') },
      { title: t('sample.tripStep3') },
    ],
  });
  return list;
}
