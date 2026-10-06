import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  act,
  createRef,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import { InventoryContext, type Inventory } from "../../zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "../../zerops/zeropsDataContext";
import { forgetRunFolds, setRunFold } from "./runCard.logic";

vi.mock("@legendapp/list/react", async () => {
  const legendListTestId = "legend-list";

  const LegendList = (props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
    anchoredEndSpace?: {
      anchorIndex: number;
      anchorMaxSize?: number;
      anchorOffset?: number;
      onReady?: (info: { anchorIndex: number }) => void;
    };
    contentInsetEndAdjustment?: number;
    className?: string;
    maintainVisibleContentPosition?:
      | boolean
      | {
          data?: boolean;
          size?: boolean;
          shouldRestorePosition?: (item: { id: string }) => boolean;
        };
    ref?: Ref<LegendListRef>;
  }) => {
    if (props.anchoredEndSpace) {
      props.anchoredEndSpace.onReady?.({ anchorIndex: props.anchoredEndSpace.anchorIndex });
    }
    return (
      <div
        data-testid={legendListTestId}
        data-anchor-index={props.anchoredEndSpace?.anchorIndex}
        data-anchor-max-size={props.anchoredEndSpace?.anchorMaxSize}
        data-anchor-offset={props.anchoredEndSpace?.anchorOffset}
        data-anchor-on-ready={Boolean(props.anchoredEndSpace?.onReady)}
        data-content-inset-end={props.contentInsetEndAdjustment}
        data-class-name={props.className}
        data-maintain-visible-content-position={
          typeof props.maintainVisibleContentPosition === "object"
            ? "object"
            : props.maintainVisibleContentPosition
        }
        data-maintain-visible-content-position-data={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.data
            : undefined
        }
        data-maintain-visible-content-position-size={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.size
            : undefined
        }
        data-maintain-visible-content-position-restore={
          typeof props.maintainVisibleContentPosition === "object"
            ? Boolean(props.maintainVisibleContentPosition.shouldRestorePosition)
            : undefined
        }
      >
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  };

  return { LegendList };
});

function MockFileDiff(props: {
  fileDiff: { name?: string | null; prevName?: string | null };
  renderCustomHeader?: (fileDiff: {
    name?: string | null;
    prevName?: string | null;
  }) => React.ReactNode;
}) {
  return (
    <div data-testid="file-diff">
      {props.renderCustomHeader?.(props.fileDiff)}
      {props.fileDiff.name ?? props.fileDiff.prevName ?? "diff"}
    </div>
  );
}

vi.mock("@pierre/diffs/react", () => {
  return { FileDiff: MockFileDiff };
});

vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => children,
}));

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

let MessagesTimeline: typeof import("./MessagesTimeline").MessagesTimeline;
let messageEnters: typeof import("./MessagesTimeline").messageEnters;

const ElementStub = class ElementStub {};

function stubDomGlobals() {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("Element", ElementStub);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    Element: ElementStub,
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
}

beforeAll(async () => {
  stubDomGlobals();
  ({ MessagesTimeline, messageEnters } = await import("./MessagesTimeline"));
}, 30_000);

// The scroll-settling test clears every global stub; mounted timeline rows
// still touch `window` through the tooltip's focus handling.
beforeEach(stubDomGlobals);

const ACTIVE_THREAD_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const MESSAGE_CREATED_AT = "2026-03-17T19:12:28.000Z";

function buildProps() {
  return {
    isWorking: false,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    latestTurn: null,
    runningTurnId: null,
    turnDiffSummaries: [],
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ACTIVE_THREAD_ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    contentInsetEndAdjustment: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
    onPersonInput: () => {},
    onManualNavigation: () => {},
  };
}

function buildLongUserMessageText(tail = "deep hidden detail only after expand") {
  return Array.from({ length: 9 }, (_, index) =>
    index === 8 ? tail : `Line ${index + 1}: ${"verbose prompt content ".repeat(8).trim()}`,
  ).join("\n");
}

function buildUserTimelineEntry(text: string) {
  return {
    id: "entry-1",
    kind: "message" as const,
    createdAt: MESSAGE_CREATED_AT,
    message: {
      id: MessageId.make("message-1"),
      role: "user" as const,
      text,
      turnId: null,
      createdAt: MESSAGE_CREATED_AT,
      updatedAt: MESSAGE_CREATED_AT,
      streaming: false,
    },
  };
}

function buildAssistantTimelineEntry(text: string) {
  const entry = buildUserTimelineEntry(text);
  return {
    ...entry,
    message: {
      ...entry.message,
      role: "assistant" as const,
    },
  };
}

describe("MessagesTimeline", () => {
  it("renders previous and next controls with the minimap", () => {
    const first = buildUserTimelineEntry("First turn");
    const secondBase = buildUserTimelineEntry("Second turn");
    const second = {
      ...secondBase,
      id: "entry-2",
      message: {
        ...secondBase.message,
        id: MessageId.make("message-2"),
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[first, second]} />,
    );

    expect(markup).toContain('aria-label="Previous turn"');
    expect(markup).toContain('aria-label="Next turn"');
  });

  // A conversation on its way draws no face — the header wears its Mate's
  // (pass 30, D2) — and its one line waits its beat before it says anything;
  // a new draft's pane says nothing at all.
  it("draws no face while a conversation is on its way, its one line held for its beat", () => {
    const loading = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} hideEmptyPlaceholder loading timelineEntries={[]} />,
    );
    expect(loading).toContain('role="status"');
    expect(loading).not.toContain("data-mate-face-state");
    expect(loading).not.toContain("Opening");
    const hero = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} hideEmptyPlaceholder timelineEntries={[]} />,
    );
    expect(hero).toContain('data-timeline-loading="true"');
    expect(hero).not.toContain("data-mate-face-state");
  });

  // A working Mate's conversation still on its way has no run to draw yet:
  // a run made up from its status alone was placed and shown, then thrown
  // 1,480 px when the conversation came (the switch harness, 2026-09-29).
  it.each([
    { case: "with no turn known", running: false },
    { case: "with its running turn known from its status", running: true },
  ])(
    "shows a working Mate's pane, not a made-up run, while its conversation is on its way, $case",
    ({ running }) => {
      const turnId = TurnId.make("turn-on-its-way");
      const loading = renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          isWorking
          activeTurnStartedAt={MESSAGE_CREATED_AT}
          {...(running
            ? {
                runningTurnId: turnId,
                latestTurn: {
                  turnId,
                  state: "running" as const,
                  startedAt: MESSAGE_CREATED_AT,
                  completedAt: null,
                },
              }
            : {})}
          hideEmptyPlaceholder
          loading
          timelineEntries={[]}
        />,
      );
      expect(loading).toContain('data-timeline-loading="true"');
      expect(loading).not.toContain("data-timeline-row-kind");
    },
  );

  it("uses the larger leading inset only when the top fade is enabled", () => {
    const timelineEntries = [buildUserTimelineEntry("Hello")];

    const compactMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} />,
    );
    const fadedMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={timelineEntries} topFadeEnabled />,
    );

    expect(compactMarkup).toContain('class="h-3 sm:h-4"');
    expect(compactMarkup).not.toContain("topbar-scroll-fade");
    expect(fadedMarkup).toContain('class="h-10 sm:h-12"');
    expect(fadedMarkup).toContain("topbar-scroll-fade");
  });

  it("treats only the strict list end as the live edge", async () => {
    const {
      resolveTimelineIsAtEnd,
      resolveTimelineMinimapHasPersistentGutter,
      resolveTimelineMinimapCurrentIndex,
      resolveTimelineMinimapHeightStyle,
      resolveTimelineMinimapHitStripWidth,
      resolveTimelineMinimapIndexFromPointer,
      resolveTimelineMinimapInteractiveWidth,
      resolveTimelineMinimapTopPercent,
    } = await import("./MessagesTimeline.logic");

    expect(resolveTimelineIsAtEnd({ isAtEnd: true })).toBe(true);
    expect(resolveTimelineIsAtEnd(undefined)).toBeUndefined();
    // Within the pixel band above the content bottom counts as the end...
    expect(
      resolveTimelineIsAtEnd({
        isAtEnd: false,
        contentLength: 2000,
        scroll: 1170,
        scrollLength: 800,
      }),
    ).toBe(true);
    // ...but half a viewport up (LegendList's isNearEnd territory) does not.
    expect(
      resolveTimelineIsAtEnd({
        isAtEnd: false,
        contentLength: 2000,
        scroll: 900,
        scrollLength: 800,
      }),
    ).toBe(false);
    // The composer inset is part of contentLength and must not count as
    // distance-to-end.
    expect(
      resolveTimelineIsAtEnd(
        { isAtEnd: false, contentLength: 2100, scroll: 1170, scrollLength: 800 },
        100,
      ),
    ).toBe(true);
    // Geometry missing (older state shape): fall back to the strict flag.
    expect(resolveTimelineIsAtEnd({ isAtEnd: false })).toBe(false);

    expect(resolveTimelineMinimapHeightStyle(5)).toBe("min(32px, calc(100vh - 18rem))");
    expect(resolveTimelineMinimapTopPercent(2, 5)).toBe(50);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 101,
        railTop: 100,
        railHeight: 500,
        pointerY: 350,
      }),
    ).toBe(50);
    expect(
      resolveTimelineMinimapIndexFromPointer({
        itemCount: 101,
        railTop: 100,
        railHeight: 500,
        pointerY: 999,
      }),
    ).toBe(100);
    expect(
      resolveTimelineMinimapCurrentIndex({
        scrollTop: 100,
        scrollBottom: 500,
        itemBounds: [
          { top: 80, height: 20 },
          { top: 120, height: 20 },
          { top: 220, height: 20 },
        ],
      }),
    ).toBe(1);
    expect(
      resolveTimelineMinimapCurrentIndex({
        scrollTop: 150,
        scrollBottom: 200,
        itemBounds: [
          { top: 80, height: 20 },
          { top: 120, height: 20 },
          { top: 220, height: 20 },
        ],
      }),
    ).toBe(1);
    expect(
      resolveTimelineMinimapCurrentIndex({
        scrollTop: 0,
        scrollBottom: 50,
        itemBounds: [{ top: 80, height: 20 }],
      }),
    ).toBeNull();
    expect(resolveTimelineMinimapHasPersistentGutter(832)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(863)).toBe(false);
    expect(resolveTimelineMinimapHasPersistentGutter(864)).toBe(true);

    // No usable gutter (zoomed in / narrow pane): the strip must go inert
    // instead of overlaying the centered content column.
    expect(resolveTimelineMinimapHitStripWidth(768)).toBe(0);
    expect(resolveTimelineMinimapHitStripWidth(792)).toBe(0);
    // Partial gutter: strip shrinks to what fits between the viewport edge
    // and the content column.
    expect(resolveTimelineMinimapHitStripWidth(820)).toBe(14);
    // Full gutter: unchanged 40px-wide strip.
    expect(resolveTimelineMinimapHitStripWidth(872)).toBe(40);
    expect(resolveTimelineMinimapHitStripWidth(1400)).toBe(40);
    expect(resolveTimelineMinimapHitStripWidth(0)).toBe(0);
    expect(resolveTimelineMinimapHitStripWidth(Number.NaN)).toBe(0);

    // The collapsed target stays narrow, but an open preview keeps its full
    // 20rem width plus the 2rem offset from the minimap rail interactive.
    expect(resolveTimelineMinimapInteractiveWidth(0, false)).toBe(0);
    expect(resolveTimelineMinimapInteractiveWidth(14, false)).toBe(14);
    expect(resolveTimelineMinimapInteractiveWidth(40, false)).toBe(40);
    expect(resolveTimelineMinimapInteractiveWidth(0, true)).toBe("22rem");
    expect(resolveTimelineMinimapInteractiveWidth(14, true)).toBe("22rem");
    expect(resolveTimelineMinimapInteractiveWidth(40, true)).toBe("22rem");
  });

  it("anchors the first user message using its measured height", () => {
    const onAnchorReady = vi.fn();
    const firstEntry = {
      ...buildUserTimelineEntry("First prompt."),
      message: {
        ...buildUserTimelineEntry("First prompt.").message,
        attachments: [
          {
            type: "image" as const,
            id: "attachment-1",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 1,
            previewUrl: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        anchorMessageId={firstEntry.message.id}
        onAnchorReady={onAnchorReady}
        contentInsetEndAdjustment={144}
        timelineEntries={[firstEntry]}
      />,
    );

    // The day's seam sits above the first message; the message is the anchor.
    expect(markup).toContain('data-anchor-index="1"');
    expect(markup).toContain('data-anchor-offset="16"');
    expect(markup).toContain('data-anchor-on-ready="true"');
    expect(markup).not.toContain("data-anchor-max-size=");
    expect(markup).toContain('data-content-inset-end="144"');
    expect(markup).toContain("[overflow-anchor:none]");
    expect(markup).not.toContain('data-timeline-follows-end=""');
    expect(markup).toContain('data-maintain-visible-content-position="object"');
    expect(markup).toContain('data-maintain-visible-content-position-data="true"');
    expect(markup).toContain('data-maintain-visible-content-position-size="true"');
    // Every row keeps its place: nothing opens in place any more, so no row
    // takes the anchor for itself.
    expect(markup).toContain('data-maintain-visible-content-position-restore="false"');
    expect(onAnchorReady).toHaveBeenCalledOnce();
    expect(onAnchorReady).toHaveBeenCalledWith(firstEntry.message.id, 1);
  });

  it("does not reserve end space for a follow-up user message", () => {
    const onAnchorReady = vi.fn();
    const firstEntry = buildUserTimelineEntry("First prompt.");
    const secondEntry = {
      ...buildUserTimelineEntry("Newest prompt."),
      id: "entry-2",
      message: {
        ...buildUserTimelineEntry("Newest prompt.").message,
        id: MessageId.make("message-2"),
      },
    };
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        anchorMessageId={secondEntry.message.id}
        onAnchorReady={onAnchorReady}
        timelineEntries={[firstEntry, secondEntry]}
      />,
    );

    expect(markup).not.toContain("data-anchor-index=");
    expect(markup).toContain('data-timeline-follows-end=""');
    expect(onAnchorReady).not.toHaveBeenCalled();
  });

  it("keeps reserved end space when tool work starts while reading history", () => {
    const turnId = TurnId.make("turn-with-active-tool");
    const firstEntry = buildUserTimelineEntry("Run the command.");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        latestTurn={{
          turnId,
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        }}
        runningTurnId={turnId}
        anchorMessageId={firstEntry.message.id}
        liveFollowEnabled={false}
        timelineEntries={[
          firstEntry,
          {
            id: "entry-active-tool",
            kind: "work",
            createdAt: MESSAGE_CREATED_AT,
            entry: {
              id: "work-active-tool",
              createdAt: MESSAGE_CREATED_AT,
              turnId,
              toolCallId: "call-active-tool",
              label: "Run command",
              tone: "tool",
              itemType: "command_execution",
              command: "git status",
              toolLifecycleStatus: "inProgress",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-anchor-index="1"');
    expect(markup).not.toContain('data-timeline-follows-end=""');
  });

  it("hands end-following back to the list once the send anchor is released", () => {
    const firstEntry = buildUserTimelineEntry("First prompt.");
    const secondEntry = {
      ...buildUserTimelineEntry("Newest prompt."),
      id: "entry-2",
      message: {
        ...buildUserTimelineEntry("Newest prompt.").message,
        id: MessageId.make("message-2"),
      },
    };
    const timelineEntries = [firstEntry, secondEntry];

    // While the send anchor holds the end space open, ChatView owns streaming
    // scrolls and the timeline must not re-pin behind it.
    expect(
      renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          anchorMessageId={firstEntry.message.id}
          timelineEntries={timelineEntries}
        />,
      ),
    ).not.toContain('data-timeline-follows-end=""');

    // Dropping the anchor is what actually gives end-following back, so
    // returning to the live edge has to release it — re-enabling live follow
    // alone leaves nothing pinned to the stream.
    expect(
      renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          anchorMessageId={null}
          timelineEntries={timelineEntries}
        />,
      ),
    ).toContain('data-timeline-follows-end=""');

    // Reading history still wins over both.
    expect(
      renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          anchorMessageId={null}
          liveFollowEnabled={false}
          timelineEntries={timelineEntries}
        />,
      ),
    ).not.toContain('data-timeline-follows-end=""');
  });

  it("follows a row easing taller on the next frame, and only while following", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const runFrames = () => {
      for (const frame of frames.splice(0)) frame(0);
    };
    const { LegendList } = await import("@legendapp/list/react");
    const viewport = { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 };
    const listRef = {
      current: {
        getState: () => ({ isWithinMaintainScrollAtEndThreshold: true }),
        getScrollableNode: () => viewport,
      } as unknown as LegendListRef,
    };
    const timeline = (liveFollowEnabled: boolean) => (
      <MessagesTimeline
        {...buildProps()}
        listRef={listRef}
        liveFollowEnabled={liveFollowEnabled}
        routeThreadKey="environment-local:thread-follow"
        timelineEntries={[buildUserTimelineEntry("Ask me first.")]}
      />
    );
    let renderer: ReactTestRenderer | undefined;
    // A late frame of the Mate's stream easing open: 3 px, under the 5 px a
    // measurement needs before LegendList re-pins the end itself.
    const easeTaller = () =>
      renderer!.root.findByType(LegendList).props.onItemSizeChanged({
        index: 0,
        itemKey: "message-1",
        itemData: undefined,
        previous: 412,
        size: 415,
      });
    try {
      await act(() => {
        renderer = create(timeline(true));
      });
      runFrames();

      viewport.scrollTop = 1180;
      easeTaller();
      expect(viewport.scrollTop).toBe(1180);
      runFrames();
      expect(viewport.scrollTop).toBe(1200);

      // A gesture between the growth and its frame hands the viewport over.
      viewport.scrollTop = 1180;
      easeTaller();
      await act(() => renderer!.update(timeline(false)));
      runFrames();
      expect(viewport.scrollTop).toBe(1180);

      // Reading history, growth never pulls the viewport down.
      easeTaller();
      runFrames();
      expect(viewport.scrollTop).toBe(1180);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  // The review, 2026-10-04: one step taller than the list and the composer —
  // a long answer landing on a phone — turned the list's own reading of its
  // end stale after the glide's first frame, and the end was lost for good.
  it("follows a step taller than the list to its end, the list's own reading gone stale", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let now = 0;
    const runFrames = () => {
      for (let guard = 0; frames.length > 0 && guard < 300; guard += 1) {
        now += 1000 / 60;
        for (const frame of frames.splice(0)) frame(now);
      }
    };
    const { LegendList } = await import("@legendapp/list/react");
    // A phone's list, 700 tall, at its end. LegendList recomputes whether it
    // is within a viewport of its end only as a scroll lands: once the glide
    // moves it with the end a viewport and more away, it reads false.
    let top = 1300;
    let within = true;
    const viewport = {
      scrollHeight: 2000,
      clientHeight: 700,
      get scrollTop() {
        return top;
      },
      set scrollTop(next: number) {
        top = Math.max(0, Math.min(next, this.scrollHeight - this.clientHeight));
        within = this.scrollHeight - this.clientHeight - top <= this.clientHeight;
      },
    };
    const listRef = {
      current: {
        getState: () => ({ isWithinMaintainScrollAtEndThreshold: within }),
        getScrollableNode: () => viewport,
      } as unknown as LegendListRef,
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <MessagesTimeline
            {...buildProps()}
            listRef={listRef}
            liveFollowEnabled
            routeThreadKey="environment-local:thread-tall-step"
            timelineEntries={[buildUserTimelineEntry("Write it all out.")]}
          />,
        );
      });
      await act(() => renderer!.root.findByType(LegendList).props.onLoad({ elapsedTimeInMs: 4 }));
      runFrames();
      expect(top).toBe(1300);
      // The answer lands whole: 1000 px more.
      viewport.scrollHeight += 1000;
      await act(async () => {
        renderer!.root.findByType(LegendList).props.onItemSizeChanged({
          index: 0,
          itemKey: "message-1",
          itemData: undefined,
          previous: 300,
          size: 1300,
        });
      });
      runFrames();
      expect(top).toBe(2300);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  it("sets a user message's time and actions beside its bubble, not under it", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[buildUserTimelineEntry("Ship it.")]} />,
    );

    expect(markup).toContain('class="group flex flex-row-reverse items-end gap-2"');
  });

  it("draws a crew task card as a task, never as the person's bubble", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            `${CREW_CARD_OPENER}\n#12 Camera rig · from you\nDone when: the camera follows`,
          ),
        ]}
      />,
    );

    expect(markup).toContain('data-timeline-row-kind="crew-card"');
    expect(markup).toContain("data-crew-task-card");
    expect(markup).toContain(">Camera rig</p>");
    expect(markup).not.toMatch(/#12|from you/u);
    expect(markup).toContain("Done when:</span> the camera follows");
    expect(markup).not.toContain(CREW_CARD_OPENER);
    expect(markup).not.toMatch(/rounded-2xl bg-message/);
  });

  it("draws a crew seam as a line across the chat, never as work", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "seam-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "seam-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              turnId: null,
              label: "Task #12 landed as a1b2c3d4e5",
              tone: "info",
              sourceActivityKind: "crew.seam",
              crewSeam: { seam: "landed", taskId: "task-12", number: 12, commit: "a1b2c3d4e5" },
            },
          },
        ]}
      />,
    );

    expect(markup).toContain('data-timeline-row-kind="crew-seam"');
    expect(markup).toContain("Its work went into the Mate&#x27;s code<");
    expect(markup).not.toContain("a1b2c3d");
    expect(markup).not.toContain('data-timeline-row-kind="background"');
  });

  it("opens an empty crewmate conversation with the crewmate, its stint seam on top", async () => {
    const { CrewTimelineContext } = await import("../zerops/crew/CrewTaskCard");
    const markup = renderToStaticMarkup(
      <CrewTimelineContext
        value={{
          firstCardId: null,
          origin: null,
          tasks: [],
          crewmate: { handle: "backend", profile: null },
          mateName: "Fen",
          onOpenThread: () => {},
          onChangeJob: null,
        }}
      >
        <MessagesTimeline
          {...buildProps()}
          timelineEntries={[
            {
              id: "seam-1",
              kind: "work",
              createdAt: "2026-03-17T19:12:28.000Z",
              entry: {
                id: "seam-1",
                createdAt: "2026-03-17T19:12:28.000Z",
                turnId: null,
                label: "You cleared its conversation",
                tone: "info",
                sourceActivityKind: "crew.seam",
                crewSeam: { seam: "stint", previousThreadId: null },
              },
            },
          ]}
        />
      </CrewTimelineContext>,
    );

    expect(markup).toContain('data-zerops-surface="crewmate-empty-state"');
    expect(markup).toContain("You cleared its conversation");
    // Its name's line is held, empty, until the crew is read: the handle never stands in.
    expect(markup).toContain("data-crewmate-name-held");
    expect(markup).not.toContain(">backend<");
    expect(markup).not.toContain("Message backend");
    expect(markup).not.toContain("@backend");
    expect(markup).not.toContain('data-timeline-row-kind="crew-seam"');
  });

  it("renders collapse controls for long user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain("Show full message");
    expect(markup).toContain('data-timeline-follows-end=""');
    expect(markup).toContain('data-user-message-collapsed="true"');
    expect(markup).toContain('data-user-message-fade="true"');
    expect(markup).toContain('data-user-message-footer="true"');
  });

  it("does not render collapse controls for short user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry("Short prompt.")]}
      />,
    );

    expect(markup).not.toContain("Show full message");
    expect(markup).toContain('data-user-message-collapsible="false"');
    // The chat's one bubble: 14 px in, 10 px down, as every bubble of the run is.
    expect(markup).toMatch(/rounded-2xl bg-message[^"]* px-3\.5 py-2\.5/);
  });

  it("preserves arbitrary XML-like tags and comparisons in rendered user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              'Without reading a file, do you have <global-agent-instructions scope="workspace">',
              'Before <nested data-value="a&b">inside</nested> after',
              "</global-agent-instructions> in your context?",
              "Comparison: 2 < 3 and 5 > 4.",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain("&lt;global-agent-instructions scope=&quot;workspace&quot;&gt;");
    expect(markup).toContain(
      "Before &lt;nested data-value=&quot;a&amp;b&quot;&gt;inside&lt;/nested&gt; after",
    );
    expect(markup).toContain("&lt;/global-agent-instructions&gt; in your context?");
    expect(markup).toContain("Comparison: 2 &lt; 3 and 5 &gt; 4.");
  });

  it("preserves XML-like source inside user code spans and fences", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              'Inline `<tag attr="x">`',
              "",
              "```xml",
              '<root><child enabled="true" /></root>',
              "```",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain('<code data-inline-code="">&lt;tag attr=&quot;x&quot;&gt;</code>');
    expect(markup).toContain("&lt;root&gt;&lt;child enabled=&quot;true&quot; /&gt;&lt;/root&gt;");
  });

  it("does not render markdown title attributes in user messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            '[link](https://example.com "link tip") ![image](https://example.com/image.png "image tip")',
          ),
        ]}
      />,
    );

    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain('src="https://example.com/image.png"');
    expect(markup).not.toContain('title="link tip"');
    expect(markup).not.toContain('title="image tip"');
  });

  it("renders unsafe user HTML as inert source text", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            '<script>globalThis.__t3Xss = 1</script><img src="x" onerror="globalThis.__t3Xss = 2">',
          ),
        ]}
      />,
    );

    expect(markup).toContain("&lt;script&gt;globalThis.__t3Xss = 1&lt;/script&gt;");
    expect(markup).toContain(
      "&lt;img src=&quot;x&quot; onerror=&quot;globalThis.__t3Xss = 2&quot;&gt;",
    );
    expect(markup).not.toMatch(/<script(?:\s|>)/i);
    expect(markup).not.toMatch(/<img(?:\s|>)/i);
  });

  it("continues to render sanitized raw HTML in assistant messages", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildAssistantTimelineEntry("<details><summary>More</summary>Details</details>"),
        ]}
      />,
    );

    expect(markup).toContain('data-markdown-details=""');
    expect(markup).toContain("More");
    expect(markup).not.toContain("&lt;details&gt;");
  });

  it("sanitizes executable HTML while preserving supported assistant markup", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildAssistantTimelineEntry(
            [
              '<details open onclick="globalThis.__t3Xss = 1">',
              "<summary>Safe details</summary>",
              "<script>globalThis.__t3Xss = 2</script>",
              '<img src="x" onerror="globalThis.__t3Xss = 3">',
              '<a href="javascript:globalThis.__t3Xss = 4">Unsafe link</a>',
              "</details>",
            ].join(""),
          ),
        ]}
      />,
    );

    expect(markup).toContain('data-markdown-details=""');
    expect(markup).toContain("Safe details");
    expect(markup).not.toMatch(/<script(?:\s|>)/i);
    expect(markup).not.toContain("onclick=");
    expect(markup).not.toContain("onerror=");
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("globalThis.__t3Xss");
  });

  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildUserTimelineEntry(
            [
              buildLongUserMessageText("yoo what's @terminal-1:1-5 mean"),
              "",
              "<terminal_context>",
              "- Terminal 1 lines 1-5:",
              "  1 | julius@mac effect-http-ws-cli % bun i",
              "  2 | bun install v1.3.9 (cf6cdbbb)",
              "</terminal_context>",
            ].join("\n"),
          ),
        ]}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s</p>");
    expect(markup).toContain('<span aria-hidden="true"> </span>');
    expect(markup).toContain("Show full message");
  }, 20_000);

  it("keeps the copy button for collapsed long user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain('aria-label="Copy message"');
    expect(markup).toContain('data-user-message-collapsed="true"');
    expect(markup).toContain('data-user-message-footer="true"');
  });

  it("renders review comment contexts as structured cards instead of raw tags", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-2"),
              role: "user",
              text: [
                '<review_comment sectionId="turn:2" sectionTitle="Turn 2" filePath="apps/web/src/lib/contextWindow.test.ts" startIndex="3" endIndex="14" rangeLabel="+47 to +58">',
                "Wadduo",
                "```diff",
                "@@ -0,0 +47,2 @@",
                '+  it("keeps valid zero-usage snapshots", () => {',
                "+    expect(snapshot).not.toBeNull();",
                "```",
                "</review_comment>",
              ].join("\n"),
              turnId: null,
              createdAt: "2026-03-17T19:12:28.000Z",
              updatedAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("contextWindow.test.ts");
    expect(markup).toContain("Wadduo");
    expect(markup).toContain('data-testid="file-diff"');
    expect(markup).not.toContain(">Review comment<");
    expect(markup).not.toContain("&lt;review_comment");
    expect(markup).not.toContain("&lt;/review_comment&gt;");
  });

  it("renders file review comments as source code instead of diffs", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-source-comment"),
              role: "user",
              text: [
                '<review_comment sectionId="file:docs/plan.md" sectionTitle="File comment" filePath="docs/plan.md" startIndex="0" endIndex="1" rangeLabel="L1 to L2">',
                "Clarify this.",
                "```md",
                "# Plan",
                "- Step one",
                "```",
                "</review_comment>",
              ].join("\n"),
              turnId: null,
              createdAt: "2026-03-17T19:12:28.000Z",
              updatedAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("plan.md");
    expect(markup).toContain("Clarify this.");
    expect(markup).toContain("# Plan");
    expect(markup).not.toContain('data-testid="file-diff"');
  });

  /**
   * A Zerops call the model classified "generic" (never a card) reaches
   * `MessagesTimeline` as its own `generic-call` row kind, but renders
   * through the same generic tool block as any other tool — this component
   * decodes no Zerops payload of its own.
   */

  /**
   * A tool call's result is not its name. The generic row is the fallback for
   * a Zerops call no card claims, and it was printing the raw payload as the
   * single truncated line a person reads — unopenable, because the body
   * deduped against the label it had become (measured on the test account,
   * 2026-09-20).
   */

  it("renders an operation timeline entry through ZeropsOperationCard", () => {
    const operation: ZeropsOperation = {
      key: "call:deploy-operation",
      kind: "deploy",
      phase: "done",
      anchorAt: MESSAGE_CREATED_AT,
      anchorActivityId: "deploy-operation",
      settledAt: MESSAGE_CREATED_AT,
      turnId: null,
      subject: "kanbandev",
      kicker: "Deploy · kanbandev",
      voice: "Deploying kanbandev.",
      voiceSource: "mate",
      statusWord: "Deployed",
      closing: "kanbandev is live.",
      steps: [],
      links: [],
      callIds: ["deploy-operation"],
      target: { hostname: "kanbandev" },
      hasResult: true,
    };
    // The operation card reads the account data runtime and the inventory; a
    // static render never acquires an interest, so empty stand-ins suffice.
    const inventory: Inventory = {
      projects: [],
      isLoading: false,
      error: null,
      projectRefs: new Map(),
      authority: new Map(),
      account: { kind: "authorized" },
      lost: new Set(),
    };
    const zeropsData: ZeropsDataContextValue = {
      runtime: {} as ManagedZeropsDataRuntime,
      signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
      organizationRef: () => {
        throw new Error("not used");
      },
      projectRef: () => {
        throw new Error("not used");
      },
    };
    const markup = renderToStaticMarkup(
      <ZeropsDataContext value={zeropsData}>
        <InventoryContext value={inventory}>
          <MessagesTimeline
            {...buildProps()}
            timelineEntries={[
              {
                id: "zerops:call:deploy-operation",
                kind: "operation",
                createdAt: MESSAGE_CREATED_AT,
                operation,
              },
            ]}
          />
        </InventoryContext>
      </ZeropsDataContext>,
    );

    expect(markup).toContain("data-zerops-card");
    expect(markup).toContain('data-zerops-card-kind="deploy"');
    expect(markup).toMatch(/data-zerops-subject-chip[^>]*>kanbandev</);
    expect(markup).toContain("kanbandev is live.");
  });
});

describe("MessagesTimeline — the conversation", () => {
  const turnId = TurnId.make("turn-1");
  const at = (second: number) =>
    new Date(Date.parse(MESSAGE_CREATED_AT) + second * 1000).toISOString();
  const settled = {
    turnId,
    state: "completed" as const,
    startedAt: MESSAGE_CREATED_AT,
    completedAt: at(90),
  };
  const assistant = (id: string, second: number, text: string) => ({
    id,
    kind: "message" as const,
    createdAt: at(second),
    message: {
      id: MessageId.make(id),
      role: "assistant" as const,
      text,
      turnId,
      createdAt: at(second),
      updatedAt: at(second),
      streaming: false,
    },
  });
  const tool = (id: string, second: number) => ({
    id,
    kind: "work" as const,
    createdAt: at(second),
    entry: {
      id,
      createdAt: at(second),
      turnId,
      toolCallId: `call-${id}`,
      label: "Run command",
      tone: "tool" as const,
      itemType: "command_execution" as const,
      command: "pnpm build",
      toolLifecycleStatus: "completed" as const,
    },
  });
  const zeropsStandIns = (children: ReactNode) => {
    const inventory: Inventory = {
      projects: [],
      isLoading: false,
      error: null,
      projectRefs: new Map(),
      authority: new Map(),
      account: { kind: "authorized" },
      lost: new Set(),
    };
    const zeropsData: ZeropsDataContextValue = {
      runtime: {} as ManagedZeropsDataRuntime,
      signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
      organizationRef: () => {
        throw new Error("not used");
      },
      projectRef: () => {
        throw new Error("not used");
      },
    };
    return (
      <ZeropsDataContext value={zeropsData}>
        <InventoryContext value={inventory}>{children}</InventoryContext>
      </ZeropsDataContext>
    );
  };
  const operation = (overrides: Partial<ZeropsOperation>): ZeropsOperation => ({
    key: "op:deploy-1",
    kind: "deploy",
    phase: "done",
    anchorAt: at(20),
    anchorActivityId: "deploy-1",
    settledAt: at(50),
    turnId,
    subject: "appstage",
    kicker: "Deploy · appstage",
    voice: "Deploying appstage.",
    voiceSource: "mate",
    statusWord: "Deployed",
    closing: "appstage is live.",
    steps: [],
    links: [{ label: "Open", url: "https://appstage.example.dev" }],
    callIds: ["deploy-1"],
    target: { hostname: "appstage" },
    hasResult: true,
    ...overrides,
  });

  it("names the crewmate, never the Mate, on a crewmate's run status", async () => {
    const { CrewTimelineContext } = await import("../zerops/crew/CrewTaskCard");
    const { crewSnapshotFixture } =
      await import("@t3tools/client-runtime/zerops/crew/testing/fixtures");
    const backend = crewSnapshotFixture().crewmates.find((mate) => mate.handle === "backend")!;
    const markup = renderToStaticMarkup(
      <CrewTimelineContext
        value={{
          firstCardId: null,
          origin: null,
          tasks: [],
          crewmate: { handle: "backend", profile: backend },
          mateName: "Fen",
          onOpenThread: () => {},
          onChangeJob: null,
        }}
      >
        <MessagesTimeline
          {...buildProps()}
          latestTurn={settled}
          timelineEntries={[
            buildUserTimelineEntry("Build it"),
            tool("w1", 5),
            assistant("a2", 60, "The shop builds."),
          ]}
        />
      </CrewTimelineContext>,
    );
    expect(markup).toMatch(/>Backend worked \d/u);
    expect(markup).not.toContain("Assistant worked");
  });

  it("draws a settled turn as the message, its card — chat, status, result — and the answer", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={settled}
        timelineEntries={[
          buildUserTimelineEntry("Build it"),
          tool("w1", 5),
          assistant("a1", 10, "Building the shop now."),
          tool("w2", 20),
          assistant("a2", 60, "The shop builds."),
        ]}
      />,
    );
    // The chat's last line says who worked and how long: to the answer, not
    // to when the server closed the turn — the same span once another turn
    // follows. No heading stands over the card.
    expect(markup).toContain(">This Mate worked 1m<");
    expect(markup).not.toContain('data-timeline-row-kind="work-line"');
    // Come back to, the run is closed to its summary line (D3): everything it
    // said and did behind "Show work".
    const record = markup.slice(markup.indexOf('data-timeline-row-kind="record"'));
    expect(record).toContain('data-run-fold="folded"');
    expect(record).toMatch(/<button aria-expanded="false" class="run-now-fold"[^>]*>Show work/u);
    expect(record).not.toContain("Building the shop now.");
    expect(record).not.toContain(">pnpm build<");
    // What its calls came to is the work's and the worked line's, never a
    // result row (K6): a run that only ran commands leaves no result.
    expect(markup).not.toContain("Ran 2 commands");
    expect(markup).not.toContain("data-turn-report");
    expect(markup).toContain("The shop builds.");
    expect(markup).not.toContain("data-message-receipt");
    // Nothing about the run opens a dialog: what it holds opens in place.
    expect(markup).not.toContain('aria-haspopup="dialog"');
  });

  // A run whose card holds its line alone keeps its card, closed as open (the
  // owner, 2026-09-30, of a bare worked line: "why the collapsed state has no
  // bg at all?").
  it.each([
    { fold: "folded", case: "closed" },
    { fold: "shown", case: "opened" },
  ] as const)("keeps the card of a run whose line is all it holds, $case", ({ fold }) => {
    setRunFold("environment-local:thread-1", "msg:message-1", fold);
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={settled}
        timelineEntries={[
          buildUserTimelineEntry("Build it"),
          tool("w1", 5),
          assistant("a1", 60, "The shop builds."),
        ]}
      />,
    );
    forgetRunFolds("environment-local:thread-1");
    const slice = (id: string) =>
      new RegExp(`data-timeline-row-id="${id}"[^>]*><div class="([^"]*)"`, "u").exec(markup)?.[1];
    expect(markup).toContain(`data-run-fold="${fold}"`);
    expect(slice("record:msg:message-1")).toBe("run-tray run-tray-top");
    expect(slice("card-end:msg:message-1")).toBe("run-tray run-tray-bottom");
  });

  // A card with nothing in it but its line's row is drawn whole by that row
  // (the owner, 2026-09-30, of a live card holding only "Thinking": "the
  // state of border radiuses in the initial thinking with no other content
  // around sucks"): closed as open, and live while nothing runs alongside.
  it.each([
    {
      case: "closed",
      fold: "folded",
      live: false,
      alongside: false,
      whole: ["record", "card-end"],
    },
    { case: "opened", fold: "shown", live: false, alongside: false, whole: ["record", "card-end"] },
    {
      case: "live, nothing alongside",
      fold: null,
      live: true,
      alongside: false,
      whole: ["record", "working", "card-end"],
    },
    { case: "live, a task alongside", fold: null, live: true, alongside: true, whole: [] },
  ] as const)("draws a card whole by its line's row: $case", ({ fold, live, alongside, whole }) => {
    if (fold !== null) setRunFold("environment-local:thread-1", "msg:message-1", fold);
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        {...(live
          ? {
              isWorking: true,
              activeTurnStartedAt: MESSAGE_CREATED_AT,
              latestTurn: running,
              runningTurnId: turnId,
            }
          : { latestTurn: settled })}
        {...(alongside
          ? {
              working: {
                operations: [],
                helpers: null,
                tasks: null,
                background: {
                  tasks: [
                    {
                      id: "b1",
                      title: "Serve the app on port 3000",
                      state: "running" as const,
                      watch: false,
                      turnId: "turn-1",
                      startedAt: at(2),
                      endedAt: null,
                    },
                  ],
                  running: 1,
                  done: 0,
                  failed: 0,
                },
                afterTurn: null,
                pause: null,
              },
            }
          : {})}
        timelineEntries={[
          buildUserTimelineEntry("Build it"),
          tool("w1", 5),
          ...(live ? [] : [assistant("a1", 60, "The shop builds.")]),
        ]}
      />,
    );
    forgetRunFolds("environment-local:thread-1");
    const drawn = [
      ...markup.matchAll(/data-card-whole=""[^>]*? data-timeline-row-kind="([^"]+)"/gu),
    ];
    expect(drawn.map((match) => match[1])).toEqual(whole);
  });

  // A step is a bubble of the run's chat; what it printed opens in place,
  // under it — never a dialog (the owner, 2026-09-27: "I hate the dialog").
  it("opens what a step printed in place, under its bubble", () => {
    // A run the person watched stays open while they are in the conversation.
    setRunFold("environment-local:thread-1", "msg:message-1", "watched");
    const built = tool("w1", 5);
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={settled}
        timelineEntries={[
          buildUserTimelineEntry("Build it"),
          { ...built, entry: { ...built.entry, detail: "dist/index.js  48.2 kB" } },
          assistant("a1", 60, "The shop builds."),
        ]}
      />,
    );
    expect(markup).toMatch(
      /<div[^>]*data-chat-bubble="tool"[^>]*data-chat-kind="step:command"[^>]*>(?:<span class="absolute[^"]*">[\s\S]*?<\/svg><\/span><\/span><\/span>)<button aria-expanded="false" aria-label="pnpm build\. Show what it returned"/,
    );
    expect(markup).not.toContain("dist/index.js");
    forgetRunFolds("environment-local:thread-1");
  });

  it("says the Mate is working from the moment a message is sent", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        timelineEntries={[buildUserTimelineEntry("Deploy it")]}
      />,
    );
    // The card stands from the first frame, the now line its last line.
    expect(markup).toContain('data-timeline-row-id="record:msg:message-1"');
    expect(markup).toContain(">Thinking<");
    expect(markup).toContain('data-work-line="working"');
    expect(markup).toContain('data-message-receipt="sent"');
  });

  const running = {
    turnId,
    state: "running" as const,
    startedAt: MESSAGE_CREATED_AT,
    completedAt: null,
  };
  const liveTimeline = (entries: ReadonlyArray<unknown>) =>
    renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        isWorking
        activeTurnStartedAt={MESSAGE_CREATED_AT}
        latestTurn={running}
        runningTurnId={turnId}
        timelineEntries={
          [buildUserTimelineEntry("Fix the types"), ...entries] as Parameters<
            typeof MessagesTimeline
          >[0]["timelineEntries"]
        }
      />,
    );

  it("records the Mate's words and steps as they happen, a failure where it happened", () => {
    const markup = liveTimeline([
      assistant("a1", 5, "Checking the build."),
      {
        ...tool("t9", 10),
        entry: {
          ...tool("t9", 10).entry,
          command: undefined,
          tone: "error" as const,
          label: "Run the type check",
          sourceActivityKind: "task.completed" as const,
        },
      },
      assistant("a2", 15, "Fixing the types."),
      tool("w2", 16),
    ]);
    const record = markup.slice(markup.indexOf('data-timeline-row-kind="record"'));
    expect(record).toMatch(/data-chat-bubble="failed"[^>]*data-chat-kind="task"/);
    expect(record).toContain("Run the type check failed");
    // Oldest first, the step it took last.
    expect(record.indexOf("Checking the build.")).toBeLessThan(
      record.indexOf("Run the type check failed"),
    );
    expect(record.indexOf("Run the type check failed")).toBeLessThan(
      record.indexOf("Fixing the types."),
    );
    expect(record.indexOf("Fixing the types.")).toBeLessThan(record.indexOf("pnpm build"));
    // Between steps the now line says it thinks: no word of what it did twice.
    expect(record).toContain(">Thinking<");
    // What runs alongside stands under the record.
    expect(markup).toContain("data-conversation-working");
  });

  // D4 (run 11): its words stream in the working row as the note they become.
  it("streams the words the Mate is writing in its working row", () => {
    const writing = assistant("a1", 8, "Checking /status next.");
    const markup = liveTimeline([
      tool("w1", 5),
      { ...writing, message: { ...writing.message, streaming: true } },
    ]);
    expect(markup).toContain('data-chat-kind="note"');
    expect(markup).toContain("Checking /status next.");
  });

  it("shows the Mate composing before it said anything", () => {
    const markup = liveTimeline([tool("w1", 5)]);
    expect(markup).toContain(">Thinking<");
    expect(markup).not.toContain('data-chat-kind="note"');
  });

  const call = (id: string, second: number, detail: string) => ({
    ...tool(id, second),
    entry: {
      ...tool(id, second).entry,
      itemType: "dynamic_tool_call" as const,
      label: "Tool call",
      command: undefined,
      detail,
      toolLifecycleStatus: "inProgress" as const,
    },
  });

  // The step it is taking lives on the now line while it runs (K10), in
  // words and with what it is on — the page it reads, the command it runs —
  // once, beside its face; it lands in the chat above once it ends.
  it("says the step the Mate is taking on the now line, once, with what it is on", () => {
    const markup = liveTimeline([
      assistant("a1", 5, "Reading the docs first."),
      call("c1", 8, 'WebFetch: {"url":"https://docs.example.dev/guides"}'),
    ]);
    // In the live slot, as the row it becomes: said plainly, sweeping.
    expect(markup.match(/data-chat-kind="step:web"/g)).toHaveLength(1);
    expect(markup).toContain('data-mate-face-state="working"');
    // Once in the slot, and once more for a screen reader, in its words alone; the sweep's
    // copy of the words is hidden from readers and repeats them where they stand.
    const said = markup.replace(/<span data-sweep-copy="">.*?<\/span><\/span>/gu, "");
    expect(markup).toMatch(/aria-hidden="true" data-sweep-band="" inert="">/u);
    expect(said.match(/docs\.example\.dev\/guides/g)).toHaveLength(2);
    expect(markup).toContain(
      '<span class="sr-only" role="status">Reading docs.example.dev/guides</span>',
    );
    expect(markup).not.toContain("WebFetch");
  });

  it("waits on the person when the Mate asked with its question tool", () => {
    const markup = liveTimeline([
      call("c1", 8, 'AskUserQuestion: {"questions":[{"question":"Teal or amber?"}]}'),
    ]);
    expect(markup).toContain('data-run-status="waiting"');
    expect(markup).toContain('data-mate-face-state="needs"');
    expect(markup).toContain(">Waiting for your answer<");
    expect(markup).not.toContain("AskUserQuestion");
  });

  // The question stands in the run's card as the Mate asked it, in its tint
  // with its face beside it, and the person's answer under it in their own
  // bubble (K14) — kept when the run folds on return (K7).
  it("keeps the question the Mate asked in its card, the answer in the person's bubble under it", () => {
    // Open, as the person watched it: come back to, it is behind "Show work".
    setRunFold("environment-local:thread-1", "msg:message-1", "watched");
    const input = (id: string, second: number, extra: Record<string, unknown>) => ({
      ...tool(id, second),
      entry: {
        ...tool(id, second).entry,
        tone: "info" as const,
        itemType: undefined,
        command: undefined,
        toolCallId: undefined,
        toolLifecycleStatus: undefined,
        inputRequestId: "req-1",
        ...extra,
      },
    });
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={settled}
        timelineEntries={
          [
            buildUserTimelineEntry("Pick a colour with me"),
            input("rq", 5, {
              label: "User input requested",
              sourceActivityKind: "user-input.requested",
              inputQuestions: [
                { id: "accent", header: "Accent colour", question: "Which accent do you prefer?" },
              ],
            }),
            input("rs", 20, {
              label: "User input submitted",
              sourceActivityKind: "user-input.resolved",
              inputAnswers: [{ key: "accent", answer: "Teal" }],
            }),
            assistant("a1", 30, "Teal it is."),
          ] as Parameters<typeof MessagesTimeline>[0]["timelineEntries"]
        }
      />,
    );
    const card = markup.slice(markup.indexOf('data-timeline-row-kind="record"'));
    expect(card).toMatch(
      /data-chat-bubble="speech" data-chat-kind="question"><div[^>]*><div[^>]*data-capped="item"[^>]*><div[^>]*><p[^>]*>Which accent do you prefer\?</u,
    );
    expect(card).toMatch(/<p class="[^"]*bg-message[^"]*" data-chat-kind="person">Teal</u);
    expect(card.indexOf("Which accent do you prefer?")).toBeLessThan(card.indexOf(">Teal<"));
    // No row of its own on the page: the question and answer are the card's.
    expect(markup).not.toContain("data-person-answer");
    // The question's short header was never the person's words.
    expect(markup).not.toContain("Accent colour");
    forgetRunFolds("environment-local:thread-1");
  });

  it("says what finished in the background, in words", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={settled}
        timelineEntries={
          [
            buildUserTimelineEntry("Start the checks"),
            assistant("a1", 5, "Started them."),
            {
              ...tool("b1", 120),
              entry: {
                ...tool("b1", 120).entry,
                turnId: null,
                label: "Run the smoke tests",
                sourceActivityKind: "task.completed",
                taskId: "task-1",
                detail: "4 passed",
              },
            },
          ] as Parameters<typeof MessagesTimeline>[0]["timelineEntries"]
        }
      />,
    );
    // The task in its own words, where it ran, and what it reported in a
    // few words, on the line itself: nothing left to open.
    expect(markup).toContain("Run the smoke tests finished");
    expect(markup).toContain("in the background · 4 passed");
    expect(markup).not.toContain("Show what it reported");
    expect(markup).not.toContain("1 background task ");
  });

  it("opens a run a helper's result woke with the helper that finished", () => {
    const woken = TurnId.make("turn-2");
    const review = tool("h1", 20);
    const answer = assistant("a2", 60, "The review came back clean.");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={{ ...settled, turnId: woken }}
        timelineEntries={
          [
            buildUserTimelineEntry("Have a helper review it"),
            assistant("a1", 5, "A helper is reviewing it."),
            {
              ...review,
              entry: {
                ...review.entry,
                label: "Review the endpoint",
                toolTitle: "Review the endpoint",
                sourceActivityKind: "task.completed",
                taskId: "task-1",
                agentRole: "general-purpose",
                tone: "info",
                detail: "No issues found.",
                // Spawned mid-run, it finished once the run had ended.
                updatedAt: at(45),
              },
            },
            assistant("a3", 30, "It reports back when done."),
            { ...answer, message: { ...answer.message, turnId: woken } },
          ] as Parameters<typeof MessagesTimeline>[0]["timelineEntries"]
        }
      />,
    );
    // The run went on over the turn the helper woke: one card, what woke it
    // inside its work, nothing loose between cards (run 11).
    expect(markup.match(/data-timeline-row-kind="record"/g)).toHaveLength(1);
    expect(markup).not.toContain('data-timeline-row-kind="background"');
    expect(markup).toContain("The review came back clean.");
  });

  it.each([
    { watch: true, words: "Watching in the background", title: "Watch the pull request" },
    { watch: false, words: "Still working in the background", title: "Typecheck appdev" },
  ])(
    // A watch or a background command may run for hours: the run settles with
    // its answer, and the work goes on at the bottom with the way to stop it.
    "keeps the Mate at work at the bottom after its answer while work runs on, with a stop ($words)",
    ({ watch, words, title }) => {
      const markup = renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          latestTurn={settled}
          afterTurnWork="monitoring"
          working={{
            operations: [],
            helpers: null,
            tasks: null,
            background: {
              tasks: [
                {
                  id: "b1",
                  title,
                  state: "running",
                  watch,
                  turnId: "turn-1",
                  startedAt: at(20),
                  endedAt: null,
                },
              ],
              running: 1,
              done: 0,
              failed: 0,
            },
            afterTurn: "monitoring",
            pause: null,
          }}
          timelineEntries={[
            buildUserTimelineEntry("Keep an eye on it"),
            tool("w1", 5),
            assistant("a1", 10, "On it."),
          ]}
        />,
      );
      expect(markup).toContain('data-conversation-after-work="monitoring"');
      expect(markup).toContain(words);
      expect(markup).toContain(title);
      expect(markup).toContain(">Stop<");
      // The answer stays where it was: the panel comes after it.
      expect(markup.indexOf("On it.")).toBeLessThan(markup.indexOf(words));
    },
  );

  // Run 11, "finished, but background running": the run's own card waits on
  // the helpers it launched, with the way to stop them — nothing at the bottom.
  it("keeps the run's card waiting on its helpers, with a stop", () => {
    const review = tool("h1", 8);
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={settled}
        afterTurnWork="working"
        liveJobs={{ ids: new Set(["task-1"]) }}
        timelineEntries={
          [
            buildUserTimelineEntry("Have a helper review it"),
            {
              ...review,
              entry: {
                ...review.entry,
                label: "Review the endpoint",
                toolTitle: "Review the endpoint",
                sourceActivityKind: "task.started",
                taskId: "task-1",
                agentRole: "general-purpose",
                tone: "info",
              },
            },
            assistant("a1", 10, "A helper is reviewing it."),
          ] as Parameters<typeof MessagesTimeline>[0]["timelineEntries"]
        }
      />,
    );
    expect(markup).not.toContain("data-conversation-after-work");
    expect(markup).toContain("Waiting for its helpers");
    expect(markup).toContain(">Stop<");
  });

  it("draws a usage limit as one pause, however many attempts hit it", () => {
    const limit = "You've hit your session limit · resets 9:20pm (UTC)";
    const background = (id: string, second: number) => ({
      ...assistant(id, second, limit),
      message: { ...assistant(id, second, limit).message, turnId: TurnId.make(`turn-${id}`) },
    });
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={{ ...settled, turnId: TurnId.make("turn-b3") }}
        timelineEntries={[
          buildUserTimelineEntry("Keep going"),
          tool("w1", 5),
          assistant("a1", 30, limit),
          background("b2", 31),
          background("b3", 32),
        ]}
      />,
    );
    expect(markup.match(/data-conversation-pause=/g)).toHaveLength(1);
    expect(markup).toContain("Claude usage limit");
    expect(markup).toContain("2 more attempts");
    expect(markup).not.toContain("You&#x27;ve hit your session limit");
  });

  it("draws a slash command as an event, never the person's bubble", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={settled}
        timelineEntries={[buildUserTimelineEntry("/compact"), tool("w1", 5)]}
      />,
    );
    expect(markup).toContain("data-conversation-event");
    expect(markup).toContain("Context condensed");
    expect(markup).not.toContain("rounded-2xl bg-message");
  });

  it("never shows the client's image-only placeholder as the person's words", () => {
    const entry = buildUserTimelineEntry(
      "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]",
    );
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            ...entry,
            message: {
              ...entry.message,
              attachments: [
                {
                  type: "image" as const,
                  id: "attachment-1",
                  name: "screenshot.png",
                  mimeType: "image/png",
                  sizeBytes: 1,
                  previewUrl: "data:image/png;base64,iVBORw0KGgo=",
                },
              ],
            },
          },
        ]}
      />,
    );
    expect(markup).toContain("screenshot.png");
    expect(markup).not.toContain("User attached one or more images");
  });

  it("keeps a failed deploy in the log and says in the outcome what the turn came to", () => {
    const markup = renderToStaticMarkup(
      zeropsStandIns(
        <MessagesTimeline
          {...buildProps()}
          latestTurn={settled}
          // Markdown (the person's message, the answer) reads the account's
          // grant, which these stand-ins lack: the turn is drawn from its work.
          timelineEntries={[
            {
              id: "zerops:op:deploy-0",
              kind: "operation",
              createdAt: at(10),
              operation: operation({
                key: "op:deploy-0",
                phase: "failed",
                statusWord: "Failed",
                anchorAt: at(10),
                settledAt: at(15),
                closing: "The build failed.",
                links: [],
              }),
            },
            {
              id: "zerops:op:deploy-1",
              kind: "operation",
              createdAt: at(20),
              // A link would render the browser-panel link, which needs the account's grant.
              operation: operation({ links: [] }),
            },
          ]}
        />,
      ),
    );
    // The failure is a step on the way, not a card under the closed line.
    expect(markup).not.toContain('data-zerops-card-kind="deploy"');
    expect(markup).toContain("data-turn-report");
    expect(markup).toContain("appstage");
    expect(markup).toContain("Deployed");
  });
});

describe("messageEnters", () => {
  // A message that arrived while the person watched rises into place once;
  // what the conversation opened onto is simply there. The baseline is the
  // newest message's time at opening, on the server's clock.
  const opened = Date.parse("2026-09-29T01:00:00.000Z");
  const message = (id: string, createdAt: string) =>
    ({
      kind: "message",
      id,
      createdAt,
      message: { id, role: "assistant", createdAt },
    }) as unknown as Parameters<typeof messageEnters>[0];
  it.each([
    ["a message after the opening", message("m2", "2026-09-29T01:00:05.000Z"), opened, true],
    ["the newest message at the opening", message("m1", "2026-09-29T01:00:00.000Z"), opened, false],
    [
      "an older message scrolled back into sight",
      message("m0", "2026-09-29T00:10:00.000Z"),
      opened,
      false,
    ],
    [
      "anything before the conversation had a message",
      message("m2", "2026-09-29T01:00:05.000Z"),
      null,
      false,
    ],
    [
      "a row that is not a message",
      { kind: "event", id: "e1", createdAt: "2026-09-29T01:00:05.000Z" } as unknown as Parameters<
        typeof messageEnters
      >[0],
      opened,
      false,
    ],
  ] as const)("%s", (_, row, after, enters) => {
    expect(messageEnters(row, after)).toBe(enters);
  });
});

describe("MessagesTimeline — placing its rows", () => {
  // A conversation is out of sight until its list stands where it stays: its
  // end reached, or a reading position put back.
  const frames: FrameRequestCallback[] = [];
  const runFrames = () => {
    for (const frame of frames.splice(0)) frame(0);
  };
  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  const listRef = {
    current: {
      getState: () => ({ data: [], isWithinMaintainScrollAtEndThreshold: true }),
      getScrollableNode: () => ({ scrollTop: 0, scrollHeight: 2000, clientHeight: 800 }),
    } as unknown as LegendListRef,
  };
  const mount = async (props: Pick<Parameters<typeof MessagesTimeline>[0], "timelineEntries">) => {
    let renderer: ReactTestRenderer | undefined;
    await act(() => {
      renderer = create(
        <MessagesTimeline
          {...buildProps()}
          listRef={listRef}
          routeThreadKey="environment-local:thread-in-place"
          {...props}
        />,
      );
    });
    runFrames();
    return renderer!;
  };
  const outOfSight = (renderer: ReactTestRenderer) =>
    renderer.root.find(
      (node) => node.type === "div" && node.props["data-timeline-thread"] !== undefined,
    ).props["data-timeline-placing"] !== undefined;

  const settleFrames = async (count: number) => {
    for (let frame = 0; frame < count; frame += 1) await act(() => runFrames());
  };

  it("shows once its list has put the rows in place", async () => {
    const { LegendList } = await import("@legendapp/list/react");
    const renderer = await mount({
      timelineEntries: [buildUserTimelineEntry("Where were we?")],
    });
    try {
      await settleFrames(4);
      expect(outOfSight(renderer)).toBe(true);
      await act(() => renderer.root.findByType(LegendList).props.onLoad({ elapsedTimeInMs: 4 }));
      await settleFrames(6);
      expect(outOfSight(renderer)).toBe(false);
    } finally {
      await act(() => renderer.unmount());
    }
  });

  // Handed over from its Mate's own view, its Mate stays at
  // work in the pane while the rows are placed out of sight: a face on screen
  // the whole way, never an empty pane.
  it.each([
    { case: "handed over from its Mate's own view", handedOver: true, face: true },
    { case: "opened from another conversation", handedOver: false, face: false },
  ])("while its rows are placed, $case: its Mate at work $face", async ({ handedOver, face }) => {
    const { LegendList } = await import("@legendapp/list/react");
    const { handOverMateConversation } = await import("../../zerops/mateHandOver");
    const key = `environment-local:thread-handed-${String(handedOver)}`;
    if (handedOver) handOverMateConversation(key, Date.now());
    let renderer: ReactTestRenderer | undefined;
    await act(() => {
      renderer = create(
        <MessagesTimeline
          {...buildProps()}
          listRef={listRef}
          routeThreadKey={key}
          timelineEntries={[buildUserTimelineEntry("Where were we?")]}
        />,
      );
    });
    const atWork = () => renderer!.root.findAll((node) => node.props.role === "status").length > 0;
    try {
      await settleFrames(2);
      expect(outOfSight(renderer!)).toBe(true);
      expect(atWork()).toBe(face);
      await act(() => renderer!.root.findByType(LegendList).props.onLoad({ elapsedTimeInMs: 4 }));
      await settleFrames(6);
      expect(outOfSight(renderer!)).toBe(false);
      expect(atWork()).toBe(false);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  // A Mate streaming its answer changes the rows every frame: the list's end
  // never stands still, and the conversation still shows, after a while.
  it("shows after a while, even while its rows never stand still", async () => {
    const { LegendList } = await import("@legendapp/list/react");
    const { TIMELINE_PLACING_AT_MOST_MS } = await import("./timelineScrollAnchoring");
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    let height = 2000;
    const streaming = {
      scrollTop: 0,
      clientHeight: 800,
      get scrollHeight() {
        height += 40;
        return height;
      },
    };
    const streamingList = {
      current: {
        getState: () => ({ data: [], isWithinMaintainScrollAtEndThreshold: true }),
        getScrollableNode: () => streaming,
        scrollToEnd: vi.fn(() => Promise.resolve()),
      } as unknown as LegendListRef,
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <MessagesTimeline
            {...buildProps()}
            listRef={streamingList}
            routeThreadKey="environment-local:thread-streaming-end"
            timelineEntries={[buildUserTimelineEntry("Keep going.")]}
          />,
        );
      });
      await act(() => renderer!.root.findByType(LegendList).props.onLoad({ elapsedTimeInMs: 4 }));
      for (; now < TIMELINE_PLACING_AT_MOST_MS - 16; now += 16) await settleFrames(1);
      expect(outOfSight(renderer!)).toBe(true);
      now = TIMELINE_PLACING_AT_MOST_MS;
      await settleFrames(3);
      expect(outOfSight(renderer!)).toBe(false);
    } finally {
      clock.mockRestore();
      await act(() => renderer?.unmount());
    }
  });

  // Coming back mid-read to a Mate still streaming: the place is put back by
  // one loop that reads the rows as they come, not restarted by each of them.
  it("puts a reading position back once, however often its rows change", async () => {
    const { LegendList } = await import("@legendapp/list/react");
    const { rememberTimelinePosition, readTimelinePosition } =
      await import("./timelineScrollAnchoring");
    const threadKey = "environment-local:thread-streaming-mid";
    rememberTimelinePosition(threadKey, {
      rowId: "entry-1",
      offsetWithinRow: 30,
      rowHeight: 200,
      cardTopId: null,
      previousRowId: null,
      atEnd: false,
    });
    const document = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const reading = {
      scrollTop: 0,
      scrollHeight: 4000,
      clientHeight: 800,
      getBoundingClientRect: () => ({ top: 0 }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      ownerDocument: document,
    };
    // The remembered row stands 900 px into the conversation.
    const row = { getBoundingClientRect: () => ({ top: 900 - reading.scrollTop, height: 200 }) };
    const readingList = {
      current: {
        getState: () => ({
          data: [],
          indexByKey: () => 0,
          elementAtIndex: () => row,
          isWithinMaintainScrollAtEndThreshold: false,
        }),
        getScrollableNode: () => reading,
      } as unknown as LegendListRef,
    };
    // As ChatView does: the person's place being put back turns follow off.
    let follows = true;
    const onManualNavigation = vi.fn(() => {
      follows = false;
    });
    const streamed = (words: number) => (
      <MessagesTimeline
        {...buildProps()}
        liveFollowEnabled={follows}
        listRef={readingList}
        onManualNavigation={onManualNavigation}
        routeThreadKey={threadKey}
        timelineEntries={[
          buildUserTimelineEntry("Where were we?"),
          {
            ...buildAssistantTimelineEntry("word ".repeat(words)),
            id: "entry-2",
            message: {
              ...buildAssistantTimelineEntry("").message,
              id: MessageId.make("message-2"),
              text: "word ".repeat(words),
              streaming: true,
            },
          },
        ]}
      />
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(streamed(1));
      });
      await act(() => renderer!.root.findByType(LegendList).props.onLoad({ elapsedTimeInMs: 4 }));
      for (let words = 2; words < 8; words += 1) {
        await act(() => renderer!.update(streamed(words)));
        await settleFrames(1);
      }
      await settleFrames(3);
      expect(reading.scrollTop).toBe(930);
      expect(outOfSight(renderer!)).toBe(false);
      expect(onManualNavigation).toHaveBeenCalledTimes(1);
      expect(readTimelinePosition(threadKey)?.rowId).toBe("entry-1");
    } finally {
      await act(() => renderer?.unmount());
    }
  });
});

describe("KeptTimelines — a conversation seen a moment ago", () => {
  // A return shows the conversation's rows as they stood when the person
  // left, in the frame the header changes: its list was kept, out of sight,
  // and is never placed again.
  const frames: FrameRequestCallback[] = [];
  const runFrames = () => {
    for (const frame of frames.splice(0)) frame(0);
  };
  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  const listRef = {
    current: {
      getState: () => ({ data: [], isWithinMaintainScrollAtEndThreshold: true }),
      getScrollableNode: () => ({ scrollTop: 0, scrollHeight: 2000, clientHeight: 800 }),
    } as unknown as LegendListRef,
  };
  const KEY_A = "environment-local:thread-a";
  const KEY_B = "environment-local:thread-b";
  // What a kept list reads of its conversation while out of sight, as a
  // store it subscribes to.
  const read = new Map<
    string,
    { readonly timelineEntries: ReadonlyArray<unknown>; readonly latestTurn?: unknown }
  >();
  const readers = new Set<() => void>();
  const tell = (key: string, props: NonNullable<ReturnType<typeof read.get>>) => {
    read.set(key, props);
    for (const reader of readers) reader();
  };
  /** Whether each kept list's reader was last asked to hold. */
  const holds = new Map<string, boolean>();
  const Reader = ({
    threadKey,
    hold,
    onRead,
  }: {
    readonly threadKey: string;
    readonly hold: boolean;
    readonly onRead: (props: never) => void;
  }) => {
    holds.set(threadKey, hold);
    const props = useSyncExternalStore(
      (listener) => {
        readers.add(listener);
        return () => readers.delete(listener);
      },
      () => read.get(threadKey) ?? null,
    );
    useLayoutEffect(() => onRead(props as never), [onRead, props]);
    return null;
  };
  beforeEach(() => read.clear());
  const pane = async (
    open: string,
    alive: (key: string) => boolean = () => true,
    extra: Partial<Parameters<typeof MessagesTimeline>[0]> = {},
    inset: {
      readonly insetMeasured?: boolean;
      readonly insetRemembered?: boolean;
      readonly warm?: string | null;
      readonly Reader?: typeof Reader;
    } = {},
  ) => {
    const { KeptTimelines } = await import("./KeptTimelines");
    const { Reader: reader = Reader, ...said } = inset;
    return (
      <KeptTimelines
        open={open}
        alive={alive}
        {...said}
        Reader={reader}
        crewTimeline={null}
        timeline={{
          ...buildProps(),
          listRef,
          routeThreadKey: open,
          timelineEntries: [buildUserTimelineEntry(`Where were we in ${open}?`)],
          ...extra,
        }}
      />
    );
  };
  const listOf = (renderer: ReactTestRenderer, key: string) =>
    renderer.root.find((node) => node.type === "div" && node.props["data-timeline-thread"] === key);
  const placing = (renderer: ReactTestRenderer, key: string) =>
    listOf(renderer, key).props["data-timeline-placing"] !== undefined;
  const settle = async () => {
    const { LegendList } = await import("@legendapp/list/react");
    return async (renderer: ReactTestRenderer) => {
      for (const list of renderer.root.findAllByType(LegendList)) {
        await act(() => list.props.onLoad({ elapsedTimeInMs: 4 }));
      }
      for (let frame = 0; frame < 6; frame += 1) await act(() => runFrames());
    };
  };

  it("shows its rows as they stood, never placed again", async () => {
    const place = await settle();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(await pane(KEY_A));
    });
    try {
      await place(renderer!);
      expect(placing(renderer!, KEY_A)).toBe(false);

      const b = await pane(KEY_B);
      await act(() => renderer!.update(b));
      expect(placing(renderer!, KEY_B)).toBe(true);
      await place(renderer!);

      const a = await pane(KEY_A);
      await act(() => renderer!.update(a));
      // A list mounted anew starts out of sight until it is placed.
      expect(placing(renderer!, KEY_A)).toBe(false);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  it("takes its conversation's rows while out of sight, so a return finds them placed", async () => {
    const place = await settle();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(await pane(KEY_A));
    });
    try {
      await place(renderer!);
      const b = await pane(KEY_B);
      await act(() => renderer!.update(b));
      // An answer comes in A while the person reads B.
      await act(() =>
        tell(KEY_A, {
          timelineEntries: [
            buildUserTimelineEntry(`Where were we in ${KEY_A}?`),
            { ...buildAssistantTimelineEntry("Here is where."), id: "entry-answer" },
          ],
        }),
      );
      const { LegendList } = await import("@legendapp/list/react");
      const rowsOfA = listOf(renderer!, KEY_A).findByType(LegendList).props.data;
      expect(JSON.stringify(rowsOfA)).toContain("Here is where.");
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  // The line over what is new is read as the person comes back, not only as
  // the list first opened: an answer that came while they were away is
  // marked, and a line from an earlier visit goes.
  it("marks what came while the person was away when it shows again", async () => {
    const { useUiStateStore } = await import("../../uiStateStore");
    const place = await settle();
    const turn = (completedAt: string) => ({
      turnId: TurnId.make("turn-a"),
      state: "completed" as const,
      startedAt: "2026-09-30T09:00:00.000Z",
      completedAt,
    });
    useUiStateStore.setState((state) => ({
      threadLastVisitedAtById: {
        ...state.threadLastVisitedAtById,
        [KEY_A]: "2026-09-30T09:10:00.000Z",
      },
    }));
    const seamNew = (renderer: ReactTestRenderer) =>
      JSON.stringify(listOf(renderer, KEY_A).findByType(LegendListType).props.data).includes(
        '"seam:new"',
      );
    const { LegendList: LegendListType } = await import("@legendapp/list/react");
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        await pane(KEY_A, undefined, { latestTurn: turn("2026-09-30T09:05:00.000Z") }),
      );
    });
    try {
      await place(renderer!);
      expect(seamNew(renderer!)).toBe(false);
      const b = await pane(KEY_B);
      await act(() => renderer!.update(b));
      const answered = await pane(KEY_A, undefined, {
        latestTurn: turn("2026-09-30T09:30:00.000Z"),
        timelineEntries: [
          buildUserTimelineEntry(`Where were we in ${KEY_A}?`),
          {
            ...buildAssistantTimelineEntry("It is done."),
            id: "entry-answer",
            createdAt: "2026-09-30T09:30:00.000Z",
            message: {
              ...buildAssistantTimelineEntry("It is done.").message,
              id: MessageId.make("message-answer"),
              createdAt: "2026-09-30T09:30:00.000Z",
              updatedAt: "2026-09-30T09:30:00.000Z",
            },
          },
        ],
      });
      await act(() => renderer!.update(answered));
      expect(seamNew(renderer!)).toBe(true);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  // A return shows a kept list in the press frame with the inset remembered
  // for it; one whose conversation changed while away — its banners may have
  // too — waits out of sight until its own inset is measured.
  it.each([
    { case: "unchanged while away", changed: false },
    { case: "changed while away", changed: true },
  ])("shows at once on a return, $case: out of sight $changed", async ({ changed }) => {
    const place = await settle();
    const turn = (completedAt: string) => ({
      turnId: TurnId.make("turn-a"),
      state: "completed" as const,
      startedAt: "2026-09-30T09:00:00.000Z",
      completedAt,
    });
    const before = { latestTurn: turn("2026-09-30T09:05:00.000Z") };
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(await pane(KEY_A, undefined, before));
    });
    try {
      await place(renderer!);
      const b = await pane(KEY_B);
      await act(() => renderer!.update(b));
      await act(() =>
        tell(KEY_A, {
          timelineEntries: [buildUserTimelineEntry(`Where were we in ${KEY_A}?`)],
          latestTurn: changed ? turn("2026-09-30T09:30:00.000Z") : before.latestTurn,
        }),
      );
      const back = await pane(KEY_A, undefined, before, {
        insetMeasured: false,
        insetRemembered: true,
      });
      await act(() => renderer!.update(back));
      const outOfSightNow =
        renderer!.root.findAll(
          (node) =>
            node.props["data-kept-timeline"] !== undefined &&
            node.findAll((inner) => inner.props["data-timeline-thread"] === KEY_A).length > 0,
        ).length > 0;
      expect(outOfSightNow).toBe(changed);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  // A run streaming in a Mate the person left is not read word by word out
  // of sight; resting on its menu row reads it live again, before the press.
  it("holds a kept list's read out of sight until someone is about to open it", async () => {
    const place = await settle();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(await pane(KEY_A));
    });
    try {
      await place(renderer!);
      await act(async () => renderer!.update(await pane(KEY_B)));
      expect(holds.get(KEY_A)).toBe(true);
      await act(async () => renderer!.update(await pane(KEY_B, undefined, {}, { warm: KEY_A })));
      expect(holds.get(KEY_A)).toBe(false);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  // Mate A streams through one turn while the person reads B; they come back
  // by ⌘K, a shortcut or back — no menu row rested on, so no warm intent. Its
  // list was placed out of sight with what streamed: nothing lands as it shows.
  it("shows a kept list opened without a warm intent with what streamed while away, already placed", async () => {
    const { useHeld, HELD_READ_EVERY_MS } = await import("./heldRead");
    // The production reader's hold, over the store the test tells.
    const HeldReader = ({
      threadKey,
      hold,
      onRead,
    }: {
      readonly threadKey: string;
      readonly hold: boolean;
      readonly onRead: (props: never) => void;
    }) => {
      const live = useSyncExternalStore(
        (listener) => {
          readers.add(listener);
          return () => readers.delete(listener);
        },
        () => read.get(threadKey) ?? null,
      );
      const props = useHeld(live, hold, "turn-a running", HELD_READ_EVERY_MS);
      useLayoutEffect(() => onRead(props as never), [onRead, props]);
      return null;
    };
    const place = await settle();
    const held = { Reader: HeldReader };
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(await pane(KEY_A, undefined, {}, held));
    });
    // Its waits only: the list's own clock stays the page's.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await place(renderer!);
      await act(async () => renderer!.update(await pane(KEY_B, undefined, {}, held)));
      const words = [
        "Here",
        "Here is",
        "Here is where",
        "Here is where we",
        "Here is where we were.",
      ];
      for (const said of words) {
        await act(() =>
          tell(KEY_A, {
            timelineEntries: [
              buildUserTimelineEntry(`Where were we in ${KEY_A}?`),
              { ...buildAssistantTimelineEntry(said), id: "entry-answer" },
            ],
          }),
        );
        await act(() => vi.advanceTimersByTime(120));
      }
      await act(() => vi.advanceTimersByTime(HELD_READ_EVERY_MS));
      // Out of sight, before the frame it shows in: the rows it will show.
      const { LegendList } = await import("@legendapp/list/react");
      const rowsOfA = JSON.stringify(listOf(renderer!, KEY_A).findByType(LegendList).props.data);
      expect(rowsOfA).toContain("Here is where we were.");
    } finally {
      vi.useRealTimers();
      await act(() => renderer?.unmount());
    }
  });

  it("lets a list go once its conversation is gone", async () => {
    const place = await settle();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(await pane(KEY_A));
    });
    try {
      await place(renderer!);
      const b = await pane(KEY_B, (key) => key !== KEY_A);
      await act(() => renderer!.update(b));
      expect(
        renderer!.root.findAll(
          (node) => node.type === "div" && node.props["data-timeline-thread"] === KEY_A,
        ),
      ).toHaveLength(0);
    } finally {
      await act(() => renderer?.unmount());
    }
  });
});
