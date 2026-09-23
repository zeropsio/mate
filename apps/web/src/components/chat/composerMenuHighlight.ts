import { useEffect, useState } from "react";

export function resolveComposerMenuActiveItemId(input: {
  items: ReadonlyArray<{ id: string }>;
  highlightedItemId: string | null;
  currentSearchKey: string | null;
  highlightedSearchKey: string | null;
}): string | null {
  if (input.items.length === 0) {
    return null;
  }

  if (
    input.currentSearchKey === input.highlightedSearchKey &&
    input.highlightedItemId &&
    input.items.some((item) => item.id === input.highlightedItemId)
  ) {
    return input.highlightedItemId;
  }

  return input.items[0]?.id ?? null;
}

/**
 * The composer menu's highlight: the item last moved to and the search it was
 * chosen under. It follows the menu: cleared while the menu is closed, and on
 * the first item when the highlighted one leaves the list or the search
 * changes.
 */
export function useComposerMenuHighlight(input: {
  menuOpen: boolean;
  items: ReadonlyArray<{ id: string }>;
  searchKey: string | null;
}) {
  const { menuOpen, items, searchKey } = input;
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [highlightedSearchKey, setHighlightedSearchKey] = useState<string | null>(null);

  // The composer rebuilds `items` on every render, so this runs after each of
  // its commits. It calls a setter only when the value changes: a same-value
  // update still schedules a render while the fiber has work pending, and one
  // left pending by every commit of a burst of store writes (a reconnect after
  // a lapse) makes React count each commit as nested until it throws
  // "Maximum update depth exceeded".
  useEffect(() => {
    const nextItemId = menuOpen
      ? resolveComposerMenuActiveItemId({
          items,
          highlightedItemId,
          currentSearchKey: searchKey,
          highlightedSearchKey,
        })
      : null;
    const nextSearchKey = menuOpen ? searchKey : null;
    if (nextItemId !== highlightedItemId) setHighlightedItemId(nextItemId);
    if (nextSearchKey !== highlightedSearchKey) setHighlightedSearchKey(nextSearchKey);
  }, [highlightedItemId, highlightedSearchKey, items, menuOpen, searchKey]);

  return { highlightedItemId, setHighlightedItemId, highlightedSearchKey, setHighlightedSearchKey };
}
