/** Where the app last put each box's scroll to follow its end, as the browser took it. */
const followedTo = new WeakMap<Element, number>();

/**
 * Puts a box's scroll at `top` the way the app follows an end (a run card's box, the browser
 * strip), so the scroll event it causes is told apart from a person's (`isFollowScroll`).
 */
export function followScrollTo(element: HTMLElement, top: number): void {
  element.scrollTop = top;
  followedTo.set(element, element.scrollTop);
}

/** Whether the scroll that just reached `target` is one the app made to follow an end. */
export function isFollowScroll(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const top = followedTo.get(target);
  return top !== undefined && Math.abs(target.scrollTop - top) <= 1;
}
