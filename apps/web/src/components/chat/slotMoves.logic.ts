/**
 * What a change of the live slot moves (pass 39): the lines leaving it for
 * the history — what stood in it, a question with the person's answer under
 * it — and whether something enters it. Either makes room in the card, and the history glides with it.
 * Entering is read against what the slot drew, not what it held: an arrival
 * held behind "Thinking" (`pending`) was never drawn, and its entrance makes
 * its room all the same.
 */
import { slotHolds, type LiveSlot } from "./liveSlot.logic";

export function slotMoves(
  from: LiveSlot,
  to: LiveSlot,
): { readonly leaving: ReadonlyArray<string>; readonly entering: boolean } {
  const after = slotHolds(to);
  const leaving = [...slotHolds(from)].filter((key) => !after.has(key));
  const drawn = new Set(from.entries.map((entry) => entry.key));
  return { leaving, entering: to.entries.some((entry) => !drawn.has(entry.key)) };
}

/**
 * The lines leaving the slot that land at once, by their plop: what stood in
 * the slot, and what was drawn there with it — a question's answer under it,
 * the pair landing as one.
 */
export function landingHosts(
  from: LiveSlot,
  leaving: ReadonlyArray<string>,
  /** The keys the slot drew a row for. */
  drawn: ReadonlySet<string>,
): ReadonlySet<string> {
  const stood = new Set(from.entries.map((entry) => entry.key));
  return new Set(leaving.filter((key) => stood.has(key) || drawn.has(key)));
}

/** A row of a run's history as it was drawn: its key, and its top in what holds it. */
export interface DrawnRow {
  readonly key: string;
  readonly top: number;
}

/**
 * How far each row that stays moved as the rows around it changed (F3, run
 * 9: a line joining between two pushed the lines under it down in one frame;
 * a call that returned moved past the ones still running): where it stands
 * now less where it stood, in one pass. Rows only joining at the foot move
 * nothing: what stood keeps its place, and a height easing above is its ease.
 */
export function rowShifts(
  before: ReadonlyArray<DrawnRow>,
  after: ReadonlyArray<DrawnRow>,
): ReadonlyMap<string, number> {
  const shifts = new Map<string, number>();
  if (
    before.length <= after.length &&
    before.every((row, index) => after[index]!.key === row.key)
  ) {
    return shifts;
  }
  const stood = new Map(before.map((row) => [row.key, row.top] as const));
  for (const row of after) {
    const top = stood.get(row.key);
    if (top !== undefined && Math.abs(row.top - top) >= 0.5) shifts.set(row.key, row.top - top);
  }
  return shifts;
}
