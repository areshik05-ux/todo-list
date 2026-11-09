import {
  addTodo, toggleTodo, renameTodo, removeTodo, clearCompleted,
  filterTodos, countActive, plural, FILTERS,
} from './todos.js';
import { loadTodos, saveTodos, STORAGE_KEY } from './storage.js';

const $ = (sel) => document.querySelector(sel);

const form = $('#add-form');
const input = $('#new-todo');
const board = $('#board');
const list = $('#list');
const listEmpty = $('#list-empty');
const empty = $('#empty');
const left = $('#left');
const clearDoneBtn = $('#clear-done');
const storageWarning = $('#storage-warning');
const toast = $('#toast');
const toastText = $('#toast-text');
const template = $('#todo-template');

const EMPTY_TEXT = {
  active: 'Активных задач нет. Можно выдохнуть.',
  done: 'Пока ничего не отмечено.',
};

let todos = loadTodos();
let filter = filterFromHash();
let undo = null; // { snapshot, timer }

// Все изменения списка проходят здесь: сохранить, перерисовать.
function commit(next, { focus } = {}) {
  dropUndo();
  todos = next;
  storageWarning.hidden = saveTodos(todos);
  render(focus);
}

function filterFromHash() {
  const name = location.hash.replace('#/', '');
  return name in FILTERS ? name : 'all';
}

function render(focus) {
  const hasTodos = todos.length > 0;
  board.hidden = !hasTodos;
  empty.hidden = hasTodos;

  const doneCount = todos.length - countActive(todos);
  const activeCount = todos.length - doneCount;
  const counts = { all: todos.length, active: activeCount, done: doneCount };

  for (const btn of document.querySelectorAll('[data-filter]')) {
    const name = btn.dataset.filter;
    btn.setAttribute('aria-pressed', String(name === filter));
    btn.querySelector('[data-count]').textContent = counts[name];
  }

  left.textContent = activeCount === 0
    ? 'Всё сделано'
    : `Осталось ${activeCount} ${plural(activeCount, ['задача', 'задачи', 'задач'])}`;
  clearDoneBtn.hidden = doneCount === 0;

  const visible = filterTodos(todos, filter);
  list.replaceChildren(...visible.map(renderItem));
  listEmpty.hidden = visible.length > 0;
  listEmpty.textContent = EMPTY_TEXT[filter] ?? '';

  restoreFocus(focus);
}

function renderItem(todo) {
  const li = template.content.firstElementChild.cloneNode(true);
  li.dataset.id = todo.id;
  li.classList.toggle('is-done', todo.done);

  const check = li.querySelector('.todo-check');
  check.checked = todo.done;
  check.setAttribute('aria-label', `Выполнено: ${todo.title}`);

  li.querySelector('.todo-title').textContent = todo.title;
  li.querySelector('.todo-edit').setAttribute('aria-label', `Переименовать: ${todo.title}`);
  li.querySelector('.todo-edit').title = 'Переименовать';
  li.querySelector('.todo-delete').setAttribute('aria-label', `Удалить: ${todo.title}`);
  li.querySelector('.todo-delete').title = 'Удалить';
  return li;
}

// После перерисовки возвращаем фокус туда, где был пользователь,
// иначе при работе с клавиатуры он улетает в начало страницы.
function restoreFocus(focus) {
  if (!focus) return;
  if (focus === 'input') return input.focus();
  const item = list.querySelector(`[data-id="${CSS.escape(focus.id)}"]`);
  if (item) return item.querySelector(focus.selector).focus();
  const neighbour = list.children[Math.min(focus.index, list.children.length - 1)];
  (neighbour?.querySelector('.todo-check') ?? input).focus();
}

/* Отмена удаления */

function offerUndo(snapshot, message) {
  toastText.textContent = message;
  toast.hidden = false;
  undo = { snapshot, timer: setTimeout(dropUndo, 6000) };
}

function dropUndo() {
  if (!undo) return;
  clearTimeout(undo.timer);
  undo = null;
  toast.hidden = true;
}

$('#toast-undo').addEventListener('click', () => {
  if (!undo) return;
  const { snapshot } = undo;
  commit(snapshot, { focus: 'input' });
});

/* Редактирование */

function startEditing(li) {
  if (li.classList.contains('is-editing')) return;
  const todo = todos.find((t) => t.id === li.dataset.id);
  const title = li.querySelector('.todo-title');

  const field = document.createElement('input');
  field.className = 'todo-field';
  field.value = todo.title;
  field.maxLength = 200;
  field.setAttribute('aria-label', 'Новое название задачи');

  li.classList.add('is-editing');
  title.replaceWith(field);
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const focus = { id: todo.id, selector: '.todo-edit', index: 0 };
    if (save && field.value.trim() && field.value.trim() !== todo.title) {
      commit(renameTodo(todos, todo.id, field.value), { focus });
    } else {
      render(focus);
    }
  };

  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  field.addEventListener('blur', () => finish(true));
}

/* События */

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!input.value.trim()) {
    input.value = '';
    return;
  }
  // новая задача не видна во вкладке «Готово», переключаемся на все
  if (filter === 'done') {
    filter = 'all';
    history.replaceState(null, '', '#/all');
  }
  commit(addTodo(todos, input.value), { focus: 'input' });
  form.reset();
});

list.addEventListener('change', (e) => {
  if (!e.target.matches('.todo-check')) return;
  const li = e.target.closest('.todo');
  const index = [...list.children].indexOf(li);
  commit(toggleTodo(todos, li.dataset.id), { focus: { id: li.dataset.id, selector: '.todo-check', index } });
});

list.addEventListener('click', (e) => {
  const li = e.target.closest('.todo');
  if (!li) return;

  if (e.target.closest('.todo-delete')) {
    const snapshot = todos;
    const index = [...list.children].indexOf(li);
    const title = li.querySelector('.todo-title')?.textContent ?? '';
    commit(removeTodo(todos, li.dataset.id), { focus: { id: '', index } });
    offerUndo(snapshot, `Удалено: «${title}»`);
  } else if (e.target.closest('.todo-edit')) {
    startEditing(li);
  }
});

list.addEventListener('dblclick', (e) => {
  const li = e.target.closest('.todo');
  if (li && e.target.closest('.todo-title')) startEditing(li);
});

clearDoneBtn.addEventListener('click', () => {
  const snapshot = todos;
  const removed = todos.length - countActive(todos);
  commit(clearCompleted(todos), { focus: 'input' });
  offerUndo(snapshot, `Убрано ${removed} ${plural(removed, ['задача', 'задачи', 'задач'])}`);
});

for (const btn of document.querySelectorAll('[data-filter]')) {
  btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.filter}`; });
}

window.addEventListener('hashchange', () => {
  filter = filterFromHash();
  render();
});

// Список открыт в двух вкладках: изменения в одной сразу видны в другой
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  if (list.querySelector('.is-editing')) return;
  dropUndo();
  todos = loadTodos();
  render();
});

const today = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date());
$('#today').textContent = today[0].toUpperCase() + today.slice(1);

render();
