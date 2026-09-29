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
  useConversationStripShown,
  useLoneChatNewChat,
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
    const newChat = html.indexOf('aria-label="New chat"');
    expect(main).toBeGreaterThan(-1);
    expect(logs).toBeGreaterThan(main);
    expect(newChat).toBeGreaterThan(logs);
    expect(html).toContain(">Fen</span>");
    expect(html).toContain(">Logs</span>");
    expect(html.match(/data-zerops-primitive="mate-face"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Close Logs"');
    expect(html).not.toContain('aria-label="Close Fen"');
  });
});

describe("useLoneChatNewChat", () => {
  function newChat(currentThreadId: string | null): (() => void) | null {
    const found: Array<(() => void) | null> = [];
    function Probe() {
      found.push(
        useLoneChatNewChat({
          environmentId: FEN,
          projectId: ProjectId.make("project-1"),
          currentThreadId: currentThreadId === null ? null : ThreadId.make(currentThreadId),
        }),
      );
      return null;
    }
    renderToStaticMarkup(<Probe />);
    return found[0] ?? null;
  }

  it("is the header's one way to a second chat while the Mate has one", () => {
    state.shells = [shell("main")];
    const start = newChat("main");
    expect(start).toBeTypeOf("function");
    start?.();
    expect(state.newThread).toHaveBeenCalledWith(
      { environmentId: FEN, projectId: "project-1" },
      { chat: true },
    );
  });

  it("gives way to the strip's own New chat once there are two chats", () => {
    state.shells = [
      shell("main", { latestUserMessageAt: "2026-09-05T12:00:00.000Z" }),
      shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" }),
    ];
    expect(newChat("main")).toBeNull();
  });
});

describe("useConversationStripShown", () => {
  function shown(currentThreadId: string): boolean {
    const found: Array<boolean> = [];
    function Probe() {
      found.push(
        useConversationStripShown({
          environmentId: FEN,
          currentThreadId: ThreadId.make(currentThreadId),
        }),
      );
      return null;
    }
    renderToStaticMarkup(<Probe />);
    return found[0] ?? false;
  }

  it.each([
    { name: "leaves the header to the Mate while it has one chat", chats: 1, strip: false },
    { name: "gives the header's line to the strip with a second chat", chats: 2, strip: true },
  ])("$name", ({ chats, strip }) => {
    state.shells = [
      shell("main", { latestUserMessageAt: "2026-09-05T12:00:00.000Z" }),
      shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" }),
    ].slice(0, chats);
    expect(shown("main")).toBe(strip);
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
    face: { tint: "amber", state: "idle" },
    status: null,
    current: false,
    close: "none",
    canMakeMain: false,
    ...overrides,
  });
  const view = (groups: ReadonlyArray<ConversationStripGroup>) =>
    renderToStaticMarkup(
      <ConversationStripView
        canMakeMain
        groups={groups}
        onClose={() => {}}
        onMakeMain={() => {}}
        onNewChat={() => {}}
        onOpen={() => {}}
      />,
    );
  /** One entry's own classes: its band, and whether it is folded out of the row. */
  const entryClass = (html: string, key: string) =>
    new RegExp(`class="([^"]*)" data-conversation-strip-entry="${key}"`).exec(html)?.[1] ?? "";
  /** One entry's button and its name, from the entry's tag to the name's end. */
  const entryButton = (html: string, key: string) => {
    const start = html.indexOf(`data-conversation-strip-entry="${key}"`);
    return html.slice(start, html.indexOf("</span>", start));
  };

  it("sets the crew a step apart from the chats, with no rule between them", () => {
    const html = view([
      { id: "chats", label: "Chats", entries: [entry("main"), entry("logs")] },
      { id: "crew", label: "Crew", entries: [entry("crew:backend", { label: "Backend" })] },
    ]);
    expect(html).toMatch(/aria-label="Crew" class="[^"]*\bms-4\b[^"]*" role="group"/);
    expect(html).not.toContain('data-slot="separator"');
    expect(html).toContain(">Backend</span>");
  });

  it("offers New chat after the Mate's chats, before the crew, as a quiet glyph", () => {
    const html = view([
      { id: "chats", label: "Chats", entries: [entry("main")] },
      { id: "crew", label: "Crew", entries: [entry("crew:lead", { label: "Lead" })] },
    ]);
    const newChat = html.indexOf('aria-label="New chat"');
    expect(newChat).toBeGreaterThan(html.indexOf('data-conversation-strip-entry="main"'));
    expect(newChat).toBeLessThan(html.indexOf('data-conversation-strip-entry="crew:lead"'));
    expect(html).not.toContain(">New chat<");
  });

  it("marks the entry on screen with the menu's band, and only that one", () => {
    const html = view([
      {
        id: "chats",
        label: "Chats",
        entries: [entry("main"), entry("logs", { current: true, close: "open" })],
      },
    ]);
    expect(entryClass(html, "logs")).toContain("bg-sidebar-row-active");
    expect(entryButton(html, "logs")).toContain('aria-current="page"');
    expect(entryClass(html, "main")).not.toContain("bg-sidebar-row-active");
    expect(entryButton(html, "main")).not.toContain("aria-current");
  });

  it("leaves what an entry does to its face: the word is only its accessible name", () => {
    const html = view([
      {
        id: "crew",
        label: "Crew",
        entries: [
          entry("crew:backend", {
            label: "Backend",
            status: "Working",
            face: { tint: "sky", state: "working" },
          }),
        ],
      },
    ]);
    expect(html).toContain('aria-label="Backend, Working"');
    expect(html).not.toContain(">Working<");
    expect(html).not.toContain('data-zerops-primitive="status-dot"');
    expect(html).toContain('data-mate-face-state="working"');
  });

  it("names an entry that has something for you in ink, and one at work muted", () => {
    const html = view([
      {
        id: "crew",
        label: "Crew",
        entries: [
          entry("crew:backend", { label: "Backend", face: { tint: "sky", state: "needs" } }),
          entry("crew:erik", { label: "Erik", face: { tint: "amber", state: "working" } }),
        ],
      },
    ]);
    expect(entryButton(html, "crew:backend")).toMatch(/ text-foreground[^"]*">Backend$/);
    expect(entryButton(html, "crew:erik")).toMatch(/ text-muted-foreground[^"]*">Erik$/);
  });

  it("marks the lead by no glyph: its place, and its role where its name does not say it", () => {
    const html = view([
      { id: "chats", label: "Chats", entries: [entry("main")] },
      {
        id: "crew",
        label: "Crew",
        entries: [
          entry("crew:lead", { label: "Ada", role: "Ada, the lead" }),
          entry("crew:backend"),
        ],
      },
    ]);
    expect(html).not.toContain("data-crew-lead-mark");
    expect(html).toContain('aria-label="Ada, the lead"');
    expect(html).toContain(">Ada</span>");
  });

  it("draws every entry in the row before the row is measured", () => {
    const keys = ["main", "logs", "crew:lead", "crew:backend"];
    const html = view([
      { id: "chats", label: "Chats", entries: [entry("main"), entry("logs")] },
      { id: "crew", label: "Crew", entries: [entry("crew:lead"), entry("crew:backend")] },
    ]);
    for (const key of keys) expect(entryClass(html, key)).not.toContain("invisible");
  });

  it("offers Make main and Close chat on the chat you are on", () => {
    const html = view([
      {
        id: "chats",
        label: "Chats",
        entries: [
          entry("main"),
          entry("logs", { current: true, close: "open", canMakeMain: true }),
        ],
      },
    ]);
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
