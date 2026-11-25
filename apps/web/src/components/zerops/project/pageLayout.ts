/**
 * A project's own page, in the page frame's column (`Page width="page"`): its header, then what
 * changes day to day and, under it, what is set up once, each section on the frame's rhythm: a
 * label hugs its card (`PAGE_GROUP`, the 8 px a `Section` keeps), sections stand 48 px apart.
 */
export const PAGE = "grid min-w-0 gap-12";
export const PAGE_COLS = "grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-12";
export const PAGE_MAIN = "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-12";
export const PAGE_SIDE = "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-12";

/** One section: its label hugging its card. */
export const PAGE_GROUP = "grid min-w-0 gap-2";

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
