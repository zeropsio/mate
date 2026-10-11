import { useLayoutEffect, type RefObject } from "react";

/**
 * A project's heading gives way as the menu narrows (the owner, 2026-10-12: "this has no handling
 * when the left column is too small (it split name and others in two rows in this case)"): it
 * stays one line, its name keeps its first letters, and what rides after the name steps aside only
 * when the name would lose them, least needed first — each step a `data-fit` on the heading that
 * `index.css` reads: 1, the stage and the way's lead; 2, the faces; 3, production behind a release
 * that waits on you. A width alone can't say it: a short name leaves room a long one takes.
 */
const NAME_FLOOR_PX = 56;
const STEPS = 3;

function fit(heading: HTMLElement): void {
  const name = heading.querySelector<HTMLElement>(".zerops-project-name");
  for (let step = 0; step <= STEPS; step++) {
    if (step === 0) delete heading.dataset.fit;
    else heading.dataset.fit = String(step);
    // A name its ellipsis cuts is narrower than its words: it fits showing them, or its floor.
    if (name === null || name.clientWidth + 1 >= Math.min(name.scrollWidth, NAME_FLOOR_PX)) return;
  }
}

export function useHeadingFit(heading: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = heading.current;
    if (element === null) return;
    fit(element);
    if (typeof ResizeObserver !== "function" || typeof MutationObserver !== "function") return;
    const refit = () => {
      fit(element);
    };
    const resize = new ResizeObserver(refit);
    resize.observe(element);
    // What rides after the name changes on its own — a place arrives, a release starts to wait —
    // and the heading's width stays, so its parts and words refit it too.
    const content = new MutationObserver(refit);
    content.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      resize.disconnect();
      content.disconnect();
    };
  }, [heading]);
}
