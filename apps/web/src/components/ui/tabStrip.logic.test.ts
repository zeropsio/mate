import { describe, expect, it } from "vite-plus/test";

import { tabsCompact, tabsOutOfView } from "./tabStrip.logic";

describe("tabsOutOfView", () => {
  // Ten tabs in a 540 px panel cut "…ff" and "…les" off with nothing to reach them (stress run 3).
  it.each([
    ["every tab fits", { left: 0, right: 300 }, []],
    ["a tab cut by the left edge", { left: 82, right: 300 }, ["a"]],
    ["a tab cut by the right edge and one past it", { left: 0, right: 150 }, ["c", "d"]],
    ["scrolled to the middle", { left: 60, right: 190 }, ["a", "d"]],
  ] as const)(
    "The strip's overflow menu lists the tabs its edges cut off: %s",
    (_case, viewport, hidden) => {
      const tabs = [
        { id: "a", left: 0, right: 80 },
        { id: "b", left: 84, right: 140 },
        { id: "c", left: 144, right: 190 },
        { id: "d", left: 194, right: 260 },
      ];
      expect(tabsOutOfView(viewport, tabs)).toEqual(hidden);
    },
  );
});

describe("tabsCompact", () => {
  // Eleven pages in a 540 px panel read "rew · Terminal 1 · Files · Diff · Helpe… · 7 more", the
  // open page out of sight (the onboarding run, 2026-10-16).
  it.each([
    ["every name fits", [80, 60, 60], 220, false],
    ["the names fit to the pixel", [80, 60, 60], 208, false],
    ["the names outgrow the strip", [80, 60, 60, 90], 260, true],
    ["one more page than the names fit", [100, 100, 100, 100, 100], 500, true],
  ] as const)(
    "Tabs other than the open one fold to their icons once every name no longer fits: %s",
    (_case, widths, room, compact) => {
      expect(tabsCompact({ room, widths })).toBe(compact);
    },
  );
});
