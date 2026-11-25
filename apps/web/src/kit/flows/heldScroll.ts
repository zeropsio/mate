import { useEffect } from "react";

/** How long after the person's own input a canvas scroll counts as theirs. */
const INPUT_LASTS_MS = 400;
let movedAt = Number.NEGATIVE_INFINITY;

/** The kit's own scroll (a thumbnail brought into view) is the person's, like their input. */
export const allowCanvasScroll = () => {
  movedAt = performance.now();
};

/**
 * Holds a canvas where the person left it. A harness page that scrolls something into view inside
 * its frame scrolls every document above it too, and the kit's canvas would jump as a state opens;
 * a scroll with no input of the person's just before it goes back.
 */
export function useHeldScroll(canvas: HTMLElement | null): void {
  useEffect(() => {
    if (canvas === null) return;
    let top = canvas.scrollTop;
    let left = canvas.scrollLeft;
    const input = () => allowCanvasScroll();
    const scrolled = () => {
      if (performance.now() - movedAt < INPUT_LASTS_MS) {
        top = canvas.scrollTop;
        left = canvas.scrollLeft;
        return;
      }
      canvas.scrollTo({ top, left, behavior: "instant" });
    };
    const inputs = ["wheel", "pointerdown", "keydown", "touchmove"] as const;
    for (const name of inputs)
      window.addEventListener(name, input, { capture: true, passive: true });
    canvas.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      for (const name of inputs) window.removeEventListener(name, input, { capture: true });
      canvas.removeEventListener("scroll", scrolled);
    };
  }, [canvas]);
}
