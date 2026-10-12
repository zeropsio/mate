/**
 * How the left menu lands a reveal on the row it asked for, keeps the room a fold leaves at the
 * list's end, and whether its foot offers *New project*.
 *
 * Pure: no React, no clock, no store.
 */
import {
  mateEnvironmentsEmptyReason,
  type ZeropsPlacedBirth,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

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

/**
 * Whether the menu's list draws its loading rows: nothing of its own to draw yet — no Mate being
 * made, none HQ lists, none among the projects read so far — while its listing is read and says
 * nothing of its own. They stand from the boot frame's until rows replace them: a reload never
 * empties the menu.
 */
export function menuDrawsLoadingRows(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly births: ReadonlyArray<Pick<ZeropsPlacedBirth, "placement">>;
  readonly complete: boolean;
  readonly reading: boolean;
  readonly notice: unknown;
}): boolean {
  if (input.complete || !input.reading || (input.notice ?? null) !== null) return false;
  if (input.births.some((birth) => birth.placement.kind === "mate")) return false;
  if (input.candidates.some((candidate) => candidate.project.hq !== undefined)) return false;
  return mateEnvironmentsEmptyReason(input.candidates) !== undefined;
}
