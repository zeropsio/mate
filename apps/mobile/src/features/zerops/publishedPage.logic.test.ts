import { describe, expect, it } from "vite-plus/test";

import {
  openFromTap,
  pageRequestAllowed,
  tapEnded,
  type PageTouchPoint,
} from "./publishedPage.logic";

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

  /** What the person's finger did, then the page asking to open links: whether each one opens. */
  const opens = (
    touches: ReadonlyArray<{ start: PageTouchPoint; end: PageTouchPoint }>,
    asks: ReadonlyArray<number>,
  ) => {
    let tappedAt: number | null = null;
    for (const touch of touches) tappedAt = tapEnded(touch.start, touch.end);
    return asks.map((now) => {
      const open = openFromTap(tappedAt, now);
      tappedAt = null;
      return open;
    });
  };
  const at = (time: number, x = 100, y = 200): PageTouchPoint => ({ at: time, x, y });

  it.each([
    {
      title: "a tap just now",
      touches: [{ start: at(10_000), end: at(10_120, 103, 198) }],
      asks: [10_200],
      want: [true],
    },
    {
      title: "a finger that scrolled the conversation",
      touches: [{ start: at(10_000), end: at(10_150, 100, 260) }],
      asks: [10_200],
      want: [false],
    },
    {
      title: "a long press",
      touches: [{ start: at(10_000), end: at(10_800) }],
      asks: [10_850],
      want: [false],
    },
    {
      title: "a second link after one tap",
      touches: [{ start: at(10_000), end: at(10_100) }],
      asks: [10_150, 10_200],
      want: [true, false],
    },
    {
      title: "a tap long ago",
      touches: [{ start: at(10_000), end: at(10_100) }],
      asks: [10_700],
      want: [false],
    },
    { title: "no tap at all", touches: [], asks: [10_000], want: [false] },
  ])("opens a link in the system browser only on the person's tap: $title", (input) => {
    expect(opens(input.touches, input.asks)).toEqual(input.want);
  });
});
