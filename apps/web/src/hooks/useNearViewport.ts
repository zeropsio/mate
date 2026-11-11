import { useEffect, useRef, useState } from "react";

import { watchIntersections, type RestingIntersections } from "../lib/restingIntersections";

const waiting = new Map<Element, () => void>();
let observer: RestingIntersections | undefined;

/** Defer image processing and blob reads until their reserved box is near the viewport. */
export function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (near || element === null) return;
    observer ??= watchIntersections(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) waiting.get(entry.target)?.();
        }
      },
      { rootMargin: "128px" },
    );
    waiting.set(element, () => setNear(true));
    // Kept timelines retain layout while invisible, so geometry alone is not visibility.
    const hiddenTimeline = element.closest("[data-kept-timeline]");
    const visibility =
      hiddenTimeline === null
        ? undefined
        : new MutationObserver(() => {
            if (getComputedStyle(element).visibility !== "hidden") {
              observer?.observe(element);
              visibility?.disconnect();
            }
          });
    if (hiddenTimeline !== null && getComputedStyle(element).visibility === "hidden") {
      visibility?.observe(hiddenTimeline, { attributes: true, attributeFilter: ["class"] });
    } else {
      observer?.observe(element);
    }
    return () => {
      visibility?.disconnect();
      waiting.delete(element);
      observer?.unobserve(element);
      if (waiting.size === 0) {
        observer?.disconnect();
        observer = undefined;
      }
    };
  }, [near]);
  return { ref, near };
}
