/**
 * Where the Mate's words stood on screen as they were last written in a run's live slot, by
 * message, and where their card's head stood: the answer they become lands under the head held
 * still, or, too long to end in view there, with its last line where it was read
 * (`landingHolds`).
 */
export interface WordsStood {
  /** The foot of the words' box, a screen y. */
  readonly bottom: number;
  /** The words stood whole in the slot, never cut by its cap. */
  readonly whole: boolean;
  /** Their card's head and its top, a screen y; null when the card has none. */
  readonly head: { readonly element: HTMLElement; readonly top: number } | null;
}

const stood = new Map<string, WordsStood & { readonly at: number }>();
/** By card head: whether the words last told under it stood whole, and where the head stood. */
const byHead = new WeakMap<
  HTMLElement,
  { readonly whole: boolean; readonly top: number; readonly at: number }
>();

/** How long after its box left the answer may still land on it: the same commit, give or take. */
const LANDS_WITHIN_MS = 1000;

/** The words' box leaves the slot, standing at its foot: where its last line was. */
export function wordsStood(id: string, where: WordsStood): void {
  const at = performance.now();
  stood.set(id, { ...where, at });
  if (where.head !== null)
    byHead.set(where.head.element, { whole: where.whole, top: where.head.top, at });
}

/** Where `head` stood as words stood whole under it just now; null otherwise. */
export function headStood(head: HTMLElement): number | null {
  const held = byHead.get(head);
  return held === undefined || !held.whole || performance.now() - held.at > LANDS_WITHIN_MS
    ? null
    : held.top;
}

/** The answer's words stood in the slot just now: it lands from there, never rising in as new. */
export function wordsJustStood(id: string): boolean {
  const held = stood.get(id);
  return held !== undefined && performance.now() - held.at <= LANDS_WITHIN_MS;
}

/** Where the answer's words last stood, once, while that is fresh; null otherwise. */
export function takeWordsStood(id: string): WordsStood | null {
  const held = stood.get(id);
  stood.delete(id);
  return held === undefined || performance.now() - held.at > LANDS_WITHIN_MS
    ? null
    : { bottom: held.bottom, whole: held.whole, head: held.head };
}
