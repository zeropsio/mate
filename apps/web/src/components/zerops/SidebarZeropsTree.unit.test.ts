import { expect, it } from "vite-plus/test";
import { deletingHeldBy } from "../../zerops/deletingMates.ts";
import { projectHeadingMenu } from "./SidebarZeropsTree.logic.ts";

// witness: apps/web/src/components/zerops/SidebarZeropsTree.logic.ts | reorder === undefined || (!reorder.canMoveUp && !reorder.canMoveDown) → reorder === undefined
it("MN1: A project that cannot move is offered no move", () => {
  const entries = projectHeadingMenu({
    collapsed: false,
    onToggle: () => {},
    onAddMate: () => {},
    onOpen: () => {},
    reorder: { canMoveUp: false, canMoveDown: false, onMove: () => {} },
    setUp: [],
    onBrowseProjects: () => {},
  });
  const labels = entries.flatMap((entry) => (entry.kind === "item" ? [entry.label] : []));
  expect(labels).not.toContain("Move up");
  expect(labels).not.toContain("Move down");
  const separatorPairs = entries.filter(
    (entry, index) => entry.kind === "separator" && entries[index + 1]?.kind === "separator",
  );
  expect(separatorPairs).toEqual([]);
});

// witness: apps/web/src/zerops/deletingMates.ts | [...placements] → []
it("MN2: A Mate this tab deleted stays deleting while HQ still places it, after the listing let it go", () => {
  const placements = new Map([
    ["p-quinn", { appId: "app-shop", appName: "Shop", kind: "mate" as const, mate: {} }],
    [
      "p-fen",
      {
        appId: "app-shop",
        appName: "Shop",
        kind: "mate" as const,
        mate: {},
        unregistered: true as const,
      },
    ],
  ]);
  expect(deletingHeldBy(new Set(["p-ada"]), placements)).toEqual(new Set(["p-ada", "p-quinn"]));
  expect(deletingHeldBy(new Set(["p-ada"]), null)).toEqual(new Set(["p-ada"]));
});
