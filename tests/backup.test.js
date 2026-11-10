import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupNudge, markBackup, readLastBackup, daysSince, requestPersist, LAST_BACKUP_KEY } from '../js/backup.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 11, 12);
const task = (ageDays, extra = {}) => ({ title: 't', createdAt: NOW - ageDays * DAY, ...extra });

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

test('мало задач: не напоминаем', () => {
  assert.equal(backupNudge([task(30), task(30)], { now: NOW }), null);
  assert.equal(backupNudge([], { now: NOW }), null);
  assert.equal(backupNudge(null, { now: NOW }), null);
});

test('примеры с первого визита не считаются', () => {
  const samples = [task(30, { sample: 's1' }), task(30, { sample: 's2' }), task(30, { sample: 's3' })];
  assert.equal(backupNudge(samples, { now: NOW }), null);
});

test('копии не было: напоминаем, когда первой задаче 14 дней', () => {
  assert.equal(backupNudge([task(13), task(1), task(0)], { now: NOW }), null);
  assert.equal(backupNudge([task(14), task(1), task(0)], { now: NOW }), 'never');
});

test('старая копия: напоминаем через 14 дней после неё', () => {
  const list = [task(60), task(30), task(1)];
  assert.equal(backupNudge(list, { now: NOW, lastAt: NOW - 3 * DAY }), null);
  assert.equal(backupNudge(list, { now: NOW, lastAt: NOW - 14 * DAY }), 'old');
});

test('отметка о копии сохраняется и читается', () => {
  const s = memoryStorage();
  assert.equal(readLastBackup(s), null);
  assert.equal(markBackup(s, NOW), true);
  assert.equal(s.getItem(LAST_BACKUP_KEY), String(NOW));
  assert.equal(readLastBackup(s), NOW);
  s.setItem(LAST_BACKUP_KEY, 'мусор');
  assert.equal(readLastBackup(s), null);
});

test('хранилище недоступно: без исключений', () => {
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(readLastBackup(broken), null);
  assert.equal(markBackup(broken, NOW), false);
});

test('дни с последней копии', () => {
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince(NOW - 20 * DAY - 5, NOW), 20);
  assert.equal(daysSince(NOW + DAY, NOW), 0);
});

test('persist: уже защищено, согласие, отказ, нет API, ошибка', async () => {
  assert.equal(await requestPersist({ storage: { persisted: async () => true, persist: async () => false } }), true);
  assert.equal(await requestPersist({ storage: { persisted: async () => false, persist: async () => true } }), true);
  assert.equal(await requestPersist({ storage: { persisted: async () => false, persist: async () => false } }), false);
  assert.equal(await requestPersist({}), false);
  assert.equal(await requestPersist(undefined), false);
  assert.equal(await requestPersist({ storage: { persist: async () => { throw new Error('x'); } } }), false);
});
