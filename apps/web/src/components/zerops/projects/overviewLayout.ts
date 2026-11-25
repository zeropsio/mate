/**
 * The overview's row of project cards: side by side, one width; past the window's edge the row
 * scrolls sideways under a fade (`--rail-fade-left`/`-right`, registered so they ease), a round
 * back and forward button on the side where there is more. Each card is as tall as what it holds
 * (the owner, 2026-10-12: "why the gap at bottom"), up to the row, which fits the window under the
 * page's head (`--card-row-height`, set by `CardRow`): a card taller than the row scrolls inside
 * (the owner, 2026-11-09: "what needs to happen here is an inner scroll in the card"). A phone shows
 * one card a screen with the next one's edge in sight, swiped a card at a time, no fade over the
 * card in hand.
 */
export const RAIL =
  "group/rail relative -mx-4 transition-[--rail-fade-left,--rail-fade-right] duration-200 ease-out-strong data-can-left:[--rail-fade-left:56px] data-can-right:[--rail-fade-right:96px] sm:-mx-6 max-sm:[--rail-fade-left:0px] max-sm:[--rail-fade-right:0px]";

/**
 * The row itself. One pixel over the cards, taken back by the margin: a card's edge is drawn
 * outside its box, and a row that scrolls sideways cuts whatever stands past its own top edge.
 */
export const ROW =
  "-mt-px grid h-(--card-row-height,auto) auto-cols-[min(380px,100%)] grid-flow-col items-start justify-start gap-x-4 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 pt-px pb-1.5 [mask-image:linear-gradient(to_right,transparent,var(--color-black)_var(--rail-fade-left),var(--color-black)_calc(100%-var(--rail-fade-right)),transparent)] [scrollbar-width:none] snap-x snap-proximity scroll-px-4 sm:px-6 sm:scroll-px-6 max-sm:auto-cols-[min(380px,calc(100%-28px))] max-sm:gap-x-3 max-sm:snap-mandatory [&::-webkit-scrollbar]:hidden";

/** A card in the row: as tall as it holds, up to the row's height, snapping to the row's start. */
export const ROW_CARD = "flex max-h-full min-h-0 min-w-0 snap-start rounded-sheet";

/** A card's own room, inside its sheet. */
export const CARD_ROOM = "flex min-h-0 w-full flex-col px-3 pt-4.5 pb-2.5";

/** The overview's filter: quiet tabs under its title; a finger's touch reaches 44 px. */
export const FILTERS =
  "-mt-1.5 flex flex-wrap gap-1 pointer-coarse:*:relative pointer-coarse:*:after:absolute pointer-coarse:*:after:inset-x-0 pointer-coarse:*:after:-inset-y-2";
