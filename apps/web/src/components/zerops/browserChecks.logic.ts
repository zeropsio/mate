/**
 * What the Browser page shows of the Mate's own checks: its test browser runs
 * only for each `zerops_browser` call and never reaches the live view, so the
 * pictures those calls took are what is left of what it looked at.
 */
import type { ZeropsOperation, ZeropsTimelineEntry } from "@t3tools/client-runtime/zerops/model";

import {
  browserCheckCaption,
  browserCheckDevice,
  browserCheckUrl,
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
  /** "Home page", "/teas/new", "Search: green". */
  readonly page: string;
  /** The screen it was seen on: "iPhone 14", "Desktop 1280 × 577". */
  readonly screen: string;
  /** When the check came back. */
  readonly at: string;
  /** It failed and no later check of the page passed. */
  readonly failed: boolean;
}

/** The query words a page is searched by. */
const SEARCH_KEYS = new Set(["q", "query", "search", "s"]);

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The page a check looked at, as a person names it: its path — a hash route's own, where the app
 * routes by one — the front page by name, and what its query asks in words ("Search: green").
 */
function pageWords(take: ZeropsOperation): string {
  const url = browserCheckUrl(take);
  if (url === null) {
    const caption = browserCheckCaption(take);
    return caption === "/" ? "Home page" : caption;
  }
  const routed = url.hash.startsWith("#/");
  const [routePath = "", routeQuery = ""] = routed ? url.hash.slice(1).split("?", 2) : [];
  const path = decoded(routed ? routePath : url.pathname) || "/";
  const params = [...new URLSearchParams(routed ? routeQuery : url.search)].filter(
    ([, value]) => value.trim() !== "",
  );
  const asked = params.map(([key, value]) =>
    SEARCH_KEYS.has(key.toLowerCase()) ? `Search: ${value}` : `${key}: ${value}`,
  );
  const searched = params.some(([key]) => SEARCH_KEYS.has(key.toLowerCase()));
  const page = path === "/" ? (searched ? undefined : "Home page") : path;
  return [page, ...asked].filter((part) => part !== undefined).join(" · ");
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
    const view = `${browserCheckUrl(check)?.host ?? ""}${pageWords(check)} on ${screenWords(check)}`;
    lastByView.delete(view);
    lastByView.set(view, check);
  }
  return [...lastByView.values()]
    .toReversed()
    .slice(0, CHECKED_PAGES_SHOWN)
    .map((take) => {
      return {
        key: take.key,
        take,
        page: pageWords(take),
        screen: screenWords(take),
        at: take.settledAt ?? take.anchorAt,
        failed: browserTakeState(take, checks) === "failed",
      };
    });
}
