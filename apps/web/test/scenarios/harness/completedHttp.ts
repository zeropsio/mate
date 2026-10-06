import type { HTTPRequest, Page } from "puppeteer-core";
import { waitBudget } from "./waits.ts";
import { deadline } from "./http.ts";

/** Track response bodies through completion; Puppeteer's network-idle counter ends at headers. */
export function completedHttp(page: Page) {
  const pending = new Set<HTTPRequest>();
  const waiters = new Set<() => void>();
  const asked = (request: HTTPRequest) => pending.add(request);
  const answered = (request: HTTPRequest) => {
    pending.delete(request);
    if (pending.size === 0) for (const resolve of waiters) resolve();
  };
  page.on("request", asked);
  page.on("requestfinished", answered);
  page.on("requestfailed", answered);
  page.once("close", () => {
    page.off("request", asked);
    page.off("requestfinished", answered);
    page.off("requestfailed", answered);
    for (const resolve of waiters) resolve();
  });
  return async (timeout = waitBudget()) => {
    let activeWaiter: (() => void) | undefined;
    try {
      await deadline(
        (async () => {
          for (;;) {
            if (page.isClosed()) throw new Error("Page closed while settling HTTP");
            if (pending.size > 0) {
              let resolve = () => {};
              try {
                await new Promise<void>((done) => {
                  resolve = done;
                  activeWaiter = done;
                  waiters.add(done);
                });
              } finally {
                waiters.delete(resolve);
                activeWaiter = undefined;
              }
            }
            if (page.isClosed()) throw new Error("Page closed while settling HTTP");
            // Observe a renderer turn after body completion: fetch continuations and native scheduler
            // jobs can dispatch another request. This is a rendering receipt, never a quiet-time sleep.
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                ),
            );
            if (pending.size === 0) return;
          }
        })(),
        `completed browser HTTP and renderer continuations: ${[...pending].map((request) => request.url()).join(", ")}`,
        timeout,
      );
    } finally {
      if (activeWaiter) waiters.delete(activeWaiter);
    }
  };
}
