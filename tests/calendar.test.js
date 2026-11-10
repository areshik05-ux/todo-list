import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toICS, icsFileName, escapeText, foldLine, repeatRule, eventUid } from '../js/calendar.js';

const NOW = Date.UTC(2026, 10, 11, 4, 0, 0);
const base = { id: 'a1', title: 'Позвонить в банк', due: '2026-11-12', priority: 0, tags: [], notes: '', steps: [], repeat: null, repeatDay: null };

const unfold = (ics) => ics.replace(/\r\n /g, '');

test('нет срока: файла нет', () => {
  assert.equal(toICS({ ...base, due: null }, { now: NOW }), null);
  assert.equal(toICS(null), null);
  assert.equal(toICS({ ...base, due: '12.11.2026' }), null);
});

test('событие на весь день с напоминанием в 9:00', () => {
  const ics = toICS(base, { now: NOW });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /\r\nDTSTART;VALUE=DATE:20261112\r\n/);
  assert.match(ics, /\r\nDTEND;VALUE=DATE:20261113\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261111T040000Z\r\n/);
  assert.match(ics, /\r\nUID:a1@arina-todo-list\r\n/);
  assert.match(ics, /\r\nSUMMARY:Позвонить в банк\r\n/);
  assert.match(ics, /\r\nTRIGGER;RELATED=START:PT9H\r\n/);
  assert.doesNotMatch(ics, /RRULE|DESCRIPTION:[^\r]*\r\nRRULE/);
  assert.ok(!/[^\r]\n/.test(ics), 'все переводы строк CRLF');
});

test('конец месяца и года переходит правильно', () => {
  assert.match(toICS({ ...base, due: '2026-12-31' }, { now: NOW }), /DTEND;VALUE=DATE:20270101/);
  assert.match(toICS({ ...base, due: '2028-02-28' }, { now: NOW }), /DTEND;VALUE=DATE:20280229/);
});

test('повторы переводятся в RRULE', () => {
  assert.equal(repeatRule('day', null, '2026-11-12'), 'FREQ=DAILY');
  assert.equal(repeatRule('weekday', null, '2026-11-12'), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.equal(repeatRule('week', 5, '2026-11-12'), 'FREQ=WEEKLY;BYDAY=FR');
  assert.equal(repeatRule('week', null, '2026-11-12'), 'FREQ=WEEKLY;BYDAY=TH'); // 12.11.2026 четверг
  assert.equal(repeatRule('month', 31, '2026-11-30'), 'FREQ=MONTHLY;BYMONTHDAY=-1');
  assert.equal(repeatRule('month', 30, '2026-11-30'), 'FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1');
  assert.equal(repeatRule('month', 29, '2026-11-29'), 'FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1');
  assert.equal(repeatRule('month', 28, '2026-11-28'), 'FREQ=MONTHLY;BYMONTHDAY=28');
  assert.equal(repeatRule('month', null, '2026-11-05'), 'FREQ=MONTHLY;BYMONTHDAY=5');
  assert.equal(repeatRule('year', null, '2028-02-29'), 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1');
  assert.equal(repeatRule('year', null, '2026-11-12'), 'FREQ=YEARLY');
  assert.equal(repeatRule(null, null, '2026-11-12'), null);
  assert.match(toICS({ ...base, repeat: 'week', repeatDay: 1 }, { now: NOW }), /\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\n/);
});

test('заметки и шаги в описании, спецсимволы экранированы', () => {
  const ics = unfold(toICS({
    ...base, title: 'Купить: хлеб, молоко; сыр', notes: 'Строка 1\nстрока 2 \\ слеш',
    steps: [{ title: 'Сделать список', done: true }, { title: 'Сходить', done: false }],
  }, { now: NOW }));
  assert.match(ics, /SUMMARY:Купить: хлеб\\, молоко\\; сыр\r\n/);
  assert.match(ics, /DESCRIPTION:Строка 1\\nстрока 2 \\\\ слеш\\n\\nШаги:\\n\[x\] Сделать список\\n\[ \] Сходить\r\n/);
  const en = unfold(toICS({ ...base, steps: [{ title: 'A', done: false }] }, { now: NOW, lang: 'en' }));
  assert.match(en, /DESCRIPTION:Steps:\\n\[ \] A\r\n/);
});

test('P1 отмечается приоритетом, напоминание можно выключить', () => {
  assert.match(toICS({ ...base, priority: 1 }, { now: NOW }), /\r\nPRIORITY:1\r\n/);
  assert.doesNotMatch(toICS({ ...base, priority: 2 }, { now: NOW }), /PRIORITY/);
  assert.doesNotMatch(toICS(base, { now: NOW, alarm: false }), /VALARM/);
});

test('длинные строки складываются по 75 байт и не рвут буквы', () => {
  const title = 'Очень длинное название задачи на русском языке, чтобы строка точно вышла за предел 🙂 конец';
  const ics = toICS({ ...base, title }, { now: NOW });
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) assert.ok(enc.encode(line).length <= 75, `строка ${enc.encode(line).length} байт`);
  assert.ok(unfold(ics).includes(`SUMMARY:${escapeText(title)}`));
  assert.equal(foldLine('короткая'), 'короткая');
});

test('имя файла из названия', () => {
  assert.equal(icsFileName({ title: 'Позвонить в банк!' }), 'Позвонить-в-банк.ics');
  assert.equal(icsFileName({ title: '../../etc/passwd' }), 'etc-passwd.ics');
  assert.equal(icsFileName({ title: '!!!' }), 'task.ics');
  assert.ok(icsFileName({ title: 'а'.repeat(100) }).length <= 44);
});

test('UID серии не меняется от раза к разу, у обычной задачи это id', () => {
  const first = { ...base, id: 'x1', repeat: 'month', repeatDay: 31, due: '2026-11-30' };
  const next = { ...first, id: 'x2', due: '2026-12-31' };
  assert.equal(eventUid(first), eventUid(next));
  assert.match(eventUid(first), /^series-[0-9a-f]{8}$/);
  assert.notEqual(eventUid(first), eventUid({ ...first, title: 'Другое' }));
  assert.equal(eventUid(base), 'a1');
  assert.match(toICS(next, { now: NOW }), new RegExp(`UID:${eventUid(first)}@arina-todo-list`));
  assert.match(toICS(base, { now: NOW, lang: 'en' }), /PRODID:-\/\/arina-todo-list\/\/Tasks\/\/EN/);
});
