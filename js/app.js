import {
  addTodo, toggleTodo, updateTodo, removeTodo, clearCompleted, moveTodo, moveTodoAfter, moveWithin,
  inView, countViews, todayProgress, matchesQuery, sortTodos, sortDone, VIEWS,
} from './todos.js';
import {
  loadTodos, saveTodos, loadSettings, saveSettings, exportJSON, importJSON, storageAvailable, STORAGE_KEY, SETTINGS_KEY,
} from './storage.js';
import { parseQuickAdd, splitTags } from './parse.js';
import { todayKey, toKey, addDays } from './dates.js';
import { createI18n, detectLang } from './i18n.js';

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

const LINGER_MS = 700; // столько отмеченная задача остаётся на месте, прежде чем уйти в «Готово»
const LEAVE_MS = 240;
const TOAST_MS = 6000;
const MAX_IMPORT_BYTES = 2_000_000;

let todos = loadTodos();
const settings = loadSettings();
settings.lang ??= detectLang();
let i18n = createI18n(settings.lang);
const t = (...args) => i18n.t(...args);

let view = viewFromHash();
let query = '';
let editingId = null;
let ignoreTokens = [];
let lastChips = '';
let undo = null; // { snapshot, timer }
let dragEnabled = false;
let renderedDay = todayKey();
const lingering = new Map(); // id → таймер

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
  $('#progress-text').textContent = progress.done === progress.total
    ? `${t('progress.all')}: ${progress.done} / ${progress.total}`
    : t('progress.label', progress);
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
      nodes.push(h);
    }
    ul.append(...group.items.map((todo) => renderItem(todo, today)));
    nodes.push(ul);
  });
  listWrap.replaceChildren(...(total ? nodes : []));

  empty.hidden = total > 0;
  emptyText.textContent = todos.length === 0 ? t('empty.first')
    : query ? t('empty.search', { q: query })
      : t(`empty.${view}`);

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

  for (const [sel, key] of [['.todo-edit', 'edit'], ['.todo-delete', 'delete']]) {
    const btn = $(sel, li);
    btn.setAttribute('aria-label', t(`task.${key}Label`, { title: todo.title }));
    btn.title = t(`task.${key}`);
  }

  const body = $('.todo-body', li);
  if (editingId === todo.id) {
    li.classList.add('is-editing');
    body.replaceChildren(renderEditor(todo));
    return li;
  }

  highlight($('.todo-title', li), todo.title);
  const meta = $('.todo-meta', li);

  if (todo.due) {
    const due = document.createElement('span');
    due.className = 'meta-item meta-due';
    const overdue = !todo.done && todo.due < today;
    due.classList.toggle('is-overdue', overdue);
    due.classList.toggle('is-today', !todo.done && todo.due === today);
    const label = document.createElement('span');
    label.textContent = i18n.relativeDate(todo.due, today);
    due.append(svgIcon('calendar'), label);
    if (overdue) {
      const note = document.createElement('span');
      note.className = 'visually-hidden';
      note.textContent = `, ${t('task.overdue')}`;
      due.append(note);
    }
    due.title = i18n.groupDate(todo.due, today);
    meta.append(due);
  }

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

  return li;
}

function renderEditor(todo) {
  const editor = editorTemplate.content.firstElementChild.cloneNode(true);
  translate(editor);
  editor.elements.title.value = todo.title;
  editor.elements.due.value = todo.due ?? '';
  editor.elements.priority.value = String(todo.priority);
  editor.elements.tags.value = todo.tags.join(' ');
  return editor;
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
const ROW_TARGETS = ['.todo-check', '.handle', '.todo-edit', '.todo-delete', '.meta-tag'];

function currentFocus() {
  const el = document.activeElement;
  if (!el || !listWrap.contains(el) || !el.closest('.todo') || el.closest('.editor')) return undefined;
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
  $('#today-date').textContent = i18n.longDate(new Date());
  lastChips = '';
  updateChips();
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

function chipText(token, today) {
  if (token.type === 'date') return i18n.groupDate(token.value, today);
  if (token.type === 'priority') return `P${token.value}`;
  return token.value;
}

function updateChips() {
  const today = todayKey();
  const { tokens } = currentParse();
  const key = JSON.stringify([settings.lang, tokens]);
  if (key === lastChips) return;
  lastChips = key;
  chips.replaceChildren(...tokens.map((token) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const icon = { date: 'calendar', priority: 'flag', tag: 'hash' }[token.type];
    if (token.type === 'priority') chip.classList.add(`p${token.value}`);
    const text = document.createElement('span');
    text.textContent = chipText(token, today);
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
  } else if (hidesDone) {
    clearTimeout(lingering.get(id));
    lingering.set(id, setTimeout(() => leave(id), LINGER_MS));
  }
  commit(toggleTodo(todos, id), { focus });
  if (!before.done) showToast(t('toast.completed', { title: before.title }), { snapshot, focus: { id, selector: '.todo-check' } });
}

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

function startEditing(li) {
  if (editingId === li.dataset.id) return;
  editingId = li.dataset.id;
  render({ id: editingId, selector: 'input[name="title"]' });
  const field = $('.is-editing input[name="title"]', listWrap);
  field?.setSelectionRange(field.value.length, field.value.length);
}

function editedTodos() {
  const editor = $('.editor', listWrap);
  if (!editingId || !editor) return todos;
  const f = editor.elements;
  return updateTodo(todos, editingId, {
    title: f.title.value,
    due: f.due.value || null,
    priority: Number(f.priority.value),
    tags: splitTags(f.tags.value),
  });
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
// Перерисовываем не сразу, а после клика: иначе кнопка под курсором
// исчезнет между нажатием и отпусканием и клик потеряется.
function flushEditor(afterPointer = false) {
  if (!editingId) return;
  const next = editedTodos();
  editingId = null;
  if (next !== todos) {
    dropUndo(); // снимок для «Вернуть» сделан до правки и откатил бы её
    todos = next;
    storageWarning.hidden = saveTodos(todos);
  }
  const refresh = () => setTimeout(() => {
    if (!editingId && $('.editor', listWrap)) render();
  }, 0);
  if (afterPointer) document.addEventListener('pointerup', refresh, { once: true, capture: true });
  else refresh();
}

listWrap.addEventListener('change', (e) => {
  if (e.target.matches('.todo-check')) toggle(e.target.closest('.todo'));
});

listWrap.addEventListener('click', (e) => {
  const li = e.target.closest('.todo');
  if (!li) return;
  if (e.target.closest('.todo-delete')) remove(li);
  else if (e.target.closest('.todo-edit')) startEditing(li);
  else if (e.target.closest('.editor-cancel')) finishEditing(false);
  else if (e.target.closest('.meta-tag')) setQuery(`#${e.target.closest('.meta-tag').dataset.tag}`, true);
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
  if (!e.target.closest('.editor')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    finishEditing(false);
  }
});

// Клик или Tab мимо редактора сохраняет правку, как в v1 при потере фокуса.
document.addEventListener('pointerdown', (e) => {
  if (editingId && !e.target.closest?.('.editor')) flushEditor(true);
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
function showToast(message, { snapshot = null, focus = null } = {}) {
  dropUndo();
  toastText.textContent = message;
  toastUndo.hidden = !snapshot;
  toast.hidden = false;
  announce(message);
  undo = { snapshot, focus, timer: setTimeout(dropUndo, TOAST_MS) };
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
  for (const timer of lingering.values()) clearTimeout(timer);
  lingering.clear();
  commit(snapshot, { focus: focus ?? undefined });
}

toastUndo.addEventListener('click', applyUndo);
$('#toast-close').addEventListener('click', dropUndo);

// Пока человек тянется к «Вернуть», сообщение не исчезает.
toast.addEventListener('pointerenter', () => undo && clearTimeout(undo.timer));
toast.addEventListener('focusin', () => undo && clearTimeout(undo.timer));
toast.addEventListener('pointerleave', () => {
  if (undo && !toast.contains(document.activeElement)) undo.timer = setTimeout(dropUndo, TOAST_MS / 2);
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
    $('#today-date').textContent = i18n.longDate(new Date());
    render();
  }
}, 60_000);

storageWarning.hidden = storageAvailable();
applyTheme();
applyLanguage();
render();
