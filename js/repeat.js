// Повторяющиеся задачи: «каждый день», «по будням», «по понедельникам», «каждый месяц».
// Кроме шага повтора храним repeatDay, «якорь» повтора отдельно от срока:
// для недели это день недели (0 = воскресенье), для месяца и года число месяца.
// Так перенос одного раза на вторник не превращает «по пятницам» во «по вторникам»,
// а «каждое 31-е» после короткого февраля снова встаёт на 31-е, а не на 28-е.

import { addDays, addMonths, daysBetween, weekdayOf, withDay } from './dates.js';

export const REPEATS = ['day', 'weekday', 'week', 'month', 'year'];

export const isRepeat = (value) => REPEATS.includes(value);

// Подходит ли якорь к шагу повтора.
export function isRepeatDay(repeat, day) {
  if (!Number.isInteger(day)) return false;
  if (repeat === 'week') return day >= 0 && day <= 6;
  if (repeat === 'month' || repeat === 'year') return day >= 1 && day <= 31;
  return false;
}

// Якорь для задачи: заданный, если подходит, иначе из срока.
export function repeatDayFor(repeat, day, due) {
  if (isRepeatDay(repeat, day)) return day;
  if (!due) return null;
  if (repeat === 'week') return weekdayOf(due);
  if (repeat === 'month' || repeat === 'year') return Number(due.slice(8));
  return null;
}

const isWeekend = (key) => weekdayOf(key) === 0 || weekdayOf(key) === 6;

// Первый срок для новой повторяющейся задачи без даты.
export function firstDue(repeat, today) {
  if (repeat !== 'weekday') return today;
  let key = today;
  while (isWeekend(key)) key = addDays(key, 1);
  return key;
}

// Следующий срок после выполнения: позже и прошлого срока, и сегодняшнего дня.
// Пропущенные дни не копятся: просроченная ежедневная задача встаёт на завтра.
export function nextDue(repeat, due, today, day = null) {
  const base = due ?? today;
  const after = base > today ? base : today;
  switch (repeat) {
    case 'day':
      return addDays(after, 1);
    case 'weekday': {
      let key = addDays(after, 1);
      while (isWeekend(key)) key = addDays(key, 1);
      return key;
    }
    case 'week': {
      // с заданным днём недели: ближайший такой день после срока и после сегодня
      if (isRepeatDay('week', day)) {
        let key = addDays(after, 1);
        while (weekdayOf(key) !== day) key = addDays(key, 1);
        return key;
      }
      const weeks = base > today ? 1 : Math.floor(daysBetween(base, today) / 7) + 1;
      return addDays(base, 7 * weeks);
    }
    case 'month':
    case 'year': {
      const step = repeat === 'month' ? 1 : 12;
      const anchor = isRepeatDay(repeat, day) ? day : Number(base.slice(8));
      for (let k = 1; k <= 1200; k += 1) {
        const key = withDay(addMonths(base, step * k), anchor);
        if (key > after) return key;
      }
      return addMonths(today, step);
    }
    default:
      return null;
  }
}
