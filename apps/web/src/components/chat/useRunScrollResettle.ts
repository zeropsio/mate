/**
 * Keeps a run's scroll where it stood through its node being re-inserted: the
 * browser puts it back at 0 then, saying nothing — no scroll, no resize. One
 * following stands at its foot again: the sentinel at its end left view. One
 * the person reads stands where they read: the sentinel at its start came
 * into view, which a reader far from the foot shows by nothing else
 * (`runScrollResettle.logic`).
 *
 * @module useRunScrollResettle
 */
import { type RefObject, useCallback, useLayoutEffect } from "react";

import type { RunScrollFollow, RunScrollPosition } from "./runCard.logic";
import { resettledTop } from "./runScrollResettle.logic";

/** Gives how to put it back where it stood, should no move of anybody's have taken it from there: for what learns of it before a sentinel says so. */
export function useRunScrollResettle(input: {
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** An empty mark before its lines, inside it: in view while it stands at its start. */
  readonly startRef: RefObject<HTMLElement | null>;
  /** An empty mark after its lines, inside it: in view while it stands at its foot. */
  readonly endRef: RefObject<HTMLElement | null>;
  readonly followRef: { readonly current: RunScrollFollow };
  /** Where it stands, as its follow reads it. */
  readonly positionOf: (scroll: HTMLElement) => RunScrollPosition;
  /** The page puts its top at `top`, and remembers it. */
  readonly putAt: (scroll: HTMLElement, top: number) => void;
}): () => void {
  const { scrollRef, startRef, endRef, followRef, positionOf, putAt } = input;
  const resettle = useCallback(() => {
    const scroll = scrollRef.current;
    // Off the page (its work hidden) it stands nowhere.
    if (scroll === null || scroll.clientHeight === 0) return;
    const { follows, stood } = followRef.current;
    const top = resettledTop({ follows, stood, position: positionOf(scroll) });
    if (top !== null) putAt(scroll, top);
  }, [followRef, positionOf, putAt, scrollRef]);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const start = startRef.current;
    const end = endRef.current;
    if (root === null || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(resettle, { root });
    if (start !== null) observer.observe(start);
    if (end !== null) observer.observe(end);
    return () => observer.disconnect();
  }, [endRef, resettle, scrollRef, startRef]);
  return resettle;
}
