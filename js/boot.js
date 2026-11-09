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
  if (settings.lang === 'en' || settings.lang === 'ru') root.lang = settings.lang;
}());
