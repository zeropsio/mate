/**
 * The composer at full screen: it fills the chat column, a gap short of its
 * edges, with whatever stands with it (its banners, strips, the composer).
 * Docked at the column's foot it grows up; centred on a new draft it grows
 * both ways, so nothing jumps on the way. The height is refitted whenever the
 * column or the stack changes size: a smaller window or a banner arriving
 * shrinks it, a strip leaving gives the room back.
 */

/** What is left of the column above and below the composer at full screen. */
export const FULL_COMPOSER_GAP = 16;

/** How long the composer takes to grow or to go back. */
export const FULL_COMPOSER_MS = 240;

/** The composer's text never gets shorter than at rest (`4.375rem`). */
export const FULL_COMPOSER_MIN_HEIGHT = 70;

interface Edges {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The composer text's height at full screen, from where the stack stands in
 * the column now and the text's height now: the room left (or overrun) above
 * the stack, and below it when centred, is added to (or taken from) the text.
 * Applied, it is a fixed point: the next measure gives the same height.
 */
export function fullComposerHeight(input: {
  readonly column: Edges;
  readonly stack: Edges;
  readonly editorHeight: number;
  readonly centred: boolean;
}): number {
  const { column, stack } = input;
  const above = stack.top - column.top - FULL_COMPOSER_GAP;
  const below = column.bottom - stack.bottom - FULL_COMPOSER_GAP;
  const room = input.centred ? above + below : above;
  return Math.max(FULL_COMPOSER_MIN_HEIGHT, Math.round(input.editorHeight + room));
}
