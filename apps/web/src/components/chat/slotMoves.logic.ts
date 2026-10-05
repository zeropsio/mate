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

/**
 * How far each row that stays moved as the rows around it changed (F3, run
 * 9: a line joining between two pushed the lines under it down in one frame;
 * a call that returned moved past the ones still running): what joined above
 * it, less what left from above it, each by the room it takes (`step`). Only
 * a row that moved is said, and one is left out when something that left
 * from above it is no longer there to measure.
 */
export function rowShifts(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
  step: (key: string) => number | undefined,
): ReadonlyMap<string, number> {
  const shifts = new Map<string, number>();
  const was = new Map(before.map((key, index) => [key, index] as const));
  after.forEach((key, index) => {
    const at = was.get(key);
    if (at === undefined) return;
    const above = new Set(after.slice(0, index));
    const stoodAbove = new Set(before.slice(0, at));
    let shift = 0;
    for (const joined of above) {
      if (stoodAbove.has(joined)) continue;
      const room = step(joined);
      if (room === undefined) return;
      shift += room;
    }
    for (const left of stoodAbove) {
      if (above.has(left)) continue;
      const room = step(left);
      if (room === undefined) return;
      shift -= room;
    }
    if (Math.abs(shift) >= 0.5) shifts.set(key, shift);
  });
  return shifts;
}
