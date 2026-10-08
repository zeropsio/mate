import type { CDPSession, HTTPRequest, Page } from "puppeteer-core";
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
  let navigationClient: CDPSession | undefined;
  let awaitingCommit: HTTPRequest | undefined;
  const isMainNavigation = (request: HTTPRequest) =>
    request.isNavigationRequest() && request.frame() === page.mainFrame();
  const notifyIfDrained = () => {
    if (pending.size === 0 && awaitingCommit === undefined)
      for (const resolve of waiters) resolve();
  };
  const committed = ({ frame }: { frame: { parentId?: string } }) => {
    if (frame.parentId !== undefined) return;
    awaitingCommit = undefined;
    // This native receipt excludes same-document navigation. Only replacement abandons old bodies.
    for (const request of pending) if (!isMainNavigation(request)) pending.delete(request);
    notifyIfDrained();
  };
  const asked = (request: HTTPRequest) => {
    const navigation = isMainNavigation(request);
    if (navigation) awaitingCommit = request;
    if (navigation && navigationClient !== request.client) {
      navigationClient?.off("Page.frameNavigated", committed);
      navigationClient = request.client;
      navigationClient.on("Page.frameNavigated", committed);
    }
    // Navigation's body remains a barrier even for a platform-only HTTP filter.
    if (navigation || includes(request)) pending.add(request);
  };
  const answered = (request: HTTPRequest) => {
    pending.delete(request);
    notifyIfDrained();
  };
  page.on("request", asked);
  page.on("requestfinished", answered);
  const failed = (request: HTTPRequest) => {
    if (awaitingCommit === request) awaitingCommit = undefined;
    answered(request);
  };
  page.on("requestfailed", failed);
  const close = () => {
    navigationClient?.off("Page.frameNavigated", committed);
    page.off("request", asked);
    page.off("requestfinished", answered);
    page.off("requestfailed", failed);
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
            if (pending.size > 0 || awaitingCommit !== undefined) {
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
            if (pending.size === 0 && awaitingCommit === undefined) return;
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
