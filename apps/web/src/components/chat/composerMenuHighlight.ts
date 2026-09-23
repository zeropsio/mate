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

  useEffect(() => {
    if (!menuOpen) {
      setHighlightedItemId(null);
      setHighlightedSearchKey(null);
      return;
    }
    const nextActiveItemId = resolveComposerMenuActiveItemId({
      items,
      highlightedItemId,
      currentSearchKey: searchKey,
      highlightedSearchKey,
    });
    setHighlightedItemId((existing) =>
      existing === nextActiveItemId ? existing : nextActiveItemId,
    );
    setHighlightedSearchKey((existing) => (existing === searchKey ? existing : searchKey));
  }, [highlightedItemId, highlightedSearchKey, items, menuOpen, searchKey]);

  return { highlightedItemId, setHighlightedItemId, highlightedSearchKey, setHighlightedSearchKey };
}
