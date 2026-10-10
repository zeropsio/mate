/**
 * A frame taken out of the document and put back loads its page again, and the conversation's list
 * moves its rows by exactly that: LegendList (3.3.5) sorts its containers into the order they show
 * (`useDOMOrder`, half a second after their positions change) with `insertBefore`, and a row it
 * placed in a recycled container out of order moves then. Where the browser can move an element
 * while keeping its state (`moveBefore`), the ancestors of a page's frame move their own children
 * that way, so the page loads once; elsewhere a move loads it again, as before.
 */

type Moving = Element & {
  moveBefore?: (node: Node, child: Node | null) => void;
};

/** How many frames each patched ancestor holds: the last to leave restores it. */
const holders = new WeakMap<Element, number>();

function keepMoves(parent: Moving): void {
  const held = holders.get(parent) ?? 0;
  holders.set(parent, held + 1);
  if (held > 0) return;
  const move = (node: Node, child: Node | null): boolean => {
    if (node.parentNode !== parent || (child !== null && child.parentNode !== parent)) return false;
    try {
      parent.moveBefore!(node, child);
      return true;
    } catch {
      // Not movable with its state (a parent outside the document): an ordinary move.
      return false;
    }
  };
  parent.insertBefore = function <T extends Node>(node: T, child: Node | null): T {
    return move(node, child)
      ? node
      : (Element.prototype.insertBefore.call(parent, node, child) as T);
  };
  parent.appendChild = function <T extends Node>(node: T): T {
    return move(node, null) ? node : (Element.prototype.appendChild.call(parent, node) as T);
  };
}

function releaseMoves(parent: Element): void {
  const held = holders.get(parent) ?? 0;
  if (held > 1) {
    holders.set(parent, held - 1);
    return;
  }
  holders.delete(parent);
  delete (parent as Partial<Pick<Element, "insertBefore" | "appendChild">>).insertBefore;
  delete (parent as Partial<Pick<Element, "insertBefore" | "appendChild">>).appendChild;
}

/**
 * Keeps the frame inside `element` loaded when any of its ancestors moves it among its siblings;
 * returns the release. Without `moveBefore` it does nothing.
 */
export function keepFrameOnMove(element: Element): () => void {
  if (typeof (element as Moving).moveBefore !== "function") return () => {};
  const ancestors: Element[] = [];
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    if (parent === document.body) break;
    ancestors.push(parent);
    keepMoves(parent);
  }
  return () => {
    for (const parent of ancestors) releaseMoves(parent);
  };
}
