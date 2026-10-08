import type { HTTPRequest, Page } from "puppeteer-core";
import { deadline } from "./http.ts";

/** Native scheduler jobs and React continuations get a renderer turn before the next action. */
export const rendered = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

/** Track response bodies through completion; Puppeteer's network-idle counter ends at headers. */
export function completedHttp(
  page: Page,
  includes: (request: HTTPRequest) => boolean = () => true,
) {
  const pending = new Set<HTTPRequest>();
  const waiters = new Set<() => void>();
  const asked = (request: HTTPRequest) => {
    // Chrome can abandon intercepted bodies without a terminal event when their document leaves.
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      pending.clear();
      for (const resolve of waiters) resolve();
    }
    if (includes(request)) pending.add(request);
  };
  const answered = (request: HTTPRequest) => {
    pending.delete(request);
    if (pending.size === 0) for (const resolve of waiters) resolve();
  };
  page.on("request", asked);
  page.on("requestfinished", answered);
  page.on("requestfailed", answered);
  const close = () => {
    page.off("request", asked);
    page.off("requestfinished", answered);
    page.off("requestfailed", answered);
    page.off("close", close);
    for (const resolve of waiters) resolve();
  };
  page.once("close", close);
  const settle = async (timeout = 10_000) => {
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
            await rendered(page);
            if (pending.size === 0) return;
          }
        })(),
        "completed browser HTTP and renderer continuations",
        timeout,
      );
    } finally {
      if (activeWaiter) waiters.delete(activeWaiter);
    }
  };
  return Object.assign(settle, { close });
}
