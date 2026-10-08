import type { Page } from "puppeteer-core";
import { completedHttp } from "../../harness/completedHttp.ts";

/** Drain platform bodies and their renderer continuations; HQ's stream stays connected. */
export function creationNetwork(page: Page) {
  const settle = completedHttp(
    page,
    (request) => new URL(request.url()).hostname === "api.app-prg1.zerops.io",
  );
  return { settled: () => settle(15_000), close: settle.close };
}
