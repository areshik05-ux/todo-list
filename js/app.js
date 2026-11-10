import {
  addTodo, toggleTodo, completeTodo, updateTodo, removeTodo, clearCompleted, moveTodo, moveTodoAfter, moveWithin,
  toggleStep, stepProgress, rescheduleOverdue, addSteps, removeSamples, MAX_STEPS,
  inView, countViews, todayProgress, matchesQuery, sortTodos, sortDone, VIEWS,
  suggestForToday, moveOpenTo, doneThisWeek, weekLoad, greetingKey, groupDoneByDay, dayStatus, planMode,
} from './todos.js';
import {
  loadTodos, loadTodosReport, saveTodos, loadSettings, saveSettings, exportJSON, importJSON, storageAvailable, isFirstVisit,
  STORAGE_KEY, SETTINGS_KEY,
} from './storage.js';
import { parseQuickAdd, splitTags } from './parse.js';
import { todayKey, toKey, fromKey, addDays, nextMonday, daysBetween } from './dates.js';
import { createI18n, detectLang } from './i18n.js';
import { sampleTodos, translateSamples } from './samples.js';
import { toICS, icsFileName, ICS_TYPE } from './calendar.js';
import { backupNudge, markBackup, readLastBackup, daysSince, requestPersist } from './backup.js';
import { createInstall, launchAction } from './install.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const form = $('#add-form');
const input = $('#new-todo');
const chips = $('#chips');
const hint = $('#add-hint');
const listWrap = $('#list');
const empty = $('#empty');
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
const main = $('#main');
const viewTitle = $('#view-title');
const dayStatusEl = $('#day-status');
const dayActions = $('#day-actions');
const leaf = $('#leaf');
const ringBox = $('#ring-box');
const weekList = $('#week-list');
const planZone = $('#plan-zone');
const planSection = $('#plan');
const planToggle = $('#plan-toggle');
const planBody = $('#plan-body');
const planList = $('#plan-list');
const planFoot = $('#plan-foot');
const planAgain = $('#plan-again');
const content = $('#content');
const searchToggle = $('#search-toggle');

const LINGER_MS = 700; // столько отмеченная задача остаётся на месте, прежде чем уйти в «Готово»
const LEAVE_MS = 240;
const TOAST_MS = 6000;
const MAX_IMPORT_BYTES = 2_000_000;
const NAV = ['today', 'upcoming', 'all', 'done']; // порядок в боковой панели, клавиши 1–4
const FULL_DAY = 6; // с шести задач на сегодня мягко говорим, что их много
const EVENING_HOUR = 18; // с 18:00 можно перенести оставшееся на завтра
const PLAN_SHORT = 3; // столько предложений видно сразу
const PLAN_MAX = 10; // больше не показываем, дальше ссылка на «Все»
const CHECK_MS = 700; // столько живёт анимация отметки у строки

const firstVisit = isFirstVisit();
const loaded = loadTodosReport();
let todos = loaded.todos;
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
const justChecked = new Set(); // только что отмеченные: у них играет анимация галочки
let menu = null; // { id, opener } открытого меню строки
let planExpanded = false; // «Показать ещё»: все предложения, а не три
let planAgainOpen = false; // день закрыт, но человек сам попросил ещё задач
let pendingJump = null; // клик по дню недели: куда прокрутить после смены раздела
let weekFocus = null; // день недели, который получает Tab (переходящий tabindex)
// день, время суток и вечер, для которых нарисована шапка
let renderedSlot = '';
let persistAsked = false; // просьба хранить данные постоянно: один раз, после своей задачи
let restMovedDay = null; // вечером «перенести оставшиеся»: в этот день предложения свёрнуты
let lastDay = null; // итог дня с последней отрисовки: не считать его заново при отметке

/* Состояние */

// Испорченные данные не удалось скопировать: пока человек их не скачал, список не сохраняем.
let heldRaw = loaded.corrupt && !loaded.backedUp;

function persist() {
  if (heldRaw) return;
  storageWarning.hidden = saveTodos(todos);
}

// Все изменения списка проходят здесь: сохранить, перерисовать.
function commit(next, { focus } = {}) {
  dropUndo();
  todos = next;
  persist();
  render(focus);
}

function viewFromHash() {
  const name = location.hash.replace('#/', '');
  // без адреса открывается «Сегодня»: это главный экран
  return VIEWS.includes(name) ? name : 'today';
}

// Сейчас: день, время суток для приветствия и наступил ли вечер.
function daySlot(now = new Date()) {
  return `${todayKey(now)}|${greetingKey(now.getHours())}|${now.getHours() >= EVENING_HOUR}`;
}

// Анимации кольца и листка не играют: первая отрисовка, «Вернуть», смена дня.
function quietly(fn) {
  const root = document.documentElement;
  root.classList.add('is-quiet');
  fn();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('is-quiet')));
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

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
    const found = todos.filter((todo) => matchesQuery(todo, query) || todo.id === editingId);
    const open = sortTodos(found.filter((todo) => !todo.done), settings.sort);
    return [{ items: [...open, ...sortDone(found.filter((todo) => todo.done))] }];
  }

  // открытый редактор не исчезает, даже если «Вернуть» или другая вкладка увели задачу из раздела
  const shown = todos.filter((todo) => inView(todo, view, today, dayKeyOf) || lingering.has(todo.id) || todo.id === editingId);

  if (view === 'done') {
    // по дням закрытия: «Сегодня · 3», «Вчера · 5», «Пн, 9 нояб. · 2»
    const groups = groupDoneByDay(shown, dayKeyOf).map((g) => ({ title: doneDayTitle(g.day, today), items: g.items }));
    // открытый редактор у задачи, которую «Вернуть» сделало снова открытой, остаётся сверху
    const open = shown.filter((todo) => !todo.done);
    return open.length ? [{ items: open }, ...groups] : groups;
  }

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
      { title: t('group.today'), items: ordered },
    ].filter((g) => g.items.length);
  }

  return [{ items: sortTodos(shown, settings.sort) }];
}

function doneDayTitle(day, today) {
  if (day === null) return t('done.earlier');
  if (day === today) return t('done.today');
  if (day === addDays(today, -1)) return t('done.yesterday');
  return i18n.groupDate(day, today);
}

/* День: шапка «Сегодня», листок, кольцо, неделя, «Можно взять на сегодня» */

// Всё, что нужно шапке дня. open = открытые со сроком по сегодня (и просроченные),
// done и total = прогресс дня, suggestions = что можно взять на сегодня.
function dayInfo(today) {
  const counts = countViews(todos, today);
  const progress = todayProgress(todos, today, dayKeyOf);
  return {
    counts,
    open: counts.today,
    done: progress.done,
    total: progress.total,
    closed: progress.total > 0 && progress.done === progress.total,
    suggestions: suggestForToday(todos, today),
    week: doneThisWeek(todos, today, dayKeyOf),
    all: todos.length,
    restMoved: restMovedDay === today && progress.total === 0,
  };
}

function statusText(d) {
  const parts = dayStatus({ ...d, suggestions: d.suggestions.length, restMoved: d.restMoved }, FULL_DAY);
  return parts.map(([key, params]) => t(key, { ...params, tasks: t('tasks', { n: params.total ?? 0 }) })).join(' ');
}

function renderHeader(d, total) {
  const today = view === 'today' && !query;
  main.classList.toggle('is-today', view === 'today');
  main.classList.toggle('is-search', Boolean(query));
  // раздел нарисован: дальше раскладкой управляют классы, а не data-boot из boot.js
  main.classList.add('is-ready');
  main.classList.toggle('has-tasks', todos.length > 0);
  searchToggle.setAttribute('aria-expanded', String(main.classList.contains('tools-open') || Boolean(query)));
  const title = query ? t('view.search') : t(`view.${view}`);
  if (today) {
    // на экране приветствие, скринридер слышит и название раздела: «Сегодня. Добрый вечер»
    const name = document.createElement('span');
    name.className = 'visually-hidden';
    name.textContent = `${title}. `;
    viewTitle.replaceChildren(name, t(`greeting.${greetingKey(new Date().getHours())}`));
  } else {
    viewTitle.textContent = title;
  }
  // «(3) Сегодня · Задачи»: сколько открыто на сегодня, в любом разделе
  document.title = `${d.open ? `(${d.open}) ` : ''}${title} · ${t('meta.title')}`;
  const week = view === 'done' && !query && d.week ? ` · ${t('done.week', { n: d.week })}` : '';
  $('#view-sub').textContent = query ? t('found', { n: total })
    : today ? i18n.longDate(new Date())
      : t('tasks', { n: total }) + week;
  dayStatusEl.hidden = !today;
  if (today) dayStatusEl.textContent = statusText(d);
  // вечером: перенести всё оставшееся на завтра
  dayActions.hidden = !(today && new Date().getHours() >= EVENING_HOUR && d.open > 0);
}

function renderLeaf(d) {
  const now = new Date();
  const { month, weekday, monthOf } = i18n.leafParts(now);
  $('#leaf-month').textContent = month;
  $('#leaf-month-of').textContent = monthOf;
  $('#leaf-num').textContent = String(now.getDate());
  $('#leaf-wd').textContent = weekday;
  leaf.classList.toggle('is-closed', d.closed);

  ringBox.classList.toggle('is-free', !d.total);
  ringBox.classList.toggle('is-zero', d.total > 0 && !d.done);
  ringBox.classList.toggle('is-full', d.closed);
  const off = d.total ? 100 - (d.done / d.total) * 100 : 100;
  $('#ring-arc').style.setProperty('--ring-off', String(off));
  $('#ring-count').textContent = d.total ? t('ring.count', d) : '';
  $('#ring-word').textContent = t(!d.total ? (d.suggestions.length ? 'ring.pick' : 'ring.free') : d.closed ? 'ring.allDone' : 'ring.done');
}

// Неделя: сегодня и шесть дней вперёд. Перерисовывается, только если что-то поменялось.
function renderWeek(d, today) {
  const load = weekLoad(todos, today);
  if (!load.some((day) => day.date === weekFocus)) weekFocus = today;
  const key = JSON.stringify([load, today, settings.lang, d.closed, weekFocus]);
  if (weekList.dataset.key === key) return;
  weekList.dataset.key = key;
  const hadFocus = weekList.contains(document.activeElement) ? document.activeElement.dataset.date : null;
  weekList.replaceChildren(...load.map(({ date, count }, i) => {
    const cell = i18n.weekCell(date);
    const li = document.createElement('li');
    li.setAttribute('role', 'none');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'week-day';
    btn.dataset.date = date;
    btn.tabIndex = date === weekFocus ? 0 : -1;
    const name = i === 0 ? t('week.today', { date: cell.long }) : cell.long;
    const allDone = i === 0 && d.closed;
    btn.setAttribute('aria-label', allDone ? t('week.dayDone', { date: name })
      : count ? t('week.day', { date: name, tasks: t('tasks', { n: count }) }) : t('week.dayNone', { date: name }));
    if (i === 0) btn.setAttribute('aria-current', 'date');
    const wd = document.createElement('span');
    wd.className = 'week-wd';
    wd.textContent = cell.wd;
    const num = document.createElement('span');
    num.className = 'week-num';
    num.textContent = cell.day;
    const dots = document.createElement('span');
    dots.className = 'week-dots';
    // до трёх точек, дальше три точки и плюс; число задач есть в подписи кнопки
    for (let k = 0; k < Math.min(count, 3); k += 1) {
      const dot = document.createElement('span');
      dot.className = 'week-dot';
      dots.append(dot);
    }
    if (count > 3) {
      const plus = document.createElement('span');
      plus.className = 'week-plus';
      plus.textContent = '+';
      dots.append(plus);
    }
    if (allDone) {
      const dot = document.createElement('span');
      dot.className = 'week-dot is-done';
      dots.append(dot);
    }
    btn.append(wd, num, dots);
    li.append(btn);
    return li;
  }));
  if (hadFocus) $(`.week-day[data-date="${hadFocus}"]`, weekList)?.focus();
}

const planCache = new Map(); // id → { key, li }

function planRow(todo, today) {
  const key = JSON.stringify([todo.title, todo.due, today, settings.lang]);
  const hit = planCache.get(todo.id);
  if (hit?.key === key) return hit.li;
  const li = document.createElement('li');
  li.className = 'plan-row';
  const text = document.createElement('span');
  text.className = 'plan-text';
  const name = document.createElement('span');
  name.className = 'plan-name';
  name.textContent = todo.title;
  name.title = todo.title;
  const meta = document.createElement('span');
  meta.className = 'plan-meta';
  meta.textContent = todo.due ? i18n.relativeDate(todo.due, today) : t('plan.noDate');
  text.append(name, meta);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'plan-take';
  btn.dataset.id = todo.id;
  btn.setAttribute('aria-label', t('plan.takeLabel', { title: todo.title }));
  const label = document.createElement('span');
  label.textContent = t('plan.take');
  btn.append(svgIcon('plus'), label);
  li.append(text, btn);
  planCache.set(todo.id, { key, li });
  return li;
}

// Кнопки под предложениями: «Показать ещё N» / «Свернуть» и «Открыть все задачи».
const planMore = document.createElement('button');
planMore.type = 'button';
planMore.className = 'link-btn';
planMore.id = 'plan-more';
const planAll = document.createElement('a');
planAll.className = 'link-btn';
planAll.href = '#/all';

function renderPlan(d, today) {
  // пока на сегодня ничего нет, предложения сверху; когда есть, под своими задачами
  if (d.total === 0) {
    if (planZone.nextElementSibling !== listWrap) listWrap.before(planZone);
  } else if (listWrap.nextElementSibling !== planZone) {
    listWrap.after(planZone);
  }
  if (!d.closed && !d.restMoved) planAgainOpen = false;
  // день полон (6+), брать нечего или идёт поиск: блока нет; день закрыт или
  // остальное перенесено вечером: одна кнопка «Взять ещё», без списка
  const mode = view === 'today' && !query
    ? planMode({ open: d.open, closed: d.closed, suggestions: d.suggestions.length }, { restMoved: d.restMoved, again: planAgainOpen, full: FULL_DAY })
    : 'hidden';
  planSection.hidden = mode !== 'open';
  planAgain.hidden = mode !== 'folded';
  // класс вместо :has() в CSS: перерисовка длинного списка не пересчитывает стили лишний раз
  planZone.classList.toggle('is-shown', mode !== 'hidden');
  if (planSection.hidden) return;

  const open = !settings.planFolded;
  planToggle.setAttribute('aria-expanded', String(open));
  planBody.hidden = !open;
  $('#plan-count').textContent = String(d.suggestions.length);
  const limit = planExpanded ? PLAN_MAX : PLAN_SHORT;
  const shown = d.suggestions.slice(0, limit);
  patchChildren(planList, shown.map((todo) => planRow(todo, today)));
  const ids = new Set(d.suggestions.map((todo) => todo.id));
  for (const id of planCache.keys()) if (!ids.has(id)) planCache.delete(id);

  const extra = Math.min(d.suggestions.length, PLAN_MAX) - PLAN_SHORT;
  const foot = [];
  if (extra > 0) {
    planMore.textContent = planExpanded ? t('plan.less') : t('plan.more', { n: extra });
    planMore.setAttribute('aria-expanded', String(planExpanded));
    foot.push(planMore);
  }
  if (planExpanded && d.suggestions.length > PLAN_MAX) {
    planAll.textContent = t('plan.openAll');
    foot.push(planAll);
  }
  patchChildren(planFoot, foot);
}

// Пустые состояния: заголовок, фраза, действие; примеры вписываются в поле.
function emptyModel(d) {
  if (query) {
    if (/^#\S+$/.test(query)) return { title: t('empty.tagTitle', { tag: query }), actions: [['clear-search', t('empty.clearFilter')]] };
    return { title: t('empty.searchTitle', { q: query }), text: t('empty.searchText'), actions: [['clear-search', t('search.clear')]] };
  }
  switch (view) {
    case 'today': {
      // пусто совсем: строка в шапке уже всё сказала, здесь только примеры
      if (!d.all) return { examples: true };
      // на сегодня пусто, но есть что взять: предложения сверху; примеры ввода только новичку
      const teach = d.all <= 2 ? { examples: true } : null;
      if (d.total || d.suggestions.length || d.restMoved) return teach;
      const next = todos.filter((todo) => !todo.done && todo.due !== null).map((todo) => todo.due).sort()[0];
      if (!next) return teach;
      return {
        text: t('empty.todayFree', { tasks: t('tasks', { n: d.counts.upcoming }), date: i18n.groupDate(next, todayKey()) }),
        actions: [['open-upcoming', t('empty.openUpcoming')]],
      };
    }
    case 'upcoming':
      return { title: t('empty.upcomingTitle'), text: t('empty.upcomingText'), actions: [['focus-add', t('empty.plan')]] };
    case 'done':
      return { title: t('empty.doneTitle'), text: t('empty.doneText'), actions: [['open-today', t('empty.openToday')]] };
    default:
      if (!d.all) {
        return {
          title: t('empty.allFirstTitle'),
          text: t('empty.allFirstText'),
          actions: [['focus-add', t('empty.addTask')], ['show-samples', t('empty.showSamples')]],
          examples: true,
        };
      }
      return { title: t('empty.allDoneTitle'), text: t('empty.allDoneText'), actions: [['open-done', t('empty.openDone')]] };
  }
}

function renderEmpty(model) {
  empty.hidden = !model;
  const key = JSON.stringify([model, settings.lang]);
  if (!model || empty.dataset.key === key) return;
  empty.dataset.key = key;
  const parts = [];
  if (model.title) {
    const h = document.createElement('h2');
    h.className = 'empty-title';
    h.tabIndex = -1;
    h.textContent = model.title;
    parts.push(h);
  }
  if (model.text) {
    const p = document.createElement('p');
    p.className = 'empty-text';
    p.textContent = model.text;
    parts.push(p);
  }
  if (model.actions?.length) {
    const box = document.createElement('div');
    box.className = 'empty-actions';
    model.actions.forEach(([act, label], i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = i === 0 ? 'btn-primary' : 'link-btn';
      btn.dataset.act = act;
      btn.textContent = label;
      box.append(btn);
    });
    parts.push(box);
  }
  if (model.examples) {
    const box = document.createElement('div');
    box.className = 'examples';
    const label = document.createElement('p');
    label.className = 'examples-label';
    label.id = 'examples-label';
    label.textContent = t('examples.label');
    const ul = document.createElement('ul');
    ul.className = 'examples-list';
    ul.setAttribute('aria-labelledby', 'examples-label');
    for (const n of [1, 2, 3]) {
      const text = t(`example.${n}`);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'example';
      btn.dataset.example = text;
      btn.setAttribute('aria-label', t('example.label', { text }));
      const span = document.createElement('span');
      span.textContent = text;
      btn.append(svgIcon('plus'), span);
      li.append(btn);
      ul.append(li);
    }
    box.append(label, ul);
    parts.push(box);
  }
  if (model.ghosts) {
    // «тени» строк: показывают, что здесь появится; для скринридера их нет
    const ghosts = document.createElement('div');
    ghosts.className = 'ghosts';
    ghosts.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i += 1) {
      const row = document.createElement('div');
      row.className = 'ghost';
      const dot = document.createElement('span');
      dot.className = 'ghost-dot';
      const bars = document.createElement('span');
      bars.className = 'ghost-bars';
      for (let k = 0; k < 2; k += 1) {
        const bar = document.createElement('span');
        bar.className = 'ghost-bar';
        bars.append(bar);
      }
      row.append(dot, bars);
      ghosts.append(row);
    }
    parts.push(ghosts);
  }
  empty.replaceChildren(...parts);
}

let editingRow = null; // строка с открытым редактором на время перерисовки

function render(focus = currentFocus()) {
  editingRow = editingId ? listWrap.querySelector(`.todo.is-editing[data-id="${CSS.escape(editingId)}"]`) : null;
  const today = todayKey();
  renderedDay = today;
  renderedSlot = daySlot();
  const d = dayInfo(today);
  lastDay = { today, closed: d.closed };
  // на сегодня снова что-то есть: вечерний перенос больше не сворачивает предложения
  if (d.total) restMovedDay = null;
  const { counts } = d;

  for (const link of $$('[data-view]')) {
    const name = link.dataset.view;
    if (name === view && !query) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    const count = $('[data-count]', link);
    count.textContent = counts[name] ? String(counts[name]) : '';
    if (name === 'today' && counts.overdue > 0) {
      const note = document.createElement('span');
      note.className = 'visually-hidden';
      note.textContent = `, ${t('count.overdue', { n: counts.overdue })}`;
      count.append(note);
    }
    if (name === 'today' && d.closed) {
      // день закрыт: вместо пустого счётчика розовая галочка
      const note = document.createElement('span');
      note.className = 'visually-hidden';
      note.textContent = t('count.allDone');
      count.replaceChildren(svgIcon('tick'), note);
    }
  }

  const groups = visibleGroups(today);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  renderHeader(d, total);
  renderLeaf(d);
  renderWeek(d, today);
  renderPlan(d, today);

  const defaultHint = view === 'today' ? t('add.hintToday') : view === 'upcoming' ? t('add.hintUpcoming') : '';
  // сообщение «Сначала напишите задачу» держится, пока человек не начнёт печатать
  if (hint.classList.contains('is-error')) hint.textContent = `${t('add.empty')}.`;
  else hint.textContent = defaultHint ? `${t('add.hint')}. ${defaultHint}.` : `${t('add.hint')}.`;

  dragEnabled = !query && settings.sort === 'manual' && (view === 'all' || view === 'today');
  listWrap.classList.toggle('no-drag', !dragEnabled);

  const nodes = [];
  const oldLists = $$(':scope > ul.list', listWrap);
  groups.forEach((group, i) => {
    // список и строки, которые не менялись, остаются в DOM на месте:
    // не теряется фокус и не пересчитывается раскладка всего списка
    const ul = oldLists[i] ?? document.createElement('ul');
    ul.className = 'list';
    ul.removeAttribute('aria-labelledby');
    if (group.title) {
      const h = document.createElement('h2');
      h.className = 'group-title';
      h.id = `group-${i}`;
      // к заголовку дня в «Планах» ведёт клик по дню недели
      if (group.due) h.dataset.due = group.due;
      h.tabIndex = -1;
      if (group.overdue) h.append(svgIcon('back'));
      const name = document.createElement('span');
      name.textContent = group.title;
      const n = document.createElement('span');
      n.className = 'group-count';
      n.textContent = ` · ${group.items.length}`;
      h.append(name, n);
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
    patchChildren(ul, group.items.map((todo) => cachedItem(todo, today)));
    nodes.push(ul);
  });
  patchChildren(listWrap, total ? nodes : []);
  // строки, которых больше нет на экране, из запаса убираем
  const shown = new Set(groups.flatMap((g) => g.items.map((todo) => todo.id)));
  for (const id of rowCache.keys()) if (!shown.has(id)) rowCache.delete(id);

  // в первые дни (одна-две задачи) под списком «Сегодня» остаются примеры ввода
  const teach = view === 'today' && !query && d.all <= 2;
  renderEmpty(total ? (teach ? { examples: true } : null) : emptyModel(d));

  // строка «Это примеры… Убрать примеры», пока примеры с первого визита на месте
  samplesBar.hidden = query !== '' || !(view === 'all' || view === 'today') || !todos.some((todo) => todo.sample);

  clearDoneBtn.hidden = !(view === 'done' && counts.done > 0 && !query);
  sortSelect.value = settings.sort;
  sortSelect.disabled = !query && (view === 'upcoming' || view === 'done');

  restoreFocus(focus);

  // строки сдвинулись (например, свернулся редактор): меню остаётся у своей кнопки
  if (menu) {
    const opener = menuOpener();
    if (!opener) closeMenu(false);
    else {
      menu.opener = opener;
      placeMenu();
    }
  }
}

// Слова поиска, которые подсвечиваются в названии (метки с # не подсвечиваем).
function queryWords() {
  return query.toLowerCase().split(/\s+/).filter((w) => w && !w.startsWith('#'));
}

function highlight(target, text) {
  const words = queryWords();
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

// Привести детей parent к списку desired, двигая только то, что не на месте.
function patchChildren(parent, desired) {
  const keep = new Set(desired);
  desired.forEach((node, i) => {
    const current = parent.children[i];
    if (current === node) return;
    // старую версию строки меняем на новую на том же месте, остальные не двигаем
    if (current && !keep.has(current)) current.replaceWith(node);
    else parent.insertBefore(node, current ?? null);
  });
  while (parent.children.length > desired.length) parent.lastElementChild.remove();
}

// Строка перерисовывается, только если поменялось то, что в ней видно:
// отметка одной задачи не пересобирает остальные двести.
const rowCache = new Map(); // id → { key, li }

function cachedItem(todo, today) {
  if (editingId === todo.id) {
    // открытый редактор не пересобираем: в нём то, что человек уже напечатал
    const open = editingRow;
    if (!open) return renderItem(todo, today);
    open.classList.toggle('is-done', todo.done);
    $('.todo-check', open).checked = todo.done;
    return open;
  }
  const lower = todo.title.toLowerCase();
  const marks = queryWords().filter((w) => lower.includes(w));
  const key = JSON.stringify([todo, today, marks, settings.lang, openDetails.has(todo.id), menu?.id === todo.id && menu.kind, view === 'done']);
  const hit = rowCache.get(todo.id);
  if (hit?.key === key && !hit.li.classList.contains('is-leaving')) return hit.li;
  const li = renderItem(todo, today);
  rowCache.set(todo.id, { key, li });
  return li;
}

function renderItem(todo, today) {
  const li = todoTemplate.content.firstElementChild.cloneNode(true);
  li.dataset.id = todo.id;
  li.classList.toggle('is-done', todo.done);
  // анимация галочки только у задачи, которую сейчас отметили
  li.classList.toggle('is-checking', todo.done && justChecked.has(todo.id));
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
  if (menu?.id === todo.id && menu.kind === 'more') $('.todo-more', li).setAttribute('aria-expanded', 'true');

  const body = $('.todo-body', li);
  if (editingId === todo.id) {
    li.classList.add('is-editing');
    body.replaceChildren(renderEditor(todo));
    return li;
  }

  highlight($('.todo-title-text', li), todo.title);
  const meta = $('.todo-meta', li);

  // порядок в строке: срок, повтор, шаги, приоритет, метки. В «Готово» срок уже не важен.
  if (todo.due && !(todo.done && view === 'done')) {
    // у открытой задачи срок кнопкой: нажал и перенёс, без редактора
    const due = document.createElement(todo.done ? 'span' : 'button');
    due.className = 'meta-item meta-due';
    const overdue = !todo.done && todo.due < today;
    due.classList.toggle('is-overdue', overdue);
    due.classList.toggle('is-today', !todo.done && todo.due === today);
    const label = document.createElement('span');
    label.textContent = i18n.relativeDate(todo.due, today);
    // просроченное без тревоги: часы назад вместо календаря
    due.append(svgIcon(overdue ? 'back' : 'calendar'), label);
    if (todo.done) {
      due.title = i18n.groupDate(todo.due, today);
    } else {
      due.type = 'button';
      due.setAttribute('aria-haspopup', 'menu');
      due.setAttribute('aria-expanded', String(menu?.id === todo.id && menu.kind === 'due'));
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
    text.textContent = repeatLabel(todo.repeat, todo.repeatDay, todo.due);
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
  if (!todo.done) {
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

// «По пятницам» для еженедельного повтора, иначе «Каждый день» и т. п.
function repeatLabel(repeat, day, due) {
  if (repeat === 'week') {
    const weekday = Number.isInteger(day) ? day : due ? fromKey(due).getDay() : null;
    if (weekday !== null) return t(`repeat.on${weekday}`);
  }
  if (repeat === 'month') {
    const date = Number.isInteger(day) ? day : due ? fromKey(due).getDate() : null;
    if (date !== null) return t('repeat.monthOn', { d: date });
  }
  return t(`repeat.${repeat}`);
}

function addStepsInline(field, text) {
  const id = field.closest('.todo').dataset.id;
  const { todos: next, rest } = addSteps(todos, id, text);
  if (next !== todos) {
    commit(next, { focus: { id, selector: '.details-step-new' } });
    announce(t('steps.added', { step: next.find((x) => x.id === id).steps.at(-1).title }));
  }
  if (!rest.length) return;
  // не влезло в лимит: говорим, сколько именно
  showToast(t('steps.limit', { n: MAX_STEPS, m: rest.length }));
}

// Значения полей редактора, как их показали человеку.
function editorFields(todo) {
  return {
    title: todo.title,
    due: todo.due ?? '',
    priority: String(todo.priority),
    tags: todo.tags.join(' '),
    repeat: todo.repeat ?? '',
    notes: todo.notes,
  };
}

// Задача под открытым редактором изменилась не через него («Вернуть»):
// поля, которые человек не трогал, показывают новое значение, его правки остаются.
function syncEditor(todo) {
  const editor = $('.editor', listWrap);
  if (!editor || !todo) return;
  const base = JSON.parse(editor.dataset.base);
  const next = editorFields(todo);
  for (const [name, value] of Object.entries(next)) {
    const field = editor.elements[name];
    if (field.value === base[name]) {
      field.value = value;
      base[name] = value;
    }
  }
  editor.dataset.base = JSON.stringify(base);
}

function renderEditor(todo) {
  const editor = editorTemplate.content.firstElementChild.cloneNode(true);
  translate(editor);
  editor.dataset.base = JSON.stringify(editorFields(todo));
  editor.elements.title.value = todo.title;
  editor.elements.due.value = todo.due ?? '';
  editor.elements.priority.value = String(todo.priority);
  editor.elements.tags.value = todo.tags.join(' ');
  editor.elements.repeat.value = todo.repeat ?? '';
  // у еженедельной задачи в списке виден её день: «По пятницам»
  if (todo.repeat === 'week' || todo.repeat === 'month') {
    $(`option[value="${todo.repeat}"]`, editor).textContent = repeatLabel(todo.repeat, todo.repeatDay, todo.due);
  }
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
  if (!field.value.trim()) return false;
  if ($$('.step-edit', editor).length >= MAX_STEPS) {
    showToast(t('steps.full', { n: MAX_STEPS }));
    return false;
  }
  const row = stepEditRow({ title: field.value, done: false });
  row.dataset.id = `new-${Date.now().toString(36)}-${$$('.step-edit', editor).length}`;
  $('.step-list', editor).append(row);
  announce(t('steps.added', { step: field.value.trim() }));
  field.value = '';
  numberSteps(editor);
  return true;
}

// После перерисовки возвращаем фокус туда, где был пользователь,
// иначе при работе с клавиатуры он улетает в начало страницы.
function restoreFocus(focus) {
  if (!focus) return;
  if (focus === 'input') return input.focus();
  if (focus instanceof Element) {
    // кнопка исчезла или спрятана: запасной вариант, но на телефоне не поле ввода
    if (focus.isConnected && focus.getClientRects().length) return focus.focus();
    return finePointer() ? input.focus() : viewTitle.focus();
  }
  if (focus.plan) {
    // следующая кнопка «На сегодня»; если её нет, задача в списке
    const btn = $(`.plan-take[data-id="${CSS.escape(focus.plan)}"]`, planList);
    if (btn && !planSection.hidden && !planBody.hidden) return btn.focus();
    return restoreFocus({ id: focus.fallback ?? '', selector: '.todo-check', index: 0 });
  }
  const item = listWrap.querySelector(`.todo[data-id="${CSS.escape(focus.id)}"]`);
  const target = item && $(focus.selector, item);
  // строка на месте, где по ней кликнули: прокрутка не нужна, а без неё фокус дешевле
  if (target) return target.focus({ preventScroll: Boolean(focus.still) });
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
  document.documentElement.classList.remove('i18n-pending');
  for (const btn of $$('[data-lang]')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === settings.lang));
  for (const [btn, key] of [[themeBtn, 'theme.dark'], [helpBtn, 'menu.shortcuts'], [dataBtn, 'data.label'], [searchToggle, 'search.label']]) {
    btn.setAttribute('aria-label', t(key));
    btn.title = t(key);
  }
  renderBackupNudge();
  setBrandDate();
  lastChips = '';
  updateChips();
}

function setBrandDate() {
  $('#today-date').textContent = i18n.longDate(new Date());
  // листок календаря у названия: сегодняшнее число, завтра будет следующее
  $('#day-num').textContent = String(new Date().getDate());
}

// Тема: выбранная человеком, а пока он не выбирал, как в системе.
function themeNow() {
  return settings.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme() {
  const dark = themeNow() === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeBtn.setAttribute('aria-pressed', String(dark));
  $('meta[name="theme-color"]').content = dark ? '#151921' : '#ffffff';
}

/* Быстрое добавление */

function currentParse() {
  return parseQuickAdd(input.value, todayKey(), { ignore: ignoreTokens });
}

function chipText(token, today, parsed) {
  if (token.type === 'date') return i18n.groupDate(token.value, today);
  if (token.type === 'priority') return `P${token.value}`;
  if (token.type === 'repeat') return repeatLabel(token.value, parsed.repeatDay, parsed.due);
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
    text.textContent = chipText(token, today, parsed);
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

function clearInputError() {
  if (!hint.classList.contains('is-error')) return;
  input.removeAttribute('aria-invalid');
  hint.classList.remove('is-error');
  render();
}

// Поле в фокусе с самого начала, но «/» и «?» в пустом поле остаются клавишами
// поиска и справки, как обещают подсказки.
input.addEventListener('keydown', (e) => {
  if (input.value || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.key === '?') {
    e.preventDefault();
    openHelp();
  } else if (e.key === '/') {
    e.preventDefault();
    search.focus();
  }
});

input.addEventListener('input', () => {
  clearInputError();
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
    input.setAttribute('aria-invalid', 'true');
    hint.classList.add('is-error');
    hint.textContent = `${t('add.empty')}.`;
    announce(t('add.empty'));
    input.focus();
    return;
  }
  clearInputError();
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
  // первая своя задача: просим браузер не стирать данные сайта (Firefox может спросить)
  if (!persistAsked) {
    persistAsked = true;
    requestPersist();
  }
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
  const hidesDone = !query && (view === 'all' || view === 'upcoming');
  // в «Все» и «Планах» отмеченная строка стоит на месте: фокус без прокрутки
  const focus = { ...focusOf(li), still: hidesDone };
  if (before.done) {
    // сняли галочку, пока задача ещё не ушла: она остаётся на месте
    clearTimeout(lingering.get(id));
    lingering.delete(id);
    commit(toggleTodo(todos, id), { focus });
    showToast(t('toast.reopened', { title: before.title }), { snapshot, focus: { id, selector: '.todo-check' } });
    return;
  }
  if (hidesDone) {
    clearTimeout(lingering.get(id));
    lingering.set(id, setTimeout(() => leave(id), LINGER_MS));
  }
  const today = todayKey();
  const wasClosed = lastDay?.today === today ? lastDay.closed : dayInfo(today).closed;
  justChecked.add(id);
  setTimeout(() => {
    justChecked.delete(id);
    listWrap.querySelector(`.todo[data-id="${CSS.escape(id)}"]`)?.classList.remove('is-checking');
  }, CHECK_MS);
  const result = completeTodo(todos, id, today);
  commit(result.todos, { focus });
  const message = result.next
    ? t('toast.completedNext', { title: before.title, when: whenText(result.next.due, today) })
    : t('toast.completed', { title: before.title });
  // последняя задача дня: кольцо замыкается, листок отрывается, одна фраза для скринридера
  const closesDay = !wasClosed && lastDay.closed && view === 'today' && !query;
  const progress = closesDay ? todayProgress(todos, today, dayKeyOf) : null;
  showToast(message, {
    snapshot,
    focus: { id, selector: '.todo-check' },
    say: closesDay ? `${message}. ${t('status.allDone', progress)}` : message,
  });
  if (closesDay) closeDay(today);
}

// Момент «день закрыт». Листок отрывается один раз за календарный день,
// повторно (сняли и снова отметили) уже нет, после перезагрузки тоже.
function closeDay(today) {
  if (settings.closedDay === today) return;
  settings.closedDay = today;
  saveSettings(settings);
  if (reducedMotion()) return;
  const sheet = document.createElement('span');
  sheet.className = 'leaf-sheet';
  for (const sel of ['.leaf-band', '.leaf-month', '.leaf-num', '.leaf-wd']) {
    const copy = $(sel, leaf).cloneNode(true);
    copy.removeAttribute('id');
    for (const el of $$('[id]', copy)) el.removeAttribute('id');
    $('.leaf-tick', copy)?.remove();
    sheet.append(copy);
  }
  leaf.append(sheet);
  leaf.classList.add('is-tearing');
  sheet.addEventListener('animationend', () => sheet.remove(), { once: true });
  setTimeout(() => {
    sheet.remove();
    leaf.classList.remove('is-tearing');
  }, 800);
}

// «завтра», «Пн, 16 нояб.» для сообщений о сроке.
function whenText(due, today) {
  const diff = daysBetween(today, due);
  if (diff === 0) return t('date.today').toLowerCase();
  if (diff === 1) return t('date.tomorrow').toLowerCase();
  return i18n.shortDate(due);
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
  menu = { id: li.dataset.id, opener, kind: opener.matches('.meta-due') ? 'due' : 'more' };
  opener.setAttribute('aria-expanded', 'true');
  const todo = todos.find((x) => x.id === menu.id);
  rowMenu.setAttribute('aria-label', t('menu.label', { title: todo?.title ?? '' }));
  const today = todayKey();
  const shown = new Set();
  for (const item of $$('[data-action]', rowMenu)) {
    const { action } = item.dataset;
    const due = DUE_ACTIONS[action]?.(today);
    const hint = $('.menu-hint', item);
    if (hint) hint.textContent = due ? i18n.shortDate(due) : '';
    // для сделанной задачи перенос не нужен; вариант, равный текущему сроку
    // или уже показанной дате (в воскресенье «завтра» и есть следующая неделя), тоже
    item.hidden = (action !== 'delete' && (todo?.done ?? false))
      || (due !== undefined && (due === todo?.due || shown.has(due)))
      || (action === 'calendar' && !todo?.due);
    if (due !== undefined && !item.hidden) shown.add(due);
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
  const selector = opener.matches('.meta-due') ? 'button.meta-due' : '.todo-more';
  const row = listWrap.querySelector(`.todo[data-id="${CSS.escape(id)}"]`);
  const current = opener.isConnected ? opener : row && ($(selector, row) ?? $('.todo-more', row));
  for (const btn of row ? $$('[aria-haspopup="menu"]', row) : [current]) btn?.setAttribute('aria-expanded', 'false');
  if (returnFocus) current?.focus();
}

rowMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-action]');
  if (!item || !menu) return;
  const { id, opener } = menu;
  const li = listWrap.querySelector(`.todo[data-id="${CSS.escape(id)}"]`);
  const selector = opener.matches('.meta-due') ? 'button.meta-due' : '.todo-more';
  closeMenu(false);
  if (!li) return;
  if (item.dataset.action === 'delete') {
    remove(li);
    return;
  }
  if (item.dataset.action === 'calendar') {
    const todo = todos.find((x) => x.id === id);
    const file = todo && toICS(todo, { lang: i18n.lang });
    const back = $(selector, li) ?? $('.todo-more', li);
    back?.focus();
    if (file) {
      download(file, icsFileName(todo), ICS_TYPE);
      showToast(t('calendar.done'), { focus: back });
    }
    return;
  }
  if (item.dataset.action === 'pick') {
    startEditing(li, 'input[name="due"]', { oneOff: true });
    try {
      $('.is-editing input[name="due"]', listWrap)?.showPicker();
    } catch {
      // старые браузеры: поле даты в фокусе, календарь откроется по клику
    }
    return;
  }
  const index = $$('.todo', listWrap).indexOf(li);
  reschedule(id, DUE_ACTIONS[item.dataset.action](todayKey()), { id, selector, index });
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
// Страница прокрутилась (сама после перерисовки или пальцем): меню едет за
// своей кнопкой и закрывается, только когда кнопка ушла с экрана.
document.addEventListener('scroll', () => {
  if (!menu) return;
  const opener = menuOpener();
  if (!opener) return closeMenu(false);
  menu.opener = opener;
  const r = opener.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return closeMenu(false);
  return placeMenu();
}, { passive: true });

function menuOpener() {
  if (menu.opener.isConnected) return menu.opener;
  const row = listWrap.querySelector(`.todo[data-id="${CSS.escape(menu.id)}"]`);
  return row && $(menu.kind === 'due' ? 'button.meta-due' : '.todo-more', row);
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
  if (!row || editingId || reducedMotion()) return finish();
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

let keepAnchor = false; // редактор открыт из «Выбрать дату…»: перенос одного раза

function startEditing(li, selector = 'input[name="title"]', { oneOff = false } = {}) {
  if (editingId === li.dataset.id) return;
  editingId = li.dataset.id;
  keepAnchor = oneOff;
  render({ id: editingId, selector });
  const field = $('.is-editing input[name="title"]', listWrap);
  if (document.activeElement === field) field.setSelectionRange(field.value.length, field.value.length);
}

// Список с правкой из открытого редактора; тот же массив, если ничего не поменяли.
function editedTodos() {
  const editor = $('.editor', listWrap);
  if (!editingId || !editor) return todos;
  const f = editor.elements;
  const original = todos.find((x) => x.id === editingId);
  const changes = {
    title: f.title.value,
    due: f.due.value || null,
    priority: Number(f.priority.value),
    tags: splitTags(f.tags.value),
    repeat: f.repeat.value || null,
    notes: f.notes.value,
    steps: readSteps(editor),
    today: todayKey(),
  };
  // срок и повтор не трогали: день недели повтора остаётся прежним
  // Повтор и срок не меняли, или перенесли один раз через «Выбрать дату…»:
  // «по пятницам» остаётся по пятницам. Новый срок в редакторе задаёт новый день повтора.
  if (changes.repeat === original.repeat && (keepAnchor || changes.due === original.due)) {
    changes.repeatDay = original.repeatDay;
  }
  const next = updateTodo(todos, editingId, changes);
  // пометка примера не считается правкой: открыли и закрыли пример, он остался примером
  const before = JSON.stringify({ ...original, sample: undefined });
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
    persist();
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
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const editor = field.closest('.editor');
  const room = Math.max(0, MAX_STEPS - $$('.step-edit', editor).length);
  for (const line of lines.slice(0, room)) {
    field.value = line;
    addStepFromInput(field);
  }
  field.value = '';
  if (lines.length > room) showToast(t('steps.limit', { n: MAX_STEPS, m: lines.length - room }));
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
// Клик по «Вернуть» в сообщении правку не сохраняет: редактор остаётся открытым (см. applyUndo).
document.addEventListener('click', (e) => {
  if (editingId && !e.target.closest?.('.editor, .toast')) flushEditor();
}, true);

// Пока кнопка мыши или палец нажаты, фокус уходит из редактора, но клика ещё
// не было. Перерисовка в этот момент убрала бы кнопку из-под курсора, и клик
// потерялся бы, поэтому сохраняем правку уже по клику (обработчик выше).
// Если клика так и не будет (прокрутка пальцем), редактор остаётся открытым.
let pointerDown = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => { pointerDown = false; }, true);
}

listWrap.addEventListener('focusout', (e) => {
  const editor = e.target.closest('.editor');
  // relatedTarget пуст, когда переключились в другое окно: правку не трогаем.
  // Tab в сообщение с «Вернуть» или в меню строки правку тоже не трогает:
  // иначе сообщение закрылось бы раньше, чем на него нажали.
  if (!editor || !e.relatedTarget || editor.contains(e.relatedTarget) || pointerDown) return;
  if (e.relatedTarget.closest('.toast, #row-menu')) return;
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
    // открытую задачу нельзя утащить под сделанные и наоборот
    const same = (row) => row && row.classList.contains('is-done') === li.classList.contains('is-done');
    const prev = same(li.previousElementSibling) ? li.previousElementSibling : null;
    const next = same(li.nextElementSibling) ? li.nextElementSibling : null;
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
  // в «Сегодня» сделанные стоят под открытыми: двигаем только среди своих
  const done = li.classList.contains('is-done');
  const ids = [...ul.children].filter((row) => row.classList.contains('is-done') === done).map((row) => row.dataset.id);
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
// say: что прочесть скринридеру, если это больше текста сообщения (итог дня).
function showToast(message, { snapshot = null, focus = null, action = null, say = message } = {}) {
  dropUndo();
  // цели нет: возвращаемся туда, где был фокус до сообщения
  const was = document.activeElement;
  if (!focus && was && was !== document.body && !toast.contains(was)) focus = was;
  toastText.textContent = message;
  toastUndo.textContent = action?.label ?? t('toast.undo');
  toastUndo.hidden = !snapshot && !action;
  toast.hidden = false;
  announce(say);
  undo = { snapshot, focus, action, timer: setTimeout(dropUndo, TOAST_MS) };
}

function dropUndo() {
  if (!undo) return;
  clearTimeout(undo.timer);
  const { focus } = undo;
  undo = null;
  // на телефоне в поле не возвращаем: открылась бы клавиатура
  if (toast.contains(document.activeElement)) restoreFocus(focus ?? (finePointer() ? 'input' : viewTitle));
  toast.hidden = true;
}

function applyUndo() {
  if (!undo?.snapshot) return;
  const { snapshot: raw, focus } = undo;
  // примеры возвращаются на текущем языке интерфейса
  const snapshot = translateSamples(raw, t);
  // редактор остаётся открытым с тем, что в нём набрано, если задача на месте
  if (editingId && !snapshot.some((x) => x.id === editingId)) editingId = null;
  for (const timer of lingering.values()) clearTimeout(timer);
  lingering.clear();
  // при открытом редакторе фокус остаётся в нём: уход фокуса сохранил бы и закрыл редактор.
  // Кольцо и листок возвращаются тихо, без анимации.
  quietly(() => commit(snapshot, { focus: editingId ? undefined : focus ?? undefined }));
  if (editingId) syncEditor(todos.find((x) => x.id === editingId));
  announce(t('toast.restored'));
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

/* «Можно взять на сегодня», вечерний перенос, неделя, пустые состояния */

function takeForToday(id) {
  const todo = todos.find((x) => x.id === id);
  if (!todo || todo.done) return;
  const today = todayKey();
  const list = suggestForToday(todos, today);
  const at = list.findIndex((x) => x.id === id);
  // фокус на следующее предложение, а если их больше нет, на саму задачу в списке
  const next = list[at + 1] ?? list[at - 1];
  const snapshot = todos;
  commit(updateTodo(todos, id, { due: today }), { focus: next ? { plan: next.id, fallback: id } : { id, selector: '.todo-check' } });
  showToast(t('toast.taken', { title: todo.title }), { snapshot, focus: { plan: id, fallback: id } });
}

planList.addEventListener('click', (e) => {
  const btn = e.target.closest('.plan-take');
  if (btn) takeForToday(btn.dataset.id);
});

planToggle.addEventListener('click', () => {
  settings.planFolded = !settings.planFolded;
  saveSettings(settings);
  render();
});

planMore.addEventListener('click', () => {
  planExpanded = !planExpanded;
  render();
  planMore.focus();
});

planAgain.addEventListener('click', () => {
  planAgainOpen = true;
  if (settings.planFolded) {
    settings.planFolded = false;
    saveSettings(settings);
  }
  render();
  $('.plan-take', planList)?.focus();
});

$('#move-rest').addEventListener('click', () => {
  const today = todayKey();
  const n = todos.filter((x) => !x.done && x.due !== null && x.due <= today).length;
  if (!n) return;
  const snapshot = todos;
  // остальное ушло на завтра: сегодня больше не предлагаем те же задачи обратно
  restMovedDay = today;
  planAgainOpen = false;
  // на телефоне поле в фокусе открыло бы клавиатуру: фокус на заголовок
  commit(moveOpenTo(todos, today, addDays(today, 1)), { focus: finePointer() ? 'input' : viewTitle });
  showToast(t('toast.movedRest', { n }), { snapshot, focus: $('#move-rest') });
});

// Клик по дню недели: сегодня ведёт к списку на сегодня, другой день в «Планы» к его дате.
function jumpToDay(date) {
  const target = date === todayKey() ? 'today' : 'upcoming';
  pendingJump = date;
  weekFocus = date;
  if (view === target && !query) return runJump();
  if (view === target) return setQuery('');
  location.hash = `#/${target}`;
  return undefined;
}

function runJump() {
  const date = pendingJump;
  pendingJump = null;
  if (!date) return;
  const behavior = reducedMotion() ? 'auto' : 'smooth';
  if (date === todayKey()) {
    const first = $('.todo-check', listWrap);
    content.scrollIntoView({ block: 'start', behavior });
    (first ?? viewTitle).focus({ preventScroll: true });
    return;
  }
  // ближайший день с задачами, начиная с выбранного; если планов нет, к пустому состоянию
  const head = $$('h2[data-due]', listWrap).find((h) => h.dataset.due >= date);
  const target = head ?? $('.empty-title', empty) ?? viewTitle;
  target.scrollIntoView({ block: 'start', behavior });
  target.focus({ preventScroll: true });
}

weekList.addEventListener('click', (e) => {
  const btn = e.target.closest('.week-day');
  if (btn) jumpToDay(btn.dataset.date);
});

// Стрелки двигают фокус по дням, Tab выходит из недели (переходящий tabindex).
weekList.addEventListener('keydown', (e) => {
  const days = $$('.week-day', weekList);
  const at = days.indexOf(document.activeElement);
  if (at === -1) return;
  let next = null;
  if (e.key === 'ArrowRight') next = days[Math.min(at + 1, days.length - 1)];
  else if (e.key === 'ArrowLeft') next = days[Math.max(at - 1, 0)];
  else if (e.key === 'Home') next = days[0];
  else if (e.key === 'End') next = days.at(-1);
  if (!next) return;
  e.preventDefault();
  for (const day of days) day.tabIndex = day === next ? 0 : -1;
  weekFocus = next.dataset.date;
  next.focus();
});

// Пример из пустого состояния вписывается в поле: человек видит подсказки и сам жмёт Enter.
function fillComposer(text) {
  input.value = text;
  clearInputError();
  ignoreTokens = [];
  updateChips();
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

empty.addEventListener('click', (e) => {
  const example = e.target.closest('[data-example]');
  if (example) {
    fillComposer(example.dataset.example);
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'focus-add') input.focus();
  else if (act === 'clear-search') setQuery('', true);
  else if (act === 'open-upcoming') location.hash = '#/upcoming';
  else if (act === 'open-today') location.hash = '#/today';
  else if (act === 'open-done') location.hash = '#/done';
  else if (act === 'show-samples') {
    const snapshot = todos;
    commit([...sampleTodos(t, todayKey()), ...todos], { focus: viewTitle });
    showToast(t('toast.samplesShown'), { snapshot, focus: viewTitle });
  }
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
  else if (pendingJump) runJump();
  else if (pendingTask) focusTask();
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

// Телефон: поиск и порядок спрятаны за лупой в верхней строке, чтобы список был ближе
searchToggle.addEventListener('click', () => {
  const open = !main.classList.contains('tools-open');
  main.classList.toggle('tools-open', open);
  searchToggle.setAttribute('aria-expanded', String(open || Boolean(query)));
  if (open) search.focus();
});

sortSelect.addEventListener('change', () => {
  settings.sort = sortSelect.value;
  saveSettings(settings);
  render();
});

$('.skip-link').addEventListener('click', (e) => {
  e.preventDefault();
  input.focus();
});

window.addEventListener('hashchange', () => {
  if (location.hash && !location.hash.startsWith('#/')) return;
  view = viewFromHash();
  // ушли из раздела с открытым редактором (кнопка «Назад», жест): правка сохраняется,
  // как при клике мимо редактора
  if (editingId) {
    const next = editedTodos();
    editingId = null;
    if (next !== todos) {
      dropUndo();
      todos = next;
      persist();
    }
  }
  closeMenu(false);
  openDetails.clear(); // в новом разделе всё свёрнуто
  if (query) {
    query = '';
    search.value = '';
    searchClear.hidden = true;
  }
  render();
  // пришли сюда кликом по дню недели: прокрутить к этому дню; из команд: к задаче
  if (pendingJump) runJump();
  if (pendingTask) focusTask();
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
    dropUndo();
    applyLanguage();
    const translated = translateSamples(todos, t);
    if (translated !== todos) {
      todos = translated;
      persist();
    }
    render();
  });
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!settings.theme) applyTheme();
});

themeBtn.addEventListener('click', () => {
  settings.theme = themeNow() === 'dark' ? 'light' : 'dark';
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

function download(text, name, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#export-btn').addEventListener('click', () => {
  download(exportJSON(todos), `tasks-${todayKey()}.json`);
  markBackup();
  renderBackupNudge();
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
  renderBackupNudge();
  showToast(t('toast.imported', { n: result.count }), { snapshot, focus: dataBtn });
});

// Тихое напоминание о копии: строка в меню данных и точка на кнопке, без окон.
function renderBackupNudge() {
  const last = readLastBackup();
  const kind = backupNudge(todos, { lastAt: last });
  const note = $('#backup-nudge');
  note.hidden = !kind;
  $('#data-dot').hidden = !kind;
  if (kind) note.textContent = kind === 'never' ? t('backup.never') : t('backup.old', { n: t('backup.days', { n: daysSince(last) }) });
  dataBtn.setAttribute('aria-label', kind ? `${t('data.label')} · ${t('backup.reminder')}` : t('data.label'));
}

// Установка как приложение: пункт в меню данных появляется, когда браузер это умеет.
const installer = createInstall();
const installBtn = $('#install-btn');
installer.onChange((can) => {
  if (!can && installBtn.contains(document.activeElement)) dataBtn.focus();
  installBtn.hidden = !can;
});
installBtn.addEventListener('click', async () => {
  // после ответа пункт прячется: фокус заранее на кнопку меню, чтобы не упасть в body
  dataBtn.focus();
  setDataPanel(false);
  if ((await installer.install()) === 'accepted') showToast(t('install.done'), { focus: dataBtn });
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

/* Команды (Ctrl+K): разделы, действия, поиск задачи по названию */

const palette = $('#palette');
const palInput = $('#palette-input');
const palList = $('#palette-list');
let palItems = [];
let palActive = 0;
let pendingTask = null; // задача, к которой перейти после смены раздела

const isMac = /Mac|iPhone|iPad/.test(navigator.platform ?? '');
if (isMac) for (const kbd of $$('.mod-key')) kbd.textContent = '⌘';

const VIEW_ICONS = { today: 'today', upcoming: 'upcoming', all: 'all', done: 'done' };

function paletteCommands() {
  const dark = themeNow() === 'dark';
  const other = settings.lang === 'ru' ? 'en' : 'ru';
  return [
    { group: 'actions', id: 'new', label: t('help.new'), keys: t('palette.kw.new'), hint: 'N', icon: 'plus', run: () => input.focus() },
    ...NAV.map((name, i) => ({
      group: 'views', id: `view-${name}`, label: t(`view.${name}`), hint: String(i + 1), icon: VIEW_ICONS[name],
      run: () => { location.hash = `#/${name}`; },
    })),
    { group: 'actions', id: 'theme', label: t(dark ? 'palette.light' : 'palette.dark'), keys: t('palette.kw.theme'), icon: dark ? 'sun' : 'moon', run: () => themeBtn.click() },
    { group: 'actions', id: 'lang', label: other === 'en' ? 'English' : 'Русский', keys: t('palette.kw.lang'), icon: 'globe', run: () => $(`[data-lang="${other}"]`).click() },
    { group: 'actions', id: 'export', label: t('menu.export'), keys: t('palette.kw.export'), icon: 'download', run: () => $('#export-btn').click() },
    { group: 'actions', id: 'import', label: t('menu.import'), keys: t('palette.kw.import'), icon: 'upload', run: () => importFile.click() },
    { group: 'actions', id: 'help', label: t('menu.shortcuts'), keys: t('palette.kw.help'), hint: '?', icon: 'help', run: () => openHelp() },
  ];
}

function renderPalette() {
  const raw = palInput.value.trim();
  const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (text) => words.every((w) => text.toLowerCase().includes(w));
  // пустой запрос: самое частое; иначе всё, что подходит по словам
  let items = paletteCommands();
  if (!words.length) items = items.filter((c) => ['new', 'view-today', 'theme', 'lang', 'export'].includes(c.id));
  else items = items.filter((c) => match(`${c.label} ${c.keys ?? ''}`));
  const today = todayKey();
  const found = words.length ? sortTodos(todos.filter((x) => match(x.title)), 'manual') : [];
  const tasks = [...found.filter((x) => !x.done), ...found.filter((x) => x.done)].slice(0, 6).map((x) => ({
    group: 'tasks', id: `task-${x.id}`, label: x.title, icon: x.done ? 'done' : 'today',
    hint: x.done ? t('palette.done') : x.due ? i18n.relativeDate(x.due, today) : '',
    run: () => jumpToTask(x.id),
  }));
  const groups = [
    ['actions', items.filter((c) => c.group === 'actions')],
    ['views', items.filter((c) => c.group === 'views')],
    ['tasks', tasks],
  ];
  // ничего не нашлось или нашлось: последней строкой «Новая задача: …»
  if (words.length) groups.push(['create', [{ group: 'create', id: 'create', label: t('palette.create', { title: raw }), icon: 'plus', run: () => fillComposer(raw) }]]);
  palItems = [];
  const nodes = [];
  for (const [name, list] of groups) {
    if (!list.length) continue;
    const box = document.createElement('div');
    box.setAttribute('role', 'group');
    if (name !== 'create') {
      const head = document.createElement('div');
      head.className = 'palette-group';
      head.id = `palette-g-${name}`;
      head.setAttribute('role', 'presentation');
      head.textContent = t(`palette.${name}`);
      box.setAttribute('aria-labelledby', head.id);
      box.append(head);
    }
    for (const item of list) {
      const opt = document.createElement('div');
      opt.className = 'palette-option';
      opt.id = `palette-o-${palItems.length}`;
      opt.setAttribute('role', 'option');
      opt.dataset.index = String(palItems.length);
      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = item.label;
      opt.append(svgIcon(item.icon), label);
      if (item.hint) {
        const hintEl = document.createElement(/^[\dN?]$/.test(item.hint) ? 'kbd' : 'span');
        hintEl.className = 'palette-hint';
        hintEl.textContent = item.hint;
        opt.append(hintEl);
      }
      palItems.push(item);
      box.append(opt);
    }
    nodes.push(box);
  }
  palList.replaceChildren(...nodes);
  setPaletteActive(0);
}

function setPaletteActive(index) {
  palActive = Math.max(0, Math.min(index, palItems.length - 1));
  for (const opt of $$('[role="option"]', palList)) {
    const on = Number(opt.dataset.index) === palActive;
    opt.setAttribute('aria-selected', String(on));
    if (on) opt.scrollIntoView({ block: 'nearest' });
  }
  if (palItems.length) palInput.setAttribute('aria-activedescendant', `palette-o-${palActive}`);
  else palInput.removeAttribute('aria-activedescendant');
}

function openPalette() {
  if (palette.open || helpDialog.open) return;
  closeMenu(false);
  setDataPanel(false);
  palInput.value = '';
  renderPalette();
  palette.showModal();
  palInput.focus();
}

function runPalette(index) {
  const item = palItems[index];
  if (!item) return;
  // окно закрывается раньше команды: фокус возвращается туда, где был, а команда может увести его дальше
  palette.close();
  item.run();
}

palInput.addEventListener('input', renderPalette);
palInput.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = palItems.length;
    if (n) setPaletteActive((palActive + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runPalette(palActive);
  }
});
palList.addEventListener('pointermove', (e) => {
  const opt = e.target.closest('[role="option"]');
  if (opt && Number(opt.dataset.index) !== palActive) setPaletteActive(Number(opt.dataset.index));
});
palList.addEventListener('click', (e) => {
  const opt = e.target.closest('[role="option"]');
  if (opt) runPalette(Number(opt.dataset.index));
});
// клик мимо окна закрывает его
palette.addEventListener('click', (e) => {
  if (e.target === palette) palette.close();
});

// Переход к задаче из команд: открытая в «Все», сделанная в «Готово», фокус на её кружок.
function jumpToTask(id) {
  const todo = todos.find((x) => x.id === id);
  if (!todo) return;
  // задача видна в текущем разделе: остаёмся в нём
  const here = !query && inView(todo, view, todayKey(), dayKeyOf);
  const target = here ? view : todo.done ? 'done' : 'all';
  pendingTask = id;
  if (view === target && !query) focusTask();
  else if (view === target) setQuery('');
  else location.hash = `#/${target}`;
}

function focusTask() {
  const id = pendingTask;
  pendingTask = null;
  const row = id && listWrap.querySelector(`.todo[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  $('.todo-check', row).focus({ preventScroll: true });
}

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
  // Ctrl+K (⌘K): команды. Работает и из поля ввода; простые J/K остаются переходом по задачам.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
    e.preventDefault();
    if (palette.open) palette.close();
    else openPalette();
    return;
  }
  if (palette.open) return;
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
    location.hash = `#/${NAV[Number(digit[1]) - 1]}`;
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

  if (!row || row.classList.contains('is-editing') || target.closest('.todo-details')) return;

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
    // снимок для «Вернуть» сделан до чужой правки и стёр бы её
    dropUndo();
    render();
    if (editingId) syncEditor(todos.find((todo) => todo.id === editingId));
  } else if (e.key === SETTINGS_KEY) {
    const next = loadSettings();
    Object.assign(settings, next, { lang: next.lang ?? settings.lang });
    applyTheme();
    applyLanguage();
    render();
  }
});

// Вкладку оставили открытой на ночь или вернулись к ней вечером: «Сегодня»
// становится завтрашним днём, меняются приветствие и вечерняя кнопка.
function refreshDay() {
  if (daySlot() === renderedSlot || editingId) return;
  if (todayKey() !== renderedDay) {
    planAgainOpen = false;
    planExpanded = false;
  }
  setBrandDate();
  quietly(() => render());
}

setInterval(refreshDay, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDay();
});
window.addEventListener('focus', refreshDay);

storageWarning.hidden = storageAvailable();
$('#storage-corrupt').hidden = !loaded.corrupt;
if (loaded.corrupt && !loaded.backedUp) {
  $('#corrupt-copied').hidden = true;
  $('#corrupt-nocopy').hidden = false;
  $('#corrupt-download').hidden = false;
}

// Испорченную запись не на что скопировать: даём её скачать, а пока не скачали, не затираем.
$('#corrupt-download').addEventListener('click', () => {
  download(loaded.raw, `tasks-damaged-${todayKey()}.json`);
  heldRaw = false;
  $('#storage-corrupt').hidden = true;
  persist();
  dataBtn.focus();
});
applyTheme();
applyLanguage();
quietly(() => render());

// На компьютере сразу можно печатать задачу; на телефоне клавиатуру сами не открываем.
// Ярлык «Новая задача» с иконки приложения (?new=1) ставит курсор в поле и на телефоне.
const launched = launchAction(location.href);
if (launched.action === 'new') {
  history.replaceState(null, '', launched.cleanHref);
  input.focus();
} else if (finePointer() && !todos.length && document.activeElement === document.body) input.focus();

// Работа без интернета: страница и скрипты сохраняются после первого визита.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
