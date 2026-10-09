import { Window } from "happy-dom";
import { RegistryContext } from "@effect/atom-react";
import {
  cardAccount,
  CARD_KEY,
  CARD_RUN,
  CARD_RECORDS,
  useCardTimelineInput,
} from "./engineCard.test-fixtures";
import { markupDom } from "../../../test/markupDom";
import { projectMateLimit } from "@t3tools/client-runtime/data";
import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  act,
  StrictMode,
  createRef,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import { InventoryContext, type Inventory } from "../../zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "../../zerops/zeropsDataContext";
import { forgetRunFolds, setRunFold } from "./runCard.logic";
import { takeOwnScroll } from "./timelineEndFollow";
import {
  classifyTimelineScroll,
  jumpedAway,
  nextTimelineFollow,
} from "@t3tools/client-runtime/zerops/timelineFollow";

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
  try {
    ({ MessagesTimeline, messageEnters } = await import("./MessagesTimeline"));
  } finally {
    vi.unstubAllGlobals();
  }
}, 30_000);

// Timeline rows need the DOM during render; later files must not inherit
// this fixture's browser storage when choosing their persistence backend.
beforeEach(stubDomGlobals);
afterEach(() => vi.unstubAllGlobals());

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

  it("shows the source reading the conversation immediately, with no guessed face or retry", () => {
    const loading = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} hideEmptyPlaceholder loading timelineEntries={[]} />,
    );
    expect(loading).toContain('role="status"');
    expect(loading).not.toContain("data-mate-face-state");
    expect(loading).toContain("The Mate is opening the conversation.");
    expect(loading).toContain("Picking up where you left off.");
    expect(loading).not.toContain(">Try now<");
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

  async function shrinkRow(follows: boolean, expectedTop: number) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { LegendList } = await import("@legendapp/list/react");
    const viewport = { scrollTop: 1180, scrollHeight: 2000, clientHeight: 800 };
    const listRef = {
      current: {
        getState: () => ({ isWithinMaintainScrollAtEndThreshold: true }),
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
            liveFollowEnabled={follows}
            routeThreadKey="environment-local:thread-shrinking-row"
            timelineEntries={[buildUserTimelineEntry("Keep my place.")]}
          />,
        );
      });
      await act(async () => {
        renderer!.root.findByType(LegendList).props.onItemSizeChanged({
          index: 0,
          itemKey: "message-1",
          itemData: undefined,
          previous: 300,
          size: 120,
        });
        for (const frame of frames.splice(0)) frame(0);
      });
      expect(viewport.scrollTop).toBe(expectedTop);
    } finally {
      await act(() => renderer?.unmount());
    }
  }

  it("a shrinking row keeps a followed conversation at its end", () => shrinkRow(true, 1200));
  it("a shrinking row does not move a conversation being read", () => shrinkRow(false, 1180));

  it("a measured clamp followed by growth keeps the conversation at its end", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { LegendList } = await import("@legendapp/list/react");
    const viewport = { scrollTop: 1200, scrollHeight: 2000, clientHeight: 800 };
    const listRef = {
      current: {
        getState: () => ({ isWithinMaintainScrollAtEndThreshold: true }),
        getScrollableNode: () => viewport,
      } as unknown as LegendListRef,
    };
    const timeline = (follows: boolean) => (
      <MessagesTimeline
        {...buildProps()}
        listRef={listRef}
        liveFollowEnabled={follows}
        routeThreadKey="environment-local:measured-clamp"
        timelineEntries={[buildUserTimelineEntry("Keep following after measurement.")]}
      />
    );
    let renderer: ReactTestRenderer | undefined;
    const measure = (previous: number, size: number) =>
      renderer!.root.findByType(LegendList).props.onItemSizeChanged({
        index: 0,
        itemKey: "message-1",
        itemData: undefined,
        previous,
        size,
      });
    try {
      await act(() => {
        renderer = create(timeline(true));
      });
      await act(async () => {
        measure(280, 300);
      });
      takeOwnScroll(viewport as unknown as HTMLElement);
      const previous = { scrollTop: 1200, contentHeight: 2000 };
      // A row shrinks the native range; another grows it before the scroll receipt.
      viewport.scrollHeight = 1800;
      viewport.scrollTop = 1000;
      measure(300, 100);
      viewport.scrollHeight = 2200;
      const current = { scrollTop: viewport.scrollTop, contentHeight: viewport.scrollHeight };
      const own = takeOwnScroll(viewport as unknown as HTMLElement);
      const follows = nextTimelineFollow(true, {
        type: "position",
        atEnd: false,
        ...classifyTimelineScroll({ previous, current, personScrolling: false }),
        jumped: !own && jumpedAway({ previous, current }),
      });
      await act(() => renderer!.update(timeline(follows)));
      await act(async () => {
        for (let turn = 0; frames.length > 0 && turn < 200; turn += 1)
          for (const frame of frames.splice(0)) frame(turn * (1000 / 60));
      });
      expect(viewport.scrollTop).toBe(1400);
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
    expect(markup).toContain("Loading diff...");
    expect(markup).toContain("keeps valid zero-usage snapshots");
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
      lost: new Set(),
    };
    const zeropsData: ZeropsDataContextValue = {
      scope: {} as AccountScope,
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
      lost: new Set(),
    };
    const zeropsData: ZeropsDataContextValue = {
      scope: {} as AccountScope,
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

  describe("Decision: one owner per concern as the report's table assigns; no new state model.", () => {
    it.each([
      { mode: "immediate", follows: true },
      { mode: "immediate", follows: false },
      { mode: "late", follows: true },
      { mode: "late", follows: false },
      { mode: "first layout", follows: true },
      { mode: "hidden", follows: true },
      { mode: "kept", follows: true },
      { mode: "reduced motion", follows: true },
    ])(
      "the assembled report takes natural growth and preserves outer follow ($mode, $follows)",
      async ({ mode, follows }) => {
        const reportTurn = TurnId.make(`report-room-${mode}-${follows}`);
        const dom = new Window();
        const document = dom.document as unknown as Document;
        for (const [key, value] of Object.entries({
          document,
          Element: dom.Element,
          HTMLElement: dom.HTMLElement,
          Node: dom.Node,
          MutationObserver: dom.MutationObserver,
          IS_REACT_ACT_ENVIRONMENT: true,
        }))
          vi.stubGlobal(key, value);
        vi.stubGlobal("CSS", { escape: (value: string) => value });
        vi.stubGlobal("window", dom);
        const media = dom.matchMedia("(prefers-reduced-motion: reduce)");
        vi.spyOn(media, "matches", "get").mockReturnValue(mode === "reduced motion");
        vi.spyOn(dom, "matchMedia").mockReturnValue(media);
        if (mode === "hidden")
          Object.defineProperty(document, "visibilityState", {
            value: "hidden",
            configurable: true,
          });
        const frames = new Map<number, FrameRequestCallback>();
        let nextFrame = 0;
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
          frames.set(++nextFrame, callback);
          return nextFrame;
        });
        vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
        const observers: Array<{ callback: ResizeObserverCallback; nodes: Set<Element> }> = [];
        vi.stubGlobal(
          "ResizeObserver",
          class {
            readonly nodes = new Set<Element>();
            constructor(callback: ResizeObserverCallback) {
              observers.push({ callback, nodes: this.nodes });
            }
            observe(node: Element) {
              this.nodes.add(node);
            }
            unobserve(node: Element) {
              this.nodes.delete(node);
            }
            disconnect() {
              this.nodes.clear();
            }
          },
        );
        const list = document.body.appendChild(document.createElement("div"));
        if (mode === "kept") list.setAttribute("data-kept-timeline", "");
        const panel = list.appendChild(document.createElement("div"));
        panel.setAttribute("data-timeline-row-id", "panel-fixture");
        const workingMarker = panel.appendChild(document.createElement("div"));
        const band = list.appendChild(document.createElement("div"));
        const marker = band.appendChild(document.createElement("div"));
        let naturalHeight = 80;
        panel.getBoundingClientRect = () => ({ height: 300 }) as DOMRect;
        band.getBoundingClientRect = () =>
          ({ height: Number.parseFloat(band.style.height) || naturalHeight }) as DOMRect;
        const viewport = { scrollTop: 1180, scrollHeight: 2000, clientHeight: 800 };
        const listRef = {
          current: {
            getState: () => ({ isWithinMaintainScrollAtEndThreshold: true }),
            getScrollableNode: () => viewport,
          } as unknown as LegendListRef,
        };
        const entry = (phase: "running" | "done") => ({
          id: "zerops:op:deploy-1",
          kind: "operation" as const,
          createdAt: at(20),
          operation: operation({ turnId: reportTurn, phase, links: [] }),
        });
        const timeline = (stage: "working" | "empty" | "report") =>
          zeropsStandIns(
            <StrictMode>
              <MessagesTimeline
                {...buildProps()}
                listRef={listRef}
                liveFollowEnabled={follows}
                latestTurn={
                  stage === "working"
                    ? { ...settled, turnId: reportTurn, state: "running", completedAt: null }
                    : { ...settled, turnId: reportTurn }
                }
                isWorking={stage === "working"}
                runningTurnId={stage === "working" ? reportTurn : null}
                working={
                  stage === "working"
                    ? {
                        operations: [entry("running").operation],
                        helpers: null,
                        tasks: null,
                        background: null,
                        afterTurn: null,
                        pause: null,
                      }
                    : null
                }
                timelineEntries={
                  stage === "empty" ? [] : [entry(stage === "working" ? "running" : "done")]
                }
              />
            </StrictMode>,
          );
        const createNodeMock = (node: { props: unknown }) => {
          const props = node.props as { className?: string };
          return props.className === "contents"
            ? workingMarker
            : props.className === "run-band"
              ? marker
              : null;
        };
        let renderer: ReactTestRenderer | undefined;
        let reportObservers: typeof observers = [];
        try {
          if (mode !== "first layout")
            await act(() => {
              renderer = create(timeline("working"), { createNodeMock });
            });
          // Age the existing presentation window without waiting for wall time.
          let now = performance.now();
          if (mode === "late") {
            vi.spyOn(performance, "now").mockImplementation(() => now);
            await act(() => renderer!.update(timeline("empty")));
            now += 1600;
          }
          await act(() => {
            if (renderer) renderer.update(timeline("report"));
            else renderer = create(timeline("report"), { createNodeMock });
          });
          expect(
            renderer!.root.findAll((node) => node.props["data-turn-report"] !== undefined),
          ).toHaveLength(1);
          const shrinking = mode === "immediate";
          expect(band.getBoundingClientRect().height).toBe(shrinking ? 300 : naturalHeight);
          if (shrinking) {
            const pending = [...frames.values()];
            frames.clear();
            await act(() => {
              for (const frame of pending) frame(16);
            });
            expect(band.getBoundingClientRect().height).toBeGreaterThan(naturalHeight);
            expect(band.getBoundingClientRect().height).toBeLessThan(300);
          }
          // Decoded pixels change the held box's content without a DOM mutation.
          naturalHeight = 420;
          reportObservers = observers.filter((observer) => observer.nodes.has(marker));
          expect(reportObservers.length).toBeGreaterThan(0);
          for (const observer of reportObservers)
            observer.callback(
              [{ target: marker } as unknown as ResizeObserverEntry],
              {} as ResizeObserver,
            );
          expect(band.getBoundingClientRect().height).toBe(420);
          expect(band.style.clipPath).toBe("");
          if (mode === "kept" || mode === "hidden") {
            list.removeAttribute("data-kept-timeline");
            Object.defineProperty(document, "visibilityState", {
              value: "visible",
              configurable: true,
            });
            naturalHeight = 60;
            for (const observer of reportObservers)
              observer.callback(
                [{ target: marker } as unknown as ResizeObserverEntry],
                {} as ResizeObserver,
              );
            expect(band.getBoundingClientRect().height).toBe(60);
          }
          const { LegendList } = await import("@legendapp/list/react");
          renderer!.root
            .findByType(LegendList)
            .props.onItemSizeChanged({ index: 0, itemKey: "report", previous: 300, size: 420 });
          await act(() => {
            const pending = [...frames.values()];
            frames.clear();
            for (const frame of pending) frame(32);
          });
          expect(viewport.scrollTop).toBe(follows ? 1200 : 1180);
        } finally {
          await act(() => renderer?.unmount());
          expect(reportObservers.every((observer) => observer.nodes.size === 0)).toBe(true);
          expect(band.style.height).toBe("");
          vi.restoreAllMocks();
          dom.happyDOM.abort();
        }
      },
    );
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
    expect(markupDom(record).querySelector('button[aria-expanded="false"]')?.textContent).toBe(
      "Show work",
    );
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
    expect(markup).toContain(`data-run-fold="${fold}"`);
    expect(markupDom(markup).body.textContent).toContain("The shop builds.");
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
    expect(
      markupDom(markup)
        .querySelector('button[aria-label="pnpm build. Show what it returned"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
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
    expect(markupDom(markup).querySelector('[role="status"]')?.textContent).toBe(
      "Reading docs.example.dev/guides",
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
    expect(markup).toContain("This Mate hit the coding agent&#x27;s limit on ");
    expect(markup).toContain("2 more attempts");
    expect(markup).not.toContain("You&#x27;ve hit your session limit");
  });

  it("the server's current limit owns one named stage until a resume receipt", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        latestTurn={settled}
        limit={{
          kind: "limited",
          turnId: settled.turnId,
          provider: "coding agent",
          resetsAt: "2026-09-27T10:00:00Z",
        }}
        usagePause={{ resetsAt: "2026-09-27T10:00:00Z", autoResume: false }}
        onUsageContinue={() => undefined}
        onUsageAutoResumeChange={() => undefined}
        timelineEntries={[
          buildUserTimelineEntry("Keep going"),
          assistant("limited", 30, "You've hit your session limit · resets 9:20pm (UTC)"),
        ]}
      />,
    );
    expect(markup.match(/data-conversation-pause=/g)).toHaveLength(1);
    expect(markup).toContain("data-mate-stage-area");
    expect(markup).toContain("This Mate hit the coding agent&#x27;s limit.");
    expect(markup).toContain("Continue automatically");
    expect(markup).toContain("Keep going");
    expect(markup).not.toContain("is opening the conversation");
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
    // Host load cannot turn a list-load test into the elapsed-time fallback test.
    vi.spyOn(performance, "now").mockReturnValue(0);
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => vi.restoreAllMocks());

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

  it("a parked refusal hands over the opening stage when its conversation list loads", async () => {
    const { LegendList } = await import("@legendapp/list/react");
    const lateList = createRef<LegendListRef>();
    const limit = projectMateLimit(
      {
        latestTurn: {
          turnId: "refused",
          state: "running",
          startedAt: MESSAGE_CREATED_AT,
          completedAt: null,
        },
        session: { lastError: "Claude usage limit reached", providerName: "claudeAgent" },
      },
      Date.parse(MESSAGE_CREATED_AT),
    );
    let renderer!: ReactTestRenderer;
    await act(() => {
      renderer = create(
        <MessagesTimeline
          {...buildProps()}
          routeThreadKey="environment-local:refused"
          listRef={lateList}
          timelineEntries={[buildUserTimelineEntry("Continue the work")]}
          limit={limit}
        />,
      );
    });
    try {
      expect(outOfSight(renderer)).toBe(true);
      lateList.current = listRef.current;
      await act(() => renderer.root.findByType(LegendList).props.onLoad({ elapsedTimeInMs: 4 }));
      await settleFrames(6);
      expect(outOfSight(renderer)).toBe(false);
      expect(
        renderer.root.findAll((node) => node.props["data-conversation-opening"] === "waiting"),
      ).toHaveLength(0);
    } finally {
      await act(() => renderer.unmount());
    }
  });

  it("keeps already read rows hidden until placement without inventing a waiting pose", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const renderer = await mount({ timelineEntries: [buildUserTimelineEntry("Not placed yet.")] });
    try {
      now = 10_000;
      await settleFrames(6);
      expect(outOfSight(renderer)).toBe(true);
      expect(
        renderer.root.findAll((node) => node.props["data-conversation-opening"] === "waiting"),
      ).toHaveLength(0);
    } finally {
      clock.mockRestore();
      await act(() => renderer.unmount());
    }
  });

  // Held rows still need measured placement, but that does not make their source pending again.
  it.each([
    { case: "handed over from its Mate's own view", handedOver: true, face: false },
    { case: "opened from another conversation", handedOver: false, face: false },
  ])("while its rows are placed, $case: its Mate at work $face", async ({ handedOver, face }) => {
    const { LegendList } = await import("@legendapp/list/react");
    const key = `environment-local:thread-handed-${String(handedOver)}`;
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
    const atWork = () =>
      renderer!.root.findAll((node) => node.props["data-conversation-opening"] === "waiting")
        .length > 0;
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
      now = 16;
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

  const checkNoticeFollowing = async (following: boolean, growth = 20) => {
    const { LegendList } = await import("@legendapp/list/react");
    const viewport = {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 800,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      ownerDocument: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    };
    const list = {
      current: {
        getState: () => ({ data: [], isWithinMaintainScrollAtEndThreshold: following }),
        getScrollableNode: () => viewport,
        scrollToEnd: vi.fn(() => {
          viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        }),
      } as unknown as LegendListRef,
    };
    const render = (inset: number) => (
      <MessagesTimeline
        {...buildProps()}
        listRef={list}
        liveFollowEnabled={following}
        routeThreadKey={`environment-local:notice-follow-${following}`}
        contentInsetEndAdjustment={inset}
        timelineEntries={[buildUserTimelineEntry("Keep going.")]}
      />
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(render(120));
      });
      await act(() => renderer!.root.findByType(LegendList).props.onLoad());
      await settleFrames(4);
      if (!following) viewport.scrollTop = 500;
      viewport.scrollHeight = 2000 + growth;
      await act(() => renderer!.update(render(120 + growth)));
      if (growth === 300) expect(viewport.scrollTop).toBe(1500);
      await act(() => renderer!.root.findByType(LegendList).props.onItemSizeChanged());
      await settleFrames(4);
      expect(viewport.scrollTop).toBe(following ? 1200 + growth : 500);
      if (!following) expect(list.current.scrollToEnd).not.toHaveBeenCalled();
    } finally {
      await act(() => renderer?.unmount());
    }
  };
  it("holds the followed line immediately through a large notice resize", () =>
    checkNoticeFollowing(true, 300));
  it("keeps the live edge visible when the composer overlay grows", () =>
    checkNoticeFollowing(true));
  it("leaves the scroll position alone while the user reads history", () =>
    checkNoticeFollowing(false));

  it.each([
    "arrival",
    "removal",
    "delayed measurement",
    "missing anchor",
    "user scroll",
    "navigation",
    "thread navigation",
    "keyboard navigation",
  ])("keeps the reading line through notice %s", async (scenario) => {
    const { LegendList } = await import("@legendapp/list/react");
    const { KeptTimelineContext } = await import("./keptTimelineContext");
    const { rememberTimelinePosition } = await import("./timelineScrollAnchoring");
    const threadKey = `environment-local:notice-${scenario}`;
    rememberTimelinePosition(threadKey, {
      rowId: "entry-1",
      offsetWithinRow: 30,
      rowHeight: 200,
      cardTopId: null,
      previousRowId: null,
      atEnd: false,
    });
    const listeners = new Map<string, () => void>();
    const viewport = {
      scrollTop: 0,
      scrollHeight: 4000,
      clientHeight: 800,
      getBoundingClientRect: () => ({ top: 0 }),
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      ownerDocument: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    };
    let rowTop = 900;
    let measuredData: unknown[] = [];
    let present = true;
    let shown = true;
    let renderer: ReactTestRenderer | undefined;
    const row = {
      getBoundingClientRect: () => ({ top: rowTop - viewport.scrollTop, height: 200 }),
    };
    const list = {
      current: {
        getScrollableNode: () => viewport,
        getState: () => ({
          data: measuredData,
          scroll: viewport.scrollTop,
          scrollLength: 800,
          positionAtIndex: () => rowTop,
          sizeAtIndex: () => 200,
          indexByKey: () => (present ? 0 : undefined),
          elementAtIndex: () => (present ? row : undefined),
          isWithinMaintainScrollAtEndThreshold: false,
        }),
        scrollToEnd: vi.fn(),
      } as unknown as LegendListRef,
    };
    const cancel = { current: null as (() => void) | null };
    const render = (inset: number) => (
      <KeptTimelineContext.Provider value={{ shown }}>
        <MessagesTimeline
          {...buildProps()}
          listRef={list}
          routeThreadKey={threadKey}
          liveFollowEnabled={false}
          contentInsetEndAdjustment={inset}
          cancelPositionRestoreRef={cancel}
          timelineEntries={[
            { ...buildUserTimelineEntry("Where were we?"), id: present ? "entry-1" : "entry-2" },
          ]}
        />
      </KeptTimelineContext.Provider>
    );
    try {
      await act(() => {
        renderer = create(render(scenario === "removal" ? 200 : 120));
      });
      measuredData = renderer!.root.findByType(LegendList).props.data;
      await act(() => renderer!.root.findByType(LegendList).props.onLoad());
      await settleFrames(4);
      expect(viewport.scrollTop).toBe(930);
      await act(() => renderer!.root.findByType(LegendList).props.onScroll());
      await act(() => renderer!.update(render(scenario === "removal" ? 120 : 200)));
      await settleFrames(4);
      if (scenario === "user scroll") await act(() => listeners.get("wheel")?.());
      if (scenario === "navigation") await act(() => cancel.current?.());
      if (scenario === "keyboard navigation") await act(() => listeners.get("click")?.());
      if (scenario === "thread navigation") {
        shown = false;
        await act(() => renderer!.update(render(200)));
      }
      if (scenario === "missing anchor") {
        present = false;
        await act(() => renderer!.update(render(200)));
        measuredData = renderer!.root.findByType(LegendList).props.data;
      }
      // The virtualizer finishes a layout later than the notice's render.
      rowTop = 1060;
      viewport.scrollTop =
        scenario === "user scroll" ||
        scenario === "navigation" ||
        scenario === "thread navigation" ||
        scenario === "keyboard navigation"
          ? 500
          : 770;
      await act(() => renderer!.root.findByType(LegendList).props.onItemSizeChanged());
      await settleFrames(4);
      expect(viewport.scrollTop).toBe(
        scenario === "user scroll" ||
          scenario === "navigation" ||
          scenario === "thread navigation" ||
          scenario === "keyboard navigation"
          ? 500
          : scenario === "missing anchor"
            ? 930
            : 1090,
      );
      if (scenario === "thread navigation") {
        shown = true;
        await act(() => renderer!.update(render(200)));
        await act(() => renderer!.root.findByType(LegendList).props.onItemSizeChanged());
        await settleFrames(4);
        expect(viewport.scrollTop).toBe(500);
      }
      expect(list.current.scrollToEnd).not.toHaveBeenCalled();
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
    // Host load cannot turn a list-load test into the elapsed-time fallback test.
    vi.spyOn(performance, "now").mockReturnValue(0);
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => vi.restoreAllMocks());

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

it("keeps a partly loaded account card's work reachable before and after its first page", async () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const read = vi.fn();
  const account = cardAccount(read);
  account.publish(CARD_RECORDS);
  function AccountTimeline() {
    const input = useCardTimelineInput(account);
    return (
      <MessagesTimeline
        {...buildProps()}
        {...input}
        routeThreadKey={`${CARD_KEY.environmentId}:${CARD_KEY.conversationId}`}
        activeThreadEnvironmentId={EnvironmentId.make(CARD_KEY.environmentId)}
        syncing
      />
    );
  }
  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(
        <RegistryContext value={account.registry}>
          <AccountTimeline />
        </RegistryContext>,
      );
    });
    const text = () => JSON.stringify(renderer!.toJSON());
    expect(text()).toContain("300 commands");
    expect(text()).not.toContain("inspect-service");
    expect(read).not.toHaveBeenCalled();
    const opener = renderer!.root
      .findAllByType("button")
      .find((node) => node.children.includes("Show work"));
    expect(opener).toBeDefined();
    await act(async () => opener!.props.onClick());
    expect(read).toHaveBeenCalledExactlyOnceWith(CARD_KEY, CARD_RUN, "later");
    await act(async () =>
      account.publish({
        ...CARD_RECORDS,
        spans: [{ runId: CARD_RUN, from: null, to: 2, reading: null }],
      }),
    );
    expect(text()).toContain("inspect-service");
    expect(
      renderer!.root.findAll(
        (node) => node.type === "div" && node.props["data-chat-kind"] === "step:command",
      ),
    ).toHaveLength(1);
  } finally {
    if (renderer !== null) await act(async () => renderer!.unmount());
    account.close();
  }
});
