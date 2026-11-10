import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, splitTags, normalizeTags } from '../js/parse.js';

const TODAY = '2026-11-10'; // вторник
const p = (text) => parseQuickAdd(text, TODAY);

test('русский ввод: срок, приоритет и метка вырезаются из названия', () => {
  const r = p('Позвонить маме завтра !1 #семья');
  assert.deepEqual([r.title, r.due, r.priority, r.tags], ['Позвонить маме', '2026-11-11', 1, ['семья']]);
  assert.deepEqual(r.tokens.map((t) => t.type), ['date', 'priority', 'tag']);
});

test('английский ввод работает при любом языке интерфейса', () => {
  const r = p('Call the bank tomorrow p3 #errands');
  assert.deepEqual([r.title, r.due, r.priority, r.tags], ['Call the bank', '2026-11-11', 3, ['errands']]);
});

test('относительные сроки на двух языках', () => {
  const cases = {
    'врач сегодня': '2026-11-10',
    'врач послезавтра': '2026-11-12',
    'отчёт в пятницу': '2026-11-13',
    'отчёт во вторник': '2026-11-17',
    'отпуск через 3 дня': '2026-11-13',
    'отпуск через две недели': '2026-11-24',
    'отпуск через неделю': '2026-11-17',
    'report on friday': '2026-11-13',
    'trip in 2 weeks': '2026-11-24',
    'trip in 5 days': '2026-11-15',
    'dentist day after tomorrow': '2026-11-12',
    'party next week': '2026-11-17',
  };
  for (const [text, due] of Object.entries(cases)) assert.equal(p(text).due, due, text);
});

test('даты числом и словами, прошедшие переносятся на следующий год', () => {
  assert.equal(p('сдать 25.11').due, '2026-11-25');
  assert.equal(p('сдать 05.01').due, '2027-01-05');
  assert.equal(p('сдать 25/11/2027').due, '2027-11-25');
  assert.equal(p('встреча 25 ноября').due, '2026-11-25');
  assert.equal(p('встреча 3 марта').due, '2027-03-03');
  assert.equal(p('meeting nov 25').due, '2026-11-25');
  assert.equal(p('meeting 25 november').due, '2026-11-25');
  assert.equal(p('день рождения 31.02').due, null, 'несуществующая дата не срок');
});

test('цифры в обычном тексте не превращаются в дату', () => {
  for (const text of ['Купить 1.5 литра молока', 'Прочитать главу 3', 'Версия 2.0', 'Оплатить 100/200']) {
    const r = p(text);
    assert.equal(r.due, null, text);
    assert.equal(r.title, text);
  }
});

test('обычные слова не превращаются в срок', () => {
  assert.equal(p('Настроить среду разработки').due, null);
  assert.equal(p('Пятница: купить торт').due, null);
  assert.equal(p('I may 5 times').due, null);
  assert.equal(p('встреча 5 may').due, '2027-05-05');
});

test('слово внутри другого слова не считается сроком', () => {
  assert.equal(p('Посмотреть todayshow').due, null);
  assert.equal(p('Завтрак с Олей').due, null);
  assert.equal(p('Завтрак с Олей').title, 'Завтрак с Олей');
});

test('берётся первое упоминание срока, остальные остаются в тексте', () => {
  const r = p('Перенести завтра на пятницу');
  assert.equal(r.due, '2026-11-11');
  assert.equal(r.title, 'Перенести на пятницу');
});

test('метки: кириллица, дубли, лимит, решётка внутри слова', () => {
  assert.deepEqual(p('a #Работа #работа #дом').tags, ['Работа', 'дом']);
  assert.equal(p('a #Работа #работа').tokens.length, 1);
  assert.deepEqual(p('Книга по C# #dev').tags, ['dev']);
  assert.equal(p('Книга по C# #dev').title, 'Книга по C#');
  assert.equal(p('x #1 #2 #3 #4 #5 #6').tags.length, 5);
});

test('строка из одних служебных слов остаётся названием', () => {
  const r = p('завтра');
  assert.deepEqual([r.title, r.due, r.tokens.length], ['завтра', null, 0]);
});

test('HTML в тексте остаётся текстом', () => {
  assert.equal(p('<img src=x onerror=alert(1)>').title, '<img src=x onerror=alert(1)>');
});

test('поле меток в редакторе', () => {
  assert.deepEqual(splitTags('работа, дом #срочно  дом'), ['работа', 'дом', 'срочно']);
  assert.deepEqual(normalizeTags(['  ', '#', 'a b']), ['ab']);
  assert.deepEqual(splitTags(''), []);
});

test('крестик на чипе: слово остаётся в названии', () => {
  const r = parseQuickAdd('Фильм Послезавтра !2', TODAY, { ignore: ['Послезавтра'] });
  assert.deepEqual([r.title, r.due, r.priority], ['Фильм Послезавтра', null, 2]);
});

test('повтор в быстром вводе на двух языках', () => {
  const cases = {
    'Зарядка каждый день': ['Зарядка', 'day', TODAY],
    'Пить воду ежедневно': ['Пить воду', 'day', TODAY],
    'Отчёт по будням': ['Отчёт', 'weekday', TODAY],
    'Планёрка каждый понедельник': ['Планёрка', 'week', '2026-11-16'],
    'Созвон каждый вторник': ['Созвон', 'week', TODAY],
    'Уборка каждую субботу': ['Уборка', 'week', '2026-11-14'],
    'Аренда каждый месяц 25.11': ['Аренда', 'month', '2026-11-25'],
    'Water plants every monday': ['Water plants', 'week', '2026-11-16'],
    'Stretch every day': ['Stretch', 'day', TODAY],
    'Taxes every year': ['Taxes', 'year', TODAY],
  };
  for (const [text, [title, repeat, due]] of Object.entries(cases)) {
    const r = p(text);
    assert.deepEqual([r.title, r.repeat, r.due], [title, repeat, due], text);
  }
  assert.ok(p('Зарядка каждый день').tokens.some((t) => t.type === 'repeat'));
});

test('похожие слова не превращаются в повтор, крестик снимает повтор', () => {
  for (const text of ['Read the Daily Mail', 'Weekly report draft']) assert.equal(p(text).repeat, null, text);
  const r = parseQuickAdd('Йога каждый день', TODAY, { ignore: ['каждый день'] });
  assert.deepEqual([r.title, r.repeat, r.due], ['Йога каждый день', null, null]);
  assert.deepEqual([p('каждый день').title, p('каждый день').repeat], ['каждый день', null]);
});

test('«каждый день рождения» и «every weekday» не путаются с другими повторами', () => {
  assert.equal(p('Подарок на каждый день рождения').repeat, null);
  assert.equal(p('Report every weekday').repeat, 'weekday');
  assert.equal(p('Every day of the week').repeat, null);
});

test('«по понедельникам», «on mondays» и день недели повтора', () => {
  const a = p('Йога по понедельникам');
  assert.deepEqual([a.title, a.repeat, a.repeatDay, a.due], ['Йога', 'week', 1, '2026-11-16']);
  const b = p('Gym on fridays');
  assert.deepEqual([b.title, b.repeat, b.repeatDay], ['Gym', 'week', 5]);
  const c = p('Standup every monday tomorrow');
  assert.deepEqual([c.repeatDay, c.due], [1, '2026-11-11'], 'первый раз завтра, дальше по понедельникам');
  assert.equal(p('Отчёт каждую неделю').repeatDay, null, 'без дня: день возьмётся из срока');
});

test('«on» перед датой не остаётся в названии', () => {
  assert.deepEqual([p('Pay rent every month on 25.11').title, p('Pay rent every month on 25.11').due], ['Pay rent', '2026-11-25']);
  assert.equal(p('Party on nov 25').title, 'Party');
  assert.equal(p('Turn on 5 lamps').title, 'Turn on 5 lamps');
});

test('«к 25.11» и «до 25 ноября»: предлог уходит вместе со сроком', () => {
  assert.deepEqual([p('Отчёт к 25.11').title, p('Отчёт к 25.11').due], ['Отчёт', '2026-11-25']);
  assert.equal(p('Сдать до 25 ноября').title, 'Сдать');
  assert.equal(p('Сдать проект').title, 'Сдать проект');
});
