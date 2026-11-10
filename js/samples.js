// Примеры задач при первом визите: учат шагам, повтору и быстрому вводу
// прямо в списке, без отдельного обучения. Поле sample хранит, какой это
// пример: пока человек его не трогал, он переводится вместе с интерфейсом
// и убирается кнопкой «Убрать примеры». Любое действие с примером (правка,
// отметка, перенос, шаг) делает его обычной задачей, см. own() в todos.js.
// Ничего просроченного: в первый день не за что себя винить.

import { addTodo } from './todos.js';
import { addDays } from './dates.js';

// Тексты примера на текущем языке. Шаги по порядку, отметки шагов не трогаем.
function texts(sample, t) {
  switch (sample) {
    case 'trip':
      return {
        title: t('sample.trip'),
        notes: t('sample.tripNote'),
        tags: [],
        steps: [t('sample.tripStep1'), t('sample.tripStep2'), t('sample.tripStep3')],
      };
    case 'stretch':
      return { title: t('sample.stretch'), notes: t('sample.stretchNote'), tags: [], steps: [] };
    case 'bank':
      return { title: t('sample.bank'), notes: t('sample.bankNote'), tags: [t('sample.bankTag')], steps: [] };
    default:
      return null;
  }
}

export function sampleTodos(t, today, now = Date.now()) {
  let list = [];
  const add = (sample, fields) => {
    const { steps, ...rest } = texts(sample, t);
    list = addTodo(list, { ...rest, ...fields, steps: steps.map((title, i) => ({ title, done: i === 0 })), sample }, now);
  };
  // addTodo кладёт новую задачу наверх, поэтому добавляем с конца
  add('bank', { due: addDays(today, 1), priority: 1 });
  add('stretch', { due: today, repeat: 'day' });
  add('trip', { due: today });
  return list;
}

// Сменили язык: нетронутые примеры переводим, остальное не меняем.
export function translateSamples(todos, t) {
  let changed = false;
  const next = todos.map((todo) => {
    const fresh = todo.sample ? texts(todo.sample, t) : null;
    if (!fresh) return todo;
    changed = true;
    return {
      ...todo,
      title: fresh.title,
      notes: fresh.notes,
      tags: fresh.tags,
      steps: todo.steps.map((step, i) => ({ ...step, title: fresh.steps[i] ?? step.title })),
    };
  });
  return changed ? next : todos;
}
