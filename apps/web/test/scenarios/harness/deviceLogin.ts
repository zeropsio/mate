import type { Page } from "puppeteer-core";
import type { ZeropsFake } from "../fakes/zerops.ts";
import type { openBrowser } from "./browser.ts";
import { deadline } from "./http.ts";

/**
 * Clicks `button` and answers the Zerops window it opens, routed. The platform holds the request
 * until then: the window opens blank and is pointed at the consent page once the request exists.
 */
export async function openZeropsWindow(
  web: Pick<Awaited<ReturnType<typeof openBrowser>>, "popup">,
  zerops: ZeropsFake,
  page: Page,
  button: string,
) {
  const release = zerops.deviceLogin.holdStarts();
  try {
    return await web.popup(page, () => page.locator(`::-p-aria(${button})`).click());
  } finally {
    release();
  }
}

/** The person's answer on the consent page; the window closes after it. */
export async function answerInZerops(window: Page, decision: "Approve" | "Deny") {
  const closed = new Promise<void>((resolve) => window.once("close", () => resolve()));
  await window.locator(`::-p-aria(${decision}[role="button"])`).click();
  await deadline(closed, "the Zerops window closing");
}
