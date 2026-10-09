/** A tab's or the strip's horizontal extent, in one coordinate space. */
export interface HorizontalExtent {
  readonly left: number;
  readonly right: number;
}

/** The tabs the strip's edges cut off, in strip order: the ones its overflow menu lists. */
export function tabsOutOfView<Id extends string>(
  viewport: HorizontalExtent,
  tabs: ReadonlyArray<HorizontalExtent & { readonly id: Id }>,
): Id[] {
  // A pixel of rounding is not a cut: layout boxes land on fractions.
  return tabs
    .filter((tab) => tab.left < viewport.left - 1 || tab.right > viewport.right + 1)
    .map((tab) => tab.id);
}
