import type { ZeropsOperation, ZeropsTimelineEntry } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import { operation } from "../chat/conversationFixtures";
import { CHECKED_PAGES_SHOWN, checkedPages } from "./browserChecks.logic";

/** A browser check as the conversation's Zerops model places it. */
function check(
  id: string,
  minute: number,
  subject: string,
  { picture = true, ...overrides }: Partial<ZeropsOperation> & { readonly picture?: boolean } = {},
): ZeropsTimelineEntry {
  const entry = operation(id, "t1", minute, {
    kind: "browser",
    subject,
    ...(picture ? { screenshot: { src: `data:image/png;base64,${id}` } } : {}),
    ...overrides,
  });
  if (entry.kind !== "operation") throw new Error("not an operation");
  const { operation: op } = entry;
  return {
    kind: "operation",
    key: op.key,
    anchorAt: op.anchorAt,
    anchorActivityId: op.anchorActivityId,
    operation: op,
  };
}

/** What a row says: its page, its screen, and a failure. */
const read = (entries: ReadonlyArray<ZeropsTimelineEntry>) =>
  checkedPages(entries).map((page) =>
    [page.page, page.screen, page.failed ? "failed" : null].filter(Boolean).join(" · "),
  );

describe("the pages the Mate checked, as the Browser page lists them", () => {
  it.each([
    {
      name: "a page seen at a desktop's size and at a phone's is two, the newest first",
      entries: [
        check("b1", 1, "https://shop.example.com/", {
          viewport: { width: 1280, height: 577 },
        }),
        check("b2", 2, "https://shop.example.com/", { deviceName: "iPhone 14" }),
        check("b3", 3, "https://shop.example.com/cart", {
          viewport: { width: 390, height: 844 },
        }),
      ],
      rows: ["/cart · Phone 390 × 844", "Home page · iPhone 14", "Home page · Desktop 1280 × 577"],
    },
    {
      name: "a page checked again on the same screen stands once, where it was checked last",
      entries: [
        check("b1", 1, "https://shop.example.com/cart"),
        check("b2", 2, "https://shop.example.com/"),
        check("b3", 3, "https://shop.example.com/cart"),
      ],
      rows: ["/cart · Desktop", "Home page · Desktop"],
    },
    {
      name: "a check with no picture and one still running list nothing",
      entries: [
        check("b1", 1, "https://shop.example.com/", { picture: false }),
        check("b2", 2, "https://shop.example.com/cart", { phase: "running" }),
      ],
      rows: [],
    },
    {
      name: "a failed check says so; one a later check of the page passed does not",
      entries: [
        check("b1", 1, "https://shop.example.com/", { phase: "failed" }),
        check("b2", 2, "https://shop.example.com/cart", { phase: "failed" }),
        check("b3", 3, "https://shop.example.com/", { deviceName: "iPhone 14" }),
      ],
      rows: ["Home page · iPhone 14", "/cart · Desktop · failed", "Home page · Desktop"],
    },
    {
      name: "a deploy is no page",
      entries: [check("d1", 1, "https://shop.example.com/", { kind: "deploy" })],
      rows: [],
    },
  ])("$name", ({ entries, rows }) => {
    expect(read(entries)).toEqual(rows);
  });

  it("lists only the newest pages", () => {
    const entries = Array.from({ length: CHECKED_PAGES_SHOWN + 2 }, (_, index) =>
      check(`b${index}`, index, `https://shop.example.com/p${index}`),
    );
    const pages = checkedPages(entries).map((page) => page.page);
    expect(pages).toHaveLength(CHECKED_PAGES_SHOWN);
    expect(pages[0]).toBe(`/p${CHECKED_PAGES_SHOWN + 1}`);
  });
});
