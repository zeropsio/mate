/**
 * What the Browser page shows of the Mate's own checks: its test browser runs
 * only for each `zerops_browser` call and never reaches the live view, so the
 * pictures those calls took are what is left of what it looked at.
 */
import type { ZeropsOperation, ZeropsTimelineEntry } from "@t3tools/client-runtime/zerops/model";

import {
  browserCheckCaption,
  browserCheckDevice,
  browserCheckPage,
  browserTakeState,
  type BrowserDevice,
} from "../chat/conversation.logic";

/** As many pages as the page lists: the newest. */
export const CHECKED_PAGES_SHOWN = 6;

const DEVICE_WORD: Record<BrowserDevice, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  phone: "Phone",
};

export interface CheckedPage {
  readonly key: string;
  /** The check whose picture stands for the page on its screen. */
  readonly take: ZeropsOperation;
  /** "Home page", "/teas/new". */
  readonly page: string;
  /** The screen it was seen on: "iPhone 14", "Desktop 1280 × 577". */
  readonly screen: string;
  /** When the check came back. */
  readonly at: string;
  /** It failed and no later check of the page passed. */
  readonly failed: boolean;
}

function screenWords(take: ZeropsOperation): string {
  if (take.deviceName !== undefined) return take.deviceName;
  const word = DEVICE_WORD[browserCheckDevice(take)];
  const viewport = take.viewport;
  return viewport === undefined ? word : `${word} ${viewport.width} × ${viewport.height}`;
}

/**
 * The pages the Mate checked in this conversation, newest first: each page's
 * last check with a picture on each screen it was seen on — a page seen at a
 * desktop's size and at a phone's is two. A check still running has no picture yet.
 */
export function checkedPages(entries: ReadonlyArray<ZeropsTimelineEntry>): CheckedPage[] {
  const checks = entries.flatMap((entry) =>
    entry.kind === "operation" && entry.operation.kind === "browser" ? [entry.operation] : [],
  );
  const lastByView = new Map<string, ZeropsOperation>();
  for (const check of checks) {
    if (check.phase === "running" || check.screenshot === undefined) continue;
    const view = `${browserCheckPage(check)} on ${screenWords(check)}`;
    lastByView.delete(view);
    lastByView.set(view, check);
  }
  return [...lastByView.values()]
    .toReversed()
    .slice(0, CHECKED_PAGES_SHOWN)
    .map((take) => {
      const caption = browserCheckCaption(take);
      return {
        key: take.key,
        take,
        page: caption === "/" ? "Home page" : caption,
        screen: screenWords(take),
        at: take.settledAt ?? take.anchorAt,
        failed: browserTakeState(take, checks) === "failed",
      };
    });
}
