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

/**
 * The air below each project, open or folded alike: 16 px. Folded names read as one list, and
 * opening one adds only its rows — never air to make room for them (the owner, 2026-10-11: folded
 * projects 60 px apart were "absolutely huge", and squeezed to 36 px every open was "layout
 * shifting on expand to create the space … it needs to be a balance"). At 12 a project's last
 * line stood 1.7 times as far from the next heading as a heading from its first Mate ("still
 * items squeezed together"); at 16 a project reads as one group, twice apart.
 */
const PROJECT_AIR = 16;
/** The list's own end, below its last project: 4 px. */
const LIST_END = 4;

/**
 * The room below a project, in px: the same air under an open project's rows as under a folded
 * heading — and the list's last project ends the same distance from the menu's foot, the list's
 * own 4 px end counted in. The room is the project's own, below it, so a heading's own fold
 * never moves it.
 */
export function projectRoom(at: { readonly open: boolean; readonly last: boolean }): number {
  return at.last ? PROJECT_AIR - LIST_END : PROJECT_AIR;
}

/** The dot on a folded heading's face: needs you, unread, or stopped on an error. */
export type HeadingFaceDot = "attention" | "unread" | "failed";

/** One of a folded project's Mates, as its heading shows it. */
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

/**
 * The most urgent first: needing you, then stopped on an error, finished unseen, at work, and
 * the quiet ones last.
 */
const RANK: Record<HeadingFaceDot | "working" | "quiet", number> = {
  attention: 0,
  failed: 1,
  unread: 2,
  working: 3,
  quiet: 4,
};

/** At most this many faces on one heading; past them, how many more. */
export const HEADING_FACES = 4;

/**
 * Who a folded project's heading shows (M15): every one of its Mates, each as its row draws it
 * (`mateRowView`) — the same face, the same dot — the most urgent first, the list's order kept
 * within each. Never its count in words: "1 Mate" said nobody's state (the owner, 2026-10-11:
 * "why say '1 mate' instead of showing their avatars and their states?"). The heading draws the
 * first `HEADING_FACES` and says how many more.
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
  const rank = (mate: (typeof mates)[number]) =>
    RANK[mate.dot ?? (mate.state === "working" ? "working" : "quiet")];
  return mates
    .map((mate, index) => ({ mate, index }))
    .toSorted((left, right) => rank(left.mate) - rank(right.mate) || left.index - right.index)
    .map(({ mate: { state: _state, ...face } }) => face);
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
