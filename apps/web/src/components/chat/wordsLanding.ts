/**
 * Where the Mate's words stood on screen as they were last written in a run's live slot, by
 * message (run 5, C +0:15.29): the answer they become lands with its last line there, so the
 * lines the person was reading stay where they were.
 */
const stood = new Map<string, { readonly bottom: number; readonly at: number }>();

/** How long after its box left the answer may still land on it: the same commit, give or take. */
const LANDS_WITHIN_MS = 1000;

/** The words' box leaves the slot, standing at its foot: where its last line was. */
export function wordsStood(id: string, bottom: number): void {
  stood.set(id, { bottom, at: performance.now() });
}

/** Where the answer's words last stood, once, while that is fresh; null otherwise. */
export function takeWordsStood(id: string): number | null {
  const held = stood.get(id);
  stood.delete(id);
  return held === undefined || performance.now() - held.at > LANDS_WITHIN_MS ? null : held.bottom;
}
