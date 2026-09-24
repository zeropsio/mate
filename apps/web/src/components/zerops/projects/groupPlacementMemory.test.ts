import { afterEach, describe, expect, it } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { lastGroupPlacement, rememberGroupPlacements } from "./groupPlacementMemory";

describe("where each group was last drawn", () => {
  afterEach(() => {
    closeAccountLifetime();
  });

  it("recalls nothing for a group never drawn", () => {
    openAccountLifetime("placement-a");
    expect(lastGroupPlacement("g-never")).toBeUndefined();
  });

  it("recalls the latest placement of each group", () => {
    openAccountLifetime("placement-a");
    rememberGroupPlacements([
      ["g-1", "tile"],
      ["g-2", "row"],
    ]);
    rememberGroupPlacements([["g-1", "row"]]);
    expect(lastGroupPlacement("g-1")).toBe("row");
    expect(lastGroupPlacement("g-2")).toBe("row");
  });

  it("forgets every placement when the account's lifetime closes", () => {
    openAccountLifetime("placement-a");
    rememberGroupPlacements([["g-1", "tile"]]);
    openAccountLifetime("placement-b");
    expect(lastGroupPlacement("g-1")).toBeUndefined();
  });
});
