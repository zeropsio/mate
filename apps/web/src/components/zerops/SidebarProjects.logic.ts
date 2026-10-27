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

/** A box's vertical edges, in the page's coordinates. */
export interface Span {
  readonly top: number;
  readonly bottom: number;
}

/**
 * How far the list scrolls down for a group just opened: its heading and Mates (`unit`) brought
 * above the view's end (`view`), never so far that the heading leaves the view's top. Nothing
 * where they already stand in view, or where the heading is already above it.
 */
export function unfoldScroll(input: { readonly view: Span; readonly unit: Span }): number {
  const hanging = input.unit.bottom - input.view.bottom;
  const headingRoom = input.unit.top - input.view.top;
  return Math.max(0, Math.min(hanging, headingRoom));
}

/** What the menu's reveal of the open Mate has seen (`openMateReveal`). */
export interface MateReveal {
  /** The open conversation it is for: the route's Mate, as the route names it. */
  readonly conversation: string | null;
  /** The Mate whose row stands in view: the one a reload opened on, or the last brought there. */
  readonly shown: string | null;
  /** The conversation was opened afterwards: its Mate's row is brought into view once found. */
  readonly owed: boolean;
}

/**
 * Which open Mate's row the menu scrolls into view, and what it has seen. A reload leaves the menu
 * where it was: the conversation it opened on is never revealed, however late the listing finds its
 * Mate (`resolving`, or missed first). Only a conversation opened afterwards — Add landing on a new
 * Mate, a link, a page — or a press lighting another Mate brings a row into view, once; the caller
 * marks it shown once its row is drawn, so rows drawn again never scroll the menu again.
 */
export function openMateReveal(input: {
  readonly seen: MateReveal | undefined;
  readonly conversation: string | null;
  readonly open: string | null;
  readonly resolving: boolean;
}): { readonly reveal: string | undefined; readonly seen: MateReveal } {
  const { conversation, open } = input;
  if (input.seen === undefined)
    return { reveal: undefined, seen: { conversation, shown: open, owed: false } };
  const seen =
    conversation === input.seen.conversation
      ? input.seen
      : { ...input.seen, conversation, owed: true };
  if (!seen.owed) {
    // The reload's own Mate, found late: it stands where the menu is, unscrolled.
    if (seen.shown === null) return { reveal: undefined, seen: { ...seen, shown: open } };
    return open !== null && open !== seen.shown
      ? { reveal: open, seen }
      : { reveal: undefined, seen };
  }
  if (input.resolving || open === null) return { reveal: undefined, seen };
  if (open === seen.shown) return { reveal: undefined, seen: { ...seen, owed: false } };
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
