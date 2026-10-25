import type { Page } from "puppeteer-core";
import { TestRunner } from "vite-plus/test";

import { GLIDING_ATTRIBUTE } from "../../../src/components/chat/timelineEndFollow";

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

// A glide to the end steps sub-pixel in its last stretch: its rounded geometry can read alike
// for six frames with pixels left, so the page's own mark that it glides counts as moving.
const placingSelector = [
  "[data-timeline-placing]",
  '[data-conversation-opening]:not([data-conversation-opening="complete"])',
  '[data-run-fold="folding"]',
  "[data-folding]",
  `[${GLIDING_ATTRIBUTE}]`,
].join(", ");

/**
 * Call after the phase's input is visible; a deferred phase supplies its own start predicate.
 * Waits until the layout is still, or until `signal` (the running test's, by default) stops it,
 * and then names what still moves.
 */
export async function waitForStillFrames(
  page: Page,
  {
    selector = layoutSurfaces,
    stillFrames = 6,
    phaseStarted,
    sample,
    signal = TestRunner.getCurrentTest()?.context.signal,
  }: {
    selector?: string;
    stillFrames?: number;
    phaseStarted?: () => boolean;
    sample?: () => Promise<void>;
    signal?: AbortSignal | undefined;
  } = {},
) {
  const polling = { polling: "raf" as const, ...(signal && { signal }) };
  if (phaseStarted) await page.waitForFunction(phaseStarted, polling);
  const trace = await page.evaluateHandle(
    (selector, placingSelector) => {
      const state = { active: true, still: 0, previous: "", moving: "" };
      const sample = () => {
        if (!state.active) return;
        const reading = JSON.stringify(
          [...document.querySelectorAll(selector)].map((node) => {
            const rect = node.getBoundingClientRect();
            return [rect.x, rect.y, rect.width, rect.height, node.scrollTop, node.scrollHeight];
          }),
        );
        // Include delayed finite animations, but never wait for a working spinner to stop.
        const moving = document.getAnimations().filter((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return (
            timing?.iterations !== Infinity &&
            (animation.pending || animation.playState === "running")
          );
        });
        const placing = document.querySelector(placingSelector);
        const describe = (node: Element | null | undefined) =>
          node ? node.outerHTML.slice(0, node.outerHTML.indexOf(">") + 1) : "?";
        state.moving = [
          ...moving.map(
            (animation) =>
              `animation ${(animation as CSSAnimation).animationName ?? animation.id} on ${describe(
                (animation.effect as KeyframeEffect | null)?.target,
              )}`,
          ),
          ...(placing ? [`placing ${describe(placing)}`] : []),
          ...(reading !== state.previous ? ["geometry"] : []),
        ].join(", ");
        state.still = state.moving === "" ? state.still + 1 : 0;
        state.previous = reading;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      return state;
    },
    selector,
    placingSelector,
  );
  try {
    if (sample) {
      for (;;) {
        signal?.throwIfAborted();
        const still = await trace.evaluate(async (state) => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return state.still;
        });
        await sample();
        if (still >= stillFrames) break;
      }
    } else {
      const done = await page.waitForFunction(
        (state, count) => state.still >= count,
        polling,
        trace,
        stillFrames,
      );
      await done.dispose();
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
    const moving = await trace.evaluate((state) => state.moving).catch(() => "unknown");
    throw new Error(`Layout still moved when the wait stopped: ${moving}`, { cause: error });
  } finally {
    await trace.evaluate((state) => {
      state.active = false;
    });
    await trace.dispose();
  }
}
