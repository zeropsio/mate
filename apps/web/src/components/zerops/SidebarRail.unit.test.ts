import type { ZeropsGroupPendingMember } from "@t3tools/client-runtime/zerops";
import { expect, it } from "vite-plus/test";
import { comingStopped, mateComingRowView, mateRowView } from "./SidebarMateRow.logic.ts";
import {
  comingDot,
  railMateDot,
  railTilePress,
  railTiles,
  type RailTileMate,
} from "./SidebarRail.logic.ts";

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
    birthOf: () => undefined,
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
      ? [
          ...shop.mates.map((each) => each.projectId),
          ...shop.coming.map((each) => each.member.projectId),
        ]
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

// witness: apps/web/src/components/zerops/SidebarRail.logic.ts | comingDot(each.stopped) → undefined
it("MN15: A folded project's rail tile shows its coming Mates among its faces and wears the most urgent dot of all its Mates, a stopped coming one's included; breaks: a project whose added Mate stopped looks calm on the folded rail", () => {
  const [shop] = railTiles({
    mates: [ada],
    order: ["p-ada", "p-petra"],
    // Shop folded to its tile.
    folds: { closed: new Set(["g-shop"]), opened: new Set() },
    personFacts: {},
    // Petra's creation stopped, as its birth row says.
    comingByGroup: { "g-shop": [petra] },
    birthOf: (birthId) => (birthId === petra.intent ? { attention: true } : undefined),
    projectName: (groupId) => names[groupId],
    active: null,
  });

  expect(
    shop?.kind === "group"
      ? {
          open: shop.open,
          faces: shop.faces.map((face) =>
            face.kind === "mate" ? face.mate.projectId : face.member.projectId,
          ),
          dot: shop.dot,
        }
      : undefined,
  ).toEqual({ open: false, faces: ["p-ada", "p-petra"], dot: "failed" });
});

// witness: apps/web/src/components/zerops/SidebarMateRow.logic.ts | birth?.attention ?? member.failed === true → member.failed === true
it("MN18: A Mate on the folded rail wears the dot its menu row wears, and a coming one wears the stopped dot exactly when the menu draws it stopped; breaks: a Mate whose setup stopped looks calm on the folded rail", () => {
  const up = mateRowView(undefined, "idle");
  const listed = [
    { state: "up, at work, row dot none", view: up, working: true },
    {
      state: "up, waits on the viewer",
      view: { ...up, dot: "attention" as const },
      working: false,
    },
    { state: "up, stopped on an error", view: { ...up, dot: "failed" as const }, working: false },
    {
      state: "coming, setup under way",
      view: mateComingRowView(up, { kind: "coming", line: "Coming up. A few minutes." }),
      working: true,
    },
    {
      state: "setup stopped",
      view: mateComingRowView(up, {
        kind: "failed",
        line: "Could not be set up.",
        verb: "remove",
      }),
      working: false,
    },
  ];
  const coming = [
    { state: "birth row going", member: petra, birth: { attention: false } },
    { state: "birth row stopped", member: petra, birth: { attention: true } },
    { state: "no birth row, failed unset", member: petra, birth: undefined },
  ];

  expect([
    ...listed.map((row) => [row.state, railMateDot(row.view, row.working)]),
    ...coming.map((row) => [row.state, comingDot(comingStopped(row.member, row.birth))]),
  ]).toEqual([
    ["up, at work, row dot none", "working"],
    ["up, waits on the viewer", "attention"],
    ["up, stopped on an error", "failed"],
    ["coming, setup under way", undefined],
    ["setup stopped", "attention"],
    ["birth row going", undefined],
    ["birth row stopped", "failed"],
    ["no birth row, failed unset", undefined],
  ]);
});
