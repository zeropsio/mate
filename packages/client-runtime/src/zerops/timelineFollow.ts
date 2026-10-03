/**
 * Whether a conversation's list follows its end: the rule every surface that
 * shows a conversation applies. Follow holds only while the person is at the
 * end; a person leaving it turns it off at once, and from then on nothing that
 * arrives — a message, a card growing, settling or shrinking, a resync, a
 * queued message leaving — moves what they read. Only a person turns it back
 * on: a scroll of theirs that moved toward the end and reached it, jumping to
 * the latest, sending, or opening the conversation at its end.
 */
export type TimelineScrollDirection = "toward-end" | "away";

export type TimelineFollowEvent =
  /** A person's input that moves the list away from its end (a wheel or key up, a scrollbar grab). */
  | { readonly type: "left-end" }
  /**
   * The list moved: where it stands, which way it went (null: it did not
   * move), and whether the person's scroll moved it.
   */
  | {
      readonly type: "position";
      readonly atEnd: boolean;
      readonly byPerson: boolean;
      readonly direction: TimelineScrollDirection | null;
    }
  | { readonly type: "jump-to-latest" }
  /** A message left: the person's own send, or a queued one leaving by itself. */
  | { readonly type: "sent"; readonly byPerson: boolean }
  /** The conversation opens: at its end, or where the person left it. */
  | { readonly type: "opened"; readonly atEnd: boolean };

export function nextTimelineFollow(following: boolean, event: TimelineFollowEvent): boolean {
  switch (event.type) {
    case "left-end":
      return false;
    case "position":
      if (!event.byPerson || event.direction === null) return following;
      // Direction, not position: a step up whose first frame is still near
      // the end is leaving it, and a step down that reaches it is coming back.
      return following
        ? event.atEnd || event.direction === "toward-end"
        : event.atEnd && event.direction === "toward-end";
    case "jump-to-latest":
      return true;
    case "sent":
      return event.byPerson || following;
    case "opened":
      return event.atEnd;
  }
}

/** Where the list stood when it was last read. */
export interface TimelineScrollReading {
  readonly scrollTop: number;
  /** The scrollable content's height. */
  readonly contentHeight: number;
}

/**
 * Which way the list moved since the last read, and whether the person's
 * scroll moved it. A scroll the list or the browser makes moves with the
 * content: rows growing above or a followed end growing push it down, content
 * shrinking clamps it up — so a move the content's own change explains is
 * never the person's, even mid-gesture.
 */
export function classifyTimelineScroll(input: {
  readonly previous: TimelineScrollReading | null;
  readonly current: TimelineScrollReading;
  readonly personScrolling: boolean;
}): { readonly byPerson: boolean; readonly direction: TimelineScrollDirection | null } {
  const { previous, current } = input;
  const moved = previous === null ? 0 : current.scrollTop - previous.scrollTop;
  if (previous === null || Math.abs(moved) < 0.5) return { byPerson: false, direction: null };
  const grew = current.contentHeight - previous.contentHeight;
  const explainedByContent = (moved > 0 && grew > 0) || (moved < 0 && grew < 0);
  return {
    byPerson: input.personScrolling && !explainedByContent,
    direction: moved > 0 ? "toward-end" : "away",
  };
}

/**
 * How long the list may sit still between a person's input and its scroll, or
 * between two frames of their scroll, before what moves it is no longer theirs.
 */
export const PERSON_SCROLL_QUIET_MS = 150;

/** What a person is doing to the list: holding it, or when they last moved it. */
export interface PersonScrollSession {
  /** A finger on the list, or the scrollbar grabbed. */
  readonly held: "touch" | "pointer" | null;
  readonly lastAt: number | null;
}

export const PERSON_SCROLL_IDLE: PersonScrollSession = { held: null, lastAt: null };

export type PersonScrollSessionEvent =
  /** A wheel, a scroll key, a finger moving, a jump the person picked. */
  | { readonly type: "input"; readonly at: number }
  | { readonly type: "hold"; readonly by: "touch" | "pointer"; readonly at: number }
  /** Only the hold it names ends: a touch's pointercancel as the browser takes the pan is not the finger lifting. */
  | { readonly type: "release"; readonly by: "touch" | "pointer"; readonly at: number }
  /** The list moved; a move of the person's carries their session on (a wheel's momentum, a flick's glide). */
  | { readonly type: "scrolled"; readonly at: number; readonly byPerson: boolean }
  | { readonly type: "scroll-ended" };

export function nextPersonScrollSession(
  session: PersonScrollSession,
  event: PersonScrollSessionEvent,
): PersonScrollSession {
  switch (event.type) {
    case "input":
      return { ...session, lastAt: event.at };
    case "hold":
      return { held: event.by, lastAt: event.at };
    case "release":
      return session.held === event.by ? { held: null, lastAt: event.at } : session;
    case "scrolled":
      return event.byPerson ? { ...session, lastAt: event.at } : session;
    case "scroll-ended":
      return session.held === null ? PERSON_SCROLL_IDLE : session;
  }
}

/** Whether what moves the list now is the person. */
export function personIsScrolling(session: PersonScrollSession, now: number): boolean {
  return (
    session.held !== null ||
    (session.lastAt !== null && now - session.lastAt <= PERSON_SCROLL_QUIET_MS)
  );
}
