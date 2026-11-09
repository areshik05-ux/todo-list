// Тексты интерфейса на двух языках. Склонения через Intl.PluralRules:
// у русского три формы (1 задача, 2 задачи, 5 задач), у английского две.

import { daysBetween, fromKey } from './dates.js';

export const LANGS = ['ru', 'en'];

const ru = {
  'meta.title': 'Задачи',
  'meta.description': 'Список задач со сроками, приоритетами и метками. Всё хранится в браузере.',
  'app.name': 'Задачи',
  'nav.label': 'Разделы',
  'view.all': 'Все',
  'view.today': 'Сегодня',
  'view.upcoming': 'Планы',
  'view.done': 'Готово',
  'view.search': 'Поиск',
  'add.label': 'Новая задача',
  'add.placeholder': 'Добавить задачу',
  'add.submit': 'Добавить',
  'add.hint': 'Понимаю «завтра», «в пятницу», «25.11», приоритет !1, !2, !3 и #метки',
  'add.hintToday': 'Задача без срока получит сегодняшнюю дату',
  'add.hintUpcoming': 'Задача без срока получит завтрашнюю дату',
  'chip.ignore': 'Не распознавать «{text}»',
  'search.label': 'Поиск по задачам',
  'search.placeholder': 'Найти задачу',
  'search.clear': 'Очистить поиск',
  'sort.label': 'Порядок',
  'sort.manual': 'Свой порядок',
  'sort.due': 'По сроку',
  'sort.priority': 'По приоритету',
  'progress.label': 'Сегодня сделано {done} из {total}',
  'progress.all': 'Всё на сегодня сделано',
  'tasks': { one: '{n} задача', few: '{n} задачи', many: '{n} задач', other: '{n} задачи' },
  'found': { one: 'Нашлась {n} задача', few: 'Нашлось {n} задачи', many: 'Нашлось {n} задач', other: 'Нашлось {n} задачи' },
  'count.overdue': 'просрочено: {n}',
  'group.overdue': 'Просрочено',
  'empty.first': 'Пока пусто. Напишите задачу, например «Позвонить маме завтра !2».',
  'empty.all': 'Открытых задач нет. Можно выдохнуть.',
  'empty.today': 'На сегодня всё. Можно отдохнуть или взять что-то из «Планов».',
  'empty.upcoming': 'Ничего не запланировано. Добавьте дату словом: «завтра», «в пятницу», «25.11».',
  'empty.done': 'Здесь будут сделанные задачи. Отметьте первую кружком слева.',
  'empty.search': 'По запросу «{q}» ничего. Проверьте раскладку или уберите часть слов.',
  'task.edit': 'Изменить',
  'task.editLabel': 'Изменить: {title}',
  'task.delete': 'Удалить',
  'task.deleteLabel': 'Удалить: {title}',
  'task.move': 'Переместить: {title}. Перетащите или нажмите Alt и стрелку вверх или вниз',
  'task.moved': 'Перемещено: {pos} из {total}',
  'task.overdue': 'просрочено',
  'task.priority': 'Приоритет {n}',
  'task.tagFilter': 'Показать задачи с меткой {tag}',
  'editor.title': 'Название',
  'editor.due': 'Срок',
  'editor.priority': 'Приоритет',
  'editor.p0': 'Нет',
  'editor.tags': 'Метки',
  'editor.tagsHint': 'через пробел или запятую',
  'editor.save': 'Сохранить',
  'editor.cancel': 'Отмена',
  'clearDone': 'Убрать выполненные',
  'toast.deleted': 'Удалено: «{title}»',
  'toast.completed': 'Готово: «{title}»',
  'toast.added': 'Добавлено: «{title}»',
  'toast.addedTo': 'Добавлено в «{view}»: «{title}»',
  'toast.cleared': { one: 'Убрана {n} задача', few: 'Убрано {n} задачи', many: 'Убрано {n} задач', other: 'Убрано {n} задачи' },
  'toast.imported': { one: 'Загружена {n} задача', few: 'Загружено {n} задачи', many: 'Загружено {n} задач', other: 'Загружено {n} задачи' },
  'toast.importFailed': 'В файле нет задач, которые можно загрузить.',
  'toast.undo': 'Вернуть',
  'toast.close': 'Закрыть',
  'menu.export': 'Скачать задачи (JSON)',
  'menu.import': 'Загрузить из файла',
  'menu.shortcuts': 'Горячие клавиши',
  'theme.dark': 'Тёмная тема',
  'data.label': 'Скачать или загрузить задачи',
  'lang.label': 'Язык',
  'help.title': 'Горячие клавиши',
  'help.close': 'Закрыть',
  'help.new': 'Новая задача',
  'help.search': 'Поиск',
  'help.views': 'Разделы: Все, Сегодня, Планы, Готово',
  'help.nav': 'Следующая и предыдущая задача (или стрелки)',
  'help.toggle': 'Отметить выполненной',
  'help.move': 'Переместить задачу в своём порядке',
  'help.edit': 'Изменить задачу (фокус на задаче)',
  'help.delete': 'Удалить задачу (фокус на задаче)',
  'help.undo': 'Отменить последнее действие',
  'help.help': 'Этот список',
  'help.esc': 'Закрыть окно, выйти из поля',
  'storage.warning': 'Браузер не даёт сохранить задачи. После обновления страницы список пропадёт.',
  'date.today': 'Сегодня',
  'date.tomorrow': 'Завтра',
  'date.yesterday': 'Вчера',
  'date.daysAgo': { one: '{n} день назад', few: '{n} дня назад', many: '{n} дней назад', other: '{n} дня назад' },
  'footer.local': 'Задачи хранятся только в этом браузере.',
};

const en = {
  'meta.title': 'Tasks',
  'meta.description': 'A to-do list with due dates, priorities and tags. Everything stays in your browser.',
  'app.name': 'Tasks',
  'nav.label': 'Views',
  'view.all': 'All',
  'view.today': 'Today',
  'view.upcoming': 'Upcoming',
  'view.done': 'Done',
  'view.search': 'Search',
  'add.label': 'New task',
  'add.placeholder': 'Add a task',
  'add.submit': 'Add',
  'add.hint': 'I understand “tomorrow”, “friday”, “nov 25”, priority !1, !2, !3 and #tags',
  'add.hintToday': 'A task without a date will be due today',
  'add.hintUpcoming': 'A task without a date will be due tomorrow',
  'chip.ignore': 'Don’t recognize “{text}”',
  'search.label': 'Search tasks',
  'search.placeholder': 'Search tasks',
  'search.clear': 'Clear search',
  'sort.label': 'Order',
  'sort.manual': 'My order',
  'sort.due': 'By due date',
  'sort.priority': 'By priority',
  'progress.label': '{done} of {total} done today',
  'progress.all': 'All done for today',
  'tasks': { one: '{n} task', other: '{n} tasks' },
  'found': { one: '{n} task found', other: '{n} tasks found' },
  'count.overdue': 'overdue: {n}',
  'group.overdue': 'Overdue',
  'empty.first': 'Nothing here yet. Type a task, like “Call mom tomorrow !2”.',
  'empty.all': 'No open tasks. Time to breathe out.',
  'empty.today': 'Today is clear. Take a break or pull something from Upcoming.',
  'empty.upcoming': 'Nothing planned. Add a date in words: “tomorrow”, “friday”, “nov 25”.',
  'empty.done': 'Finished tasks land here. Tick the circle next to one.',
  'empty.search': 'No match for “{q}”. Check the spelling or drop a word.',
  'task.edit': 'Edit',
  'task.editLabel': 'Edit: {title}',
  'task.delete': 'Delete',
  'task.deleteLabel': 'Delete: {title}',
  'task.move': 'Move: {title}. Drag, or press Alt and the up or down arrow',
  'task.moved': 'Moved: {pos} of {total}',
  'task.overdue': 'overdue',
  'task.priority': 'Priority {n}',
  'task.tagFilter': 'Show tasks tagged {tag}',
  'editor.title': 'Title',
  'editor.due': 'Due',
  'editor.priority': 'Priority',
  'editor.p0': 'None',
  'editor.tags': 'Tags',
  'editor.tagsHint': 'separated by spaces or commas',
  'editor.save': 'Save',
  'editor.cancel': 'Cancel',
  'clearDone': 'Clear completed',
  'toast.deleted': 'Deleted “{title}”',
  'toast.completed': 'Done: “{title}”',
  'toast.added': 'Added “{title}”',
  'toast.addedTo': 'Added to {view}: “{title}”',
  'toast.cleared': { one: '{n} task cleared', other: '{n} tasks cleared' },
  'toast.imported': { one: '{n} task loaded', other: '{n} tasks loaded' },
  'toast.importFailed': 'No tasks in this file could be loaded.',
  'toast.undo': 'Undo',
  'toast.close': 'Close',
  'menu.export': 'Download tasks (JSON)',
  'menu.import': 'Load from file',
  'menu.shortcuts': 'Keyboard shortcuts',
  'theme.dark': 'Dark theme',
  'data.label': 'Download or load tasks',
  'lang.label': 'Language',
  'help.title': 'Keyboard shortcuts',
  'help.close': 'Close',
  'help.new': 'New task',
  'help.search': 'Search',
  'help.views': 'Views: All, Today, Upcoming, Done',
  'help.nav': 'Next and previous task (or arrows)',
  'help.toggle': 'Mark as done',
  'help.move': 'Move a task in your order',
  'help.edit': 'Edit task (when focused)',
  'help.delete': 'Delete task (when focused)',
  'help.undo': 'Undo the last action',
  'help.help': 'This list',
  'help.esc': 'Close dialog, leave a field',
  'storage.warning': 'Your browser blocks saving. The list will be lost after a reload.',
  'date.today': 'Today',
  'date.tomorrow': 'Tomorrow',
  'date.yesterday': 'Yesterday',
  'date.daysAgo': { one: '{n} day ago', other: '{n} days ago' },
  'footer.local': 'Tasks are stored only in this browser.',
};

export const DICTS = { ru, en };

export function detectLang(languages = globalThis.navigator?.languages ?? []) {
  for (const tag of languages) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (base === 'ru' || base === 'be' || base === 'uk' || base === 'kk') return 'ru';
    if (base === 'en') return 'en';
  }
  return 'en';
}

const fill = (text, params) => text.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));

export function createI18n(lang) {
  const dict = DICTS[lang] ?? DICTS.en;
  const rules = new Intl.PluralRules(lang);
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';

  function t(key, params = {}) {
    let entry = dict[key] ?? DICTS.en[key] ?? key;
    if (typeof entry === 'object') {
      entry = entry[rules.select(params.n ?? 0)] ?? entry.other;
    }
    return fill(entry, params);
  }

  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  const weekdayShort = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const trimDot = (s) => s.replace(/\.$/, '');
  // год пишем, только если он не текущий: «3 янв 2027»
  const withYear = (key, today, text) => (key.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${key.slice(0, 4)}`);

  // Короткая подпись срока в строке задачи: «Сегодня», «Завтра», «Пятница», «25 нояб.»
  function relativeDate(key, today) {
    const date = fromKey(key);
    if (!date) return '';
    const diff = daysBetween(today, key);
    if (diff === 0) return t('date.today');
    if (diff === 1) return t('date.tomorrow');
    if (diff === -1) return t('date.yesterday');
    if (diff < -1 && diff > -7) return t('date.daysAgo', { n: -diff });
    if (diff > 1 && diff < 7) return cap(weekday.format(date));
    return withYear(key, today, trimDot(dayMonth.format(date)));
  }

  // Заголовок группы в «Предстоящих»: «Завтра · чт, 12 нояб.»
  function groupDate(key, today) {
    const date = fromKey(key);
    const diff = daysBetween(today, key);
    const dm = trimDot(dayMonth.format(date));
    if (diff === 0 || diff === 1) return `${relativeDate(key, today)} · ${weekdayShort.format(date)}, ${dm}`;
    if (diff > 1 && diff < 7) return `${cap(weekday.format(date))} · ${dm}`;
    return `${cap(weekdayShort.format(date))}, ${withYear(key, today, dm)}`;
  }

  const longDate = (date) => cap(long.format(date));

  return { lang, locale, t, relativeDate, groupDate, longDate };
}
