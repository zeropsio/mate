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

/** The overflow menu's name: how many tabs the strip cuts off. Its face says "3 more". */
export function hiddenTabsLabel(count: number): string {
  return count === 1 ? "1 more tab" : `${count} more tabs`;
}

/** The room between two tabs (the strip's `gap-1`). */
const TAB_GAP = 4;

/**
 * Whether the strip folds every tab but the open one to its icon: once the tabs with their names,
 * side by side, outgrow its room. Weighed with every name shown, whether folded now or not, so
 * folding never unfolds the strip again on the next measure.
 */
export function tabsCompact(input: {
  /** Each tab's width with its name shown. */
  readonly widths: ReadonlyArray<number>;
  /** The width the tabs have beside the strip's action. */
  readonly room: number;
}): boolean {
  if (input.widths.length === 0) return false;
  const named =
    input.widths.reduce((sum, width) => sum + width, 0) + TAB_GAP * (input.widths.length - 1);
  // A pixel of rounding is not an overflow: layout boxes land on fractions.
  return named > input.room + 1;
}
