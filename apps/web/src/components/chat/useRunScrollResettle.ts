/**
 * Keeps a run's scroll at its foot through its node being re-inserted: the
 * browser puts it back at 0 then, saying nothing — no scroll, no resize — and
 * the sentinel at its end leaving view is the one sign of it
 * (`runScrollResettle.logic`).
 *
 * @module useRunScrollResettle
 */
import { type RefObject, useLayoutEffect } from "react";

import type { RunScrollFollow, RunScrollPosition } from "./runCard.logic";
import { resettledTop } from "./runScrollResettle.logic";

export function useRunScrollResettle(input: {
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** An empty mark after its lines, inside it: in view while it stands at its foot. */
  readonly endRef: RefObject<HTMLElement | null>;
  readonly followRef: { readonly current: RunScrollFollow };
  /** Where it stands, as its follow reads it. */
  readonly positionOf: (scroll: HTMLElement) => RunScrollPosition;
  /** The page puts its top at `top`, and remembers it. */
  readonly putAt: (scroll: HTMLElement, top: number) => void;
}): void {
  const { scrollRef, endRef, followRef, positionOf, putAt } = input;
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const end = endRef.current;
    if (root === null || end === null || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => entry.isIntersecting)) return;
        const scroll = scrollRef.current;
        if (scroll === null) return;
        const { follows, stood } = followRef.current;
        const top = resettledTop({ follows, stood, position: positionOf(scroll) });
        if (top !== null) putAt(scroll, top);
      },
      { root },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [endRef, followRef, positionOf, putAt, scrollRef]);
}
