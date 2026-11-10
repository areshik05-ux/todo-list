// Повторяющиеся задачи: «каждый день», «по будням», «каждый понедельник».
// Храним только шаг повтора, а день недели задаёт сам срок: задача «каждый
// понедельник» стоит на понедельник и повторяется через неделю.

import { addDays, addMonths, daysBetween, weekdayOf } from './dates.js';

export const REPEATS = ['day', 'weekday', 'week', 'month', 'year'];

export const isRepeat = (value) => REPEATS.includes(value);

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
export function nextDue(repeat, due, today) {
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
      const weeks = base > today ? 1 : Math.floor(daysBetween(base, today) / 7) + 1;
      return addDays(base, 7 * weeks);
    }
    case 'month':
    case 'year': {
      const step = repeat === 'month' ? 1 : 12;
      for (let k = 1; k <= 1200; k += 1) {
        const key = addMonths(base, step * k);
        if (key > today) return key;
      }
      return addMonths(today, step);
    }
    default:
      return null;
  }
}
