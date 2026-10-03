/**
 * The composer at full screen: it grows over the conversation until what
 * stands with it (its banners, the composer) reaches the chat column's edges,
 * a gap short. Docked at the column's foot it grows up; centred on a new
 * draft it grows both ways, so nothing jumps on the way.
 */

/** What is left of the column above and below the composer at full screen. */
export const FULL_COMPOSER_GAP = 16;

/** How long the composer takes to grow or to go back. */
export const FULL_COMPOSER_MS = 240;

interface Edges {
  readonly top: number;
  readonly bottom: number;
}

/** How much taller the composer's text gets for its stack to fill the column. */
export function fullComposerGrowth(column: Edges, stack: Edges): number {
  return (
    Math.max(0, stack.top - column.top - FULL_COMPOSER_GAP) +
    Math.max(0, column.bottom - stack.bottom - FULL_COMPOSER_GAP)
  );
}
