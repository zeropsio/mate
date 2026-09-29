/**
 * How the left menu lays its projects out, one after another.
 *
 * A heading never moves when it is clicked (M9). The room between two
 * projects used to sit above a heading and depend on that project's own
 * state — 4 px folded, 36 px open — so opening one dropped its heading 32 px
 * under the pointer (measured 166 → 198). The room belongs to the end of an
 * open project instead: its rows unfold below the heading with the room after
 * them, and folded projects stack as a list of names.
 *
 * Pure: no React, no clock, no store.
 */
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";

/**
 * The room below a project's rows, in px: 44 while it is open (58 px from its
 * last row's words to the next heading's, M16), 16 at the list's end, none
 * while it is folded — its rows, and their room, fold into the heading.
 */
export function projectRoom(at: { readonly open: boolean; readonly last: boolean }): number {
  if (!at.open) return 0;
  return at.last ? 16 : 44;
}

/** The dot on a folded heading's face: needs you, unread, or stopped on an error. */
export type HeadingFaceDot = "attention" | "unread" | "failed";

/** One of a folded project's busy Mates, as its heading shows it. */
export interface HeadingFace {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly face: MateMarkState;
  /** Absent while it only works: its turning face says that. */
  readonly dot: HeadingFaceDot | undefined;
}

/** The most urgent first: needing you, then stopped on an error, finished unseen, at work. */
const RANK: Record<HeadingFaceDot | "working", number> = {
  attention: 0,
  failed: 1,
  unread: 2,
  working: 3,
};

/** At most this many faces on one heading. */
export const HEADING_FACES = 3;

/**
 * Who a folded project's heading shows (M15): its Mates that need you, are
 * working, or finished while nobody looked — the most urgent first, the list's
 * order kept within each, three at most — each face in its own pose, a dot for
 * what is not work. A heading's lone amber dot said "something here needs you"
 * without saying who, and beside a globe it read as production in trouble.
 */
export function headingFaces(
  mates: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    readonly tint: MateTintId;
    readonly face: MateMarkState;
    /** Its last run stopped on an error. */
    readonly failed: boolean;
    /** It finished something nobody has looked at yet. */
    readonly unread: boolean;
  }>,
): ReadonlyArray<HeadingFace> {
  const busy = mates.flatMap((mate) => {
    const dot: HeadingFaceDot | undefined =
      mate.face === "needs"
        ? mate.failed
          ? "failed"
          : "attention"
        : mate.unread && (mate.face === "done" || mate.face === "idle")
          ? "unread"
          : undefined;
    if (dot === undefined && mate.face !== "working") return [];
    return [{ projectId: mate.projectId, name: mate.name, tint: mate.tint, face: mate.face, dot }];
  });
  return busy
    .map((face, index) => ({ face, index }))
    .toSorted(
      (left, right) =>
        RANK[left.face.dot ?? "working"] - RANK[right.face.dot ?? "working"] ||
        left.index - right.index,
    )
    .slice(0, HEADING_FACES)
    .map(({ face }) => face);
}
