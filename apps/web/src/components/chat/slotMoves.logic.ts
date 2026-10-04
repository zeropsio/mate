/**
 * What a change of the live slot moves (pass 39): the lines leaving it for
 * the history — what stood in it and what rode along — and whether something
 * enters it. Either makes room in the card, and the history glides with it.
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
