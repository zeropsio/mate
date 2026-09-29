/**
 * The run's card, as pure rules: how much of a long chat it draws, and how
 * the rest is reached. Everything is always reachable one way or another
 * (the owner's D4): the card has no scroll of its own, so what it does not
 * draw folds behind a control that draws it.
 */

/**
 * How many of a long run's lines its chat draws when it opens: the newest.
 * A two-hour run drew nine hundred bubbles at once and froze the page for
 * 0.7 s as it opened (Juno, 2026-09-27).
 */
export const CHAT_OPENS_WITH = 40;

/** How many earlier lines one "Show N earlier" draws: a huge run is reached a chunk at a time. */
export const EARLIER_CHUNK = 200;

/** Where a chat of `lines` lines opens: its newest `CHAT_OPENS_WITH`, the rest before them. */
export function chatOpensAt(lines: number): number {
  return Math.max(0, lines - CHAT_OPENS_WITH);
}

/**
 * What one "Show N earlier" draws when the chat starts at line `from`: the
 * chunk just before it — `shows` lines — and where the chat starts after.
 */
export function earlierShown(from: number): { readonly shows: number; readonly next: number } {
  const next = Math.max(0, from - EARLIER_CHUNK);
  return { shows: from - next, next };
}
