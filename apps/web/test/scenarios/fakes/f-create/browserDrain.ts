import type { HTTPRequest, Page } from "puppeteer-core";
import { deadline } from "../../harness/http.ts";

/** Drain platform HTTP only: HQ's long-lived stream is deliberately still connected. */
export function creationNetwork(page: Page) {
  const pending = new Set<HTTPRequest>();
  const waiters = new Set<() => void>();
  const asked = (request: HTTPRequest) => {
    if (new URL(request.url()).hostname === "api.app-prg1.zerops.io") pending.add(request);
  };
  const answered = (request: HTTPRequest) => {
    pending.delete(request);
    if (pending.size === 0) for (const resolve of waiters) resolve();
  };
  page.on("request", asked);
  page.on("requestfinished", answered);
  page.on("requestfailed", answered);
  return {
    async settled() {
      // Allow native zero-delay scheduler jobs and React's next paint to dispatch their HTTP.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      if (pending.size === 0) return;
      let resolve = () => {};
      try {
        await deadline(
          new Promise<void>((done) => {
            resolve = done;
            waiters.add(done);
          }),
          "creation platform requests drained",
        );
      } catch (cause) {
        throw new Error(
          `Platform requests still pending: ${[...pending]
            .map((request) => `${request.method()} ${new URL(request.url()).pathname}`)
            .join(", ")}`,
          { cause },
        );
      } finally {
        waiters.delete(resolve);
      }
    },
    close() {
      page.off("request", asked);
      page.off("requestfinished", answered);
      page.off("requestfailed", answered);
    },
  };
}
