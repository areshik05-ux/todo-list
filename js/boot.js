// Обычный (не модульный) скрипт в <head>: ставит тему и язык до первой
// отрисовки, чтобы страница не мигала светлым у тех, кто выбрал тёмную.
(function () {
  var settings = {};
  try {
    settings = JSON.parse(localStorage.getItem('todo-list:settings') || '{}') || {};
  } catch (e) {
    settings = {};
  }
  var root = document.documentElement;
  // тема выбрана кнопкой или, пока не выбрана, как в системе
  var theme = settings.theme === 'dark' || settings.theme === 'light' ? settings.theme
    : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.dataset.theme = theme;
  // цвет верхней полосы браузера на телефоне = --surface темы (css/theme.css)
  var BAR = { light: '#ffffff', dark: '#151921' };
  var meta = document.querySelector('meta[name="theme-color"]');
  function syncBar() {
    var color = BAR[root.dataset.theme] || BAR.light;
    if (meta && meta.content !== color) meta.content = color;
  }
  syncBar();
  // тема переключается кнопкой в app.js: полоса меняется вслед за data-theme
  if (window.MutationObserver) {
    new MutationObserver(syncBar).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }
  // язык как в i18n.js detectLang: русский для ru/be/uk/kk, иначе английский
  var lang = settings.lang;
  if (lang !== 'ru' && lang !== 'en') {
    lang = 'en';
    var list = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < list.length; i += 1) {
      var base = String(list[i]).toLowerCase().split('-')[0];
      if (base === 'ru' || base === 'be' || base === 'uk' || base === 'kk') { lang = 'ru'; break; }
      if (base === 'en') break;
    }
  }
  root.lang = lang;
  // раздел из адреса до загрузки app.js: «Сегодня» сразу раскладывается в итоговую сетку,
  // и шапка дня не сдвигает поле ввода, когда скрипт дорисует её (CLS)
  var hash = location.hash;
  root.dataset.boot = !hash || hash === '#/' || hash === '#/today' ? 'today' : 'other';
  // список сохранён и пуст: подсказка под полем и кольцо сразу в пустом виде (CLS на телефоне).
  // Первый визит (записи нет) не пустой: app.js покажет примеры задач.
  try {
    var raw = localStorage.getItem('todo-list:v2');
    var stored = raw === null ? null : JSON.parse(raw);
    if (stored && stored.todos && stored.todos.length === 0) root.dataset.empty = '';
    // вечер (с 18:00, как EVENING_HOUR в app.js) и на сегодня есть открытые задачи:
    // строка «Перенести оставшиеся на завтра» появится, место под неё держим сразу
    var now = new Date();
    // первый визит: примеры задач (samples.js) включают задачи на сегодня
    var first = raw === null && localStorage.getItem('todo-list:v1') === null;
    if (now.getHours() >= 18 && first) root.dataset.evening = '';
    if (now.getHours() >= 18 && stored && stored.todos && stored.todos.length) {
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      var today = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
      for (var k = 0; k < stored.todos.length; k += 1) {
        var item = stored.todos[k];
        if (item && !item.done && typeof item.due === 'string' && item.due <= today) { root.dataset.evening = ''; break; }
      }
    }
  } catch (e) {
    // испорченные данные разберёт app.js
  }
  // разметка написана по-русски: английскому читателю прячем её до перевода
  if (lang === 'en') root.classList.add('i18n-pending');
}());
