/**
 * Whether a conversation's list follows its end: the rule every surface that
 * shows a conversation applies. Follow holds only while the person is at the
 * end; a person leaving it turns it off at once, and from then on nothing that
 * arrives — a message, a card growing, settling or shrinking, a resync — moves
 * what they read. Only a person turns it back on: scrolling back to the end,
 * jumping to the latest, sending, or opening the conversation at its end.
 */
export type TimelineFollowEvent =
  /** A person's scroll up (wheel, touch, keys, scrollbar) that moves the list. */
  | { readonly type: "left-end" }
  /** Where the list stands, and whether a person's scroll put it there. */
  | { readonly type: "position"; readonly atEnd: boolean; readonly byPerson: boolean }
  | { readonly type: "jump-to-latest" }
  | { readonly type: "sent" }
  /** The conversation opens: at its end, or where the person left it. */
  | { readonly type: "opened"; readonly atEnd: boolean };

export function nextTimelineFollow(following: boolean, event: TimelineFollowEvent): boolean {
  switch (event.type) {
    case "left-end":
      return false;
    case "position":
      return event.atEnd ? following || event.byPerson : following;
    case "jump-to-latest":
    case "sent":
      return true;
    case "opened":
      return event.atEnd;
  }
}

/**
 * How long a person's scroll keeps moving the list after their last input: a
 * wheel's momentum, a key's smooth scroll, a flick's glide.
 */
export const PERSON_SCROLL_SETTLE_MS = 1_000;

/** Whether the list is moving because a person moved it. */
export function personIsScrolling(input: {
  readonly lastGestureAt: number | null;
  readonly held: boolean;
  readonly now: number;
}): boolean {
  return (
    input.held ||
    (input.lastGestureAt !== null && input.now - input.lastGestureAt <= PERSON_SCROLL_SETTLE_MS)
  );
}
