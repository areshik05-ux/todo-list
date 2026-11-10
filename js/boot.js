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
  root.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta && settings.theme === 'dark') meta.content = '#111416';
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
  // разметка написана по-русски: английскому читателю прячем её до перевода
  if (lang === 'en') root.classList.add('i18n-pending');
}());
