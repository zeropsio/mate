import { describe, expect, it } from "vite-plus/test";

import type { ThreadRightPanelState } from "~/rightPanelStore";

import { conversationPanelStandIn, conversationPanelWidth } from "./conversationPanelStandIn.logic";

const overview: ThreadRightPanelState = {
  isOpen: true,
  activeSurfaceId: "overview",
  surfaces: [{ id: "overview", kind: "overview" }],
};

describe("conversationPanelStandIn", () => {
  it("A conversation whose panel was left open opens split, its panel waiting beside the Mate's opening", () => {
    const diff: ThreadRightPanelState = {
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [{ id: "diff", kind: "diff" }],
    };
    expect(conversationPanelStandIn({ panel: diff, sheet: false, chief: false })).toEqual({
      surfaces: diff.surfaces,
      activeSurfaceId: "diff",
      defaultWidth: undefined,
    });
  });

  it("A Chief's panel waits at the width its overview opens at", () => {
    expect(
      conversationPanelStandIn({ panel: overview, sheet: false, chief: true })?.defaultWidth,
    ).toBe(840);
  });

  it("A panel holding the overview is the Chief's, at its width before the directory names the Chief", () => {
    expect(conversationPanelWidth({ chief: false, surfaces: overview.surfaces })).toBe(840);
    expect(conversationPanelWidth({ chief: true, surfaces: [] })).toBe(840);
    expect(conversationPanelWidth({ chief: false, surfaces: [{ id: "diff", kind: "diff" }] })).toBe(
      undefined,
    );
  });

  it("A closed panel, or one a narrow window draws as a sheet over the page, leaves the opening full width", () => {
    expect(
      conversationPanelStandIn({
        panel: { ...overview, isOpen: false },
        sheet: false,
        chief: false,
      }),
    ).toBeNull();
    expect(conversationPanelStandIn({ panel: overview, sheet: true, chief: false })).toBeNull();
  });
});
