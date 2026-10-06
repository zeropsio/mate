import * as Effect from "effect/Effect";
import { beforeEach, afterEach, type TestContext } from "vite-plus/test";
import { scenarioPolicy } from "./policy.ts";
import type { Page } from "puppeteer-core";

let current: { context: TestContext; started: number } | undefined;
beforeEach((context) => {
  current = { context, started: performance.now() };
});
afterEach(() => {
  current = undefined;
});

/** A receipt/render poll uses the condition budget plus the protocol delay it must cross,
 * capped by the live test's remaining time. Changing test policy changes every wait together. */
export function remainingTestBudget() {
  const total = current?.context.task.timeout ?? scenarioPolicy.testMs;
  const remaining = current ? total - (performance.now() - current.started) : total;
  return Math.max(1, remaining);
}

export function waitBudget(expectedDelay = 0) {
  return Math.min(remainingTestBudget(), scenarioPolicy.conditionMs + expectedDelay);
}

export function boundPageWaits(page: Page) {
  page.setDefaultTimeout(waitBudget());
  page.setDefaultNavigationTimeout(waitBudget());
  const wait = page.waitForFunction.bind(page);
  page.waitForFunction = async (condition, options, ...args) => {
    try {
      return await wait(
        condition,
        { ...options, timeout: Math.min(options?.timeout ?? Infinity, waitBudget()) },
        ...args,
      );
    } catch (cause) {
      throw new Error(
        `Condition never arrived: ${String(condition)}; arguments=${JSON.stringify(args)}`,
        { cause },
      );
    }
  };
}

/** Give Effect-backed protocol waits the same named receipt boundary as wire promises. */
export const effectReceipt =
  (what: string, expectedDelay = 0) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeoutOrElse({
        duration: waitBudget(expectedDelay),
        orElse: () => Effect.die(new Error(`Timed out: ${what}`)),
      }),
    );
