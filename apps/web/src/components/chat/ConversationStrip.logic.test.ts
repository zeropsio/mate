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
  entryAccessibleName,
  entryInk,
  foldStrip,
  loneChatNewChatShown,
  mainChatToPin,
  mateChats,
  replacementChatToPin,
  stripShown,
  type ConversationStripEntry,
  type ConversationStripGroup,
  type StripRoom,
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

/** An entry as the strip draws it, at rest unless told otherwise. */
function stripEntry(
  key: string,
  overrides: Partial<ConversationStripEntry> = {},
): ConversationStripEntry {
  return {
    key,
    threadId: ThreadId.make(key),
    label: key,
    face: { tint: "amber", state: "idle" },
    status: null,
    current: false,
    close: "none",
    canMakeMain: false,
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
  it.each<{
    readonly name: string;
    readonly overrides: Partial<EnvironmentThreadShell>;
    readonly visited: string | undefined;
    readonly word: string | null;
  }>([
    {
      name: "running",
      overrides: { latestTurn: turn("running") },
      visited: undefined,
      word: "Working",
    },
    {
      name: "asking for approval",
      overrides: { hasPendingApprovals: true },
      visited: undefined,
      word: "Approval",
    },
    {
      name: "asking a question",
      overrides: { hasPendingUserInput: true },
      visited: undefined,
      word: "Input",
    },
    {
      name: "failed",
      overrides: { latestTurn: turn("error") },
      visited: undefined,
      word: "Failed",
    },
    {
      name: "done and unseen",
      overrides: { latestTurn: turn("completed") },
      visited: "2026-09-05T10:01:30.000Z",
      word: "Done",
    },
    {
      name: "done and seen, with nothing going on",
      overrides: { latestTurn: turn("completed") },
      visited: "2026-09-05T10:03:00.000Z",
      word: null,
    },
  ])(
    "words a chat that is $name as the one phrase producer does",
    ({ overrides, visited, word }) => {
      expect(chatStatus(shell("chat", overrides), visited)).toBe(word);
    },
  );
});

describe("chatEntries", () => {
  const FEN_MATE = { name: "Fen", tint: "amber", connected: true } as const;
  const main = shell("main", { latestUserMessageAt: "2026-09-05T12:00:00.000Z" });
  const logs = shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" });
  const running = {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: "2026-09-05T10:01:00.000Z",
    startedAt: "2026-09-05T10:01:00.000Z",
    completedAt: null,
    assistantMessageId: null,
  } as const;

  it("names the main chat after the Mate and the others by their titles, each in the Mate's face", () => {
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
        close: "none",
        canMakeMain: false,
      },
      {
        key: "logs",
        threadId: "logs",
        label: "Logs",
        face: { tint: "amber", state: "idle" },
        status: null,
        current: true,
        close: "open",
        canMakeMain: true,
      },
    ]);
  });

  it("gives every chat's face that chat's own state: in a second chat, what the Mate does there", () => {
    const [mainEntry, logsEntry] = chatEntries({
      chats: [main, shell("logs", { title: "Logs", latestTurn: running })],
      currentThreadId: ThreadId.make("main"),
      startingChat: false,
      mate: FEN_MATE,
      lastVisitedAtById: {},
    });
    expect(mainEntry?.face.state).toBe("idle");
    expect(logsEntry).toMatchObject({
      face: { tint: "amber", state: "working" },
      status: "Working",
    });
  });

  it("adds the chat being started as the current one, in the Mate's face at rest, with nothing to close", () => {
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
      { key: "main", label: "Fen", current: false, close: "none" },
      { key: "starting", label: "New chat", current: true, close: "none" },
    ]);
    expect(entries[1]).toMatchObject({
      threadId: null,
      face: { tint: "amber", state: "idle" },
      status: null,
      canMakeMain: false,
    });
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

  it.each([
    {
      name: "a Mate's only chat: starting over is the header menu's Archive and start fresh",
      chats: [main],
    },
    {
      name: "the main chat beside others: Make main on another is the way to close it",
      chats: [main, logs],
    },
  ])("gives $name no close", ({ chats }) => {
    const [first] = chatEntries({
      chats,
      currentThreadId: ThreadId.make("main"),
      startingChat: false,
      mate: FEN_MATE,
      lastVisitedAtById: {},
    });
    expect(first).toMatchObject({ current: true, close: "none" });
  });

  it("draws every chat's face asleep while the Mate's container is not connected", () => {
    const entries = chatEntries({
      chats: [main, shell("logs", { title: "Logs", latestTurn: running })],
      currentThreadId: null,
      startingChat: true,
      mate: { ...FEN_MATE, connected: false },
      lastVisitedAtById: {},
    });
    expect(entries.map((entry) => entry.face)).toEqual([
      { tint: "amber", state: "sleep" },
      { tint: "amber", state: "sleep" },
      { tint: "amber", state: "sleep" },
    ]);
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

  it("draws an entry per crewmate, the lead first, each by its name in its own tint", () => {
    expect(
      entries().map(({ key, threadId, label, face, close, canMakeMain }) => ({
        key,
        threadId,
        label,
        tint: face.tint,
        close,
        canMakeMain,
      })),
    ).toEqual(
      [
        ["lead", "Lead", "thread-crew-lead-1", "violet"],
        ["backend", "Backend", "thread-crew-backend-2", "sky"],
        ["frontend", "Frontend", "thread-crew-frontend-1", "coral"],
        ["erik", "Erik", "thread-crew-erik-1", "amber"],
      ].map(([handle, label, threadId, tint]) => ({
        key: `crew:${handle}`,
        threadId,
        label,
        tint,
        close: "none",
        canMakeMain: false,
      })),
    );
  });

  it.each([
    { name: "Lead", role: undefined },
    { name: "Team lead", role: undefined },
    { name: "Ada", role: "Ada, the lead" },
    { name: "Leader", role: "Leader, the lead" },
  ])("says the lead's role where its name $name does not", ({ name, role }) => {
    const snapshot = crewSnapshotFixture();
    const renamed = view({
      ...snapshot,
      crewmates: snapshot.crewmates.map((crewmate) =>
        crewmate.handle === "lead" ? { ...crewmate, displayName: name } : crewmate,
      ),
    });
    expect(entries({ view: renamed }).map((entry) => [entry.key, entry.role])).toEqual([
      ["crew:lead", role],
      ["crew:backend", undefined],
      ["crew:frontend", undefined],
      ["crew:erik", undefined],
    ]);
  });

  it("wears the working face and the resolver's word while its current stint works", () => {
    const backend = entries().find((entry) => entry.key === "crew:backend");
    expect(backend?.face.state).toBe("working");
    expect(backend?.status).toBe("Working");
  });

  it("is the current entry on any of its stints, a retired one too", () => {
    for (const threadId of ["thread-crew-backend-2", "thread-crew-backend-1"]) {
      expect(
        entries({ currentThreadId: ThreadId.make(threadId) })
          .filter((entry) => entry.current)
          .map((entry) => entry.key),
      ).toEqual(["crew:backend"]);
    }
  });

  it("sleeps every face while the Mate's container is not connected", () => {
    expect(new Set(entries({ connected: false }).map((entry) => entry.face.state))).toEqual(
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
  const entry = (key: string) => stripEntry(key);
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
  const entry = (key: string, threadId: string | null = key) =>
    stripEntry(key, {
      threadId: threadId === null ? null : ThreadId.make(threadId),
      current: true,
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

describe("entryInk", () => {
  it.each<{
    readonly name: string;
    readonly current: boolean;
    readonly state: ConversationStripEntry["face"]["state"];
    readonly ink: "ink" | "muted";
  }>([
    { name: "the conversation on screen", current: true, state: "idle", ink: "ink" },
    { name: "one that needs you", current: false, state: "needs", ink: "ink" },
    { name: "a turn you have not seen", current: false, state: "done", ink: "ink" },
    { name: "one at work: its face says so", current: false, state: "working", ink: "muted" },
    { name: "one at rest", current: false, state: "idle", ink: "muted" },
    { name: "one asleep", current: false, state: "sleep", ink: "muted" },
  ])("names $name in $ink", ({ current, state, ink }) => {
    expect(entryInk(stripEntry("any", { current, face: { tint: "sky", state } }))).toBe(ink);
  });
});

describe("entryAccessibleName", () => {
  it.each<{
    readonly name: string;
    readonly entry: Partial<ConversationStripEntry>;
    readonly spoken: string;
  }>([
    { name: "a name at rest", entry: { label: "Backend" }, spoken: "Backend" },
    {
      name: "a name and what it is doing",
      entry: { label: "Backend", status: "Working" },
      spoken: "Backend, Working",
    },
    {
      name: "the lead's role in place of its name",
      entry: { label: "Ada", role: "Ada, the lead", status: "Input" },
      spoken: "Ada, the lead, Input",
    },
  ])("says $name", ({ entry, spoken }) => {
    expect(entryAccessibleName(stripEntry("any", entry))).toBe(spoken);
  });
});

describe("foldStrip", () => {
  const keys = (groups: ReadonlyArray<ConversationStripGroup>) =>
    groups.map((group) => group.entries.map((each) => each.key));
  /** Every entry 100 wide, 2 between neighbours, 16 more before the crew, New chat 30, More 60. */
  const room = (width: number, widths: Record<string, number> = {}): StripRoom => ({
    width,
    widths: new Map(
      ["main", "logs", "docs", "lead", "backend", "frontend"].map((key) => [
        key,
        widths[key] ?? 100,
      ]),
    ),
    gap: 2,
    groupGap: 16,
    fixed: 30,
    more: 60,
  });
  const chats = (current?: string): ConversationStripGroup => ({
    id: "chats",
    label: "Chats",
    entries: ["main", "logs", "docs"].map((key) => stripEntry(key, { current: key === current })),
  });
  const crew = (current?: string): ConversationStripGroup => ({
    id: "crew",
    label: "Crew",
    entries: ["lead", "backend", "frontend"].map((key) =>
      stripEntry(key, { current: key === current }),
    ),
  });

  it.each<{
    readonly name: string;
    readonly groups: ReadonlyArray<ConversationStripGroup>;
    readonly room: StripRoom | null;
    readonly visible: ReadonlyArray<ReadonlyArray<string>>;
    readonly folded: ReadonlyArray<string>;
  }>([
    {
      name: "folds nothing before the row is measured",
      groups: [chats("main"), crew()],
      room: null,
      visible: [
        ["main", "logs", "docs"],
        ["lead", "backend", "frontend"],
      ],
      folded: [],
    },
    {
      // Six entries, five gaps, the crew's step and New chat: 600 + 10 + 16 + 30.
      name: "folds nothing when every entry fits at its drawn width",
      groups: [chats("main"), crew()],
      room: room(656),
      visible: [
        ["main", "logs", "docs"],
        ["lead", "backend", "frontend"],
      ],
      folded: [],
    },
    {
      // Five entries, four gaps, the step, New chat and More: 500 + 8 + 16 + 30 + 60.
      name: "counts the crew's step: a row a pixel short of everything folds the last",
      groups: [chats("main"), crew()],
      room: room(655),
      visible: [
        ["main", "logs", "docs"],
        ["lead", "backend"],
      ],
      folded: ["frontend"],
    },
    {
      // Four entries, three gaps, the step, New chat and More: 400 + 6 + 16 + 30 + 60.
      name: "leaves room for More itself when the tail folds",
      groups: [chats("main"), crew()],
      room: room(512),
      visible: [["main", "logs", "docs"], ["lead"]],
      folded: ["backend", "frontend"],
    },
    {
      name: "folds by what each entry needs, not by a count: a short name still fits",
      groups: [chats("main"), crew()],
      room: room(512, { lead: 60, backend: 38 }),
      visible: [
        ["main", "logs", "docs"],
        ["lead", "backend"],
      ],
      folded: ["frontend"],
    },
    {
      name: "keeps the entry you are on, folding the one before it instead",
      groups: [chats(), crew("frontend")],
      room: room(512),
      visible: [["main", "logs", "docs"], ["frontend"]],
      folded: ["lead", "backend"],
    },
    {
      name: "keeps the entry you are on alone when nothing else fits beside it",
      groups: [chats(), crew("backend")],
      room: room(120),
      visible: [[], ["backend"]],
      folded: ["main", "logs", "docs", "lead", "frontend"],
    },
    {
      name: "never folds below one entry",
      groups: [chats(), crew()],
      room: room(0),
      visible: [["main"], []],
      folded: ["logs", "docs", "lead", "backend", "frontend"],
    },
  ])("$name", ({ groups, room: measured, visible, folded }) => {
    const fold = foldStrip(groups, measured);
    expect(keys(fold.visible)).toEqual(visible);
    expect(fold.folded.map((entry) => entry.key)).toEqual(folded);
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

describe("replacementChatToPin", () => {
  const pinned = { pinnedAt: "2026-09-05T09:00:00.000Z" };
  const archived = { ...pinned, archivedAt: "2026-09-05T11:00:00.000Z" };
  const sent = ThreadId.make("fresh");
  it.each<{
    readonly name: string;
    readonly threads: ReadonlyArray<EnvironmentThreadShell>;
    readonly pin: string | null;
  }>([
    {
      name: "pins the chat that replaced the main one, whose pin went with the archive",
      threads: [shell("old-main", archived), shell("logs"), shell("fresh")],
      pin: "fresh",
    },
    {
      name: "writes nothing while another chat is main",
      threads: [shell("main", pinned), shell("fresh")],
      pin: null,
    },
    {
      name: "writes nothing for a Mate's only chat, which is main without a pin",
      threads: [shell("old-main", { archivedAt: "2026-09-05T11:00:00.000Z" }), shell("fresh")],
      pin: null,
    },
    {
      name: "counts a crewmate's thread as no chat of the Mate's",
      threads: [
        shell("old-main", archived),
        shell("crew", { crew: { crew: "shop", crewmate: "backend", stint: 1 } }),
      ],
      pin: null,
    },
  ])("$name", ({ threads, pin }) => {
    expect(replacementChatToPin(threads, sent)).toBe(pin);
  });
});
