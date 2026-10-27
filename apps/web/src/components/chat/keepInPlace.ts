/**
 * Keeping what the person pressed under their pointer while what it opened
 * closes. A "Show less" stands at the foot of what it folds, and the
 * conversation keeps a card's top still as the card shrinks, so closing a
 * long output threw the button — and the reading — up by the whole output.
 * The scroll follows the pressed element by exactly how far it moved.
 */

/** What `keepInPlace` reads of an element: whether it is still on the page, and its box. */
export interface PlacedElement {
  readonly isConnected: boolean;
  getBoundingClientRect(): { readonly top: number; readonly bottom: number };
}

/** The scroll the element stands in. */
export interface PlacedScroller {
  scrollTop: number;
}

/**
 * Applies `change` — synchronously, the page laid out anew when it returns —
 * and scrolls so `anchor` stands where it stood. Gone after the change (the
 * pressed button replaced by another), `fallback`'s foot stands in for it.
 */
export function keepInPlace(input: {
  readonly anchor: PlacedElement;
  readonly fallback: PlacedElement | null;
  readonly scroller: PlacedScroller | null;
  readonly change: () => void;
}): void {
  const { anchor, fallback, scroller } = input;
  const anchorTop = anchor.getBoundingClientRect().top;
  const fallbackBottom = fallback?.getBoundingClientRect().bottom ?? null;
  input.change();
  if (scroller === null) return;
  const moved = anchor.isConnected
    ? anchor.getBoundingClientRect().top - anchorTop
    : fallback !== null && fallback.isConnected && fallbackBottom !== null
      ? fallback.getBoundingClientRect().bottom - fallbackBottom
      : 0;
  if (Math.abs(moved) >= 0.5) scroller.scrollTop += moved;
}

/** The nearest ancestor that scrolls vertically, else the document's own scroll. */
export function scrollerOf(element: Element): PlacedScroller | null {
  for (let node = element.parentElement; node != null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return element.ownerDocument?.scrollingElement ?? null;
}
