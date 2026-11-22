/**
 * The closed menu on a desktop: an 88 px rail of tiles, one per project in the open menu's order
 * (the owner's pick of the Menu Rail Board, 2026-10-12: "we should do tiles and just not do
 * reveal"). A project of one Mate is that Mate's face over the project's name; a group of Mates is
 * its cluster over its name, and opens and folds in place with the menu's own fold. Each tile wears
 * one dot, the most urgent of its Mates': waits on you, stopped on an error, an unseen reply, at
 * work. Resting on the rail never shows the open menu.
 */
import type { ZeropsGroupPendingMember } from "@t3tools/client-runtime/zerops";
import { projectFolded, type ProjectFolds } from "~/zerops/collapsedProjects";

import { comingStopped, mateDotLabel, type MateRowView } from "./SidebarMateRow.logic";
import {
  clusterFaces,
  groupHoldsCurrent,
  groupLead,
  groupRowPress,
  viewerMates,
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

/**
 * A listed Mate's one dot: its menu row's (`mateRowView`, `mateComingRowView` while it comes up or
 * its setup stopped), and its tint at work, which only the rail draws, where the row's is none —
 * never while it is still coming up: its row says only that.
 */
export function railMateDot(
  view: Pick<MateRowView, "dot" | "coming">,
  working: boolean,
): RailDot | undefined {
  return view.dot ?? (working && view.coming === undefined ? "working" : undefined);
}

/** A coming Mate's one dot: red exactly when the menu draws it stopped (`comingStopped`). */
export function comingDot(stopped: boolean): RailDot | undefined {
  return stopped ? "failed" : undefined;
}

/** A Mate being created as the rail draws it: whether the menu draws it stopped (`comingStopped`). */
export interface RailComing {
  readonly member: ZeropsGroupPendingMember;
  readonly stopped: boolean;
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
  readonly owner: { readonly isViewer: boolean } | undefined;
  readonly dot: RailDot | undefined;
}

/** A face in a group tile's cluster: a listed Mate, or one being created. */
export type RailGroupFace<M extends RailTileMate> =
  | { readonly kind: "mate"; readonly mate: M }
  | ({ readonly kind: "coming" } & RailComing);

export type RailTile<M extends RailTileMate> =
  /** A project of one Mate, or a Mate in no project: its face over the name. */
  | {
      readonly kind: "mate";
      readonly key: string;
      readonly mate: M;
      readonly current: boolean;
    }
  /**
   * A project whose one Mate is still being created, its project perhaps not made yet: the face its
   * person picked over the project's name, as the menu draws its coming row.
   */
  | ({
      readonly kind: "coming";
      readonly key: string;
      readonly groupId: string;
      /** The project's name; empty while the menu knows none. */
      readonly projectName: string;
      readonly current: boolean;
    } & RailComing)
  /** A project of several: its cluster over its name, its Mates' tiles under it while open. */
  | {
      readonly kind: "group";
      readonly key: string;
      readonly groupId: string;
      /** Every Mate of it, in its rows' order. */
      readonly mates: ReadonlyArray<M>;
      readonly personFacts: Parameters<typeof viewerMates>[1];
      /** Its Mates being created, drawn after its listed ones as the menu's rows are. */
      readonly coming: ReadonlyArray<RailComing>;
      /** The cluster's faces, listed Mates then coming ones, the lead first (`clusterFaces`). */
      readonly faces: ReadonlyArray<RailGroupFace<M>>;
      readonly more: number;
      readonly open: boolean;
      readonly dot: RailDot | undefined;
      /** Folded around the open conversation: its tile stands for it. */
      readonly current: boolean;
      /** One of its Mates' conversations is open, folded or not. */
      readonly holdsCurrent: boolean;
    };

/**
 * The rail's tiles: one per project the menu draws a Mate in, in its order, each folded as the menu
 * has it. A project the menu draws only a coming Mate in — its setup under way, or stopped before
 * its project was made — is that Mate's tile: the listing holds nothing of it yet.
 */
export function railTiles<M extends RailTileMate>(input: {
  readonly mates: ReadonlyArray<M>;
  /** Every Mate in the order the menu draws them (`sidebarReveal.ts`'s `mateOrder`). */
  readonly order: ReadonlyArray<string>;
  readonly folds: ProjectFolds;
  readonly personFacts: Parameters<typeof viewerMates>[1];
  /** The members the menu draws as coming rows, by project (`menuComingMatesAtom`). */
  readonly comingByGroup: Readonly<Record<string, ReadonlyArray<ZeropsGroupPendingMember>>>;
  /** A coming Mate's birth row by its birth, as the menu reads it (`getBirth`). */
  readonly birthOf: (birthId: string) => { readonly attention: boolean } | undefined;
  readonly projectName: (groupId: string) => string | undefined;
  /** The Mate whose conversation is open. */
  readonly active: string | null;
}): ReadonlyArray<RailTile<M>> {
  const { folds, active, order } = input;
  const place = (projectId: string | undefined) => {
    const at = projectId === undefined ? -1 : order.indexOf(projectId);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const mateTile = (mate: M): RailTile<M> => ({
    kind: "mate",
    key: mate.projectId,
    mate,
    current: mate.projectId === active,
  });
  // Keyed by its birth where it has one, as the menu's row is: the tile stays the same tile while
  // its project's id replaces the creation's own.
  const railComing = (member: ZeropsGroupPendingMember): RailComing => ({
    member,
    stopped: comingStopped(
      member,
      member.intent === undefined ? undefined : input.birthOf(member.intent),
    ),
  });
  const comingTile = (groupId: string, member: ZeropsGroupPendingMember): RailTile<M> => ({
    kind: "coming",
    key: `coming:${member.intent ?? member.projectId}`,
    ...railComing(member),
    groupId,
    projectName: input.projectName(groupId) ?? "",
    current: member.projectId === active,
  });
  const groupTiles = (group: ReadonlyArray<M>): ReadonlyArray<RailTile<M>> => {
    const first = group[0];
    if (first === undefined) return [];
    // Mates in no project are each their own row in the menu, so each its own tile here.
    const coming = (input.comingByGroup[first.groupId] ?? []).map(railComing);
    if (first.groupId === "" || group.length + coming.length === 1) return group.map(mateTile);
    const open = !projectFolded(folds, first.groupId);
    // Listed Mates then coming ones, as the menu's group row clusters them.
    const memberIds = [
      ...group.map((mate) => mate.projectId),
      ...coming.map((each) => each.member.projectId),
    ];
    const cluster = clusterFaces(memberIds, groupLead(group).lead);
    return [
      {
        kind: "group",
        coming,
        personFacts: input.personFacts,
        key: first.groupId,
        groupId: first.groupId,
        mates: group,
        faces: cluster.shown.flatMap((id): ReadonlyArray<RailGroupFace<M>> => {
          const mate = group.find((each) => each.projectId === id);
          if (mate !== undefined) return [{ kind: "mate", mate }];
          const each = coming.find((candidate) => candidate.member.projectId === id);
          return each === undefined ? [] : [{ kind: "coming", ...each }];
        }),
        more: cluster.more,
        open,
        dot: railTileDot([
          ...group.map((mate) => mate.dot),
          ...coming.map((each) => comingDot(each.stopped)),
        ]),
        current: groupHoldsCurrent({ open, mates: memberIds, active: active ?? undefined }),
        holdsCurrent: active !== null && memberIds.includes(active),
      },
    ];
  };
  const listed = new Set(input.mates.map((mate) => mate.groupId));
  const projects = [
    ...railGroups(input.mates, order).map((group) => ({
      at: place(group[0]?.projectId),
      tiles: groupTiles(group),
    })),
    // A group's "Add a Mate" waits for its setup, so a project with no listed Mate holds one.
    ...Object.entries(input.comingByGroup).flatMap(([groupId, coming]) =>
      listed.has(groupId)
        ? []
        : [
            {
              at: place(coming[0]?.projectId),
              tiles: coming.map((member) => comingTile(groupId, member)),
            },
          ],
    ),
  ];
  return projects.toSorted((left, right) => left.at - right.at).flatMap((project) => project.tiles);
}

/**
 * A press on a tile does what the press on its menu row does: a Mate's opens its conversation; a
 * coming Mate's opens the view where it comes up; a group's folds or opens it, and opening it opens
 * the viewer's one Mate in it (`groupRowPress`).
 */
export function railTilePress<M extends RailTileMate>(
  tile: RailTile<M>,
): {
  readonly fold: { readonly groupId: string; readonly open: boolean } | undefined;
  readonly select: string | undefined;
  /** A coming Mate to open (`onOpenComing`). */
  readonly open: string | undefined;
} {
  if (tile.kind === "mate") {
    return { fold: undefined, select: tile.mate.projectId, open: undefined };
  }
  if (tile.kind === "coming") {
    return { fold: undefined, select: undefined, open: tile.member.projectId };
  }
  const press = groupRowPress({
    open: tile.open,
    mine: viewerMates(
      tile.mates,
      tile.personFacts,
      tile.coming.map((each) => each.member),
    ),
    current: tile.current,
  });
  return {
    fold: { groupId: tile.groupId, open: press.open },
    select: tile.mates.find((mate) => mate.projectId === press.select)?.projectId,
    open: undefined,
  };
}
