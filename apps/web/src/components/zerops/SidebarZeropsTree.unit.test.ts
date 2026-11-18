import { expect, it } from "vite-plus/test";
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
