import { describe, expect, it } from "vite-plus/test";

import { pageRequestAllowed, tappedJustNow } from "./publishedPage.logic";

describe("a published page on mobile cannot navigate or reach the network", () => {
  it.each([
    { title: "its own document", url: "about:blank", allowed: true },
    { title: "the page's frame inside it", url: "about:srcdoc", allowed: true },
    { title: "a website", url: "https://example.com/", allowed: false },
    { title: "a plain-http website", url: "http://example.com/", allowed: false },
    { title: "the Mate's own server", url: "https://mate.zerops.io/api", allowed: false },
    { title: "a data document", url: "data:text/html,<p>x</p>", allowed: false },
    { title: "a blob", url: "blob:null/1b2c", allowed: false },
    { title: "a file on the phone", url: "file:///var/mobile/x.html", allowed: false },
    { title: "a script", url: "javascript:alert(1)", allowed: false },
    { title: "another app", url: "tel:+420123456789", allowed: false },
    { title: "the app itself", url: "t3code://threads", allowed: false },
    { title: "a lookalike blank page", url: "about:blank#https://example.com", allowed: false },
  ])("its web view refuses every load but its own: $title", ({ url, allowed }) => {
    expect(pageRequestAllowed({ url })).toBe(allowed);
  });

  it.each([
    { title: "a tap just now", lastTouchAt: 10_000, now: 10_300, opens: true },
    { title: "a tap long ago", lastTouchAt: 10_000, now: 12_000, opens: false },
    { title: "no tap at all", lastTouchAt: null, now: 10_000, opens: false },
  ])("opens a link in the system browser only on the person's tap: $title", (input) => {
    expect(tappedJustNow(input.lastTouchAt, input.now)).toBe(input.opens);
  });
});
