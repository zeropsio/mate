import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act, createRef, type ReactNode, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import { InventoryContext, type Inventory } from "../../zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "../../zerops/zeropsDataContext";

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
    maintainScrollAtEnd?:
      | boolean
      | {
          animated?: boolean;
          on?: {
            dataChange?: boolean;
            itemLayout?: boolean;
            layout?: boolean;
          };
        };
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
        data-maintain-scroll-at-end={props.maintainScrollAtEnd ? "enabled" : undefined}
        data-maintain-scroll-at-end-animated={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.animated
            : undefined
        }
        data-maintain-scroll-at-end-data-change={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.dataChange
            : undefined
        }
        data-maintain-scroll-at-end-item-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.itemLayout
            : undefined
        }
        data-maintain-scroll-at-end-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.layout
            : undefined
        }
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
  ({ MessagesTimeline } = await import("./MessagesTimeline"));
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
    expect(markup).not.toContain('data-maintain-scroll-at-end="enabled"');
    expect(markup).toContain('data-maintain-visible-content-position="object"');
    expect(markup).toContain('data-maintain-visible-content-position-data="true"');
    expect(markup).toContain('data-maintain-visible-content-position-size="true"');
    expect(markup).toContain('data-maintain-visible-content-position-restore="true"');
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
    expect(markup).toContain('data-maintain-scroll-at-end="enabled"');
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
    expect(markup).not.toContain('data-maintain-scroll-at-end="enabled"');
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
    // scrolls and LegendList must not re-pin behind it.
    expect(
      renderToStaticMarkup(
        <MessagesTimeline
          {...buildProps()}
          anchorMessageId={firstEntry.message.id}
          timelineEntries={timelineEntries}
        />,
      ),
    ).not.toContain('data-maintain-scroll-at-end="enabled"');

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
    ).toContain('data-maintain-scroll-at-end="enabled"');

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
    ).not.toContain('data-maintain-scroll-at-end="enabled"');
  });

  it("sets a user message's time and actions beside its bubble, not under it", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[buildUserTimelineEntry("Ship it.")]} />,
    );

    expect(markup).toContain('class="group flex flex-row-reverse items-end gap-2"');
  });

  it("renders collapse controls for long user messages", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    expect(markup).toContain("Show full message");
    expect(markup).toContain('data-maintain-scroll-at-end="enabled"');
    expect(markup).toContain('data-maintain-scroll-at-end-animated="false"');
    expect(markup).toContain('data-maintain-scroll-at-end-data-change="true"');
    expect(markup).toContain('data-maintain-scroll-at-end-item-layout="true"');
    expect(markup).toContain('data-maintain-scroll-at-end-layout="true"');
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
    expect(markup).toMatch(/rounded-2xl bg-message[^"]* px-4 py-2\.5/);
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
      services: new Map(),
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

  it("renders a muted failure marker for failed tool lifecycle entries", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-info",
            kind: "work",
            createdAt: "2026-03-17T19:12:27.000Z",
            entry: {
              id: "work-info",
              createdAt: "2026-03-17T19:12:27.000Z",
              label: "Status updated",
              tone: "info",
            },
          },
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Glob",
              tone: "tool",
              toolLifecycleStatus: "failed",
              detail: "No files found",
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("lucide-x");
    expect(markup).toContain('aria-label="Tool call failed"');
    // Ordinary tool failures render muted, not red.
    expect(markup).not.toContain("text-destructive");
  });

  it("only withholds an expanded tool-call label click while text is selected", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <MessagesTimeline
            {...buildProps()}
            timelineEntries={[
              {
                id: "entry-standalone",
                kind: "work",
                createdAt: MESSAGE_CREATED_AT,
                entry: {
                  id: "work-standalone",
                  createdAt: MESSAGE_CREATED_AT,
                  toolCallId: "call-standalone",
                  label: "Run lint",
                  tone: "tool",
                  itemType: "command_execution",
                  command: "pnpm lint",
                  toolLifecycleStatus: "completed",
                },
              },
            ]}
          />,
        );
      });
      const findExpandedLabel = () =>
        renderer!.root.findAll(
          (node) => node.type === "span" && String(node.props.className).includes("select-text"),
        )[0];
      // The fork folds a lone tool call under its group toggle first; open
      // collapsed disclosures until the tool row's label is expanded.
      for (let attempt = 0; attempt < 3 && !findExpandedLabel(); attempt += 1) {
        const collapsed = renderer!.root.findAll(
          (node) =>
            node.props["aria-expanded"] === false && typeof node.props.onClick === "function",
        )[0];
        if (!collapsed) break;
        await act(() => collapsed.props.onClick());
      }
      const label = findExpandedLabel();
      const stopPropagation = vi.fn();
      // Only the click that ends a selection may be withheld from the row
      // toggle; the plain click has to reach it so the label can collapse.
      for (const isCollapsed of [false, true]) {
        label!.props.onClick({
          currentTarget: { ownerDocument: { getSelection: () => ({ isCollapsed }) } },
          stopPropagation,
        });
      }
      expect(stopPropagation).toHaveBeenCalledTimes(1);
    } finally {
      await act(() => renderer?.unmount());
    }
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
      services: new Map(),
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

  it("draws a settled turn as the message, one work line and the answer", () => {
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
    // Settled, the line says who worked, how long and what the calls came
    // to — no note preview, no face — and a read message carries no mark.
    // How long runs to the answer, not to when the server closed the turn:
    // the same span once another turn follows.
    expect(markup).toContain('data-timeline-row-kind="work-line"');
    expect(markup).toContain("Assistant worked for 1m");
    expect(markup).not.toContain("Assistant worked for 1m 30s");
    expect(markup).toContain("· ran 2 commands");
    expect(markup).not.toContain("Building the shop now.");
    expect(markup).not.toContain("1 note");
    expect(markup).not.toContain("data-message-receipt");
    expect(markup).not.toContain('data-zerops-primitive="mate-face"');
    expect(markup).toContain("The shop builds.");
    // The log stays closed: no tool rows, no "Work Log".
    expect(markup).not.toContain('data-timeline-row-kind="log-activity"');
    expect(markup).not.toContain("Work Log");
  });

  it("opens a remembered work line into its log", async () => {
    const { rememberTimelinePosition } = await import("./timelineScrollAnchoring");
    rememberTimelinePosition("environment-local:thread-log", {
      rowId: "message-1",
      offsetWithinRow: 0,
      scrollOffset: 0,
      atEnd: true,
      disclosures: {
        stretches: new Set(["msg:message-1"]),
        logItems: new Set(),
        spawnEntries: new Set(),
      },
    });
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        routeThreadKey="environment-local:thread-log"
        latestTurn={settled}
        timelineEntries={[
          buildUserTimelineEntry("Build it"),
          tool("w1", 5),
          assistant("a1", 10, "Building the shop now."),
          assistant("a2", 60, "The shop builds."),
        ]}
      />,
    );
    expect(markup).toContain('data-timeline-row-kind="log-activity"');
    expect(markup).toContain("Ran 1 command");
    expect(markup).toContain('data-timeline-row-kind="log-note"');
    expect(markup).toContain('aria-expanded="true"');
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
    expect(markup).toContain('data-timeline-row-id="work-line:msg:message-1"');
    expect(markup).toContain("Assistant is working ·");
    expect(markup).toContain("Thinking");
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

  it("streams the Mate's words at the live tail, a failure where it happened, the newest last", () => {
    const markup = liveTimeline([
      assistant("a1", 5, "Checking the build."),
      {
        ...tool("t9", 10),
        entry: {
          ...tool("t9", 10).entry,
          tone: "error" as const,
          label: "Run the type check",
          sourceActivityKind: "task.completed" as const,
        },
      },
      assistant("a2", 15, "Fixing the types."),
    ]);
    expect(markup).toContain("data-conversation-working");
    expect(markup.match(/data-stream-bubble="note"/g)).toHaveLength(2);
    expect(markup).toContain('data-stream-bubble="failed"');
    expect(markup).toContain("Run the type check failed");
    // Oldest first: the newest bubble is last, and the only one of age 0.
    expect(markup.indexOf("Checking the build.")).toBeLessThan(markup.indexOf("Fixing the types."));
    expect(markup.match(/data-stream-age="0"/g)).toHaveLength(1);
    const newest = markup.slice(markup.indexOf('data-stream-age="0"'));
    expect(newest).toContain("Fixing the types.");
    expect(newest).not.toContain("Checking the build.");
  });

  it("shows the Mate composing before it said anything", () => {
    const markup = liveTimeline([tool("w1", 5)]);
    expect(markup).toContain('data-stream-activity="thinking"');
    expect(markup).not.toContain('data-stream-bubble="note"');
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

  it("says what the Mate is on beside its face, once, and never a call's arguments", () => {
    const markup = liveTimeline([
      assistant("a1", 5, "Reading the docs first."),
      call("c1", 8, 'WebFetch: {"url":"https://docs.example.dev"}'),
    ]);
    expect(markup).toContain('data-stream-activity="doing"');
    // The panel says it; the line above keeps to its clock.
    expect(markup.match(/Reading a web page/g)).toHaveLength(1);
    expect(markup).not.toContain("docs.example.dev");
  });

  it("waits on the person when the Mate asked with its question tool", () => {
    const markup = liveTimeline([
      call("c1", 8, 'AskUserQuestion: {"questions":[{"question":"Teal or amber?"}]}'),
    ]);
    expect(markup).toContain('data-stream-activity="waiting"');
    expect(markup).toContain("Waiting for your answer");
    expect(markup).not.toContain("AskUserQuestion");
  });

  it("keeps the question the Mate asked in its words beside its face, the answer in the person's", () => {
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
    const answer = markup.slice(markup.indexOf("data-person-answer"));
    expect(answer).toContain('data-mate-speech="said"');
    expect(answer.indexOf("Which accent do you prefer?")).toBeLessThan(answer.indexOf("Teal"));
    // The question's short header was never the person's words.
    expect(markup).not.toContain("Accent colour");
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
              },
            },
          ] as Parameters<typeof MessagesTimeline>[0]["timelineEntries"]
        }
      />,
    );
    expect(markup).toContain("Background task finished");
    expect(markup).toContain("Run the smoke tests");
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
              },
            },
            assistant("a3", 30, "It reports back when done."),
            { ...answer, message: { ...answer.message, turnId: woken } },
          ] as Parameters<typeof MessagesTimeline>[0]["timelineEntries"]
        }
      />,
    );
    const line = markup.indexOf("Helper finished");
    expect(line).toBeGreaterThan(markup.indexOf("It reports back when done."));
    expect(line).toBeLessThan(markup.indexOf("The review came back clean."));
    expect(markup).toContain("Review the endpoint");
    expect(markup).not.toContain("Background task finished");
  });

  it.each([
    { watch: true, words: "Watching in the background", title: "Watch the pull request" },
    { watch: false, words: "Still working in the background", title: "Typecheck appdev" },
  ])(
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
