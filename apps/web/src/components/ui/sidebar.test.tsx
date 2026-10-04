import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarOpenerPlacement, resolveSidebarState } from "./sidebarState";

describe("responsive sidebar state", () => {
  it("uses mobile sheet visibility for the shared responsive state", () => {
    expect(resolveSidebarState({ isMobile: true, open: true, openMobile: false })).toBe(
      "collapsed",
    );
    expect(resolveSidebarState({ isMobile: true, open: false, openMobile: true })).toBe("expanded");
    expect(resolveSidebarState({ isMobile: false, open: true, openMobile: false })).toBe(
      "expanded",
    );
  });
});

describe("the closed menu's opener", () => {
  it.each([
    // A phone: the composer is the screen's last thing, so the opener stands
    // in the top bar's start corner, where the open sheet's own control is.
    { isMobile: true, state: "collapsed", placement: "top" },
    // A wider window: the corner keeps the mark, the opener the column's foot.
    { isMobile: false, state: "collapsed", placement: "foot" },
    // Open, the menu carries its own controls.
    { isMobile: true, state: "expanded", placement: "none" },
    { isMobile: false, state: "expanded", placement: "none" },
  ] as const)(
    "$state on mobile=$isMobile stands at $placement",
    ({ isMobile, state, placement }) => {
      expect(resolveSidebarOpenerPlacement({ isMobile, state })).toBe(placement);
    },
  );
});
