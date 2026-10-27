import type { HTTPRequest, Page } from "puppeteer-core";
import { deadline } from "../../harness/http.ts";

/** Settle real HQ replies without blocking unrelated account refreshes between virtual timer callbacks. */
export function receivedHqReplies(page: Page, routes: Record<string, string>, hqOrigin: string) {
  const origins = new Set(
    Object.entries(routes)
      .filter(([, target]) => target === hqOrigin)
      .map(([origin]) => origin),
  );
  const pending = new Map<HTTPRequest, { reply: Promise<void>; resolve: () => void }>();
  const request = (request: HTTPRequest) => {
    if (!origins.has(new URL(request.url()).origin)) return;
    let resolve = () => {};
    const reply = new Promise<void>((done) => {
      resolve = done;
    });
    pending.set(request, { reply, resolve });
  };
  const received = (request: HTTPRequest) => {
    pending.get(request)?.resolve();
    pending.delete(request);
  };
  page.on("request", request);
  page.on("response", (response) => received(response.request()));
  page.on("requestfailed", received);
  page.on("requestfinished", received);
  return async () => {
    while (pending.size > 0)
      await deadline(
        Promise.all([...pending.values()].map(({ reply }) => reply)),
        "HQ HTTP replies received",
      );
  };
}
