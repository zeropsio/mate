// ---------------------------------------------------------------------------
// Folding, as the person's own messages fold
// ---------------------------------------------------------------------------

/** Past this many lines or characters a message folds — the person's and the Mate's alike. */
const FOLD_LINES = 8;
const FOLD_LENGTH = 600;

/** Whether words fold: past 8 lines or 600 characters. */
export function foldsLikeAMessage(text: string): boolean {
  if (text.trim().length === 0) return false;
  return text.length > FOLD_LENGTH || text.split("\n").length > FOLD_LINES;
}

const FOLD_FADE_HEIGHT_REM = 1.75;
/** A folded message's bottom, fading into the bubble it sits in. */
export const FOLD_FADE_MASK = `linear-gradient(to bottom, black calc(100% - ${FOLD_FADE_HEIGHT_REM}rem), transparent)`;
