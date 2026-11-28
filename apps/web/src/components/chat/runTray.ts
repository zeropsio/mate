/**
 * The run's card, in the class names every place that draws it shares: the timeline's slices,
 * a tray standing whole, the now line, its words and the band of what runs alongside. A quiet
 * tray, not a white slab: one small step above the canvas with a hairline edge (`bg-run-tray`,
 * the composer keeps the only white). One radius, the composer's (`rounded-sheet`), in every
 * state; 15 px of padding inside the 1 px ring keep its bubbles 16 px from its edge, and on a
 * phone its words stand on the composer's words, 12 px inside its frame.
 */

/**
 * The conversation's text edge, where the Mate's words and every row without a card of its own
 * stand: the composer's text edge, 13 px inside the column on a phone, 17 from sm up. A card drawn
 * inside such a row reaches the column's edges, the run card's, again by `TEXT_EDGE_OUT`.
 */
export const TEXT_EDGE = "px-3.25 sm:px-4.25";
export const TEXT_EDGE_OUT = "-mx-3.25 sm:-mx-4.25";

/** A slice of a card drawn a row at a time; the middle slice's radius stays in run-card.css. */
export const RUN_TRAY_SLICE = {
  top: "rounded-t-sheet border-x border-t border-foreground/7 bg-run-tray px-3.75 pt-3.75 max-sm:px-2.75",
  middle: "border-x border-foreground/7 bg-run-tray px-3.75 max-sm:px-2.75",
  /** The edge row is 16 px tall: its corners reach the composer's radius across and its height up. */
  bottom: "h-4 rounded-b-sheet border-x border-b border-foreground/7 bg-run-tray",
} as const;

/**
 * A card nothing stands in but its line's row (`cardWhole`) is drawn whole by that row: one box
 * over the edge row's 16 px and over the room its panel holds while it closes (`--card-room`),
 * so its corners are its own. Its other slices keep their geometry and paint nothing; its panel,
 * with nothing in it, takes no room.
 */
export const RUN_TRAY_SLICE_WHOLE = {
  top: "relative isolate border-x border-t border-transparent px-3.75 pt-3.75 before:absolute before:-inset-x-px before:-top-px before:-bottom-[calc(16px+var(--card-room,0px))] before:-z-1 before:rounded-sheet before:border before:border-foreground/7 before:bg-run-tray max-sm:px-2.75",
  middle: "border-x border-transparent px-3.75 max-sm:px-2.75",
  bottom: "h-4 border-x border-b border-transparent",
} as const;

/**
 * A tray on its own, not sliced: the Mate at work once its turn is over, a helper's run, a run's
 * line with nothing under it (the box, height and inset of a card holding its line alone).
 */
export const RUN_TRAY_WHOLE =
  "rounded-sheet border border-foreground/7 bg-run-tray p-3.75 max-sm:px-2.75";

/**
 * The now line, the card's foot or head: the face in the card's 28 px column, what the Mate is
 * doing, the run's one clock on the right edge. A hairline 16 px under the chat sets it off and
 * its words stand 20 px from it; heading the card — first, or after the work folding shut — it
 * has no hairline and stands 4 px down.
 */
export const RUN_NOW_LINE =
  "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2 mt-4 border-t border-rule pt-5 pe-3.5 pb-1 [&:nth-child(1_of_:not([hidden]))]:mt-0 [&:nth-child(1_of_:not([hidden]))]:border-t-0 [&:nth-child(1_of_:not([hidden]))]:pt-1 [[data-folding]+&]:mt-0 [[data-folding]+&]:border-t-0 [[data-folding]+&]:pt-1";

/** The line's words, in its flexible column, so the clock never moves for them. */
export const RUN_NOW_WORDS = "relative min-w-0 text-body leading-5";

/** One line: the step, and after it what it runs and for how long. */
export const RUN_NOW_HEAD = "block min-w-0 truncate";

export const RUN_NOW_VERB = "font-medium text-foreground";

/** The composing dots beside the line's words, at 70 %. */
export const NOW_DOTS = "ms-1.5 inline-flex scale-70 align-middle";

/**
 * What runs alongside while the run goes on, and the result once it is over, under the now line:
 * a hairline 12 px down, its rows 6 px under it; nothing at all when they have no row.
 */
export const RUN_BAND =
  "relative pt-4.75 empty:hidden before:absolute before:inset-x-0 before:top-3 before:h-px before:bg-rule";
