/**
 * A file's line or range as a link carries it, `L10` or `L10-L20`, read in either order.
 *
 * @module zerops/gitBrowse/lineRange
 */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export const parseLines = (lines: string | undefined): LineRange | null => {
  const match = /^L(\d+)(?:-L(\d+))?$/u.exec(lines ?? "");
  if (match === null) return null;
  const first = Number(match[1]);
  const second = match[2] === undefined ? first : Number(match[2]);
  if (first < 1 || second < 1) return null;
  return { start: Math.min(first, second), end: Math.max(first, second) };
};

export const linesParam = ({ start, end }: LineRange) => {
  const [from, to] = start <= end ? [start, end] : [end, start];
  return from === to ? `L${from}` : `L${from}-L${to}`;
};
