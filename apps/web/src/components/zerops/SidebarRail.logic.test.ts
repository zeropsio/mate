import { describe, expect, it } from "vite-plus/test";

import {
  railDot,
  railGroups,
  railTileDot,
  railTilePress,
  railTiles,
  type RailDot,
  type RailTileMate,
} from "./SidebarRail.logic";

describe("railDot — the small dot on a rail face", () => {
  it.each([
    {
      title: "amber when it waits on you",
      waits: true,
      failed: false,
      unread: false,
      working: false,
      dot: "attention",
    },
    {
      title: "waiting on you outranks a failure",
      waits: true,
      failed: true,
      unread: false,
      working: false,
      dot: "attention",
    },
    {
      title: "red when it failed",
      waits: false,
      failed: true,
      unread: true,
      working: false,
      dot: "failed",
    },
    {
      title: "blue for a result not yet seen",
      waits: false,
      failed: false,
      unread: true,
      working: true,
      dot: "unread",
    },
    {
      title: "its tint while it works and nothing else is to say",
      waits: false,
      failed: false,
      unread: false,
      working: true,
      dot: "working",
    },
    {
      title: "none while all is well",
      waits: false,
      failed: false,
      unread: false,
      working: false,
      dot: undefined,
    },
  ] as const)("$title", ({ waits, failed, unread, working, dot }) => {
    expect(railDot({ waits, failed, unread, working })).toBe(dot);
  });
});

describe("railTileDot — a group's one dot is its most urgent Mate's", () => {
  it.each([
    {
      title: "waits on you over everything",
      dots: ["working", "failed", "attention"],
      dot: "attention",
    },
    {
      title: "an error over an unseen reply",
      dots: ["unread", undefined, "failed"],
      dot: "failed",
    },
    { title: "an unseen reply over work", dots: ["working", "unread"], dot: "unread" },
    { title: "work when nothing else", dots: [undefined, "working"], dot: "working" },
    { title: "none when all are well", dots: [undefined, undefined], dot: undefined },
  ] as const satisfies ReadonlyArray<{
    title: string;
    dots: ReadonlyArray<RailDot | undefined>;
    dot: RailDot | undefined;
  }>)("$title", ({ dots, dot }) => {
    expect(railTileDot(dots)).toBe(dot);
  });
});

describe("railGroups — the faces grouped by project, in the menu's order", () => {
  const mate = (projectId: string, groupId: string) => ({ projectId, groupId });

  it("keeps the menu's order, one group per project, a hairline's worth apart", () => {
    const groups = railGroups(
      [mate("milo", "ledger"), mate("sage", "tea"), mate("noibit", "ledger"), mate("rhea", "tea")],
      ["sage", "rhea", "noibit", "milo"],
    );
    expect(groups.map((group) => group.map((entry) => entry.projectId))).toEqual([
      ["sage", "rhea"],
      ["noibit", "milo"],
    ]);
  });

  it("puts a Mate the menu has not drawn yet with its project, or last", () => {
    const groups = railGroups(
      [mate("new", "tea"), mate("sage", "tea"), mate("fen", "mobile")],
      ["sage"],
    );
    expect(groups.map((group) => group.map((entry) => entry.projectId))).toEqual([
      ["sage", "new"],
      ["fen"],
    ]);
  });
});

const mate = (
  projectId: string,
  groupId: string,
  extra: Partial<RailTileMate> = {},
): RailTileMate => ({
  projectId,
  groupId,
  mine: true,
  dot: undefined,
  asksViewer: false,
  at: undefined,
  working: false,
  runSince: undefined,
  ...extra,
});
const FOLDED = { closed: new Set<string>(), opened: new Set<string>() };
const OPEN_TEA = { closed: new Set<string>(), opened: new Set(["tea"]) };
/** A tile as a line: a Mate's id, or a group's id with its Mates and how it stands. */
const said = (tiles: ReturnType<typeof railTiles>) =>
  tiles.map((tile) =>
    tile.kind === "mate"
      ? tile.mate.projectId
      : `${tile.groupId}(${tile.mates.map((entry) => entry.projectId).join(",")})${tile.open ? " open" : ""}`,
  );

describe("railTiles — one tile per project, in the open menu's order", () => {
  it.each([
    {
      title: "a project of one Mate is that Mate's tile, a project of several one group tile",
      mates: [mate("noibit", "ledger"), mate("sage", "tea"), mate("rhea", "tea")],
      order: ["sage", "rhea", "noibit"],
      folds: FOLDED,
      tiles: ["tea(sage,rhea)", "noibit"],
    },
    {
      title: "the projects stand in the menu's order, a group's Mates in its rows' order",
      mates: [mate("sage", "tea"), mate("noibit", "ledger"), mate("rhea", "tea")],
      order: ["noibit", "rhea", "sage"],
      folds: FOLDED,
      tiles: ["noibit", "tea(rhea,sage)"],
    },
    {
      title: "Mates in no project are each their own tile, after the projects",
      mates: [mate("juno", ""), mate("noibit", "ledger"), mate("vesta", "")],
      order: ["noibit", "juno", "vesta"],
      folds: FOLDED,
      tiles: ["noibit", "juno", "vesta"],
    },
    {
      title: "a group stands open where the menu has it open",
      mates: [
        mate("sage", "tea"),
        mate("rhea", "tea"),
        mate("milo", "ledger"),
        mate("ivy", "ledger"),
      ],
      order: ["sage", "rhea", "milo", "ivy"],
      folds: OPEN_TEA,
      tiles: ["tea(sage,rhea) open", "ledger(milo,ivy)"],
    },
  ])("$title", ({ mates, order, folds, tiles }) => {
    expect(said(railTiles({ mates, order, folds, active: null }))).toEqual(tiles);
  });

  it("wears its most urgent Mate's dot on a group, and its own on a Mate's tile", () => {
    const tiles = railTiles({
      mates: [
        mate("sage", "tea", { dot: "working" }),
        mate("rhea", "tea", { dot: "failed" }),
        mate("noibit", "ledger", { dot: "unread" }),
      ],
      order: ["sage", "rhea", "noibit"],
      folds: FOLDED,
      active: null,
    });
    expect(tiles.map((tile) => (tile.kind === "mate" ? tile.mate.dot : tile.dot))).toEqual([
      "failed",
      "unread",
    ]);
  });

  it("leads a group's cluster with the Mate that asks the viewer, then the rest in order", () => {
    const [tile] = railTiles({
      mates: [
        mate("sage", "tea"),
        mate("rhea", "tea"),
        mate("ivy", "tea", { asksViewer: true, at: "2026-10-12T10:00:00Z" }),
        mate("milo", "tea"),
      ],
      order: ["sage", "rhea", "ivy", "milo"],
      folds: FOLDED,
      active: null,
    });
    expect(
      tile?.kind === "group"
        ? { faces: tile.faces.map((entry) => entry.projectId), more: tile.more }
        : undefined,
    ).toEqual({ faces: ["ivy", "sage", "rhea"], more: 1 });
  });

  it.each([
    {
      title: "a Mate's tile is the open one when its conversation is",
      folds: FOLDED,
      active: "noibit",
      current: ["noibit"],
    },
    {
      title: "a folded group's tile stands for its open Mate",
      folds: FOLDED,
      active: "rhea",
      current: ["tea"],
    },
    {
      title: "an open group leaves the mark to its Mate's tile",
      folds: OPEN_TEA,
      active: "rhea",
      current: [],
    },
  ])("$title", ({ folds, active, current }) => {
    const tiles = railTiles({
      mates: [mate("sage", "tea"), mate("rhea", "tea"), mate("noibit", "ledger")],
      order: ["sage", "rhea", "noibit"],
      folds,
      active,
    });
    expect(tiles.filter((tile) => tile.current).map((tile) => tile.key)).toEqual(current);
  });
});

describe("railTilePress — a tile's press does what its menu row's does", () => {
  const tea = (mine: readonly [boolean, boolean], folds = FOLDED, active: string | null = null) =>
    railTiles({
      mates: [mate("sage", "tea", { mine: mine[0] }), mate("rhea", "tea", { mine: mine[1] })],
      order: ["sage", "rhea"],
      folds,
      active,
    })[0]!;

  it.each([
    {
      title: "a folded group opens, with the viewer's one Mate in it",
      tile: tea([false, true]),
      press: { fold: { groupId: "tea", open: true }, select: "rhea" },
    },
    {
      title: "a folded group of several of the viewer's opens alone",
      tile: tea([true, true]),
      press: { fold: { groupId: "tea", open: true }, select: undefined },
    },
    {
      title: "a group folded around the open conversation opens and keeps it",
      tile: tea([false, true], FOLDED, "sage"),
      press: { fold: { groupId: "tea", open: true }, select: undefined },
    },
    {
      title: "an open group folds, the conversation staying",
      tile: tea([false, true], OPEN_TEA, "rhea"),
      press: { fold: { groupId: "tea", open: false }, select: undefined },
    },
  ])("$title", ({ tile, press }) => {
    expect(railTilePress(tile)).toEqual(press);
  });

  it("opens a Mate's conversation from its own tile", () => {
    const [tile] = railTiles({
      mates: [mate("noibit", "ledger")],
      order: ["noibit"],
      folds: FOLDED,
      active: null,
    });
    expect(railTilePress(tile!)).toEqual({ fold: undefined, select: "noibit" });
  });
});
