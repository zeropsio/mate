import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ConversationStripEntry, ConversationStripGroup } from "./ConversationStrip.logic";

const FEN = EnvironmentId.make("env-fen");

const state = vi.hoisted(() => ({
  shells: [] as Array<unknown>,
  pin: vi.fn(),
  unpin: vi.fn(),
  archive: vi.fn(),
  newThread: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock("~/state/entities", () => ({ useThreadShells: () => state.shells }));
vi.mock("~/state/environments", () => ({ useEnvironment: () => null }));
vi.mock("~/uiStateStore", () => ({
  useUiStateStore: (select: (value: { threadLastVisitedAtById: object }) => unknown) =>
    select({ threadLastVisitedAtById: {} }),
}));
vi.mock("~/zerops/useZeropsMates", () => ({
  useZeropsMate: () => ({
    kind: "mate",
    mate: { name: "Fen", tint: "amber", project: "shop", projectUrl: "", connected: true },
  }),
}));
vi.mock("~/hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => state.newThread }));
vi.mock("~/hooks/useThreadActions", async (original) => ({
  ...(await original<typeof import("~/hooks/useThreadActions")>()),
  useThreadActions: () => ({
    archiveThread: state.archive,
    pinThread: state.pin,
    unpinThread: state.unpin,
  }),
}));

import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  ConversationStrip,
  ConversationStripView,
  useAlsoWorkingBanner,
} from "./ConversationStrip";

function shell(
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    id: ThreadId.make(id),
    environmentId: FEN,
    projectId: ProjectId.make("project-1"),
    title: id,
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-09-05T10:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function strip(currentThreadId: string | null) {
  return renderToStaticMarkup(
    <ConversationStrip
      currentThreadId={currentThreadId === null ? null : ThreadId.make(currentThreadId)}
      environmentId={FEN}
      projectId={ProjectId.make("project-1")}
    />,
  );
}

beforeEach(() => {
  state.shells = [];
  for (const spy of [state.pin, state.unpin, state.archive, state.newThread]) spy.mockReset();
});

describe("ConversationStrip", () => {
  it("draws nothing, and writes nothing, for a Mate with one chat", () => {
    state.shells = [shell("main")];
    expect(strip("main")).toBe("");
    expect(state.pin).not.toHaveBeenCalled();
    expect(state.newThread).not.toHaveBeenCalled();
  });

  it("draws the main chat under the Mate's face and name, then the other chats, then New chat", () => {
    state.shells = [
      shell("main", { latestUserMessageAt: "2026-09-05T12:00:00.000Z" }),
      shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" }),
    ];
    const html = strip("logs");
    const main = html.indexOf('data-conversation-strip-entry="main"');
    const logs = html.indexOf('data-conversation-strip-entry="logs"');
    expect(main).toBeGreaterThan(-1);
    expect(logs).toBeGreaterThan(main);
    expect(html).toContain(">Fen</span>");
    expect(html).toContain(">Logs</span>");
    expect(html).toContain('data-zerops-primitive="mate-face"');
    expect(html).toContain('aria-disabled="true" aria-label="Close Fen"');
    expect(html).toContain('aria-label="Close Logs"');
    expect(html).toContain("New chat");
  });
});

describe("ConversationStripView", () => {
  const entry = (
    key: string,
    overrides: Partial<ConversationStripEntry> = {},
  ): ConversationStripEntry => ({
    key,
    threadId: ThreadId.make(key),
    label: key,
    status: null,
    current: false,
    close: "none",
    canMakeMain: false,
    ...overrides,
  });
  const working = { word: "Working", tone: "busy", pulse: true } as const;
  const view = (groups: ReadonlyArray<ConversationStripGroup>, width: number | null) =>
    renderToStaticMarkup(
      <ConversationStripView
        canMakeMain
        groups={groups}
        onClose={() => {}}
        onMakeMain={() => {}}
        onNewChat={() => {}}
        onOpen={() => {}}
        width={width}
      />,
    );

  it("draws a further group behind a divider, as the crew will join", () => {
    const html = view(
      [
        { id: "chats", label: "Chats", entries: [entry("main"), entry("logs")] },
        { id: "crew", label: "Crew", entries: [entry("@backend", { status: working })] },
      ],
      null,
    );
    expect(html).toMatch(/aria-label="Crew"[^>]*role="group"/);
    expect(html).toContain('data-slot="separator"');
    expect(html).toContain(">@backend</span>");
  });

  it("says the status word beside its dot, and keeps it only as the dot's name when narrow", () => {
    const groups = [
      { id: "chats", label: "Chats", entries: [entry("main"), entry("logs", { status: working })] },
    ];
    expect(view(groups, null)).toContain(">Working</");
    const narrow = view(groups, 460);
    expect(narrow).toContain('aria-label="Working" role="img"');
    expect(narrow).not.toContain(">Working</");
  });

  it("folds the tail into More when the row runs out, keeping the chat you are on", () => {
    const html = view(
      [
        {
          id: "chats",
          label: "Chats",
          entries: [
            entry("main"),
            entry("logs"),
            entry("migration"),
            entry("docs", { current: true }),
          ],
        },
      ],
      // Room for three slots and New chat: the main chat, the one you are on, and More.
      3 * 148 + 104,
    );
    expect(html).toContain('data-conversation-strip-entry="main"');
    expect(html).toContain('data-conversation-strip-entry="docs"');
    expect(html).not.toContain('data-conversation-strip-entry="logs"');
    expect(html).not.toContain('data-conversation-strip-entry="migration"');
    expect(html).toContain("More");
  });

  it("offers Make main and Close chat on the chat you are on", () => {
    const html = view(
      [
        {
          id: "chats",
          label: "Chats",
          entries: [
            entry("main", { close: "main" }),
            entry("logs", { current: true, close: "open", canMakeMain: true }),
          ],
        },
      ],
      null,
    );
    expect(html).toContain('aria-label="More for logs"');
    expect(html).not.toContain('aria-label="More for main"');
  });
});

describe("useAlsoWorkingBanner", () => {
  const running = {
    latestTurn: {
      turnId: TurnId.make("turn-1"),
      state: "running" as const,
      requestedAt: "2026-09-05T10:01:00.000Z",
      startedAt: "2026-09-05T10:01:00.000Z",
      completedAt: null,
      assistantMessageId: null,
    },
  };
  function Probe({
    typing,
    receive,
  }: {
    readonly typing: boolean;
    readonly receive: (item: ComposerBannerStackItem | null) => void;
  }) {
    receive(
      useAlsoWorkingBanner({ environmentId: FEN, currentThreadId: ThreadId.make("logs"), typing }),
    );
    return null;
  }
  function banner(typing: boolean): ComposerBannerStackItem | null {
    const items: Array<ComposerBannerStackItem | null> = [];
    renderToStaticMarkup(<Probe receive={(item) => items.push(item)} typing={typing} />);
    return items[0] ?? null;
  }

  it("says the Mate is at work in the main chat while you type in another", () => {
    state.shells = [
      shell("main", { ...running, latestUserMessageAt: "2026-09-05T12:00:00.000Z" }),
      shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" }),
    ];
    expect(banner(true)).toMatchObject({
      variant: "default",
      title: "Fen is also working in your main chat — both change the same files.",
    });
    expect(banner(false)).toBeNull();
  });
});
