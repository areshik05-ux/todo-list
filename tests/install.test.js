import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstall, isStandalone, launchAction } from '../js/install.js';

function fakeWindow({ standalone = false } = {}) {
  const handlers = {};
  return {
    matchMedia: () => ({ matches: standalone }),
    navigator: {},
    addEventListener: (type, fn) => { handlers[type] = fn; },
    fire: (type, event = {}) => handlers[type]?.(event),
  };
}

function promptEvent(outcome) {
  const ev = { prevented: false, prompted: false };
  ev.preventDefault = () => { ev.prevented = true; };
  ev.prompt = async () => { ev.prompted = true; };
  ev.userChoice = Promise.resolve({ outcome });
  return ev;
}

test('без события браузера установить нельзя', async () => {
  const inst = createInstall(fakeWindow());
  assert.equal(inst.canInstall(), false);
  assert.equal(await inst.install(), 'unavailable');
});

test('событие браузера: свой пункт вместо баннера, установка принята', async () => {
  const win = fakeWindow();
  const inst = createInstall(win);
  const seen = [];
  inst.onChange((can) => seen.push(can));
  const ev = promptEvent('accepted');
  win.fire('beforeinstallprompt', ev);
  assert.equal(ev.prevented, true);
  assert.equal(inst.canInstall(), true);
  assert.equal(await inst.install(), 'accepted');
  assert.equal(ev.prompted, true);
  assert.equal(inst.canInstall(), false, 'событие одноразовое');
  assert.deepEqual(seen, [true, false]);
  win.fire('appinstalled');
  assert.equal(inst.isInstalled(), true);
});

test('отказ: пункт прячется до следующего события', async () => {
  const win = fakeWindow();
  const inst = createInstall(win);
  win.fire('beforeinstallprompt', promptEvent('dismissed'));
  assert.equal(await inst.install(), 'dismissed');
  assert.equal(inst.canInstall(), false);
  win.fire('beforeinstallprompt', promptEvent('accepted'));
  assert.equal(inst.canInstall(), true);
});

test('уже открыто как приложение: пункт не нужен', () => {
  const win = fakeWindow({ standalone: true });
  assert.equal(isStandalone(win), true);
  const inst = createInstall(win);
  win.fire('beforeinstallprompt', promptEvent('accepted'));
  assert.equal(inst.canInstall(), false);
  assert.equal(isStandalone(undefined), false);
});

test('отписка от изменений', () => {
  const win = fakeWindow();
  const inst = createInstall(win);
  let calls = 0;
  const off = inst.onChange(() => { calls += 1; });
  off();
  win.fire('beforeinstallprompt', promptEvent('accepted'));
  assert.equal(calls, 0);
});

test('ярлык «Новая задача» на иконке', () => {
  assert.deepEqual(launchAction('https://x.app/?new=1#/today'), { action: 'new', cleanHref: 'https://x.app/#/today' });
  assert.deepEqual(launchAction('https://x.app/?a=2&new#/all'), { action: 'new', cleanHref: 'https://x.app/?a=2#/all' });
  assert.deepEqual(launchAction('https://x.app/#/today'), { action: null, cleanHref: 'https://x.app/#/today' });
  assert.deepEqual(launchAction('не адрес'), { action: null, cleanHref: 'не адрес' });
});
