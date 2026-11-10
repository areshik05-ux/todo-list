import {
  addTodo, toggleTodo, completeTodo, updateTodo, removeTodo, clearCompleted, moveTodo, moveTodoAfter, moveWithin,
  toggleStep, stepProgress, rescheduleOverdue, addSteps, removeSamples, MAX_STEPS,
  inView, countViews, todayProgress, matchesQuery, sortTodos, sortDone, VIEWS,
} from './todos.js';
import {
  loadTodos, saveTodos, loadSettings, saveSettings, exportJSON, importJSON, storageAvailable, isFirstVisit,
  STORAGE_KEY, SETTINGS_KEY,
} from './storage.js';
import { parseQuickAdd, splitTags } from './parse.js';
import { todayKey, toKey, fromKey, addDays, nextMonday, daysBetween } from './dates.js';
import { createI18n, detectLang } from './i18n.js';
import { sampleTodos } from './samples.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const form = $('#add-form');
const input = $('#new-todo');
const chips = $('#chips');
const hint = $('#add-hint');
const listWrap = $('#list');
const empty = $('#empty');
const emptyText = $('#empty-text');
const search = $('#search');
const searchClear = $('#search-clear');
const sortSelect = $('#sort');
const clearDoneBtn = $('#clear-done');
const storageWarning = $('#storage-warning');
const live = $('#live');
const toast = $('#toast');
const toastText = $('#toast-text');
const toastUndo = $('#toast-undo');
const helpDialog = $('#help');
const dataBtn = $('#data-btn');
const dataPanel = $('#data-panel');
const importFile = $('#import-file');
const themeBtn = $('#theme-btn');
const helpBtn = $('#help-btn');
const todoTemplate = $('#todo-template');
const editorTemplate = $('#editor-template');
const stepEditTemplate = $('#step-edit-template');
const rowMenu = $('#row-menu');
const samplesBar = $('#samples-bar');

const LINGER_MS = 700; // столько отмеченная задача остаётся на месте, прежде чем уйти в «Готово»
const LEAVE_MS = 240;
const TOAST_MS = 6000;
const MAX_IMPORT_BYTES = 2_000_000;

const firstVisit = isFirstVisit();
let todos = loadTodos();
const settings = loadSettings();
settings.lang ??= detectLang();
let i18n = createI18n(settings.lang);
const t = (...args) => i18n.t(...args);

// Первый визит: вместо пустого экрана несколько задач-подсказок.
if (firstVisit && !todos.length) {
  todos = sampleTodos(t, todayKey());
  saveTodos(todos);
}

let view = viewFromHash();
let query = '';
let editingId = null;
let ignoreTokens = [];
let lastChips = '';
let undo = null; // { snapshot, timer }
let dragEnabled = false;
let renderedDay = todayKey();
const lingering = new Map(); // id → таймер
const openDetails = new Set(); // задачи, у которых раскрыты шаги и заметка
let menu = null; // { id, opener } открытого меню строки

/* Состояние */

// Все изменения списка проходят здесь: сохранить, перерисовать.
function commit(next, { focus } = {}) {
  dropUndo();
  todos = next;
  storageWarning.hidden = saveTodos(todos);
  render(focus);
}

function viewFromHash() {
  const name = location.hash.replace('#/', '');
  return VIEWS.includes(name) ? name : 'all';
}

function dayKeyOf(ms) {
  return toKey(new Date(ms));
}


/* Отрисовка */

function svgIcon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function visibleGroups(today) {
  if (query) {
    const found = todos.filter((todo) => matchesQuery(todo, query));
    const open = sortTodos(found.filter((todo) => !todo.done), settings.sort);
    return [{ items: [...open, ...sortDone(found.filter((todo) => todo.done))] }];
  }

  const shown = todos.filter((todo) => inView(todo, view, today, dayKeyOf) || lingering.has(todo.id));

  if (view === 'done') return [{ items: sortDone(shown) }];

  if (view === 'upcoming') {
    const groups = [];
    for (const todo of sortTodos(shown, 'due')) {
      const last = groups.at(-1);
      if (last?.due === todo.due) last.items.push(todo);
      else groups.push({ due: todo.due, title: i18n.groupDate(todo.due, today), items: [todo] });
    }
    return groups;
  }

  if (view === 'today') {
    const sorted = sortTodos(shown, settings.sort);
    const overdue = sorted.filter((todo) => !todo.done && todo.due < today);
    const rest = sorted.filter((todo) => !overdue.includes(todo));
    const ordered = [...rest.filter((todo) => !todo.done), ...rest.filter((todo) => todo.done)];
    if (!overdue.length) return [{ items: ordered }];
    return [
      { title: t('group.overdue'), overdue: true, items: overdue },
      { title: i18n.groupDate(today, today), items: ordered },
    ].filter((g) => g.items.length);
  }

  return [{ items: sortTodos(shown, settings.sort) }];
}

function render(focus = currentFocus()) {
  const today = todayKey();
  renderedDay = today;
  const counts = countViews(todos, today);

  for (const link of $$('[data-view]')) {
    const name = link.dataset.view;
    if (name === view && !query) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    const count = $('[data-count]', link);
    count.textContent = counts[name] ? String(counts[name]) : '';
    const overdue = name === 'today' && counts.overdue > 0;
    count.classList.toggle('is-overdue', overdue);
    if (overdue) {
      const note = document.createElement('span');
      note.className = 'visually-hidden';
      note.textContent = `, ${t('count.overdue', { n: counts.overdue })}`;
      count.append(note);
    }
  }

  const progress = todayProgress(todos, today, dayKeyOf);
  $('#progress-block').hidden = progress.total === 0;
  $('#progress-text').textContent = t(progress.done === progress.total ? 'progress.allCount' : 'progress.label', progress);
  $('#progress').max = Math.max(progress.total, 1);
  $('#progress').value = progress.done;

  const groups = visibleGroups(today);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  const title = query ? t('view.search') : t(`view.${view}`);
  $('#view-title').textContent = title;
  document.title = `${title} · ${t('meta.title')}`;
  $('#view-sub').textContent = query ? t('found', { n: total })
    : view === 'today' ? i18n.longDate(new Date())
      : t('tasks', { n: total });

  const defaultHint = view === 'today' ? t('add.hintToday') : view === 'upcoming' ? t('add.hintUpcoming') : '';
  hint.textContent = defaultHint ? `${t('add.hint')}. ${defaultHint}.` : `${t('add.hint')}.`;

  dragEnabled = !query && settings.sort === 'manual' && (view === 'all' || view === 'today');
  listWrap.classList.toggle('no-drag', !dragEnabled);

  const nodes = [];
  groups.forEach((group, i) => {
    const ul = document.createElement('ul');
    ul.className = 'list';
    if (group.title) {
      const h = document.createElement('h2');
      h.className = 'group-title';
      h.id = `group-${i}`;
      h.classList.toggle('is-overdue', Boolean(group.overdue));
      h.textContent = group.title;
      const n = document.createElement('span');
      n.className = 'group-count';
      n.textContent = String(group.items.length);
      const sep = document.createElement('span');
      sep.className = 'visually-hidden';
      sep.textContent = ': ';
      h.append(sep, n);
      ul.setAttribute('aria-labelledby', h.id);
      if (group.overdue) {
        // группа с кнопкой: заголовок отдельно, кнопка рядом, а не внутри h2
        const head = document.createElement('div');
        head.className = 'group-head';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'link-btn group-action';
        btn.id = 'move-today';
        btn.textContent = t('overdue.moveAll');
        head.append(h, btn);
        nodes.push(head);
      } else {
        nodes.push(h);
      }
    }
    ul.append(...group.items.map((todo) => renderItem(todo, today)));
    nodes.push(ul);
  });
  listWrap.replaceChildren(...(total ? nodes : []));

  empty.hidden = total > 0;
  emptyText.textContent = todos.length === 0 ? t('empty.first')
    : query ? t('empty.search', { q: query })
      : view === 'today' ? (progress.done ? t('empty.todayDone', { n: progress.done }) : t('empty.todayNone'))
        : t(`empty.${view}`);

  // строка «Это примеры… Убрать примеры», пока примеры с первого визита на месте
  samplesBar.hidden = query !== '' || !(view === 'all' || view === 'today') || !todos.some((todo) => todo.sample);

  clearDoneBtn.hidden = !(view === 'done' && counts.done > 0 && !query);
  sortSelect.value = settings.sort;
  sortSelect.disabled = !query && (view === 'upcoming' || view === 'done');

  restoreFocus(focus);
}

function highlight(target, text) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w && !w.startsWith('#'));
  if (!words.length) {
    target.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  const marks = [];
  for (const word of words) {
    let from = 0;
    let at;
    while ((at = lower.indexOf(word, from)) !== -1) {
      marks.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const parts = [];
  let pos = 0;
  for (const [start, end] of marks) {
    if (start < pos) continue;
    if (start > pos) parts.push(text.slice(pos, start));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    parts.push(mark);
    pos = end;
  }
  parts.push(text.slice(pos));
  target.replaceChildren(...parts);
}

function renderItem(todo, today) {
  const li = todoTemplate.content.firstElementChild.cloneNode(true);
  li.dataset.id = todo.id;
  li.classList.toggle('is-done', todo.done);
  if (todo.priority) li.classList.add(`p${todo.priority}`);

  const handle = $('.handle', li);
  handle.setAttribute('aria-label', t('task.move', { title: todo.title }));

  const check = $('.todo-check', li);
  check.checked = todo.done;
  check.setAttribute('aria-label', todo.title);

  for (const [sel, key] of [['.todo-edit', 'edit'], ['.todo-more', 'more']]) {
    const btn = $(sel, li);
    btn.setAttribute('aria-label', t(`task.${key}Label`, { title: todo.title }));
    btn.title = t(`task.${key}`);
  }
  if (menu?.id === todo.id) $('.todo-more', li).setAttribute('aria-expanded', 'true');

  const body = $('.todo-body', li);
  if (editingId === todo.id) {
    li.classList.add('is-editing');
    body.replaceChildren(renderEditor(todo));
    return li;
  }

  highlight($('.todo-title', li), todo.title);
  const meta = $('.todo-meta', li);

  // порядок в строке: срок, повтор, шаги, приоритет, метки
  if (todo.due) {
    // у открытой задачи срок кнопкой: нажал и перенёс, без редактора
    const due = document.createElement(todo.done ? 'span' : 'button');
    due.className = 'meta-item meta-due';
    const overdue = !todo.done && todo.due < today;
    due.classList.toggle('is-overdue', overdue);
    due.classList.toggle('is-today', !todo.done && todo.due === today);
    const label = document.createElement('span');
    label.textContent = i18n.relativeDate(todo.due, today);
    due.append(svgIcon('calendar'), label);
    if (todo.done) {
      due.title = i18n.groupDate(todo.due, today);
    } else {
      due.type = 'button';
      due.setAttribute('aria-haspopup', 'menu');
      due.setAttribute('aria-expanded', String(menu?.id === todo.id));
      due.setAttribute('aria-controls', 'row-menu');
      const date = i18n.groupDate(todo.due, today);
      due.setAttribute('aria-label', t('task.dueButton', { date }) + (overdue ? `, ${t('task.overdue')}` : ''));
      due.title = t('task.dueButton', { date });
    }
    meta.append(due);
  }

  if (todo.repeat) {
    const rep = document.createElement('span');
    rep.className = 'meta-item meta-repeat';
    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = `${t('task.repeats')} `;
    const text = document.createElement('span');
    text.textContent = repeatLabel(todo.repeat, todo.due);
    rep.append(svgIcon('repeat'), sr, text);
    meta.append(rep);
  }

  if (todo.steps.length || todo.notes) meta.append(renderDetailsToggle(todo));

  if (todo.priority) {
    const pr = document.createElement('span');
    pr.className = `meta-item meta-priority p${todo.priority}`;
    const text = document.createElement('span');
    text.textContent = `P${todo.priority}`;
    text.setAttribute('aria-hidden', 'true');
    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = t('task.priority', { n: todo.priority });
    pr.append(svgIcon('flag'), text, sr);
    meta.append(pr);
  }

  for (const tag of todo.tags) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'meta-tag';
    btn.dataset.tag = tag;
    btn.textContent = `#${tag}`;
    btn.setAttribute('aria-label', t('task.tagFilter', { tag: `#${tag}` }));
    meta.append(btn);
  }

  if (openDetails.has(todo.id) && (todo.steps.length || todo.notes)) body.append(renderDetails(todo));

  return li;
}

// Кнопка «шаги 1/3» (или значок заметки): раскрывает шаги и заметку под задачей.
function renderDetailsToggle(todo) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'meta-item meta-details';
  btn.setAttribute('aria-expanded', String(openDetails.has(todo.id)));
  btn.setAttribute('aria-controls', `details-${todo.id}`);
  const { done, total } = stepProgress(todo);
  const label = total ? t('steps.toggle', { done, total }) : t('steps.noteToggle');
  btn.setAttribute('aria-label', todo.notes && total ? `${label}, ${t('task.hasNote')}` : label);
  if (total) {
    btn.classList.toggle('is-complete', done === total);
    const text = document.createElement('span');
    text.textContent = `${done}/${total}`;
    btn.append(svgIcon('steps'), text);
  }
  if (todo.notes) btn.append(svgIcon('note'));
  btn.append(svgIcon('chevron', 'icon meta-chevron'));
  return btn;
}

function renderDetails(todo) {
  const box = document.createElement('div');
  box.className = 'todo-details';
  box.id = `details-${todo.id}`;
  if (todo.steps.length) {
    const ul = document.createElement('ul');
    ul.className = 'steps';
    ul.setAttribute('aria-label', t('editor.steps'));
    for (const step of todo.steps) {
      const item = document.createElement('li');
      item.className = 'step';
      item.classList.toggle('is-done', step.done);
      const label = document.createElement('label');
      const box2 = document.createElement('input');
      box2.type = 'checkbox';
      box2.className = 'step-check';
      box2.dataset.step = step.id;
      box2.checked = step.done;
      const mark = document.createElement('span');
      mark.className = 'step-box';
      mark.setAttribute('aria-hidden', 'true');
      mark.append(svgIcon('check', 'icon step-icon'));
      const text = document.createElement('span');
      text.className = 'step-text';
      text.textContent = step.title;
      label.append(box2, mark, text);
      item.append(label);
      ul.append(item);
    }
    box.append(ul);
  }
  // новый шаг прямо в списке: Enter добавляет и оставляет курсор для следующего
  if (!todo.done && todo.steps.length < MAX_STEPS) {
    const add = document.createElement('div');
    add.className = 'step-add step-add-inline';
    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'details-step-new';
    field.maxLength = 200;
    field.enterKeyHint = 'enter';
    field.placeholder = t('steps.add');
    field.setAttribute('aria-label', t('steps.addLabel', { title: todo.title }));
    add.append(svgIcon('plus'), field);
    box.append(add);
  }
  if (todo.notes) {
    const note = document.createElement('p');
    note.className = 'todo-notes';
    note.textContent = todo.notes;
    box.append(note);
  }
  return box;
}

function repeatLabel(repeat, due) {
  return repeat === 'week' && due ? t(`repeat.on${fromKey(due).getDay()}`) : t(`repeat.${repeat}`);
}

function addStepsInline(field, text) {
  const id = field.closest('.todo').dataset.id;
  const next = addSteps(todos, id, text);
  if (next === todos) return;
  commit(next, { focus: { id, selector: '.details-step-new' } });
}

function renderEditor(todo) {
  const editor = editorTemplate.content.firstElementChild.cloneNode(true);
  translate(editor);
  editor.elements.title.value = todo.title;
  editor.elements.due.value = todo.due ?? '';
  editor.elements.priority.value = String(todo.priority);
  editor.elements.tags.value = todo.tags.join(' ');
  editor.elements.repeat.value = todo.repeat ?? '';
  editor.elements.notes.value = todo.notes;
  $('.step-list', editor).append(...todo.steps.map((step) => stepEditRow(step)));
  numberSteps(editor);
  return editor;
}

function stepEditRow(step) {
  const row = stepEditTemplate.content.firstElementChild.cloneNode(true);
  if (step.id) row.dataset.id = step.id;
  $('.step-done', row).checked = step.done;
  $('.step-title', row).value = step.title;
  return row;
}

// Подписи шагов для скринридера: «Шаг 2», «Удалить шаг 2».
function numberSteps(editor) {
  $$('.step-edit', editor).forEach((row, i) => {
    const n = i + 1;
    $('.step-title', row).setAttribute('aria-label', t('editor.stepLabel', { n }));
    $('.step-done', row).setAttribute('aria-label', t('editor.stepDone', { n }));
    const remove = $('.step-remove', row);
    remove.setAttribute('aria-label', t('editor.stepRemove', { n }));
    remove.title = t('editor.stepRemove', { n });
  });
}

function readSteps(editor) {
  const steps = $$('.step-edit', editor).map((row) => ({
    id: row.dataset.id,
    title: $('.step-title', row).value,
    done: $('.step-done', row).checked,
  }));
  // набрали шаг, но не нажали Enter: всё равно сохраняем
  const pending = $('.step-new', editor).value;
  if (pending.trim()) steps.push({ title: pending, done: false });
  return steps;
}

function addStepFromInput(field) {
  const editor = field.closest('.editor');
  if (!field.value.trim()) return;
  const row = stepEditRow({ title: field.value, done: false });
  row.dataset.id = `new-${Date.now().toString(36)}-${$$('.step-edit', editor).length}`;
  $('.step-list', editor).append(row);
  field.value = '';
  numberSteps(editor);
}

// После перерисовки возвращаем фокус туда, где был пользователь,
// иначе при работе с клавиатуры он улетает в начало страницы.
function restoreFocus(focus) {
  if (!focus) return;
  if (focus === 'input') return input.focus();
  if (focus instanceof Element) return focus.focus();
  const item = listWrap.querySelector(`.todo[data-id="${CSS.escape(focus.id)}"]`);
  const target = item && $(focus.selector, item);
  if (target) return target.focus();
  const rows = $$('.todo', listWrap);
  const neighbour = rows[Math.min(focus.index ?? 0, rows.length - 1)];
  ($('.todo-check', neighbour ?? document.body) ?? $('#view-title')).focus();
}

function focusOf(el, selector = '.todo-check') {
  const li = el.closest('.todo');
  return { id: li.dataset.id, selector, index: $$('.todo', listWrap).indexOf(li) };
}

// Перерисовка без явной цели: фокус остаётся на той же кнопке той же задачи.
const ROW_TARGETS = ['.todo-check', '.handle', '.todo-edit', '.todo-more', '.meta-details', '.meta-tag'];

function currentFocus() {
  const el = document.activeElement;
  if (!el || !listWrap.contains(el) || !el.closest('.todo') || el.closest('.editor')) return undefined;
  if (el.matches('.step-check')) return focusOf(el, '.step-check[data-step="' + CSS.escape(el.dataset.step) + '"]');
  const selector = ROW_TARGETS.find((sel) => el.matches(sel)) ?? '.todo-check';
  return focusOf(el, selector);
}

function announce(text) {
  live.textContent = '';
  // пустая строка и пауза нужны, чтобы скринридер прочёл одинаковый текст повторно
  setTimeout(() => { live.textContent = text; }, 50);
}

/* Язык и тема */

function translate(root = document) {
  for (const el of $$('[data-i18n]', root)) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-attr]', root)) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    }
  }
}

function applyLanguage() {
  i18n = createI18n(settings.lang);
  document.documentElement.lang = settings.lang;
  $('meta[name="description"]').content = t('meta.description');
  translate();
  for (const btn of $$('[data-lang]')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === settings.lang));
  for (const [btn, key] of [[themeBtn, 'theme.dark'], [helpBtn, 'menu.shortcuts'], [dataBtn, 'data.label']]) {
    btn.setAttribute('aria-label', t(key));
    btn.title = t(key);
  }
  setBrandDate();
  lastChips = '';
  updateChips();
}

function setBrandDate() {
  $('#today-date').textContent = i18n.longDate(new Date());
  $('#today-date-short').textContent = i18n.shortDate(todayKey());
}

function applyTheme() {
  const dark = settings.theme === 'dark';
  document.documentElement.dataset.theme = settings.theme;
  themeBtn.setAttribute('aria-pressed', String(dark));
  $('meta[name="theme-color"]').content = dark ? '#111416' : '#f3f5f6';
}

/* Быстрое добавление */

function currentParse() {
  return parseQuickAdd(input.value, todayKey(), { ignore: ignoreTokens });
}

function chipText(token, today, due) {
  if (token.type === 'date') return i18n.groupDate(token.value, today);
  if (token.type === 'priority') return `P${token.value}`;
  if (token.type === 'repeat') return repeatLabel(token.value, due);
  return token.value;
}

function updateChips() {
  const today = todayKey();
  const parsed = currentParse();
  const { tokens } = parsed;
  const key = JSON.stringify([settings.lang, tokens, parsed.due]);
  if (key === lastChips) return;
  lastChips = key;
  chips.replaceChildren(...tokens.map((token) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const icon = { date: 'calendar', priority: 'flag', tag: 'hash', repeat: 'repeat' }[token.type];
    if (token.type === 'priority') chip.classList.add(`p${token.value}`);
    const text = document.createElement('span');
    text.textContent = chipText(token, today, parsed.due);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chip-remove';
    remove.dataset.token = token.text;
    remove.setAttribute('aria-label', t('chip.ignore', { text: token.text }));
    remove.title = t('chip.ignore', { text: token.text });
    remove.append(svgIcon('x'));
    chip.append(svgIcon(icon), text, remove);
    return chip;
  }));
}

input.addEventListener('input', () => {
  if (!input.value.trim()) ignoreTokens = [];
  updateChips();
});

chips.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip-remove');
  if (!btn) return;
  ignoreTokens.push(btn.dataset.token);
  updateChips();
  input.focus();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = currentParse();
  if (!parsed.title) {
    input.value = '';
    return;
  }
  const today = todayKey();
  if (!parsed.due && view === 'today') parsed.due = today;
  if (!parsed.due && view === 'upcoming') parsed.due = addDays(today, 1);
  // новая задача не видна в «Готово» и может не попасть в поиск: показываем её
  if (view === 'done') location.hash = '#/all';
  query = '';
  search.value = '';
  searchClear.hidden = true;
  form.reset();
  ignoreTokens = [];
  const next = addTodo(todos, parsed);
  commit(next, { focus: 'input' });
  updateChips();
  const added = next[0];
  const shownIn = inView(added, view === 'done' ? 'all' : view, today, dayKeyOf) ? null
    : added.due && added.due > today ? 'upcoming' : 'all';
  if (shownIn) showToast(t('toast.addedTo', { title: added.title, view: t(`view.${shownIn}`) }));
  else announce(t('toast.added', { title: added.title }));
});

/* Действия со строкой */

function toggle(li) {
  const id = li.dataset.id;
  const before = todos.find((todo) => todo.id === id);
  if (!before) return;
  const snapshot = todos;
  const focus = focusOf(li);
  const hidesDone = !query && (view === 'all' || view === 'upcoming');
  if (before.done) {
    // сняли галочку, пока задача ещё не ушла: она остаётся на месте
    clearTimeout(lingering.get(id));
    lingering.delete(id);
    commit(toggleTodo(todos, id), { focus });
    return;
  }
  if (hidesDone) {
    clearTimeout(lingering.get(id));
    lingering.set(id, setTimeout(() => leave(id), LINGER_MS));
  }
  const today = todayKey();
  const result = completeTodo(todos, id, today);
  commit(result.todos, { focus });
  const message = result.next
    ? t('toast.completedNext', { title: before.title, when: whenText(result.next.due, today) })
    : t('toast.completed', { title: before.title });
  showToast(message, { snapshot, focus: { id, selector: '.todo-check' } });
}

// «завтра», «Пн, 16 нояб.» для сообщений о сроке.
function whenText(due, today) {
  const diff = daysBetween(today, due);
  if (diff === 0) return t('date.today').toLowerCase();
  if (diff === 1) return t('date.tomorrow').toLowerCase();
  return i18n.groupDate(due, today);
}

// Перенести одну задачу (меню строки, клавиши T и M) или все просроченные.
function reschedule(id, due, focus) {
  const todo = todos.find((x) => x.id === id);
  if (!todo || todo.done || todo.due === due) return;
  const snapshot = todos;
  commit(updateTodo(todos, id, { due }), { focus });
  const message = due
    ? t('toast.rescheduled', { when: whenText(due, todayKey()), title: todo.title })
    : t('toast.undated', { title: todo.title });
  showToast(message, { snapshot, focus: { id, selector: '.todo-check' } });
}

function moveOverdueToToday() {
  const today = todayKey();
  const n = todos.filter((x) => !x.done && x.due !== null && x.due < today).length;
  if (!n) return;
  const snapshot = todos;
  commit(rescheduleOverdue(todos, today), { focus: $('#view-title') });
  showToast(t('toast.movedToday', { n }), { snapshot, focus: $('#view-title') });
}

const DUE_ACTIONS = {
  today: (today) => today,
  tomorrow: (today) => addDays(today, 1),
  nextWeek: (today) => nextMonday(today),
  noDate: () => null,
};

/* Меню строки: срок и удаление */

function openMenu(opener) {
  const li = opener.closest('.todo');
  if (menu?.id === li.dataset.id) return closeMenu(true);
  closeMenu(false);
  menu = { id: li.dataset.id, opener };
  opener.setAttribute('aria-expanded', 'true');
  rowMenu.setAttribute('aria-label', opener.getAttribute('aria-label'));
  const todo = todos.find((x) => x.id === menu.id);
  const today = todayKey();
  for (const item of $$('[data-action]', rowMenu)) {
    const { action } = item.dataset;
    const due = DUE_ACTIONS[action]?.(today);
    const hint = $('.menu-hint', item);
    if (hint) hint.textContent = due ? i18n.shortDate(due) : '';
    // для сделанной задачи перенос не нужен; вариант, равный текущему сроку, тоже
    item.hidden = (action !== 'delete' && (todo?.done ?? false)) || (due !== undefined && due === todo?.due);
  }
  $('.menu-sep', rowMenu).hidden = todo?.done ?? false;
  rowMenu.hidden = false;
  placeMenu();
  $$('[data-action]:not([hidden])', rowMenu)[0]?.focus();
}

function placeMenu() {
  if (!menu) return;
  const r = menu.opener.getBoundingClientRect();
  const w = rowMenu.offsetWidth;
  const h = rowMenu.offsetHeight;
  // от срока меню открывается вправо, от кнопки «ещё» влево
  const anchor = menu.opener.matches('.meta-due') ? r.left - 6 : r.right - w;
  const left = Math.max(8, Math.min(anchor, innerWidth - w - 8));
  const below = r.bottom + 4 + h <= innerHeight - 8;
  const top = below ? r.bottom + 4 : Math.max(8, r.top - h - 4);
  rowMenu.style.left = `${left}px`;
  rowMenu.style.top = `${top}px`;
}

function closeMenu(returnFocus) {
  if (!menu) return;
  const { opener, id } = menu;
  menu = null;
  rowMenu.hidden = true;
  const current = opener.isConnected ? opener
    : listWrap.querySelector(`.todo[data-id="${CSS.escape(id)}"] .todo-more`);
  current?.setAttribute('aria-expanded', 'false');
  if (returnFocus) current?.focus();
}

rowMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-action]');
  if (!item || !menu) return;
  const { id } = menu;
  const li = listWrap.querySelector(`.todo[data-id="${CSS.escape(id)}"]`);
  closeMenu(false);
  if (!li) return;
  if (item.dataset.action === 'delete') {
    remove(li);
    return;
  }
  if (item.dataset.action === 'pick') {
    startEditing(li, 'input[name="due"]');
    return;
  }
  const index = $$('.todo', listWrap).indexOf(li);
  reschedule(id, DUE_ACTIONS[item.dataset.action](todayKey()), { id, selector: '.todo-more', index });
});

rowMenu.addEventListener('keydown', (e) => {
  const items = $$('[data-action]:not([hidden])', rowMenu);
  const at = items.indexOf(document.activeElement);
  let next = null;
  if (e.key === 'ArrowDown') next = items[(at + 1) % items.length];
  else if (e.key === 'ArrowUp') next = items[(at - 1 + items.length) % items.length];
  else if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items.at(-1);
  else if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    closeMenu(true);
    return;
  }
  if (next) {
    e.preventDefault();
    next.focus();
  }
});

document.addEventListener('pointerdown', (e) => {
  if (menu && !rowMenu.contains(e.target) && !menu.opener.contains(e.target)) closeMenu(false);
});
window.addEventListener('resize', () => closeMenu(false));
document.addEventListener('scroll', () => closeMenu(false), { passive: true });

// Отмеченная задача немного стоит на месте с галочкой и только потом уходит.
function leave(id) {
  const row = listWrap.querySelector(`.todo[data-id="${CSS.escape(id)}"]`);
  const hadFocus = row?.contains(document.activeElement);
  const index = row ? $$('.todo', listWrap).indexOf(row) : 0;
  const finish = () => {
    lingering.delete(id);
    if (editingId) return;
    render(hadFocus ? { id: '', index } : undefined);
  };
  if (!row || editingId || matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
  row.classList.add('is-leaving');
  setTimeout(finish, LEAVE_MS);
}

function remove(li) {
  const id = li.dataset.id;
  const todo = todos.find((x) => x.id === id);
  const snapshot = todos;
  const index = $$('.todo', listWrap).indexOf(li);
  commit(removeTodo(todos, id), { focus: { id: '', index } });
  showToast(t('toast.deleted', { title: todo.title }), { snapshot, focus: { id, selector: '.todo-check', index } });
}

function startEditing(li, selector = 'input[name="title"]') {
  if (editingId === li.dataset.id) return;
  editingId = li.dataset.id;
  render({ id: editingId, selector });
  const field = $('.is-editing input[name="title"]', listWrap);
  if (document.activeElement === field) field.setSelectionRange(field.value.length, field.value.length);
}

// Список с правкой из открытого редактора; тот же массив, если ничего не поменяли.
function editedTodos() {
  const editor = $('.editor', listWrap);
  if (!editingId || !editor) return todos;
  const f = editor.elements;
  const next = updateTodo(todos, editingId, {
    title: f.title.value,
    due: f.due.value || null,
    priority: Number(f.priority.value),
    tags: splitTags(f.tags.value),
    repeat: f.repeat.value || null,
    notes: f.notes.value,
    steps: readSteps(editor),
    today: todayKey(),
  });
  const before = JSON.stringify(todos.find((x) => x.id === editingId));
  const after = JSON.stringify(next.find((x) => x.id === editingId));
  return before === after ? todos : next;
}

function finishEditing(save, focus = { id: editingId, selector: '.todo-edit', index: 0 }) {
  if (!editingId) return;
  const next = save ? editedTodos() : todos;
  editingId = null;
  if (next !== todos) commit(next, { focus });
  else render(focus);
}

// Человек ушёл из редактора к другому действию (клик по чужой галочке, метке,
// разделу): сначала молча сохраняем правку, потом выполняется само действие.
// Вызывается в начале клика (фаза захвата), до обработчика самой кнопки,
// поэтому кнопка ещё на месте и клик срабатывает. Прокрутка пальцем клика
// не даёт, и редактор остаётся открытым.
function flushEditor() {
  if (!editingId) return;
  const next = editedTodos();
  editingId = null;
  if (next !== todos) {
    dropUndo(); // снимок для «Вернуть» сделан до правки и откатил бы её
    todos = next;
    storageWarning.hidden = saveTodos(todos);
  }
  setTimeout(() => {
    if (!editingId && $('.editor', listWrap)) render();
  }, 0);
}

listWrap.addEventListener('change', (e) => {
  if (e.target.matches('.todo-check')) toggle(e.target.closest('.todo'));
  else if (e.target.matches('.step-check')) {
    const { id } = e.target.closest('.todo').dataset;
    const step = e.target.dataset.step;
    const focus = { id, selector: `.step-check[data-step="${CSS.escape(step)}"]` };
    commit(toggleStep(todos, id, step), { focus });
    // все шаги готовы: предлагаем отметить задачу, но не отмечаем сами
    const todo = todos.find((x) => x.id === id);
    const { done, total } = stepProgress(todo);
    if (e.target.checked && !todo.done && done === total) {
      showToast(t('toast.allSteps'), {
        focus,
        action: {
          label: t('toast.markDone'),
          run: () => {
            const row = listWrap.querySelector(`.todo[data-id="${CSS.escape(id)}"]`);
            if (row) toggle(row);
          },
        },
      });
    }
  }
});

listWrap.addEventListener('click', (e) => {
  if (e.target.closest('#move-today')) {
    moveOverdueToToday();
    return;
  }
  const li = e.target.closest('.todo');
  if (!li) return;
  if (e.target.closest('.todo-more, button.meta-due')) openMenu(e.target.closest('.todo-more, button.meta-due'));
  else if (e.target.closest('.meta-details')) {
    const id = li.dataset.id;
    if (openDetails.has(id)) openDetails.delete(id);
    else openDetails.add(id);
    render({ id, selector: '.meta-details' });
  } else if (e.target.closest('.step-remove')) {
    const row = e.target.closest('.step-edit');
    const editor = row.closest('.editor');
    const list = row.parentElement;
    const index = [...list.children].indexOf(row);
    row.remove();
    numberSteps(editor);
    const rest = $$('.step-edit', editor);
    ($('.step-remove', rest[Math.min(index, rest.length - 1)] ?? editor) ?? $('.step-new', editor)).focus();
  } else if (e.target.closest('.todo-edit')) startEditing(li);
  else if (e.target.closest('.editor-cancel')) finishEditing(false);
  else if (e.target.closest('.meta-tag')) setQuery(`#${e.target.closest('.meta-tag').dataset.tag}`, true);
});

// Вставили несколько строк: каждая становится шагом (как в Things).
listWrap.addEventListener('paste', (e) => {
  const field = e.target;
  if (!field.matches?.('.step-new, .details-step-new')) return;
  const text = e.clipboardData?.getData('text') ?? '';
  if (!/[\r\n]/.test(text.trim())) return;
  e.preventDefault();
  if (field.matches('.details-step-new')) {
    addStepsInline(field, text);
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    field.value = line;
    addStepFromInput(field);
  }
  field.value = '';
});

listWrap.addEventListener('dblclick', (e) => {
  const li = e.target.closest('.todo');
  if (li && e.target.closest('.todo-title')) startEditing(li);
});

listWrap.addEventListener('submit', (e) => {
  e.preventDefault();
  finishEditing(true);
});

listWrap.addEventListener('keydown', (e) => {
  if (e.target.matches('.details-step-new') && e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    addStepsInline(e.target, e.target.value);
    return;
  }
  if (!e.target.closest('.editor')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    finishEditing(false);
    return;
  }
  if (e.key !== 'Enter' || e.isComposing) return;
  // Enter в поле нового шага добавляет шаг, а не сохраняет задачу
  if (e.target.matches('.step-new') && e.target.value.trim()) {
    e.preventDefault();
    addStepFromInput(e.target);
  } else if (e.target.matches('.step-title')) {
    e.preventDefault();
    $('.step-new', e.target.closest('.editor')).focus();
  } else if (e.target.matches('textarea') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    finishEditing(true);
  }
});

// Клик или Tab мимо редактора сохраняет правку, как в v1 при потере фокуса.
// Клик по «Вернуть» в сообщении сам закрывает редактор (см. applyUndo).
document.addEventListener('click', (e) => {
  if (editingId && !e.target.closest?.('.editor, .toast')) flushEditor();
}, true);

listWrap.addEventListener('focusout', (e) => {
  const editor = e.target.closest('.editor');
  // relatedTarget пуст, когда переключились в другое окно: правку не трогаем
  if (!editor || !e.relatedTarget || editor.contains(e.relatedTarget)) return;
  flushEditor();
});

/* Перетаскивание мышью и пальцем за ручку */

listWrap.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle || !dragEnabled || e.button !== 0) return;
  flushEditor();
  const li = handle.closest('.todo');
  const ul = li.parentElement;
  const startIndex = [...ul.children].indexOf(li);
  const grab = e.clientY - li.getBoundingClientRect().top;
  let moved = false;
  let startY = e.clientY;
  handle.setPointerCapture(e.pointerId);
  e.preventDefault();

  const onMove = (ev) => {
    if (!moved && Math.abs(ev.clientY - startY) < 4) return;
    if (!moved) {
      moved = true;
      li.classList.add('is-dragging');
      listWrap.classList.add('dragging-list');
    }
    const top = ev.clientY - grab;
    li.style.transform = '';
    const prev = li.previousElementSibling;
    const next = li.nextElementSibling;
    if (prev) {
      const r = prev.getBoundingClientRect();
      if (top < r.top + r.height / 2) ul.insertBefore(li, prev);
    }
    if (next) {
      const r = next.getBoundingClientRect();
      if (top + li.offsetHeight > r.top + r.height / 2) ul.insertBefore(next, li);
    }
    li.style.transform = `translateY(${top - li.getBoundingClientRect().top}px)`;
    if (ev.clientY < 56) window.scrollBy(0, -12);
    else if (ev.clientY > window.innerHeight - 56) window.scrollBy(0, 12);
  };

  const onEnd = (ev) => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onEnd);
    handle.removeEventListener('pointercancel', onEnd);
    li.classList.remove('is-dragging');
    listWrap.classList.remove('dragging-list');
    li.style.transform = '';
    const endIndex = [...ul.children].indexOf(li);
    if (!moved || ev.type === 'pointercancel' || endIndex === startIndex) {
      render();
      return;
    }
    const id = li.dataset.id;
    const next = li.nextElementSibling;
    const prev = li.previousElementSibling;
    const reordered = next ? moveTodo(todos, id, next.dataset.id) : moveTodoAfter(todos, id, prev.dataset.id);
    commit(reordered, { focus: { id, selector: '.handle' } });
    announce(t('task.moved', { pos: endIndex + 1, total: ul.children.length }));
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onEnd);
  handle.addEventListener('pointercancel', onEnd);
});

function moveByKeyboard(li, step) {
  if (!dragEnabled) return;
  const ul = li.parentElement;
  const ids = [...ul.children].map((row) => row.dataset.id);
  const id = li.dataset.id;
  const next = moveWithin(todos, ids, id, step);
  if (next === todos) return;
  const selector = document.activeElement?.classList.contains('handle') ? '.handle' : '.todo-check';
  commit(next, { focus: { id, selector } });
  announce(t('task.moved', { pos: ids.indexOf(id) + 1 + step, total: ids.length }));
}

/* Отмена и сообщения */

// snapshot: список до действия (для «Вернуть»); focus: куда вернуть фокус после отмены.
// Текст дублируем в постоянную live-область: скринридеры не всегда читают
// только что показанный элемент.
// action: другая кнопка вместо «Вернуть» ({ label, run }), например «Отметить».
function showToast(message, { snapshot = null, focus = null, action = null } = {}) {
  dropUndo();
  toastText.textContent = message;
  toastUndo.textContent = action?.label ?? t('toast.undo');
  toastUndo.hidden = !snapshot && !action;
  toast.hidden = false;
  announce(message);
  undo = { snapshot, focus, action, timer: setTimeout(dropUndo, TOAST_MS) };
}

function dropUndo() {
  if (!undo) return;
  clearTimeout(undo.timer);
  const { focus } = undo;
  undo = null;
  if (toast.contains(document.activeElement)) restoreFocus(focus ?? 'input');
  toast.hidden = true;
}

function applyUndo() {
  if (!undo?.snapshot) return;
  const { snapshot, focus } = undo;
  editingId = null;
  for (const timer of lingering.values()) clearTimeout(timer);
  lingering.clear();
  commit(snapshot, { focus: focus ?? undefined });
}

toastUndo.addEventListener('click', () => {
  if (!undo?.action) return applyUndo();
  const { run } = undo.action;
  dropUndo();
  return run();
});
$('#toast-close').addEventListener('click', dropUndo);

// Пока человек тянется к «Вернуть», сообщение не исчезает.
toast.addEventListener('pointerenter', () => undo && clearTimeout(undo.timer));
toast.addEventListener('focusin', () => undo && clearTimeout(undo.timer));
toast.addEventListener('pointerleave', () => {
  if (undo && !toast.contains(document.activeElement)) undo.timer = setTimeout(dropUndo, TOAST_MS / 2);
});

$('#samples-remove').addEventListener('click', () => {
  const snapshot = todos;
  commit(removeSamples(todos), { focus: $('#view-title') });
  showToast(t('toast.samplesRemoved'), { snapshot, focus: $('#samples-remove') });
});

clearDoneBtn.addEventListener('click', () => {
  const snapshot = todos;
  const removed = todos.filter((todo) => todo.done).length;
  commit(clearCompleted(todos), { focus: $(`[data-view="${view}"]`) });
  showToast(t('toast.cleared', { n: removed }), { snapshot, focus: clearDoneBtn });
});

/* Поиск, сортировка, разделы */

function setQuery(value, focusSearch = false) {
  query = value.trim().slice(0, 100);
  search.value = value;
  searchClear.hidden = !value;
  render();
  if (focusSearch) search.focus();
}

let searchTimer = 0;
search.addEventListener('input', () => {
  searchClear.hidden = !search.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setQuery(search.value), 120);
});

search.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  if (search.value) setQuery('');
  else search.blur();
});

searchClear.addEventListener('click', () => setQuery('', true));

sortSelect.addEventListener('change', () => {
  settings.sort = sortSelect.value;
  saveSettings(settings);
  render();
});

window.addEventListener('hashchange', () => {
  view = viewFromHash();
  editingId = null;
  closeMenu(false);
  if (query) {
    query = '';
    search.value = '';
    searchClear.hidden = true;
  }
  render();
});

// Клик по уже открытому разделу во время поиска возвращает к разделу.
$('#views').addEventListener('click', (e) => {
  const link = e.target.closest('[data-view]');
  if (link && link.dataset.view === view && query) {
    e.preventDefault();
    setQuery('');
  }
});

/* Язык, тема, данные, справка */

for (const btn of $$('[data-lang]')) {
  btn.addEventListener('click', () => {
    if (settings.lang === btn.dataset.lang) return;
    settings.lang = btn.dataset.lang;
    saveSettings(settings);
    applyLanguage();
    render();
  });
}

themeBtn.addEventListener('click', () => {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  saveSettings(settings);
  applyTheme();
});

function setDataPanel(open) {
  dataPanel.hidden = !open;
  dataBtn.setAttribute('aria-expanded', String(open));
}

dataBtn.addEventListener('click', () => setDataPanel(dataPanel.hidden));

document.addEventListener('click', (e) => {
  if (!dataPanel.hidden && !e.target.closest('.data')) setDataPanel(false);
});

// Ушли Tab-ом из меню: закрываем его
$('.data').addEventListener('focusout', (e) => {
  if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setDataPanel(false);
});

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([exportJSON(todos)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tasks-${todayKey()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setDataPanel(false);
  dataBtn.focus();
});

$('#import-btn').addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  setDataPanel(false);
  if (!file) return;
  const result = file.size <= MAX_IMPORT_BYTES ? importJSON(await file.text(), todos) : null;
  if (!result) {
    showToast(t('toast.importFailed'), { focus: dataBtn });
    dataBtn.focus();
    return;
  }
  const snapshot = todos;
  commit(result.todos, { focus: dataBtn });
  showToast(t('toast.imported', { n: result.count }), { snapshot, focus: dataBtn });
});

let helpOpener = null;

function openHelp() {
  helpOpener = document.activeElement;
  helpDialog.showModal();
}

helpBtn.addEventListener('click', openHelp);
$('#help-close').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('close', () => helpOpener?.focus?.());
helpDialog.addEventListener('click', (e) => {
  // клик по затемнению вокруг окна
  if (e.target !== helpDialog) return;
  const r = helpDialog.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) helpDialog.close();
});

/* Горячие клавиши */

const TEXT_INPUT = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"]';

function rowFocus(dir) {
  const rows = $$('.todo', listWrap);
  if (!rows.length) return;
  const current = document.activeElement?.closest?.('.todo');
  let index = current ? rows.indexOf(current) + dir : 0;
  index = Math.max(0, Math.min(rows.length - 1, index));
  $('.todo-check', rows[index]).focus();
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing || helpDialog.open) return;
  const target = e.target;
  const row = target.closest?.('.todo');

  if (e.key === 'Escape') {
    if (!dataPanel.hidden) {
      setDataPanel(false);
      dataBtn.focus();
    } else if (target === input) {
      input.blur();
    }
    return;
  }

  if (target.matches?.(TEXT_INPUT)) return;

  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyZ' && undo?.snapshot) {
    e.preventDefault();
    applyUndo();
    return;
  }
  if (e.ctrlKey || e.metaKey) return;

  if (e.altKey) {
    if (row && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveByKeyboard(row, e.key === 'ArrowUp' ? -1 : 1);
    }
    return;
  }

  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
    e.preventDefault();
    openHelp();
    return;
  }

  if (e.key === '/' || e.code === 'Slash') {
    e.preventDefault();
    search.focus();
    search.select();
    return;
  }

  const digit = /^Digit([1-4])$/.exec(e.code);
  if (digit && !e.shiftKey) {
    location.hash = `#/${VIEWS[Number(digit[1]) - 1]}`;
    return;
  }

  if (e.shiftKey) return;

  switch (e.code) {
    case 'KeyN':
      e.preventDefault();
      input.focus();
      return;
    case 'KeyJ':
      e.preventDefault();
      rowFocus(1);
      return;
    case 'KeyK':
      e.preventDefault();
      rowFocus(-1);
      return;
    default:
  }

  if (!row || row.classList.contains('is-editing')) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    rowFocus(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.code === 'KeyX') {
    e.preventDefault();
    toggle(row);
  } else if (e.code === 'KeyE') {
    e.preventDefault();
    startEditing(row);
  } else if (e.key === 'Delete') {
    e.preventDefault();
    remove(row);
  } else if (e.code === 'KeyT' || e.code === 'KeyM') {
    e.preventDefault();
    const today = todayKey();
    const index = $$('.todo', listWrap).indexOf(row);
    reschedule(row.dataset.id, e.code === 'KeyT' ? today : addDays(today, 1), { id: row.dataset.id, selector: '.todo-check', index });
  }
});

/* Другие вкладки и смена дня */

// Список открыт в двух вкладках: изменения в одной сразу видны в другой.
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    todos = loadTodos();
    if (editingId && !todos.some((todo) => todo.id === editingId)) editingId = null;
    if (editingId) return;
    dropUndo();
    render();
  } else if (e.key === SETTINGS_KEY) {
    const next = loadSettings();
    Object.assign(settings, next, { lang: next.lang ?? settings.lang });
    applyTheme();
    applyLanguage();
    render();
  }
});

// Вкладку оставили открытой на ночь: «Сегодня» должно стать завтрашним днём.
setInterval(() => {
  if (todayKey() !== renderedDay && !editingId) {
    setBrandDate();
    render();
  }
}, 60_000);

storageWarning.hidden = storageAvailable();
applyTheme();
applyLanguage();
render();

// Работа без интернета: страница и скрипты сохраняются после первого визита.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
