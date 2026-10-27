/**
 * The closed menu on a desktop: an 88 px rail of tiles, one per project in the open menu's order
 * (the owner's pick of the Menu Rail Board, 2026-10-12: "we should do tiles and just not do
 * reveal"). A project of one Mate is that Mate's face over the project's name; a group of Mates is
 * its cluster over its name, and opens and folds in place with the menu's own fold. Each tile wears
 * one dot, the most urgent of its Mates': waits on you, stopped on an error, an unseen reply, at
 * work. Resting on the rail never shows the open menu.
 */
import { projectFolded, type ProjectFolds } from "~/zerops/collapsedProjects";

import { mateDotLabel } from "./SidebarMateRow.logic";
import {
  clusterFaces,
  groupHoldsCurrent,
  groupLead,
  groupRowPress,
  type LeadReading,
} from "./SidebarProjectRow.logic";

/** The dot on a rail tile: amber waits on you, red failed, blue a reply not yet seen, its tint at work. */
export type RailDot = "attention" | "failed" | "unread" | "working";

/** Most urgent first. */
const DOT_RANK: Readonly<Record<RailDot, number>> = {
  attention: 0,
  failed: 1,
  unread: 2,
  working: 3,
};

export function railDot(input: {
  readonly waits: boolean;
  readonly failed: boolean;
  readonly unread: boolean;
  readonly working: boolean;
}): RailDot | undefined {
  if (input.waits) return "attention";
  if (input.failed) return "failed";
  if (input.unread) return "unread";
  if (input.working) return "working";
  return undefined;
}

/** A group's one dot: the most urgent of its Mates'. */
export function railTileDot(dots: ReadonlyArray<RailDot | undefined>): RailDot | undefined {
  return dots.reduce<RailDot | undefined>(
    (best, dot) =>
      dot !== undefined && (best === undefined || DOT_RANK[dot] < DOT_RANK[best]) ? dot : best,
    undefined,
  );
}

/** A dot in words, as the menu's row says it to a screen reader and the tile's card says it. */
export function railDotWords(dot: RailDot): string {
  return dot === "working" ? "Working" : mateDotLabel(dot);
}

/**
 * The faces in the menu's order, one group per project in the order the projects come; a Mate the
 * menu has not drawn yet goes with its project, or last.
 */
export function railGroups<M extends { readonly projectId: string; readonly groupId: string }>(
  mates: ReadonlyArray<M>,
  order: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<M>> {
  const place = (projectId: string) => {
    const at = order.indexOf(projectId);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const groups = new Map<string, M[]>();
  for (const mate of mates.toSorted(
    (left, right) => place(left.projectId) - place(right.projectId),
  )) {
    const group = groups.get(mate.groupId);
    if (group === undefined) groups.set(mate.groupId, [mate]);
    else group.push(mate);
  }
  return [...groups.values()];
}

/** A Mate as a tile reads it: where it is, whose it is, its dot, and what leads a group. */
export interface RailTileMate extends LeadReading {
  /** Its project; empty for a Mate in no project. */
  readonly groupId: string;
  /** The viewer's own: a press on its folded group opens it when it is the viewer's only one. */
  readonly mine: boolean;
  readonly dot: RailDot | undefined;
}

export type RailTile<M extends RailTileMate> =
  /** A project of one Mate, or a Mate in no project: its face over the name. */
  | {
      readonly kind: "mate";
      readonly key: string;
      readonly mate: M;
      readonly current: boolean;
    }
  /** A project of several: its cluster over its name, its Mates' tiles under it while open. */
  | {
      readonly kind: "group";
      readonly key: string;
      readonly groupId: string;
      /** Every Mate of it, in its rows' order. */
      readonly mates: ReadonlyArray<M>;
      /** The cluster's faces, the lead first (`clusterFaces`). */
      readonly faces: ReadonlyArray<M>;
      readonly more: number;
      readonly open: boolean;
      readonly dot: RailDot | undefined;
      /** Folded around the open conversation: its tile stands for it. */
      readonly current: boolean;
      /** One of its Mates' conversations is open, folded or not. */
      readonly holdsCurrent: boolean;
    };

/** The rail's tiles: the menu's projects in its order, each folded as the menu has it. */
export function railTiles<M extends RailTileMate>(input: {
  readonly mates: ReadonlyArray<M>;
  /** Every Mate in the order the menu draws them (`sidebarReveal.ts`'s `mateOrder`). */
  readonly order: ReadonlyArray<string>;
  readonly folds: ProjectFolds;
  /** The Mate whose conversation is open. */
  readonly active: string | null;
}): ReadonlyArray<RailTile<M>> {
  const { folds, active } = input;
  const mateTile = (mate: M): RailTile<M> => ({
    kind: "mate",
    key: mate.projectId,
    mate,
    current: mate.projectId === active,
  });
  return railGroups(input.mates, input.order).flatMap((group): ReadonlyArray<RailTile<M>> => {
    const first = group[0];
    if (first === undefined) return [];
    // Mates in no project are each their own row in the menu, so each its own tile here.
    if (first.groupId === "" || group.length === 1) return group.map(mateTile);
    const open = !projectFolded(folds, first.groupId);
    const ids = group.map((mate) => mate.projectId);
    const cluster = clusterFaces(ids, groupLead(group).lead);
    return [
      {
        kind: "group",
        key: first.groupId,
        groupId: first.groupId,
        mates: group,
        faces: cluster.shown.flatMap((id) => group.filter((mate) => mate.projectId === id)),
        more: cluster.more,
        open,
        dot: railTileDot(group.map((mate) => mate.dot)),
        current: groupHoldsCurrent({ open, mates: ids, active: active ?? undefined }),
        holdsCurrent: active !== null && ids.includes(active),
      },
    ];
  });
}

/**
 * A press on a tile does what the press on its menu row does: a Mate's opens its conversation; a
 * group's folds or opens it, and opening it opens the viewer's one Mate in it (`groupRowPress`).
 */
export function railTilePress<M extends RailTileMate>(
  tile: RailTile<M>,
): {
  readonly fold: { readonly groupId: string; readonly open: boolean } | undefined;
  readonly select: string | undefined;
} {
  if (tile.kind === "mate") return { fold: undefined, select: tile.mate.projectId };
  const press = groupRowPress({
    open: tile.open,
    mine: tile.mates.filter((mate) => mate.mine).map((mate) => mate.projectId),
    current: tile.current,
  });
  return { fold: { groupId: tile.groupId, open: press.open }, select: press.select };
}
