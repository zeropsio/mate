// @effect-diagnostics nodeBuiltinImport:off -- the test HQ's local server and its receipts.
import { createTestHq, type TestHq } from "@zerops/session/testing/test-hq";
import * as NodeEvents from "node:events";
import type { Page } from "puppeteer-core";
import { ZEROPS_HQ_ORIGIN } from "./build.ts";
import { deadline, serve } from "./http.ts";
import { fromTestHq, toTestHq } from "./testHqWire.ts";

/** Mate's hosted origin, which Zerops HQ's bridge serves: a page there shares HQ's session. */
export const MATE_ORIGIN = "https://mate.zerops.io";
const ZEROPS_API = "https://api.app-prg1.zerops.io/api/rest/public";
/** Production HQ's least overlay sizes (hq's `FRAME_SIZES`). */
const FRAME_SIZES = { signIn: { width: 480, height: 944 }, sudo: { width: 480, height: 660 } };

/**
 * Zerops HQ for a scenario of the `zerops-hq` build: `@zerops/session`'s own test HQ, which runs the
 * package's bridge. It holds the session, and the platform fake hands it the API's `/auth/*`.
 */
export async function startZeropsHq(now: () => number) {
  const hq = createTestHq({
    origin: ZEROPS_HQ_ORIGIN,
    apiUrl: ZEROPS_API,
    allowedOrigins: [MATE_ORIGIN],
    frameSizes: FRAME_SIZES,
    now,
  });
  const answers = new NodeEvents.EventEmitter();
  const server = await serve(async (request) => {
    const response = await hq.handle(toTestHq(request));
    if (request.url.pathname === "/test-hq/consent" && response?.status === 200)
      answers.emit("answer");
    return fromTestHq(response);
  });
  return {
    hq,
    server,
    /** The next answer on HQ's consent page, once HQ has taken it. */
    answered: () =>
      deadline(
        new Promise<void>((resolve) => answers.once("answer", () => resolve())),
        "an answer on Zerops HQ's consent page",
      ),
  };
}

/** The person signed in at Zerops HQ in `page`'s browser, before the page loads anything of HQ's. */
export async function signedInAtHq(hq: TestHq, page: Page, userId: string) {
  const cookie = hq.signedInCookie(userId);
  await page.browserContext().setCookie({
    ...cookie,
    domain: new URL(ZEROPS_HQ_ORIGIN).hostname,
    path: "/",
    secure: true,
    sameSite: "Strict",
  });
}
