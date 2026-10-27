/**
 * One wait, one line, said once (pass 30, the owner: "multiple loading states… unify"). A wait
 * says nothing for its first beat — 600 ms from the page's load for the app's own boot, 1 s from
 * a Mate's page opening for its conversation — then one quiet line at the page's centre. A line
 * already on screen when the next layer takes the same wait over (the boot's frame to the Mate's
 * page, the route's opening view to its conversation) stays said: the new layer shows it at once
 * rather than taking it away for a beat and saying it again. Pure.
 */

/** The app's own boot: from the page's load. */
export const BOOT_WAIT_LINE_MS = 600;
/** A Mate's conversation on its way: from the Mate's page opening. */
export const OPENING_WAIT_LINE_MS = 1_000;

export const READING_PROJECTS_LINE = "Reading your projects…";

/** What a Mate's page says while its conversation is on its way. */
export function openingConversationLine(mateName: string | undefined): string {
  return mateName === undefined
    ? "Opening the conversation…"
    : `Opening ${mateName}'s conversation…`;
}

/**
 * Whether a route stands in shaped like the overview while the app or its code loads: the
 * overview's own route, so a reload paints the overview's shape once and then its cards in the
 * same places. Any other route holds its room and paints nothing it would take back — the home
 * (`/`) too, which lands on a Mate as often as on the overview and paints neither until it knows.
 */
export function overviewStandsIn(pathname: string): boolean {
  return pathname === "/zerops";
}

/**
 * How long until a wait's line shows: `null` never (no words), 0 at once — the same words are
 * already on screen, or the beat has passed — else what is left of the beat.
 */
export function waitLineDueInMs(input: {
  readonly text: string | null;
  /** The line on screen now, said by the layer this one takes over from. */
  readonly said: string | null;
  /** How long this wait has stood. */
  readonly elapsedMs: number;
  readonly delayMs: number;
}): number | null {
  if (input.text === null) return null;
  if (input.text === input.said) return 0;
  return Math.max(0, input.delayMs - input.elapsedMs);
}

/**
 * Whether the line shows: once the wait has spoken it keeps speaking, so new words ("Opening the
 * conversation…" → "Opening Gita's conversation…") stand at once and never blank a frame.
 */
export function waitLineShows(input: {
  readonly text: string | null;
  readonly spoken: boolean;
}): boolean {
  return input.text !== null && input.spoken;
}
