/**
 * The menu's unit is the project (the owner, 2026-10-12: "the unit would be project, but one mate =
 * project would look like a mate named with project and name and when more it would be project
 * and it would expand instead of going to detail (or expanding and going to detail if only one of
 * the mates is yours)").
 *
 * A project with one Mate is that Mate's row, "Project · Mate"; with several, one row whose faces
 * share the avatar and whose press opens them under it; with none, the project alone. What needs
 * the viewer rises to the project's row: the asking face leads and the line says the ask.
 *
 * Pure: no React, no store, no clock.
 */

/** What a project is in the menu: one Mate's row, a group of Mates, or a project with none. */
export type ProjectRowKind = "solo" | "group" | "bare";

/** `mates`: its Mates the menu lists, those being created included. */
export function projectRowKind(input: { readonly mates: number }): ProjectRowKind {
  if (input.mates === 0) return "bare";
  return input.mates === 1 ? "solo" : "group";
}

export interface GroupMate {
  readonly projectId: string;
  /** The viewer's own, as the menu's Mine holds it. */
  readonly mine: boolean;
  /** When it was made; unknown sorts after the dated ones, by name. */
  readonly createdAt: string | undefined;
  readonly name: string;
}

function madeAt(mate: GroupMate): number {
  const at = mate.createdAt === undefined ? Number.NaN : Date.parse(mate.createdAt);
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

/**
 * A group's Mates in the order its open rows stand: the viewer's first, then colleagues', each in
 * the order they were made — never by what they did, so nothing under an open project moves for
 * work.
 */
export function groupMateOrder<M extends GroupMate>(mates: ReadonlyArray<M>): ReadonlyArray<M> {
  return mates.toSorted(
    (left, right) =>
      Number(right.mine) - Number(left.mine) ||
      madeAt(left) - madeAt(right) ||
      left.name.localeCompare(right.name, "en") ||
      left.projectId.localeCompare(right.projectId, "en"),
  );
}

/** One Mate of a group as its lead is chosen: what it asks of the viewer, and when it acted. */
export interface LeadReading {
  readonly projectId: string;
  /**
   * It asks something the viewer can answer — an approval, an input, a plan, its own or its
   * crew's. A colleague's Mate waiting on its person is not this.
   */
  readonly asksViewer: boolean;
  /** When it last did something (`ZeropsAgentActivity.at`): since when an ask waits. */
  readonly at: string | undefined;
  readonly working: boolean;
  /** When the run it is on started (`runSince`), while it works. */
  readonly runSince: string | undefined;
}

export interface GroupLead {
  /** Whose face leads the cluster, whose time the row shows and whose words its line says. */
  readonly lead: string | undefined;
  /** The asks the viewer can answer, oldest first: the first leads, the rest are "· N more". */
  readonly asks: ReadonlyArray<string>;
}

function timeOf(at: string | undefined): number {
  const parsed = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Who leads a group, in `readings`' order (the group's own): the oldest ask the viewer can answer;
 * else the Mate whose run started last — not whose step came last, so two Mates at work never
 * trade places on every step; else the newest words; else the first.
 */
export function groupLead(readings: ReadonlyArray<LeadReading>): GroupLead {
  const asks = readings
    .filter((reading) => reading.asksViewer)
    .toSorted((left, right) => timeOf(left.at) - timeOf(right.at))
    .map((reading) => reading.projectId);
  if (asks.length > 0) return { lead: asks[0], asks };
  const newest = (pick: (reading: LeadReading) => number) =>
    readings.reduce<LeadReading | undefined>(
      (best, reading) =>
        pick(reading) > Number.NEGATIVE_INFINITY &&
        (best === undefined || pick(reading) > pick(best))
          ? reading
          : best,
      undefined,
    );
  const working = newest((reading) => (reading.working ? timeOf(reading.runSince) : -Infinity));
  const lead = working ?? newest((reading) => timeOf(reading.at)) ?? readings[0];
  return { lead: lead?.projectId, asks };
}

/** How many faces a group's avatar holds whole; past them, how many more. */
export const CLUSTER_ROOM = 3;

/** The faces in a group's avatar: the lead first, then the rest in the group's order. */
export function clusterFaces(
  order: ReadonlyArray<string>,
  lead: string | undefined,
  room = CLUSTER_ROOM,
): { readonly shown: ReadonlyArray<string>; readonly more: number } {
  const led =
    lead === undefined || !order.includes(lead)
      ? order
      : [lead, ...order.filter((projectId) => projectId !== lead)];
  return { shown: led.slice(0, room), more: Math.max(0, led.length - room) };
}

/**
 * A press on a group's row: a folded group opens — and where exactly one of its Mates is the
 * viewer's, that Mate opens with it; an open group folds, and the conversation stays.
 */
export function groupRowPress(input: {
  readonly open: boolean;
  /** The group's Mates that are the viewer's. */
  readonly mine: ReadonlyArray<string>;
}): { readonly open: boolean; readonly select: string | undefined } {
  if (input.open) return { open: false, select: undefined };
  return { open: true, select: input.mine.length === 1 ? input.mine[0] : undefined };
}

/** A folded group stands for the open conversation of one of its Mates: its row wears the mark. */
export function groupHoldsCurrent(input: {
  readonly open: boolean;
  readonly mates: ReadonlyArray<string>;
  readonly active: string | undefined;
}): boolean {
  return !input.open && input.active !== undefined && input.mates.includes(input.active);
}

/** What a key does on a row of the menu. */
export type ProjectRowKeyAction = "next" | "previous" | "open" | "into" | "fold" | "out";

/**
 * The list's keys: ↓ or j to the next row, ↑ or k to the one before; on a group, → opens it and,
 * open, steps into its first Mate, ← folds it; on a Mate inside a group, ← steps out to it.
 */
export function projectRowKey(input: {
  readonly key: string;
  readonly modified: boolean;
  readonly kind: "solo" | "group" | "kid" | "bare";
  readonly open: boolean;
}): ProjectRowKeyAction | undefined {
  if (input.modified) return undefined;
  switch (input.key) {
    case "ArrowDown":
    case "j":
      return "next";
    case "ArrowUp":
    case "k":
      return "previous";
    case "ArrowRight":
      if (input.kind !== "group") return undefined;
      return input.open ? "into" : "open";
    case "ArrowLeft":
      if (input.kind === "kid") return "out";
      return input.kind === "group" && input.open ? "fold" : undefined;
    default:
      return undefined;
  }
}
