/**
 * A project's own page, in one centred column no wider than reads well: its header, then what
 * changes day to day and, under it, what is set up once. A label hugs its card (`PAGE_GROUP`);
 * sections stand three times further apart. The label's own line box holds 7 px over and under
 * its words: the main column's gaps read as 36 and 32.
 */
export const PAGE = "mx-auto grid w-full max-w-220 min-w-0 gap-8";
export const PAGE_COLS = "grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-7.5";
export const PAGE_MAIN = "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-7.5";
export const PAGE_SIDE = "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6.5";

/** One section: its label hugging its card. */
export const PAGE_GROUP = "grid min-w-0 gap-1";

/** A card's quiet line of words: what is empty, what a place's note says. */
export const PAGE_WORDS = "text-line leading-5 text-muted-foreground";

/**
 * Going live's hero, and production's where it runs outside Mate: a mark, what it means, its one
 * verb. On a phone it says itself across the card, its door under its words.
 */
export const HERO =
  "flex min-w-0 items-center gap-4.5 p-5 max-sm:grid max-sm:grid-cols-[40px_minmax(0,1fr)] max-sm:gap-x-3.5 max-sm:gap-y-3 max-sm:p-4";
export const HERO_ICON =
  "flex size-10 flex-none items-center justify-center rounded-control max-sm:self-start";
export const HERO_TEXT = "grid min-w-0 flex-1 gap-1";
export const HERO_TITLE = "text-emphasis leading-5.5 font-semibold text-foreground";
export const HERO_WHY = "text-body text-pretty text-muted-foreground";
