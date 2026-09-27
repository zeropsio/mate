import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type CrewSnapshot,
} from "@t3tools/contracts";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";
import { describe, expect, it } from "vite-plus/test";

import {
  alsoWorkingLine,
  chatEntries,
  chatStatus,
  crewEntries,
  foldStrip,
  loneChatNewChatShown,
  mainChatToPin,
  mateChats,
  stripShown,
  type ConversationStripEntry,
} from "./ConversationStrip.logic";

const FEN = EnvironmentId.make("env-fen");

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

describe("mateChats", () => {
  it("puts the main chat first and the others in the order they were started", () => {
    const main = shell("main", { latestUserMessageAt: "2026-09-05T12:00:00.000Z" });
    const logs = shell("logs", {
      createdAt: "2026-09-05T11:00:00.000Z",
      latestUserMessageAt: "2026-09-05T11:30:00.000Z",
    });
    const migration = shell("migration", {
      createdAt: "2026-09-05T10:30:00.000Z",
      latestUserMessageAt: "2026-09-05T11:45:00.000Z",
    });
    const archived = shell("archived", { archivedAt: "2026-09-05T11:50:00.000Z" });

    expect(mateChats([logs, archived, migration, main]).map((chat) => chat.id)).toEqual([
      "main",
      "migration",
      "logs",
    ]);
  });
});

describe("chatStatus", () => {
  const turn = (state: "running" | "completed" | "error") => ({
    turnId: TurnId.make("turn-1"),
    state,
    requestedAt: "2026-09-05T10:01:00.000Z",
    startedAt: "2026-09-05T10:01:00.000Z",
    completedAt: state === "running" ? null : "2026-09-05T10:02:00.000Z",
    assistantMessageId: null,
  });
  const cases = [
    {
      name: "running",
      overrides: { latestTurn: turn("running") },
      visited: undefined,
      word: "Working",
      tone: "busy",
      pulse: true,
    },
    {
      name: "asking for approval",
      overrides: { hasPendingApprovals: true },
      visited: undefined,
      word: "Approval",
      tone: "attention",
      pulse: false,
    },
    {
      name: "asking a question",
      overrides: { hasPendingUserInput: true },
      visited: undefined,
      word: "Input",
      tone: "attention",
      pulse: false,
    },
    {
      name: "failed",
      overrides: { latestTurn: turn("error") },
      visited: undefined,
      word: "Failed",
      tone: "failed",
      pulse: false,
    },
    {
      name: "done and unseen",
      overrides: { latestTurn: turn("completed") },
      visited: "2026-09-05T10:01:30.000Z",
      word: "Done",
      tone: "ok",
      pulse: false,
    },
  ] as const;

  for (const row of cases) {
    it(`phrases a chat that is ${row.name} as the one resolver does`, () => {
      expect(chatStatus(shell("chat", row.overrides), row.visited)).toEqual({
        word: row.word,
        tone: row.tone,
        pulse: row.pulse,
      });
    });
  }

  it("has no word, and so no dot, for a chat with nothing going on", () => {
    expect(
      chatStatus(shell("chat", { latestTurn: turn("completed") }), "2026-09-05T10:03:00.000Z"),
    ).toBeNull();
  });
});

describe("chatEntries", () => {
  const FEN_MATE = { name: "Fen", tint: "amber", connected: true } as const;
  const main = shell("main", { latestUserMessageAt: "2026-09-05T12:00:00.000Z" });
  const logs = shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" });

  it("names the main chat after the Mate, with its face, and the others by their titles", () => {
    const entries = chatEntries({
      chats: [main, logs],
      currentThreadId: ThreadId.make("logs"),
      startingChat: false,
      mate: FEN_MATE,
      lastVisitedAtById: {},
    });
    expect(entries).toEqual([
      {
        key: "main",
        threadId: "main",
        label: "Fen",
        face: { tint: "amber", state: "idle" },
        status: null,
        current: false,
        close: "main",
        canMakeMain: false,
      },
      {
        key: "logs",
        threadId: "logs",
        label: "Logs",
        status: null,
        current: true,
        close: "open",
        canMakeMain: true,
      },
    ]);
  });

  it("adds the chat being started as the current one, with nothing to close yet", () => {
    const entries = chatEntries({
      chats: [main],
      currentThreadId: null,
      startingChat: true,
      mate: FEN_MATE,
      lastVisitedAtById: {},
    });
    expect(
      entries.map(({ key, label, current, close }) => ({ key, label, current, close })),
    ).toEqual([
      { key: "main", label: "Fen", current: false, close: "main" },
      { key: "starting", label: "New chat", current: true, close: "none" },
    ]);
    expect(entries[1]).toMatchObject({ threadId: null, status: null, canMakeMain: false });
  });

  it("holds a chat's close while its turn runs, as archiving would refuse it", () => {
    const busy = shell("logs", {
      title: "Logs",
      createdAt: "2026-09-05T11:00:00.000Z",
      session: {
        threadId: ThreadId.make("logs"),
        status: "running",
        providerName: null,
        runtimeMode: "full-access",
        activeTurnId: TurnId.make("turn-1"),
        lastError: null,
        updatedAt: "2026-09-05T11:01:00.000Z",
      },
    });
    const [, logsEntry] = chatEntries({
      chats: [main, busy],
      currentThreadId: null,
      startingChat: false,
      mate: FEN_MATE,
      lastVisitedAtById: {},
    });
    expect(logsEntry?.close).toBe("busy");
  });

  it("gives a Mate's only chat no close: starting over is the header's New session", () => {
    const [only] = chatEntries({
      chats: [main],
      currentThreadId: ThreadId.make("main"),
      startingChat: false,
      mate: FEN_MATE,
      lastVisitedAtById: {},
    });
    expect(only).toMatchObject({ current: true, close: "none" });
  });

  it("draws the main chat's face asleep while the Mate's container is not connected", () => {
    const [first] = chatEntries({
      chats: [main],
      currentThreadId: null,
      startingChat: false,
      mate: { ...FEN_MATE, connected: false },
      lastVisitedAtById: {},
    });
    expect(first?.face).toEqual({ tint: "amber", state: "sleep" });
  });
});

describe("crewEntries", () => {
  const crewShell = (
    handle: string,
    stint: number,
    overrides: Partial<EnvironmentThreadShell> = {},
  ) =>
    shell(`thread-crew-${handle}-${stint}`, {
      crew: { crew: "shop", crewmate: handle, stint },
      ...overrides,
    });
  const running = {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: "2026-09-05T10:01:00.000Z",
    startedAt: "2026-09-05T10:01:00.000Z",
    completedAt: null,
    assistantMessageId: null,
  } as const;
  const shells = [
    crewShell("lead", 1),
    crewShell("backend", 1, { archivedAt: "2026-09-27T09:10:00.000Z" }),
    crewShell("backend", 2, { latestTurn: running }),
    crewShell("frontend", 1),
    crewShell("erik", 1),
  ];
  const view = (snapshot: CrewSnapshot = crewSnapshotFixture()) =>
    deriveCrewView(snapshot, shells, (thread) => ({
      status: resolveThreadStatus(thread),
      word: null,
      working: false,
    }));
  const entries = (
    input: Partial<Parameters<typeof crewEntries>[0]> = {},
  ): ReadonlyArray<ConversationStripEntry> =>
    crewEntries({
      view: view(),
      currentThreadId: null,
      connected: true,
      lastVisitedAtById: {},
      ...input,
    }).entries;

  it("draws a chip per crewmate, the lead first, each as its @handle in its own tint", () => {
    expect(
      entries().map(({ key, threadId, label, face, close, canMakeMain }) => ({
        key,
        threadId,
        label,
        tint: face?.tint,
        close,
        canMakeMain,
      })),
    ).toEqual(
      [
        ["lead", "thread-crew-lead-1", "violet"],
        ["backend", "thread-crew-backend-2", "sky"],
        ["frontend", "thread-crew-frontend-1", "coral"],
        ["erik", "thread-crew-erik-1", "amber"],
      ].map(([handle, threadId, tint]) => ({
        key: `crew:${handle}`,
        threadId,
        label: `@${handle}`,
        tint,
        close: "none",
        canMakeMain: false,
      })),
    );
  });

  it("wears the working face and the resolver's word while its current stint works", () => {
    const backend = entries().find((entry) => entry.key === "crew:backend");
    expect(backend?.face?.state).toBe("working");
    expect(backend?.status).toEqual(
      chatStatus(crewShell("backend", 2, { latestTurn: running }), undefined),
    );
  });

  it("is the current chip on any of its stints, a retired one too", () => {
    for (const threadId of ["thread-crew-backend-2", "thread-crew-backend-1"]) {
      expect(
        entries({ currentThreadId: ThreadId.make(threadId) })
          .filter((entry) => entry.current)
          .map((entry) => entry.key),
      ).toEqual(["crew:backend"]);
    }
  });

  it("sleeps every face while the Mate's container is not connected", () => {
    expect(new Set(entries({ connected: false }).map((entry) => entry.face?.state))).toEqual(
      new Set(["sleep"]),
    );
  });

  it("opens nothing for a crewmate before its first turn", () => {
    const snapshot = crewSnapshotFixture();
    const [first] = entries({
      view: view({
        ...snapshot,
        crewmates: snapshot.crewmates.map((crewmate) =>
          crewmate.handle === "lead"
            ? { ...crewmate, currentThreadId: null, stints: [] }
            : crewmate,
        ),
      }),
    });
    expect(first).toMatchObject({ key: "crew:lead", threadId: null, status: null });
  });

  it("draws nothing while no crew is applied", () => {
    expect(entries({ view: null })).toEqual([]);
    expect(
      entries({ view: view(crewSnapshotFixture({ status: "none", crew: null, crewmates: [] })) }),
    ).toEqual([]);
  });
});

describe("stripShown", () => {
  const entry = (key: string) => ({
    key,
    threadId: ThreadId.make(key),
    label: key,
    status: null,
    current: false,
    close: "none" as const,
    canMakeMain: false,
  });
  const crew = { id: "crew", label: "Crew", entries: [entry("backend")] };
  const cases = [
    { name: "a Mate's only chat", chats: [entry("main")], extra: [], shown: false },
    { name: "two chats", chats: [entry("main"), entry("logs")], extra: [], shown: true },
    { name: "a Mate with no chat yet", chats: [], extra: [], shown: false },
    { name: "one chat beside a crew", chats: [entry("main")], extra: [crew], shown: true },
    {
      name: "one chat beside an empty group",
      chats: [entry("main")],
      extra: [{ ...crew, entries: [] }],
      shown: false,
    },
  ];
  for (const row of cases) {
    it(`${row.shown ? "shows" : "hides"} the chip row for ${row.name}`, () => {
      expect(stripShown(row.chats, row.extra)).toBe(row.shown);
    });
  }
});

describe("loneChatNewChatShown", () => {
  const entry = (key: string, threadId: string | null = key) => ({
    key,
    threadId: threadId === null ? null : ThreadId.make(threadId),
    label: key,
    status: null,
    current: true,
    close: "none" as const,
    canMakeMain: false,
  });
  const crew = { id: "crew", label: "Crew", entries: [entry("backend")] };
  const cases = [
    { name: "a Mate's only chat", chats: [entry("main")], extra: [], shown: true },
    {
      name: "two chats, where the row has its own",
      chats: [entry("main"), entry("logs")],
      extra: [],
      shown: false,
    },
    {
      name: "a Mate's first chat not sent yet",
      chats: [entry("starting", null)],
      extra: [],
      shown: false,
    },
    {
      name: "one chat beside a crew, where the row has its own",
      chats: [entry("main")],
      extra: [crew],
      shown: false,
    },
  ];
  for (const row of cases) {
    it(`${row.shown ? "offers" : "does not offer"} the header's New chat for ${row.name}`, () => {
      expect(loneChatNewChatShown(row.chats, row.extra)).toBe(row.shown);
    });
  }
});

describe("alsoWorkingLine", () => {
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
  const main = shell("main");
  const logs = shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" });
  const line = (input: {
    chats: ReadonlyArray<EnvironmentThreadShell>;
    current: string | null;
    typing: boolean;
  }) =>
    alsoWorkingLine({
      mateName: "Fen",
      chats: input.chats,
      currentThreadId: input.current === null ? null : ThreadId.make(input.current),
      typing: input.typing,
    });

  const cases = [
    {
      name: "names the main chat while you type in another",
      chats: [shell("main", running), logs],
      current: "logs",
      typing: true,
      expected: "Fen is also working in your main chat — both change the same files.",
    },
    {
      name: "names another chat by its title while you type in the main one",
      chats: [main, shell("logs", { ...running, title: "Logs" })],
      current: "main",
      typing: true,
      expected: "Fen is also working in ‘Logs’ — both change the same files.",
    },
    {
      name: "counts every chat as another while you start a new one",
      chats: [shell("main", running), logs],
      current: null,
      typing: true,
      expected: "Fen is also working in your main chat — both change the same files.",
    },
    {
      name: "stays silent until you type",
      chats: [shell("main", running), logs],
      current: "logs",
      typing: false,
      expected: null,
    },
    {
      name: "stays silent when only the chat you are in works",
      chats: [main, shell("logs", { ...running, title: "Logs" })],
      current: "logs",
      typing: true,
      expected: null,
    },
  ];
  for (const row of cases) {
    it(row.name, () => {
      expect(line(row)).toBe(row.expected);
    });
  }
});

describe("foldStrip", () => {
  const entry = (key: string, current = false) => ({
    key,
    threadId: ThreadId.make(key),
    label: key,
    status: null,
    current,
    close: "none" as const,
    canMakeMain: false,
  });
  const keys = (groups: ReadonlyArray<{ entries: ReadonlyArray<{ key: string }> }>) =>
    groups.map((group) => group.entries.map((each) => each.key));

  it("folds nothing when every entry fits", () => {
    const groups = [{ id: "chats", label: "Chats", entries: [entry("a"), entry("b")] }];
    const folded = foldStrip(groups, 2);
    expect(keys(folded.visible)).toEqual([["a", "b"]]);
    expect(folded.folded).toEqual([]);
  });

  it("folds the tail across groups into More, leaving room for the More chip itself", () => {
    const groups = [
      { id: "chats", label: "Chats", entries: [entry("a"), entry("b")] },
      { id: "crew", label: "Crew", entries: [entry("lead"), entry("backend")] },
    ];
    const folded = foldStrip(groups, 3);
    expect(keys(folded.visible)).toEqual([["a", "b"], []]);
    expect(folded.folded.map((each) => each.key)).toEqual(["lead", "backend"]);
  });

  it("keeps the current entry out of More, folding the one before it instead", () => {
    const groups = [
      {
        id: "chats",
        label: "Chats",
        entries: [entry("a"), entry("b"), entry("c"), entry("d", true)],
      },
    ];
    const folded = foldStrip(groups, 3);
    expect(keys(folded.visible)).toEqual([["a", "d"]]);
    expect(folded.folded.map((each) => each.key)).toEqual(["b", "c"]);
  });

  it("never folds below one entry", () => {
    const groups = [{ id: "chats", label: "Chats", entries: [entry("a"), entry("b", true)] }];
    const folded = foldStrip(groups, 0);
    expect(keys(folded.visible)).toEqual([["b"]]);
    expect(folded.folded.map((each) => each.key)).toEqual(["a"]);
  });
});

describe("mainChatToPin", () => {
  const pinned = { pinnedAt: "2026-09-05T09:00:00.000Z" };
  const cases = [
    {
      name: "pins the Mate's one chat when a second is started",
      threads: [shell("main")],
      pin: "main",
    },
    {
      name: "pins the chat the Mate answers from when several were never pinned",
      threads: [shell("old", { latestUserMessageAt: null }), shell("main")],
      pin: "main",
    },
    {
      name: "writes nothing when a chat is already main",
      threads: [shell("main", pinned), shell("logs")],
      pin: null,
    },
    {
      name: "does not count a pin on an archived chat",
      threads: [
        shell("gone", { ...pinned, archivedAt: "2026-09-05T09:30:00.000Z" }),
        shell("main"),
      ],
      pin: "main",
    },
    { name: "writes nothing for a Mate with no chat yet", threads: [], pin: null },
  ];
  for (const row of cases) {
    it(row.name, () => {
      expect(mainChatToPin(row.threads)).toBe(row.pin);
    });
  }
});
