// Цвет приложения: семь готовых пар «основной + второй цвет». Кобальт по умолчанию.
// Сами цвета живут в css/theme.css (блоки :root[data-accent="…"]), здесь только список
// и проверка. boot.js держит копию списка (он не модуль): тест сверяет их.

export const ACCENTS = ['cobalt', 'sky', 'marshmallow', 'mint', 'coral', 'lilac', 'graphite'];
export const DEFAULT_ACCENT = 'cobalt';

export function isAccent(value) {
  return typeof value === 'string' && ACCENTS.includes(value);
}

// что угодно из хранилища или файла → известный цвет, иначе кобальт
export function cleanAccent(value) {
  return isAccent(value) ? value : DEFAULT_ACCENT;
}

// Темы в окне «Оформление»: null = как в системе.
export const THEMES = ['light', 'dark', null];

// Следующий вариант в группе переключателей по стрелке (по кругу), для клавиатуры.
export function stepChoice(list, current, delta) {
  const at = list.indexOf(current);
  const from = at === -1 ? 0 : at;
  return list[(from + delta + list.length * 2) % list.length];
}

// Стрелки в сетке выбора (цвета приложения, цвета и значки метки), как у переключателей в APG:
// влево и вправо по кругу; вверх и вниз на ряд, у края остаёмся на месте. Сетка в один ряд:
// вверх и вниз = влево и вправо. Home и End: первый и последний. Возвращает новый номер или null.
export function gridStep(index, length, cols, key) {
  const last = length - 1;
  const oneRow = cols >= length;
  const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: oneRow ? 1 : cols, ArrowUp: oneRow ? -1 : -cols }[key];
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (delta === undefined) return null;
  if (Math.abs(delta) === 1) return (index + delta + length) % length;
  const to = index + delta;
  return to < 0 || to > last ? index : to;
}
