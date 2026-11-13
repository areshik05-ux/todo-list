// Работа без интернета. Сначала сеть (чтобы после выкладки сразу видеть новую
// версию), а если сети нет или она молчит дольше 3 секунд, то последняя
// сохранённая копия. Задачи лежат в localStorage, им сеть не нужна вовсе.
const CACHE = 'todo-v4-6';
const NETWORK_WAIT_MS = 3000;
const SHELL = [
  './', 'index.html', 'css/theme.css', 'css/style.css', 'favicon.svg', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/boot.js', 'js/app.js', 'js/todos.js', 'js/parse.js', 'js/dates.js', 'js/repeat.js',
  'js/i18n.js', 'js/storage.js', 'js/samples.js', 'js/calendar.js', 'js/backup.js', 'js/install.js',
  'fonts/onest-latin-wght.woff2', 'fonts/onest-cyrillic-wght.woff2',
  'fonts/geologica-latin-wght.woff2', 'fonts/geologica-cyrillic-wght.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

const fromCache = (request) => caches.match(request, { ignoreSearch: true })
  .then((hit) => hit ?? (request.mode === 'navigate' ? caches.match('index.html') : undefined));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
  // медленная сеть: отдаём копию, если она есть, иначе ждём сеть дальше
  const slow = new Promise((resolve) => { setTimeout(resolve, NETWORK_WAIT_MS); })
    .then(() => fromCache(request))
    .then((hit) => hit ?? network);
  event.respondWith(Promise.race([network, slow])
    .catch(() => fromCache(request).then((hit) => hit ?? Response.error())));
});
