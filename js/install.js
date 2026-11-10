// Установка как приложение. Список уже работает без интернета, но об этом никто не знает:
// браузер присылает beforeinstallprompt, мы прячем его баннер и показываем свой пункт меню,
// который появляется только когда установка правда доступна.
// Плюс ярлыки на иконке (manifest "shortcuts"): ./?new=1#/today открывает список с фокусом в поле ввода.
// win передаётся снаружи, чтобы проверить без браузера (tests/install.test.js).

export function isStandalone(win = globalThis.window) {
  try {
    return Boolean(win?.matchMedia?.('(display-mode: standalone)').matches || win?.navigator?.standalone);
  } catch {
    return false;
  }
}

export function createInstall(win = globalThis.window) {
  let deferred = null;
  let installed = isStandalone(win);
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(api.canInstall()));

  win?.addEventListener?.('beforeinstallprompt', (event) => {
    event.preventDefault(); // без своего баннера браузера: предлагаем из меню, когда человек сам захочет
    deferred = event;
    notify();
  });
  win?.addEventListener?.('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });

  const api = {
    canInstall: () => Boolean(deferred) && !installed,
    isInstalled: () => installed,
    // 'accepted' | 'dismissed' | 'unavailable'. Событие одноразовое: после ответа пункт прячется.
    async install() {
      if (!deferred) return 'unavailable';
      const event = deferred;
      deferred = null;
      try {
        await event.prompt();
        const choice = await event.userChoice;
        return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch {
        return 'dismissed';
      } finally {
        notify();
      }
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}

// Что попросили ярлыком на иконке: 'new' (сразу писать задачу) или null.
// Возвращает и адрес без параметра, чтобы app.js убрал его через history.replaceState
// и повторная загрузка страницы не ставила фокус снова.
export function launchAction(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return { action: null, cleanHref: href };
  }
  if (!url.searchParams.has('new')) return { action: null, cleanHref: href };
  url.searchParams.delete('new');
  return { action: 'new', cleanHref: url.toString() };
}
