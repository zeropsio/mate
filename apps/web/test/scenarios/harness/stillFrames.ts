import type { Page } from "puppeteer-core";

// Layout owners, rather than their continuously animated decorative descendants.
const layoutSurfaces = [
  "[data-sidebar]",
  "[data-zerops-surface]",
  ".timeline-legend-list",
  "[data-timeline-row-kind]",
  "[data-run-chat]",
  "[data-run-head]",
  "[data-run-now]",
  "[data-run-scroll]",
  "[data-chat-kind]",
  "[data-chat-composer-overlay]",
  '[data-slot="composer-shell"]',
  "[data-composer-banner-drawer]",
  ".helper-map > li",
  '[role="dialog"]',
].join(", ");

/** Call after the phase's input is visible; a deferred phase supplies its own start predicate. */
export async function waitForStillFrames(
  page: Page,
  {
    selector = layoutSurfaces,
    stillFrames = 6,
    phaseStarted,
    sample,
  }: {
    selector?: string;
    stillFrames?: number;
    phaseStarted?: () => boolean;
    sample?: () => Promise<void>;
  } = {},
) {
  if (phaseStarted) await page.waitForFunction(phaseStarted, { polling: "raf", timeout: 8000 });
  const trace = await page.evaluateHandle((selector) => {
    const state = { active: true, still: 0, previous: "" };
    const sample = () => {
      if (!state.active) return;
      const reading = JSON.stringify(
        [...document.querySelectorAll(selector)].map((node) => {
          const rect = node.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height, node.scrollTop, node.scrollHeight];
        }),
      );
      // Include delayed finite animations, but never wait for a working spinner to stop.
      const moving = document.getAnimations().some((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return (
          timing?.iterations !== Infinity &&
          (animation.pending || animation.playState === "running")
        );
      });
      const placing = document.querySelector(
        '[data-timeline-placing], [data-conversation-opening]:not([data-conversation-opening="complete"]), [data-run-fold="folding"], [data-folding]',
      );
      state.still = !moving && !placing && reading === state.previous ? state.still + 1 : 0;
      state.previous = reading;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return state;
  }, selector);
  try {
    if (sample) {
      const deadline = performance.now() + 8000;
      for (;;) {
        const still = await trace.evaluate(async (state) => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return state.still;
        });
        await sample();
        if (still >= stillFrames) break;
        if (performance.now() >= deadline)
          throw new Error("Layout did not reach still frames in 8000ms");
      }
    } else {
      const done = await page.waitForFunction(
        (state, count) => state.still >= count,
        { polling: "raf", timeout: 8000 },
        trace,
        stillFrames,
      );
      await done.dispose();
    }
  } finally {
    await trace.evaluate((state) => {
      state.active = false;
    });
    await trace.dispose();
  }
}
