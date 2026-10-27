/**
 * What a person opens comes into view (pass 39, Bodhi's audit: the helpers
 * block, the Background list and an opened step opened behind the composer).
 * The conversation scrolls by as much as brings the foot of what opened into
 * view, the composer's room kept clear — and never so far that what they
 * clicked leaves the top.
 */

/** Room kept between what opened and the view's edges. */
export const REVEAL_MARGIN_PX = 16;

/**
 * How far to scroll down so that what opened, from its opener's top to its
 * foot, shows within `view` (the visible band, the composer's room off its
 * foot); 0 when it shows already.
 */
export function revealBy({
  openerTop,
  regionBottom,
  view,
}: {
  readonly openerTop: number;
  readonly regionBottom: number;
  readonly view: { readonly top: number; readonly bottom: number };
}): number {
  const under = regionBottom - (view.bottom - REVEAL_MARGIN_PX);
  if (under <= 0) return 0;
  const room = openerTop - (view.top + REVEAL_MARGIN_PX);
  return Math.max(0, Math.min(under, room));
}
