import {
  nextTimelineFollow,
  type TimelineScrollDirection,
} from "@t3tools/client-runtime/zerops/timelineFollow";

export type ThreadFeedLiveFollowEvent =
  | { readonly type: "reset" }
  | { readonly type: "user-scroll-begin" }
  | {
      readonly type: "user-scroll-end";
      readonly isAtEnd: boolean;
      /** The list's offset where the drag began (null: not read), and where the glide ended. */
      readonly startOffset: number | null;
      readonly endOffset: number | null;
      readonly userScrollSessionActive: boolean;
    }
  /** The person pressed the jump-to-latest button. */
  | { readonly type: "jump-to-latest" }
  | {
      readonly type: "scroll" | "disclosure-settled";
      readonly isAtEnd: boolean;
      readonly userScrollSessionActive: boolean;
    };

export interface ThreadWorkGroupScrollPosition {
  readonly rowId: string;
  readonly offsetWithinRow: number;
  readonly scrollOffset: number;
  readonly contentHeight: number;
}

export function resolveThreadWorkGroupInitialScroll(
  rows: ReadonlyArray<{ readonly id: string }>,
  position: ThreadWorkGroupScrollPosition | undefined,
) {
  const index = position ? rows.findIndex((row) => row.id === position.rowId) : -1;
  return index >= 0 && position ? { index, viewOffset: -position.offsetWithinRow } : undefined;
}

export function shouldFollowThreadWorkGroupAppend(input: {
  readonly previousRows: ReadonlyArray<{ readonly id: string }>;
  readonly rows: ReadonlyArray<{ readonly id: string }>;
  readonly previousContentHeight: number;
  readonly contentHeight: number;
  readonly viewportHeight: number;
  readonly scrollOffset: number;
  readonly detailsChanged: boolean;
  readonly userScrolling: boolean;
}) {
  return (
    !input.detailsChanged &&
    !input.userScrolling &&
    input.contentHeight > input.previousContentHeight &&
    input.rows.length > input.previousRows.length &&
    input.previousRows.every((row, index) => row.id === input.rows[index]?.id) &&
    input.previousContentHeight - input.viewportHeight - input.scrollOffset <= 1
  );
}

export function resolveThreadFeedSubmissionAnchor<AnchorId>(input: {
  readonly currentAnchorMessageId: AnchorId | null;
  readonly submittedMessageId: AnchorId;
  readonly hasStartedTurn: boolean;
  readonly hasUserMessage: boolean;
  readonly queuedMessageCount: number;
}): AnchorId | null {
  if (input.hasStartedTurn || input.hasUserMessage) {
    return null;
  }

  if (input.currentAnchorMessageId !== null) {
    return input.currentAnchorMessageId;
  }

  return input.queuedMessageCount > 0 ? null : input.submittedMessageId;
}

/**
 * The conversation's follow rule (client-runtime's `nextTimelineFollow`) read
 * through the feed's scroll session: a drag and its momentum are the
 * person's, every other scroll is the list's or the layout's and never
 * changes follow.
 */
/**
 * Which way a drag and its glide carried the list, from where the drag began:
 * one that came back to where it began, or bounced at the end, did not leave it.
 */
function threadFeedDragDirection(
  startOffset: number | null,
  endOffset: number | null,
): TimelineScrollDirection {
  return startOffset === null || endOffset === null || endOffset >= startOffset
    ? "toward-end"
    : "away";
}

export function resolveThreadFeedLiveFollow(
  current: boolean,
  event: ThreadFeedLiveFollowEvent,
): boolean {
  switch (event.type) {
    case "reset":
      return nextTimelineFollow(current, { type: "opened", atEnd: true });
    // The person takes hold of the list: paused before the first scroll, so
    // a stream update can't pin the end between touch-down and the drag.
    case "user-scroll-begin":
      return nextTimelineFollow(current, { type: "left-end" });
    case "user-scroll-end":
      return event.userScrollSessionActive
        ? nextTimelineFollow(current, {
            type: "position",
            atEnd: event.isAtEnd,
            byPerson: true,
            direction: threadFeedDragDirection(event.startOffset, event.endOffset),
          })
        : current;
    case "jump-to-latest":
      return nextTimelineFollow(current, { type: "jump-to-latest" });
    // The person's tap opened or closed a disclosure: it leaves the end when
    // it leaves them above it, and never brings follow back.
    case "disclosure-settled":
      return !event.userScrollSessionActive && !event.isAtEnd
        ? nextTimelineFollow(current, { type: "left-end" })
        : current;
    case "scroll":
      return event.userScrollSessionActive
        ? false
        : nextTimelineFollow(current, {
            type: "position",
            atEnd: event.isAtEnd,
            byPerson: false,
            direction: null,
          });
  }
}
