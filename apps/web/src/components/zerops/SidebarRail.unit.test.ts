import type { ZeropsGroupPendingMember } from "@t3tools/client-runtime/zerops";
import { expect, it } from "vite-plus/test";
import { railTilePress, railTiles, type RailTileMate } from "./SidebarRail.logic.ts";

function mate(projectId: string, groupId: string): RailTileMate {
  return {
    projectId,
    groupId,
    owner: { isViewer: true },
    dot: undefined,
    asksViewer: false,
    at: undefined,
    working: false,
    runSince: undefined,
  };
}

const ada = mate("p-ada", "g-shop");
const bo = mate("p-bo", "g-blog");
// Being added to Shop, whose Ada is listed.
const petra: ZeropsGroupPendingMember = {
  projectId: "p-petra",
  intent: "birth-petra",
  kind: "mate",
  name: "Petra",
};
// A New project's first Mate, refused by Zerops before its project was made.
const yara: ZeropsGroupPendingMember = {
  projectId: "birth-yara",
  intent: "birth-yara",
  kind: "mate",
  name: "Yara",
  face: { tint: "rose", shape: "flower" },
  failed: true,
};
const names: Record<string, string> = { "g-shop": "Shop", "g-blog": "Blog", "g-q4d": "Q4d" };

// witness: apps/web/src/components/zerops/SidebarRail.logic.ts | listed.has(groupId) → listed.size > 0
it("MN11: The closed menu's rail draws a tile for every Mate the open menu draws in a project, one being created or stopped before its project was made included", () => {
  const tiles = railTiles({
    mates: [bo, ada],
    // The open menu draws Shop (Ada, then Petra coming), then Yara's project, then Blog.
    order: ["p-ada", "p-petra", "birth-yara", "p-bo"],
    folds: { closed: new Set(), opened: new Set(["g-shop"]) },
    personFacts: {},
    comingByGroup: { "g-shop": [petra], "g-q4d": [yara] },
    projectName: (groupId) => names[groupId],
    active: null,
  });

  expect(tiles.map((tile) => `${tile.kind} ${tile.key}`)).toEqual([
    "group g-shop",
    "coming coming:birth-yara",
    "mate p-bo",
  ]);
  const [shop, stopped] = tiles;
  expect(shop?.kind === "group" && shop.open).toBe(true);
  expect(
    shop?.kind === "group"
      ? [...shop.mates.map((each) => each.projectId), ...shop.coming.map((each) => each.projectId)]
      : [],
  ).toEqual(["p-ada", "p-petra"]);
  expect(
    stopped?.kind === "coming"
      ? { groupId: stopped.groupId, name: stopped.projectName, failed: stopped.member.failed }
      : undefined,
  ).toEqual({ groupId: "g-q4d", name: "Q4d", failed: true });
  expect(stopped === undefined ? undefined : railTilePress(stopped)).toEqual({
    fold: undefined,
    select: undefined,
    open: "birth-yara",
  });
});
