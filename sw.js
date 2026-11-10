// Работа без интернета. Сначала сеть (чтобы после выкладки сразу видеть новую
// версию), а если сети нет, то последняя сохранённая копия. Задачи лежат
// в localStorage, им сеть не нужна вовсе.
const CACHE = 'todo-v3-1';
const SHELL = [
  './', 'index.html', 'css/style.css', 'favicon.svg', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/boot.js', 'js/app.js', 'js/todos.js', 'js/parse.js', 'js/dates.js', 'js/repeat.js',
  'js/i18n.js', 'js/storage.js', 'js/samples.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request, { ignoreSearch: true })
      .then((hit) => hit ?? (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
