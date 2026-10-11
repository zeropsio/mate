/**
 * What an answer landing from its run's slot holds still. Read whole in the slot, it lands under
 * the card's head, which stands where it stood while the card's history folds under it: nothing
 * above the answer moves (engine-final, seg E +0:17.6: the page moved 130–330 px as the answer
 * landed). Cut by the slot's cap, the person was reading its newest lines: its last line stays
 * where it stood (run 5, C +0:15.29: it landed from its first line and the page glided 1033 px).
 */
export function landingHolds(input: {
  /** The card's head is on the page. */
  readonly head: boolean;
  /** The answer's words stood whole in the slot, never cut by its cap. */
  readonly whole: boolean;
}): "head" | "words" {
  return input.head && input.whole ? "head" : "words";
}
