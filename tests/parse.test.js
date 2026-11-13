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
  assert.equal(p('x #a1 #a2 #a3 #a4 #a5 #a6').tags.length, 5);
});

test('метка без букв не метка: «Issue #42»', () => {
  const r = p('Issue #42 fix');
  assert.deepEqual([r.title, r.tags], ['Issue #42 fix', []]);
  assert.deepEqual(p('Ревью #2026_q4').tags, ['2026_q4']);
});

test('«на завтра», «на сегодня», «на 25 ноября», «на 25.11»: предлог уходит вместе со сроком', () => {
  const cases = {
    'Купить хлеб на завтра': ['Купить хлеб', '2026-11-11'],
    'Список дел на сегодня': ['Список дел', '2026-11-10'],
    'Билеты на 25 ноября': ['Билеты', '2026-11-25'],
    'Перенести встречу на 25.11': ['Перенести встречу', '2026-11-25'],
    'Встреча на пятницу': ['Встреча', '2026-11-13'],
    'Отпуск с 25.12 по 05.01': ['Отпуск с 25.12 по 05.01', '2026-12-25'],
  };
  for (const [text, [title, due]] of Object.entries(cases)) assert.deepEqual([p(text).title, p(text).due], [title, due], text);
  assert.equal(p('Отпуск с 25.12 по 05.01').tokens[0].text, 'с 25.12 по 05.01');
  const off = parseQuickAdd('Отпуск с 25.12 по 05.01', TODAY, { ignore: ['с 25.12 по 05.01'] });
  assert.deepEqual([off.title, off.due], ['Отпуск с 25.12 по 05.01', null], 'крестик на диапазоне снимает и даты внутри');
  assert.equal(p('Настроить среду разработки').due, null);
});

test('число с единицей не дата: «2.10 кг»', () => {
  for (const text of ['Купить 2.10 кг яблок', 'Сыр 0.10кг', 'Бензин 1.10 л', 'Pay 5.50 $']) {
    assert.deepEqual([p(text).due, p(text).title], [null, text], text);
  }
  assert.equal(p('Сдать 2.10').due, '2027-10-02');
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

test('«by 25.11» тоже срок', () => {
  assert.deepEqual([p('Pay rent by 25.11').title, p('Pay rent by 25.11').due], ['Pay rent', '2026-11-25']);
});

test('«к пятнице», «до пятницы», «в пт», «до завтра», "next fri"', () => {
  const cases = {
    'Отчёт к пятнице': ['Отчёт', '2026-11-13'],
    'Отчёт до пятницы': ['Отчёт', '2026-11-13'],
    'Созвон в пт': ['Созвон', '2026-11-13'],
    'Созвон во вт': ['Созвон', '2026-11-17'],
    'Отчёт до завтра': ['Отчёт', '2026-11-11'],
    'Report next fri': ['Report', '2026-11-13'],
    'Report by tomorrow': ['Report', '2026-11-11'],
  };
  for (const [text, [title, due]] of Object.entries(cases)) assert.deepEqual([p(text).title, p(text).due], [title, due], text);
  assert.equal(p('Mon cheri').due, null, 'сокращение без on/next не день');
  assert.equal(p('Купить пт-шку').due, null);
});

test('мелочи разбора: «к среде», "on sun", "by friday", точка после срока', () => {
  assert.equal(p('Готовиться к среде').due, null);
  assert.equal(p('Lie on sun lounger').due, null);
  assert.deepEqual([p('Pay by friday').title, p('Pay by friday').due], ['Pay', '2026-11-13']);
  assert.equal(p('Done by today').title, 'Done');
  assert.equal(p('Встреча завтра.').title, 'Встреча.');
});

test('год с «г.» не теряется, «г.» и «м.» после даты не единицы', () => {
  const cases = {
    'Сдать отчёт до 25.11.2027 г.': ['Сдать отчёт', '2027-11-25'],
    'Сдать отчёт до 25.11.2027': ['Сдать отчёт', '2027-11-25'],
    'Встреча 25.11 г. Москва': ['Встреча г. Москва', '2026-11-25'],
    'Ужин 25.11 м. Пушкинская': ['Ужин м. Пушкинская', '2026-11-25'],
    'Сдать 25 ноября 2027 г.': ['Сдать', '2027-11-25'],
    'Купить 2.10 кг яблок': ['Купить 2.10 кг яблок', null],
    'Купить 2.10 г соли': ['Купить 2.10 г соли', null],
  };
  for (const [text, [title, due]] of Object.entries(cases)) assert.deepEqual([p(text).title, p(text).due], [title, due], text);
});

test('дата документа после «от» не срок', () => {
  const r = p('Договор от 01.12.2026 г. подписать');
  assert.deepEqual([r.title, r.due], ['Договор от 01.12.2026 г. подписать', null]);
  assert.equal(p('Отчёт к 01.12').due, '2026-12-01');
});

test('неразрывный пробел из подсказки работает как обычный', () => {
  const r = p('Встреча в\u00A0пятницу каждый\u00A0понедельник');
  assert.deepEqual([r.title, r.due, r.repeat], ['Встреча', '2026-11-13', 'week']);
});

test('«г.», «м.», «ч.» после дробного числа это единицы, после даты с названием места нет', () => {
  // правило: число похоже на дробь (день до 12 без нуля впереди), а дальше не слово с заглавной
  for (const text of ['Купить 2.10 г. соли', 'Купить 1.05 м. кабеля', 'Отрезать 2.10 м. ткани', 'Прочитать гл. 1.10 ч.1']) {
    assert.deepEqual([p(text).title, p(text).due], [text, null], text);
  }
  assert.equal(p('Встреча 25.11 г. Москва').due, '2026-11-25');
  assert.equal(p('Ужин 05.12 м. Пушкинская').due, '2026-12-05');
  assert.equal(p('Встреча 2.10 г. Москва').due, '2027-10-02');
});

test('дата не берётся из середины числа с точками', () => {
  assert.deepEqual([p('IP 10.10.10.10').title, p('IP 10.10.10.10').due], ['IP 10.10.10.10', null]);
  assert.equal(p('Встреча 25.11/26.11').due, null);
  assert.equal(p('Версия 1.2.10').due, null);
});

test('«года», «от … по» и год двумя цифрами', () => {
  assert.deepEqual([p('Сдать 25.11.2026 года').title, p('Сдать 25.11.2026 года').due], ['Сдать', '2026-11-25']);
  assert.deepEqual([p('Курс от 01.12 по 05.12').title, p('Курс от 01.12 по 05.12').due], ['Курс от 01.12 по 05.12', '2026-12-01']);
  assert.deepEqual([p('Сдать до 25.11.26').title, p('Сдать до 25.11.26').due], ['Сдать', '2026-11-25']);
  assert.equal(p('Отпуск с 25.12.26 по 05.01.27').due, '2026-12-25');
});

test('судья, круг 5: «3.10 м.», «25.11 г.Москва», «на среду обитания»', () => {
  assert.equal(p('Пробежать 3.10 м.').due, null);
  assert.equal(p('Встреча 25.11 г.Москва').due, '2026-11-25');
  assert.equal(p('Влияние на среду обитания').due, null);
  assert.deepEqual([p('Встреча на пятницу #работа').title, p('Встреча на пятницу #работа').due], ['Встреча', '2026-11-13']);
  assert.equal(p('Купить 1.5 литра молока').due, null);
});

test('критик, круг 6: «на <день недели>» в середине фразы снова срок', () => {
  // 10.11.2026 вторник: пятница 13.11, понедельник 16.11, четверг 12.11, суббота 14.11, среда 11.11
  const cases = {
    'Созвон на пятницу в 10:00': ['Созвон в 10:00', '2026-11-13'],
    'Записаться на пятницу к врачу': ['Записаться к врачу', '2026-11-13'],
    'Отчёт на понедельник утром': ['Отчёт утром', '2026-11-16'],
    'Встреча на пт в 10': ['Встреча в 10', '2026-11-13'],
    'Дедлайн на четверг 18:00': ['Дедлайн 18:00', '2026-11-12'],
    'Купить на субботу молоко': ['Купить молоко', '2026-11-14'],
    'Встреча на пятницу — офис': ['Встреча — офис', '2026-11-13'],
    'Встреча на пятницу (офис)': ['Встреча (офис)', '2026-11-13'],
    'Встреча на среду в 10': ['Встреча в 10', '2026-11-11'],
    'Встреча на пятницу': ['Встреча', '2026-11-13'],
  };
  for (const [text, [title, due]] of Object.entries(cases)) assert.deepEqual([p(text).title, p(text).due], [title, due], text);
  const weekly = p('Встреча на пятницу каждую неделю');
  assert.deepEqual([weekly.title, weekly.due, weekly.repeat], ['Встреча', '2026-11-13', 'week']);
});

test('«среда» как окружение не срок, а «на среду» как день срок', () => {
  for (const text of ['Влияние на среду обитания', 'Изучить влияние на среду окружения', 'Настроить в среду разработки', 'Подготовить на среду исполнения']) {
    assert.deepEqual([p(text).title, p(text).due], [text, null], text);
  }
  assert.equal(p('Отчёт на среду обитания и пятницу').due, null);
  assert.equal(p('Отчёт на среду, обитания много').due, '2026-11-11');
});

test('короткий год в прошлом это номер версии, а не срок', () => {
  for (const text of ['Обновить до 2.12.21', 'Release 1.10.25', 'Версия 10.10.10', 'Тираж 12.12.12', 'Сдать 01.02.03', 'Сдать до 31.12.25', 'Версия 10.10.26']) {
    assert.deepEqual([p(text).title, p(text).due], [text, null], text);
  }
  // впереди, но не дальше 10 лет
  assert.deepEqual([p('Сдать до 25.11.26').title, p('Сдать до 25.11.26').due], ['Сдать', '2026-11-25']);
  assert.equal(p('Продлить паспорт 01.03.30').due, '2030-03-01');
  assert.equal(p('Версия 1.10.99').due, null);
  // полный год пишут осознанно: берём как есть
  assert.equal(p('Сдать до 31.12.2025').due, '2025-12-31');
});

test('диапазон, который уже идёт, получает срок по концу, а не через год', () => {
  const on = (text, today) => parseQuickAdd(text, today);
  // 13.11: начало 10.11 прошло, конец 20.11 впереди: срок 20.11, диапазон в названии
  const promo = on('Акция от 10.11 по 20.11', '2026-11-13');
  assert.deepEqual([promo.title, promo.due], ['Акция от 10.11 по 20.11', '2026-11-20']);
  assert.equal(on('Акция с 10.11 по 20.11', '2026-11-13').due, '2026-11-20');
  assert.equal(on('Курс с 01.11 по 30.11', '2026-11-13').due, '2026-11-30');
  // ещё не начался: срок по началу
  assert.equal(on('Отпуск с 25.12 по 05.01', '2026-11-13').due, '2026-12-25');
  // переход через год: второго января отпуск ещё идёт до 5 января
  assert.equal(on('Отпуск с 25.12 по 05.01', '2027-01-02').due, '2027-01-05');
  // целиком в прошлом: следующий раз через год
  assert.equal(on('Акция с 01.11 по 05.11', '2026-11-13').due, '2027-11-01');
  // начинается сегодня: срок сегодня
  assert.equal(on('Курс с 13.11 по 20.11', '2026-11-13').due, '2026-11-13');
  // год только у конца: начало в предыдущем году
  assert.equal(on('Отпуск с 25.12 по 05.01.2027 г.', '2026-11-13').due, '2026-12-25');
  assert.equal(on('Отпуск с 25.12 по 05.01.2027 г.', '2027-01-02').due, '2027-01-05');
  // с полным годом и уже идёт
  assert.equal(on('Курс с 01.11.2026 по 30.11.2026', '2026-11-13').due, '2026-11-30');
});

test('судья, круг 6: «на <день недели>» в живых фразах', () => {
  const cases = {
    'Встреча на пятницу с Олей': ['Встреча с Олей', '2026-11-13'],
    'Записаться на понедельник к врачу': ['Записаться к врачу', '2026-11-16'],
    'Созвон на понедельник с командой': ['Созвон с командой', '2026-11-16'],
    'Билеты на субботу в кино': ['Билеты в кино', '2026-11-14'],
    'Отчёт на вторник 10:00': ['Отчёт 10:00', '2026-11-17'],
    'Встреча на пт с Олей': ['Встреча с Олей', '2026-11-13'],
    'Уборка на воскресенье': ['Уборка', '2026-11-15'],
  };
  for (const [text, [title, due]] of Object.entries(cases)) assert.deepEqual([p(text).title, p(text).due], [title, due], text);
});

test('судья, круг 6: номера версий и пунктов не даты, срок рядом с ними берётся', () => {
  for (const text of ['Обновить плагин до 2.10.15', 'Прочитать п. 3.11.25 договора', 'Пункт 2.10.14 ТЗ поправить', 'Обновить Python до 3.12.11']) {
    assert.deepEqual([p(text).title, p(text).due], [text, null], text);
  }
  const release = p('Релиз 3.12.20 в пятницу');
  assert.deepEqual([release.title, release.due], ['Релиз 3.12.20', '2026-11-13']);
  assert.deepEqual([p('Сдать до 15.12.26').title, p('Сдать до 15.12.26').due], ['Сдать', '2026-12-15']);
  assert.deepEqual([p('Pay 25.11.26').title, p('Pay 25.11.26').due], ['Pay', '2026-11-25']);
  // проверенные раньше случаи не сломались
  assert.equal(p('Купить 2.10 г. соли').due, null);
  assert.equal(p('Встреча 25.11 г. Москва').due, '2026-11-25');
  assert.equal(p('Сдать отчёт до 25.11.2027 г.').due, '2027-11-25');
});

test('диапазон словами остаётся в названии целиком, без «с по»', () => {
  const on = (text, today = '2026-11-13') => parseQuickAdd(text, today);
  assert.deepEqual([on('Отпуск с 25 декабря по 5 января').title, on('Отпуск с 25 декабря по 5 января').due], ['Отпуск с 25 декабря по 5 января', '2026-12-25']);
  assert.deepEqual([on('Отпуск с 25 по 31 декабря').title, on('Отпуск с 25 по 31 декабря').due], ['Отпуск с 25 по 31 декабря', '2026-12-25']);
  assert.equal(on('Акция с 10 по 20 ноября').due, '2026-11-20');
  assert.equal(on('Отпуск с 25 декабря по 5 января', '2027-01-02').due, '2027-01-05');
  assert.equal(on('Отжиматься от 10 до 20 раз').due, null);
  assert.equal(on('Договор от 1 декабря подписать').due, null);
});
