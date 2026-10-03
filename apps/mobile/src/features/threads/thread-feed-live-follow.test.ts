import { describe, expect, it } from "vite-plus/test";

import {
  resolveThreadFeedLiveFollow,
  resolveThreadFeedSubmissionAnchor,
  type ThreadFeedLiveFollowEvent,
  resolveThreadWorkGroupInitialScroll,
  shouldFollowThreadWorkGroupAppend,
} from "./thread-feed-live-follow";

describe("tool-group scroll restoration", () => {
  const position = {
    rowId: "read-output",
    offsetWithinRow: 80,
    scrollOffset: 600,
    contentHeight: 1_000,
  };

  it("restores the visible row and its detail offset rather than stale absolute pixels", () => {
    const before = [{ id: "first" }, { id: "read-output" }, { id: "last" }];
    const after = [{ id: "older" }, ...before];
    expect(resolveThreadWorkGroupInitialScroll(before, position)).toEqual({
      index: 1,
      viewOffset: -80,
    });
    expect(resolveThreadWorkGroupInitialScroll(after, position)).toEqual({
      index: 2,
      viewOffset: -80,
    });
  });

  it("starts normally when the saved row no longer belongs to the group", () => {
    expect(resolveThreadWorkGroupInitialScroll([{ id: "other" }], position)).toBeUndefined();
    expect(resolveThreadWorkGroupInitialScroll([{ id: "read-output" }], undefined)).toBeUndefined();
  });
});

describe("tool-group append following", () => {
  const previousRows = Array.from({ length: 10 }, (_, index) => ({ id: `call-${index}` }));
  const appendedRows = [...previousRows, { id: "new-call" }];
  const atEnd = {
    previousRows,
    rows: appendedRows,
    previousContentHeight: 289,
    contentHeight: 318,
    viewportHeight: 256,
    scrollOffset: 33,
    detailsChanged: false,
    userScrolling: false,
  };

  it("follows a new call when the reader was at the end", () => {
    expect(shouldFollowThreadWorkGroupAppend(atEnd)).toBe(true);
  });

  it("follows the first overflowing append as a short group reaches its height cap", () => {
    expect(
      shouldFollowThreadWorkGroupAppend({
        ...atEnd,
        previousRows: previousRows.slice(0, 8),
        rows: previousRows.slice(0, 9),
        previousContentHeight: 231,
        contentHeight: 260,
        viewportHeight: 231,
        scrollOffset: 0,
      }),
    ).toBe(true);
  });

  it.each([
    { name: "reading earlier calls", changes: { scrollOffset: 20 } },
    { name: "dragging before leaving the edge", changes: { userScrolling: true } },
    { name: "opening detail during an append", changes: { detailsChanged: true } },
    { name: "streaming a result", changes: { rows: previousRows, contentHeight: 600 } },
    { name: "updating a lifecycle label", changes: { rows: previousRows, contentHeight: 289 } },
    { name: "prepending old calls", changes: { rows: [{ id: "older" }, ...previousRows] } },
    {
      name: "replacing a call while appending",
      changes: { rows: [{ id: "replacement" }, ...appendedRows.slice(1)] },
    },
  ])("does not steal the reader's position when $name", ({ changes }) => {
    expect(shouldFollowThreadWorkGroupAppend({ ...atEnd, ...changes })).toBe(false);
  });
});

describe("resolveThreadFeedSubmissionAnchor", () => {
  it("anchors the first user message in a thread", () => {
    expect(
      resolveThreadFeedSubmissionAnchor({
        currentAnchorMessageId: null,
        submittedMessageId: "first-message",
        hasStartedTurn: false,
        hasUserMessage: false,
        queuedMessageCount: 0,
      }),
    ).toBe("first-message");
  });

  it("preserves the first-message anchor when another message is queued", () => {
    expect(
      resolveThreadFeedSubmissionAnchor({
        currentAnchorMessageId: "first-message",
        submittedMessageId: "second-message",
        hasStartedTurn: false,
        hasUserMessage: false,
        queuedMessageCount: 1,
      }),
    ).toBe("first-message");
  });

  it("preserves the first-message anchor after its outbox entry drains", () => {
    expect(
      resolveThreadFeedSubmissionAnchor({
        currentAnchorMessageId: "first-message",
        submittedMessageId: "second-message",
        hasStartedTurn: false,
        hasUserMessage: false,
        queuedMessageCount: 0,
      }),
    ).toBe("first-message");
  });

  it("does not anchor a follow-up after a user message appears", () => {
    expect(
      resolveThreadFeedSubmissionAnchor({
        currentAnchorMessageId: "first-message",
        submittedMessageId: "second-message",
        hasStartedTurn: false,
        hasUserMessage: true,
        queuedMessageCount: 0,
      }),
    ).toBeNull();
  });

  it("does not anchor a thread that has already started a turn", () => {
    expect(
      resolveThreadFeedSubmissionAnchor({
        currentAnchorMessageId: null,
        submittedMessageId: "second-message",
        hasStartedTurn: true,
        hasUserMessage: false,
        queuedMessageCount: 0,
      }),
    ).toBeNull();
  });
});

describe("resolveThreadFeedLiveFollow", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly following: boolean;
    readonly event: ThreadFeedLiveFollowEvent;
    readonly expected: boolean;
  }> = [
    {
      name: "a drag starts",
      following: true,
      event: { type: "user-scroll-begin" },
      expected: false,
    },
    {
      name: "the person's drag moves the list, even at the end",
      following: false,
      event: { type: "scroll", isAtEnd: true, userScrollSessionActive: true },
      expected: false,
    },
    {
      name: "layout compensation moves a follower off the end for a frame",
      following: true,
      event: { type: "scroll", isAtEnd: false, userScrollSessionActive: false },
      expected: true,
    },
    {
      name: "a card below settles shorter and the list lands at its end under a reader",
      following: false,
      event: { type: "scroll", isAtEnd: true, userScrollSessionActive: false },
      expected: false,
    },
    {
      name: "the person's drag and glide came back down to the end",
      following: false,
      event: {
        type: "user-scroll-end",
        isAtEnd: true,
        direction: "toward-end",
        userScrollSessionActive: true,
      },
      expected: true,
    },
    {
      name: "the person nudged up and let go still within the end's tolerance",
      following: false,
      event: {
        type: "user-scroll-end",
        isAtEnd: true,
        direction: "away",
        userScrollSessionActive: true,
      },
      expected: false,
    },
    {
      name: "the person's drag ended above the end",
      following: false,
      event: {
        type: "user-scroll-end",
        isAtEnd: false,
        direction: "toward-end",
        userScrollSessionActive: true,
      },
      expected: false,
    },
    {
      name: "a momentum end from a programmatic scroll",
      following: true,
      event: {
        type: "user-scroll-end",
        isAtEnd: false,
        direction: "away",
        userScrollSessionActive: false,
      },
      expected: true,
    },
    {
      name: "a disclosure the person opened leaves them above the end",
      following: true,
      event: { type: "disclosure-settled", isAtEnd: false, userScrollSessionActive: false },
      expected: false,
    },
    {
      name: "a disclosure closing lands the list at its end under a reader",
      following: false,
      event: { type: "disclosure-settled", isAtEnd: true, userScrollSessionActive: false },
      expected: false,
    },
    {
      name: "a disclosure settles at the end under a follower",
      following: true,
      event: { type: "disclosure-settled", isAtEnd: true, userScrollSessionActive: false },
      expected: true,
    },
    {
      name: "a disclosure settles mid-drag",
      following: false,
      event: { type: "disclosure-settled", isAtEnd: true, userScrollSessionActive: true },
      expected: false,
    },
    {
      name: "a thread switch or the person's send",
      following: false,
      event: { type: "reset" },
      expected: true,
    },
  ];

  it.each(cases)("$name", ({ following, event, expected }) => {
    expect(resolveThreadFeedLiveFollow(following, event)).toBe(expected);
  });
});
