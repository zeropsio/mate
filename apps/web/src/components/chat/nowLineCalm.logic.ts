/**
 * The now line, calm (K10): a run's words change at every call, at times
 * several in a second, and a line that flips as fast reads as jitter. A line
 * once shown stands `NOW_LINE_DWELL_MS`; what arrives meanwhile waits, and
 * when the dwell ends only the latest of it shows — a burst reads as one
 * change. A change after a quiet spell shows at once, and so does the run's
 * end: the worked line never waits on the step before it.
 */

/**
 * How long a line, once shown, stands before another may take its place: long
 * enough to read a short sentence (run 9: at 1 s the line's median state stood
 * exactly its dwell, and read as flicker).
 */
export const NOW_LINE_DWELL_MS = 1200;

/** What the line shows, since when, and the latest line waiting its turn. */
export interface CalmLine<T> {
  readonly shown: T;
  /** The shown line's words: a line is a change only when they differ. */
  readonly key: string;
  readonly since: number;
  readonly waiting: { readonly line: T; readonly key: string } | null;
}

/** The line as first drawn: shown at once. */
export function calmLineStart<T>(line: T, key: string, at: number): CalmLine<T> {
  return { shown: line, key, since: at, waiting: null };
}

/**
 * A line arrives. The words shown drop anything waiting: the latest is what
 * shows (its details — a thought's latest words — are the caller's to draw
 * fresh). Other words show at once when the shown line has stood its dwell or
 * the run is over (`final`), else they wait, in place of whatever waited. A
 * line that changes nothing returns the calm it was given, so a caller that
 * offers every render settles.
 */
export function calmLineOffer<T>(
  calm: CalmLine<T>,
  line: T,
  key: string,
  at: number,
  final: boolean,
): CalmLine<T> {
  if (key === calm.key) return calm.waiting === null ? calm : { ...calm, waiting: null };
  if (final || at - calm.since >= NOW_LINE_DWELL_MS) return calmLineStart(line, key, at);
  if (calm.waiting?.key === key) return calm;
  return { ...calm, waiting: { line, key } };
}

/** When the waiting line is due, or null with none waiting. */
export function calmLineDue<T>(calm: CalmLine<T>): number | null {
  return calm.waiting === null ? null : calm.since + NOW_LINE_DWELL_MS;
}

/** Time passes: the waiting line shows once the shown one has stood its dwell. */
export function calmLineSettle<T>(calm: CalmLine<T>, at: number): CalmLine<T> {
  const due = calmLineDue(calm);
  if (calm.waiting === null || due === null || at < due) return calm;
  return calmLineStart(calm.waiting.line, calm.waiting.key, at);
}

/**
 * The run's clock as it may show: never less than it showed — a wait's end
 * reaching the clock a render before the time it waited would step it back —
 * unless the run it counts is another (`run` differs from the last shown).
 */
export function calmClockMs(
  last: { readonly run: string; readonly ms: number } | null,
  run: string,
  ms: number,
): number {
  return last !== null && last.run === run ? Math.max(last.ms, ms) : ms;
}
