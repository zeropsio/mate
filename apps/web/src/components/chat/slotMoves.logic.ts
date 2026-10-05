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
