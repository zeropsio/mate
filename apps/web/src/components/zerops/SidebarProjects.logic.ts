/**
 * How the left menu lays its projects out, one after another, lands a reveal
 * on the row it asked for, and whether its foot offers *New project*.
 *
 * A heading never moves when it is clicked (M9). The room between two
 * projects used to sit above a heading and depend on that project's own
 * state — 4 px folded, 36 px open — so opening one dropped its heading 32 px
 * under the pointer (measured 166 → 198). The room belongs to the end of a
 * project instead: an open one's rows unfold below the heading with the room
 * after them, and folded projects stack as a list of names, each with its own
 * few px under it — the room an unfold grows from and a fold shrinks back to.
 *
 * Pure: no React, no clock, no store.
 */
import {
  mateEnvironmentsEmptyReason,
  type ZeropsPlacedBirth,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";

import type { MateRowState } from "./SidebarMateRow.logic";

/**
 * Whether the menu's foot offers *New project* (D11), pinned above the
 * account's row whatever the list's length (the owner, 2026-09-29): from the
 * first paint, while the listing is still read, and where the account has
 * no project at all — there it is the one way in. Not where the listing says
 * the account has projects and none with a Mate: the list's own *Set up
 * Mate* is the one thing to do there.
 */
export function newProjectOffered(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  /** The creations under way: a Mate being made is a Mate to list. */
  readonly births: ReadonlyArray<ZeropsPlacedBirth>;
  /** The listing is known and complete (`candidatesComplete`). */
  readonly complete: boolean;
}): boolean {
  if (!input.complete) return true;
  if (input.births.some((birth) => birth.placement.kind === "mate")) return true;
  return mateEnvironmentsEmptyReason(input.candidates) !== "no-mate";
}

/** From a heading's words to the next words under it: its first Mate's, or the next heading's. */
const HEADING_STEP = 20;
/** From one Mate's last words to the next Mate's name. */
const MATE_STEP = 30;
/** How deep words stand in their boxes: a heading's title in its 32 px, a Mate row's lines. */
const HEADING_INSET = 4;
const ROW_INSET = 10;

/**
 * The room below a project's rows, in px — one rule for both, read from one
 * text's foot to the next text's head (the owner, 2026-09-29: "slightly
 * decrease the space between open project and next project", "slightly
 * increase the space between closed projects"): a folded project's name
 * stands a heading's step (20) from the next project's, as a heading's does
 * from its first Mate's; an open project's last words stand that and one
 * Mate's step more (50) from the next heading's. So 12 folded and 36 open,
 * less the words' own insets; at the list's end, 16 open and none folded.
 * Folded or open, the room is the project's own, below its heading, so a
 * heading's own fold never moves it.
 */
export function projectRoom(at: { readonly open: boolean; readonly last: boolean }): number {
  if (!at.open) return at.last ? 0 : HEADING_STEP - 2 * HEADING_INSET;
  return at.last ? 16 : HEADING_STEP + MATE_STEP - ROW_INSET - HEADING_INSET;
}

/** The dot on a folded heading's face: needs you, unread, or stopped on an error. */
export type HeadingFaceDot = "attention" | "unread" | "failed";

/** One of a folded project's busy Mates, as its heading shows it. */
export interface HeadingFace {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked, else its tint's own (`mateShapeOf`). */
  readonly shape: MateShapeId;
  /** Its row's face: still where it stopped on an error, as in the list. */
  readonly face: MateMarkState;
  /** Absent while it only works: its turning face says that. */
  readonly dot: HeadingFaceDot | undefined;
  /** Its state is read, not what this browser remembered: only then is a change an arrival. */
  readonly known: boolean;
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
 * working, stopped on an error or finished while nobody looked — the most
 * urgent first, the list's order kept within each, three at most — each as
 * its row draws it (`mateRowView`): the same face, the same dot. A heading's
 * lone amber dot said "something here needs you" without saying who, and
 * beside a globe it read as production in trouble.
 */
export function headingFaces(
  mates: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    readonly tint: MateTintId;
    readonly shape: MateShapeId;
    /** Its row's state, face and dot (`mateRowView`). */
    readonly state: MateRowState;
    readonly face: MateMarkState;
    readonly dot: HeadingFaceDot | undefined;
    readonly known: boolean;
  }>,
): ReadonlyArray<HeadingFace> {
  const busy = mates.flatMap(({ state, ...mate }) =>
    mate.dot === undefined && state !== "working" ? [] : [mate],
  );
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

/** A reveal waiting for its row: asked for, and whether a draw has passed since. */
export interface PendingLanding<T> {
  readonly target: T;
  readonly drawn: boolean;
}

/**
 * What a draw does with a reveal waiting for its row. The draw the ask came
 * in only marks it; the one the ask set off — the project opened, the quiet
 * Mates or the changes unfolded — lands it where its row stands, and the ask
 * is done either way. A row that draw does not hold (a Mate the viewer hides,
 * a chip the heading does not draw) is never landed on later: once one
 * appears, the person has long moved on, and the focus would jump there.
 */
export function landingAfterDraw<T>(pending: PendingLanding<T> | null): {
  readonly land: T | undefined;
  readonly next: PendingLanding<T> | null;
} {
  if (pending === null) return { land: undefined, next: null };
  if (!pending.drawn) return { land: undefined, next: { target: pending.target, drawn: true } };
  return { land: pending.target, next: null };
}

/** A scrolling list as a fold reads it, with the room at its end it keeps (`slack`). */
export interface ScrollRoom {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  /** The room at the list's end a fold left, counted in `scrollHeight`. */
  readonly slack: number;
}

/**
 * The room a fold leaves at the list's end (M9). Scrolled to the end, the rows
 * folding away shorten the list under the view, and the view — held at the
 * list's end — slides everything down, the heading just pressed with it. The
 * room is what the view would lack once `removed` px are gone, so nothing
 * above the list's end moves.
 */
export function slackForFold(scroll: ScrollRoom, removed: number): number {
  return roomTheViewNeeds(scroll, scroll.scrollHeight - scroll.slack - removed);
}

/** The room after a scroll: only as much as still holds the view, never more than it was. */
export function slackAfterScroll(scroll: ScrollRoom): number {
  return Math.min(scroll.slack, roomTheViewNeeds(scroll, scroll.scrollHeight - scroll.slack));
}

/** What a list `natural` px long lacks to hold the view where it is; at the top, nothing. */
function roomTheViewNeeds(scroll: ScrollRoom, natural: number): number {
  if (scroll.scrollTop <= 0) return 0;
  return Math.max(0, scroll.scrollTop + scroll.clientHeight - natural);
}

/**
 * Which open Mate's row the menu scrolls into view, and the open Mate it has seen. A reload leaves
 * the menu where it was: the Mate it opened on is not revealed, even when the route's Mate is found
 * only after the menu drew (`resolving` until then; `seen` unset while nothing was found). Only a
 * Mate opened afterwards — Add landing on a new Mate, a link, a page — is scrolled to; the caller
 * marks it seen once its row is drawn.
 */
export function openMateReveal(input: {
  readonly seen: string | null | undefined;
  readonly open: string | null;
  readonly resolving: boolean;
}): { readonly reveal: string | undefined; readonly seen: string | null | undefined } {
  const { seen, open } = input;
  if (input.resolving) return { reveal: undefined, seen };
  if (seen === undefined) return { reveal: undefined, seen: open };
  if (open === null || open === seen) return { reveal: undefined, seen };
  return { reveal: open, seen };
}
