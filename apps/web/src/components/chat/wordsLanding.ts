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

/** By card head: where it stood as last painted while its run went on. */
const headsStood = new WeakMap<HTMLElement, { readonly top: number; readonly at: number }>();

/** How long after its box left the answer may still land on it: the same commit, give or take. */
const LANDS_WITHIN_MS = 1000;

/** A live card's head was painted at `top`, a screen y: what a landing holds it at. */
export function headStood(head: HTMLElement, top: number): void {
  headsStood.set(head, { top, at: performance.now() });
}

/** Where `head` stood as last painted, while that is fresh; null otherwise. */
export function headStoodJustNow(head: HTMLElement): number | null {
  const held = headsStood.get(head);
  return held === undefined || performance.now() - held.at > LANDS_WITHIN_MS ? null : held.top;
}

/** The words' box leaves the slot, standing at its foot: where its last line was. */
export function wordsStood(id: string, where: WordsStood): void {
  const at = performance.now();
  stood.set(id, { ...where, at });
  if (where.head !== null)
    byHead.set(where.head.element, { whole: where.whole, top: where.head.top, at });
}

/** Words stood under `head` just now: the slot's words become the answer landing under it. */
export function wordsStoodUnder(head: HTMLElement): boolean {
  const held = byHead.get(head);
  return held !== undefined && performance.now() - held.at <= LANDS_WITHIN_MS;
}

/** The words told under `head` just now ran past the slot's cap: the person read their tail. */
export function wordsCutUnder(head: HTMLElement): boolean {
  const held = byHead.get(head);
  return held !== undefined && !held.whole && performance.now() - held.at <= LANDS_WITHIN_MS;
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
