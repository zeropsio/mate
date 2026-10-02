import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import type { ZeropsAgentActivity } from "./agentActivity";
import {
  activityFromMemory,
  changeFromMemory,
  EMPTY_MENU_MEMORY,
  MENU_MEMORY_STORAGE_KEY,
  menuMemory,
  rememberedChangeOf,
  rememberedChanges,
  rememberedCrewOf,
  rememberedRowOf,
  rememberMenu,
  withChanges,
  withChips,
  withCrews,
  withMembers,
  withoutMate,
  withRows,
  withStructure,
} from "./menuMemory";

const WORKING: ZeropsAgentActivity = {
  threadId: ThreadId.make("thread-nova"),
  kind: "working",
  status: null,
  face: "working",
  subject: "Add a /status page",
  at: "2026-09-27T10:00:00.000Z",
  snippet: "The page reads the build number.",
  unread: true,
  pausedUntil: undefined,
  threadKey: "env-nova:thread-nova",
  task: "Add a /status page",
};

const PULL: FlowPullRequest = {
  repository: "app",
  number: 14,
  title: "Add a /status page",
  kind: "code",
  mateProjectId: "nova",
  url: "https://git.example/app/pulls/14",
  mergeability: "mergeable",
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: "abc123",
  baseBranch: "main",
  line: "app #14",
  updatedAt: "2026-09-27T10:05:00.000Z",
};

describe("a remembered row", () => {
  it("draws the words and the time the row last said, at rest, with nothing only true then", () => {
    expect(activityFromMemory(rememberedRowOf(WORKING))).toEqual({
      threadId: "thread-nova",
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Add a /status page",
      at: "2026-09-27T10:00:00.000Z",
      snippet: "The page reads the build number.",
      unread: true,
      pausedUntil: undefined,
      threadKey: "env-nova:thread-nova",
      task: "Add a /status page",
      remembered: true,
    });
  });

  // A row whose third line stood without words to remember — words still
  // to come, the step it was on, the question it asked, the error it stopped
  // on before saying anything — holds that line from memory, so a reload
  // stands the row at the height it had rather than growing it when the
  // socket answers.
  it.each([
    {
      case: "working, before its first words",
      row: { ...WORKING, snippet: undefined },
      holds: true,
    },
    {
      case: "sent, its run not started",
      row: {
        ...WORKING,
        kind: "idle" as const,
        face: "idle" as const,
        snippet: undefined,
        awaitingWords: true as const,
      },
      holds: true,
    },
    {
      case: "working on a step it relayed",
      row: {
        ...WORKING,
        snippet: undefined,
        liveStep: { words: "Compile the gallery", code: "npm run compile" },
      },
      holds: true,
    },
    {
      case: "stopped on an error before its first words",
      row: {
        ...WORKING,
        kind: "failed" as const,
        face: "needs" as const,
        snippet: undefined,
        errorLine: "The build timed out after 120 s.",
      },
      holds: true,
    },
    {
      case: "asking a question before its first words",
      row: {
        ...WORKING,
        kind: "input" as const,
        face: "needs" as const,
        snippet: undefined,
        question: "Pricing in CZK or EUR?",
      },
      holds: true,
    },
    { case: "with words to remember", row: WORKING, holds: false },
    {
      case: "at rest with no words",
      row: { ...WORKING, kind: "idle" as const, face: "idle" as const, snippet: undefined },
      holds: false,
    },
    {
      case: "never asked anything",
      row: { ...WORKING, subject: undefined, task: undefined, snippet: undefined },
      holds: false,
    },
  ])("holds the third line of a row $case: $holds", ({ row, holds }) => {
    const remembered = activityFromMemory(rememberedRowOf(row));
    if (holds) expect(remembered).toMatchObject({ awaitingWords: true, snippet: undefined });
    else expect(remembered).not.toHaveProperty("awaitingWords");
  });

  it("keeps no word the row did not say", () => {
    const quiet = rememberedRowOf({ ...WORKING, subject: undefined, snippet: undefined });
    expect(quiet).not.toHaveProperty("subject");
    expect(activityFromMemory(quiet).snippet).toBeUndefined();
  });
});

describe("a remembered change", () => {
  it("is its title where it hung, with no verdict until HQ says one again", () => {
    expect(changeFromMemory(rememberedChangeOf(PULL))).toEqual({
      ...PULL,
      mergeability: "checking",
      headSha: undefined,
    });
  });
});

describe("what the memory keeps", () => {
  const row = rememberedRowOf(WORKING);

  it("writes each row and forgets a Mate no longer listed", () => {
    const first = withRows(EMPTY_MENU_MEMORY, { nova: row, kai: row }, new Set(["nova", "kai"]));
    const next = withRows(first, {}, new Set(["nova"]));
    expect(Object.keys(next.rows)).toEqual(["nova"]);
  });

  it("forgets everything of a deleted Mate at once, its row and its crew, and nothing else", () => {
    const crew = rememberedCrewOf([
      { handle: "ada", displayName: "Ada", tint: "violet", lead: true },
    ]);
    const first = withCrews(
      withRows(EMPTY_MENU_MEMORY, { nova: row, kai: row }, new Set(["nova", "kai"])),
      { nova: crew, kai: crew },
    );
    const next = withoutMate(first, "nova");
    expect(Object.keys(next.rows)).toEqual(["kai"]);
    expect(Object.keys(next.crews)).toEqual(["kai"]);
    expect(withoutMate(next, "nova")).toBe(next);
  });

  it("is the same memory when nothing changed, so nothing is written", () => {
    const first = withRows(EMPTY_MENU_MEMORY, { nova: row }, new Set(["nova"]));
    expect(withRows(first, { nova: rememberedRowOf(WORKING) }, new Set(["nova"]))).toBe(first);
    const changes = withChanges(first, { g1: [rememberedChangeOf(PULL)] }, new Set(["g1"]));
    expect(withChanges(changes, { g1: [rememberedChangeOf(PULL)] }, new Set(["g1"]))).toBe(changes);
  });

  it("keeps a member's record and nothing else of what the platform sent", () => {
    const memory = withMembers(EMPTY_MENU_MEMORY, "org-1", [
      {
        id: "cu-jan",
        roleCode: "OWNER",
        user: { id: "u-jan", fullName: "Jan Novák", avatar: null },
        extra: "dropped",
      } as never,
      { nope: true } as never,
    ]);
    expect(memory.members["org-1"]).toEqual([
      {
        id: "cu-jan",
        roleCode: "OWNER",
        user: { id: "u-jan", fullName: "Jan Novák", avatar: null },
      },
    ]);
  });
});

describe("a remembered HQ structure", () => {
  const STRUCTURE = {
    ungrouped: [{ projectId: "p9", name: "scratch", mate: { name: "Ada", face: "sky:flower" } }],
    apps: [
      {
        id: "app-1",
        name: "Acme CRM",
        projects: [
          {
            projectId: "p-vera",
            name: "Acme CRM - Vera",
            kind: "mate",
            mate: { name: "Vera", face: "rose:seal" },
          },
        ],
      },
    ],
  };

  it("keeps an organization's structure with when HQ answered it, and is the same memory for the same one", () => {
    const memory = withStructure(EMPTY_MENU_MEMORY, "org-1", STRUCTURE, 1_000);
    expect(memory.structures["org-1"]).toEqual({
      readAt: 1_000,
      ungrouped: STRUCTURE.ungrouped,
      apps: STRUCTURE.apps,
    });
    expect(
      withStructure(
        memory,
        "org-1",
        { ungrouped: [...STRUCTURE.ungrouped], apps: [...STRUCTURE.apps] },
        1_000,
      ),
    ).toBe(memory);
  });
});

describe("a project's remembered chips", () => {
  const OK = { label: "prod", state: "ok", version: "v0.1.0" } as const;
  const WAITING = { label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 } as const;
  const STAGE = { label: "stage", state: "failed", version: "main" } as const;
  const STAGES = {
    label: "stage",
    state: "down",
    stages: [
      { name: "stage", state: "ok" },
      { name: "qa", state: "down" },
    ],
  } as const;

  it("keeps each project's chips as last drawn, and forgets one that is no more", () => {
    const first = withChips(
      EMPTY_MENU_MEMORY,
      { g1: { prod: OK, stage: STAGE }, g2: { prod: WAITING } },
      new Set(["g1", "g2"]),
    );
    expect(first.chips).toEqual({ g1: { prod: OK, stage: STAGE }, g2: { prod: WAITING } });
    // Read again: g1's stage is gone; g2's production is unread, so kept.
    const next = withChips(first, { g1: { stage: null }, g2: {} }, new Set(["g1", "g2"]));
    expect(next.chips).toEqual({ g1: { prod: OK }, g2: { prod: WAITING } });
    // A project that has neither any more keeps nothing.
    expect(withChips(next, { g1: { prod: null } }).chips).toEqual({ g2: { prod: WAITING } });
    // A project no longer listed takes its chips with it.
    expect(withChips(next, {}, new Set(["g2"])).chips).toEqual({ g2: { prod: WAITING } });
  });

  it("keeps a chip over several stages with each of them", () => {
    expect(withChips(EMPTY_MENU_MEMORY, { g1: { stage: STAGES } }).chips).toEqual({
      g1: { stage: STAGES },
    });
  });

  it("is the same memory when no chip changed, so nothing is written", () => {
    const first = withChips(EMPTY_MENU_MEMORY, { g1: { prod: OK } }, new Set(["g1"]));
    expect(withChips(first, { g1: { prod: { ...OK } } }, new Set(["g1"]))).toBe(first);
    expect(withChips(first, { g1: {} })).toBe(first);
    expect(withChips(first, {})).toBe(first);
  });
});

describe("a remembered crew", () => {
  const FACES = [
    {
      handle: "ada",
      displayName: "Ada",
      tint: "violet",
      lead: true,
      state: "working",
      threadId: ThreadId.make("thread-ada"),
    },
    { handle: "bo", displayName: "Bo", tint: "sky", lead: false, state: "needs", threadId: null },
  ] as const;

  it("keeps its faces, lead first, at rest: no state, no chat, no fact", () => {
    expect(rememberedCrewOf(FACES)).toEqual({
      faces: [
        { handle: "ada", displayName: "Ada", tint: "violet", lead: true },
        { handle: "bo", displayName: "Bo", tint: "sky", lead: false },
      ],
    });
  });

  it("keeps each Mate's crew as last read, forgets one that is gone, and a Mate no longer listed", () => {
    const crew = rememberedCrewOf(FACES);
    const first = withCrews(EMPTY_MENU_MEMORY, { nova: crew, kai: crew });
    expect(Object.keys(first.crews)).toEqual(["nova", "kai"]);
    // Read again: Kai's crew was taken off.
    expect(Object.keys(withCrews(first, { kai: null }).crews)).toEqual(["nova"]);
    // The listing no longer holds Nova.
    expect(Object.keys(withCrews(first, {}, new Set(["kai"])).crews)).toEqual(["kai"]);
    expect(withCrews(first, { nova: rememberedCrewOf(FACES) })).toBe(first);
  });
});

describe("the memory in this browser", () => {
  const stored = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    stored.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
  });

  afterEach(() => {
    closeAccountLifetime();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is written per account once the menu settles, read back, and gone when the account closes", () => {
    openAccountLifetime("user-ales");
    rememberMenu((memory) =>
      withRows(memory, { nova: rememberedRowOf(WORKING) }, new Set(["nova"])),
    );
    expect(stored.size).toBe(0);
    vi.advanceTimersByTime(400);
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    expect(JSON.parse(stored.get(key) ?? "{}").rows.nova.subject).toBe("Add a /status page");

    closeAccountLifetime();
    expect(stored.has(key)).toBe(false);
    openAccountLifetime("user-ales");
    expect(menuMemory()).toEqual(EMPTY_MENU_MEMORY);
  });

  it("reads a memory written before HQ structures were kept, with none", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    stored.set(key, JSON.stringify({ rows: {}, changes: {}, chips: {}, crews: {}, members: {} }));
    openAccountLifetime("user-ales");
    expect(menuMemory().structures).toEqual({});
  });

  it("reads a structure remembered before the Mates in no application, with none of them", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    const structures = { "org-1": { readAt: 1_000, apps: [] } };
    stored.set(key, JSON.stringify({ rows: {}, changes: {}, members: {}, structures }));
    openAccountLifetime("user-ales");
    expect(menuMemory().structures["org-1"]).toEqual({ readAt: 1_000, ungrouped: [], apps: [] });
  });

  // A reload after an upgrade paints what the last version drew: a memory
  // from before the production chip (with each stop's line, no chips) keeps
  // its rows, changes and members, and simply has no chip yet.
  it("reads a memory written before the production chip, keeping all it held", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    stored.set(
      key,
      JSON.stringify({
        rows: { nova: rememberedRowOf(WORKING) },
        changes: { g1: [rememberedChangeOf(PULL)] },
        stops: { "prod-1": "v1.4.0" },
        members: { "org-1": [{ id: "cu-jan", roleCode: "OWNER" }] },
      }),
    );
    openAccountLifetime("user-ales");
    const memory = menuMemory();
    expect(Object.keys(memory.rows)).toEqual(["nova"]);
    expect(memory.changes.g1).toHaveLength(1);
    expect(memory.members["org-1"]).toEqual([{ id: "cu-jan", roleCode: "OWNER" }]);
    expect(memory.chips).toEqual({});
  });

  // A memory written while a project wore one chip keeps all else it held,
  // and has no chip yet: one reload draws them once they are read.
  it("reads a memory written with one chip per project, keeping all else it held", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    stored.set(
      key,
      JSON.stringify({
        ...EMPTY_MENU_MEMORY,
        rows: { nova: rememberedRowOf(WORKING) },
        chips: { g1: { label: "prod", state: "ok", version: "v1.4.0" } },
      }),
    );
    openAccountLifetime("user-ales");
    const memory = menuMemory();
    expect(Object.keys(memory.rows)).toEqual(["nova"]);
    expect(memory.chips).toEqual({ g1: {} });
  });

  // A memory written before crews were kept reads with none, rather than
  // being forgotten whole for want of them.
  it("reads a memory from before crews were kept, crews and all none", () => {
    openAccountLifetime("user-ada");
    const key = `mate:account:user-ada:${MENU_MEMORY_STORAGE_KEY}`;
    const before: Record<string, unknown> = {
      ...EMPTY_MENU_MEMORY,
      rows: { nova: rememberedRowOf(WORKING) },
    };
    delete before.crews;
    stored.set(key, JSON.stringify(before));
    closeAccountLifetime();
    stored.set(key, JSON.stringify(before));
    openAccountLifetime("user-ada");
    expect(menuMemory().crews).toEqual({});
    expect(menuMemory().rows.nova?.subject).toBe("Add a /status page");
  });

  // Only Mates open changes (SPEC §5.4): the author a change was once remembered with is not
  // kept, and the change is.
  it("reads a change remembered with its author, keeping the change and not the author", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    stored.set(
      key,
      JSON.stringify({
        ...EMPTY_MENU_MEMORY,
        changes: { g1: [{ ...rememberedChangeOf(PULL), author: "nova-bot" }] },
      }),
    );
    openAccountLifetime("user-ales");
    expect(menuMemory().changes.g1).toEqual([rememberedChangeOf(PULL)]);
  });

  // Only Mates open changes (SPEC §5.4): a change remembered with no Mate — a person's own branch,
  // from before — reads, and is drawn nowhere; the rest of what was remembered still is.
  it("reads a change remembered without its Mate, and draws it nowhere", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    const { mateProjectId: _mate, ...personal } = { ...rememberedChangeOf(PULL), number: 15 };
    stored.set(
      key,
      JSON.stringify({
        ...EMPTY_MENU_MEMORY,
        changes: { g1: [personal, rememberedChangeOf(PULL)] },
      }),
    );
    openAccountLifetime("user-ales");
    expect(rememberedChanges("g1")?.map((pull) => pull.number)).toEqual([14]);
  });

  it("reads nothing another account remembered", () => {
    openAccountLifetime("user-ales");
    rememberMenu((memory) =>
      withRows(memory, { nova: rememberedRowOf(WORKING) }, new Set(["nova"])),
    );
    vi.advanceTimersByTime(400);
    openAccountLifetime("user-jan");
    expect(menuMemory().rows).toEqual({});
  });
});
