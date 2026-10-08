import { lastKnownMateWords } from "./lastKnownMate.logic";
import { mateRowView } from "../components/zerops/SidebarMateRow.logic";
import { mateStatus } from "./mateStatus.logic";
import type { MateAttentionRead } from "@t3tools/client-runtime/data";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type MateAttention,
} from "@t3tools/contracts";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import { matesActivityOf, seenResultsOf, type MatesActivityInput } from "./mateActivity";

const ASKED = "2026-10-03T09:00:00.000Z";
const DONE = "2026-10-03T09:05:00.000Z";

/** Vera, online, her main chat done answering what she was asked. */
const VERA = Schema.decodeUnknownSync(MateLiveView)({
  presence: { online: true, since: ASKED, overview: "live" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: {
    id: "t1",
    title: "Add a login page",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: { status: "ready", lastError: null },
    latestTurn: {
      turnId: "turn-1",
      state: "completed",
      requestedAt: ASKED,
      startedAt: ASKED,
      completedAt: DONE,
    },
    latestUserMessageAt: ASKED,
    updatedAt: DONE,
    latestUserMessagePreview: { text: "Add a login page" },
    latestMessagePreview: { role: "assistant", text: "The login page is up at /login." },
    planProgress: null,
    pendingQuestion: null,
    usagePause: null,
    liveStep: null,
  },
  threads: { list: [], omitted: 0 },
  logins: {},
  crew: { status: "off" },
});

/** Vera's main chat as her socket read it: at work. */
const WORKING: EnvironmentThreadShell = {
  id: ThreadId.make("t1"),
  environmentId: EnvironmentId.make("env-vera"),
  projectId: ProjectId.make("project-1"),
  title: "Add a login page",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: ASKED,
    startedAt: ASKED,
    completedAt: null,
    assistantMessageId: null,
  },
  createdAt: ASKED,
  updatedAt: ASKED,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: ASKED,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const VERA_ENV = EnvironmentId.make("env-vera");

const said = (over: Partial<MateAttention> = {}): MateAttention =>
  ({
    source: { environmentId: "env-vera", epoch: 1, incarnation: "m1", revision: 4 },
    mainThreadId: "t1",
    lastThreadId: "t1",
    working: 0,
    waiting: 0,
    results: [],
    questions: [],
    truncated: false,
    ...over,
  }) as MateAttention;

const read = (input: Partial<MatesActivityInput>) =>
  matesActivityOf({
    projectIds: ["p-vera"],
    attention: {},
    overviews: new Map([["p-vera", VERA]]),
    hqCurrent: true,
    threads: [],
    sockets: new Map(),
    standing: new Set(),
    lastVisitedAtById: {},
    ...input,
  }).get("p-vera");

const attention = (value: MateAttention, live = true, unseen: number | null = null) => ({
  "p-vera": { attention: value, live, unseen } satisfies MateAttentionRead,
});

describe("matesActivityOf — a Mate that publishes its attention", () => {
  it.each([
    {
      name: "at work: its chat's words, the attention's kind",
      attention: attention(said({ working: 1 })),
      expected: { threadId: "t1", kind: "working", face: "working", subject: "Add a login page" },
    },
    {
      name: "waiting on an answer from its person",
      attention: attention(
        said({ waiting: 1, questions: [{ threadId: "t1", kind: "input", turnId: null }] as never }),
      ),
      expected: { kind: "input", face: "needs" },
    },
    {
      name: "stopped on an error",
      attention: attention(
        said({
          waiting: 1,
          questions: [{ threadId: "t1", kind: "failed", turnId: null }] as never,
        }),
      ),
      expected: { kind: "failed", face: "needs" },
    },
    {
      name: "a result HQ counts the person has not seen",
      attention: attention(said(), true, 1),
      expected: { kind: "done", face: "done", unread: true },
    },
    {
      name: "every result seen, whatever this device last visited",
      attention: attention(said(), true, 0),
      expected: { kind: "idle", face: "idle", unread: false },
    },
    {
      name: "HQ not saying what was seen: this device's visit",
      attention: attention(said(), true, null),
      expected: { kind: "done", unread: true },
    },
    {
      name: "a word not of now rests",
      attention: attention(said({ working: 1 }), false),
      expected: { kind: "idle", face: "idle", remembered: true, subject: "Add a login page" },
    },
  ])("$name", ({ attention, expected }) => {
    expect(read({ attention, lastVisitedAtById: { "env-vera:t1": ASKED } })).toMatchObject(
      expected,
    );
  });

  it("reads the words of the chat the attention names off its shell where this page holds it", () => {
    const shell = { ...WORKING, title: "Fix the build" };
    const activity = read({
      attention: attention(said({ working: 1 })),
      threads: [shell],
      overviews: new Map([["p-vera", VERA]]),
    });
    expect(activity).toMatchObject({ threadId: "t1", kind: "working", subject: "Fix the build" });
    expect(activity?.remembered).toBeUndefined();
  });

  it.each([
    { name: "at work", says: { working: 1 }, kind: "working" },
    {
      name: "waiting on its person",
      says: {
        waiting: 1,
        questions: [{ threadId: "t9", kind: "approval", turnId: null }],
      },
      kind: "approval",
    },
    { name: "at rest", says: {}, kind: "idle" },
  ])(
    "reads a new chat HQ's overview does not name yet off the attention, wordless: $name",
    ({ says, kind }) => {
      const activity = read({
        attention: attention(said({ mainThreadId: "t9" as never, ...(says as object) })),
      });
      expect(activity).toMatchObject({ threadId: "t9", kind, at: DONE });
      expect(activity?.subject).toBeUndefined();
      expect(activity?.snippet).toBeUndefined();
    },
  );

  it("says nothing of a chat no words of which are held, nor HQ's overview of any", () => {
    expect(
      read({ attention: attention(said({ working: 1 })), overviews: new Map() }),
    ).toBeUndefined();
  });

  it("never lets HQ's overview at rest or a socket's standing decide a published word", () => {
    const stored = {
      ...VERA,
      presence: { ...VERA.presence, online: false, overview: "stored" as const },
    };
    expect(
      read({
        attention: attention(said({ working: 1 })),
        overviews: new Map([["p-vera", stored]]),
        hqCurrent: false,
        standing: new Set(),
      }),
    ).toMatchObject({ kind: "working" });
  });
});

describe("matesActivityOf — a Mate from before the attention value", () => {
  it("reads its HQ overview with this device's visit", () => {
    const visited = (visitedAt: string) =>
      read({ lastVisitedAtById: { "env-vera:t1": visitedAt } });
    expect(visited(ASKED)).toMatchObject({
      threadId: "t1",
      threadKey: "env-vera:t1",
      kind: "done",
      face: "done",
      subject: "Add a login page",
      snippet: "The login page is up at /login.",
      at: DONE,
      unread: true,
    });
    expect(visited(ASKED)?.remembered).toBeUndefined();
    expect(visited("2026-10-03T09:10:00.000Z")).toMatchObject({ kind: "idle", unread: false });
  });

  const socket = (standing: boolean, hq: MatesActivityInput["overviews"], hqCurrent = true) =>
    read({
      overviews: hq,
      hqCurrent,
      threads: [WORKING],
      sockets: new Map([["p-vera", VERA_ENV]]),
      standing: new Set(standing ? [VERA_ENV] : []),
    });

  it("stands while its socket does, and rests once it no longer does", () => {
    expect(socket(true, null)).toMatchObject({ kind: "working" });
    expect(socket(true, null)?.remembered).toBeUndefined();
    expect(socket(false, null)).toMatchObject({ kind: "idle", remembered: true });
  });

  it("gives way to HQ's live word, and holds over HQ's word at rest", () => {
    const stored = {
      ...VERA,
      presence: { ...VERA.presence, online: false, overview: "stored" as const },
    };
    expect(socket(false, new Map([["p-vera", VERA]]))).toMatchObject({
      kind: "idle",
      subject: "Add a login page",
    });
    expect(socket(false, new Map([["p-vera", VERA]]))?.remembered).toBeUndefined();
    expect(socket(true, new Map([["p-vera", stored]]))).toMatchObject({ kind: "working" });
  });
});

describe("matesActivityOf — what a Mate's row keeps between reads", () => {
  const IDA_ENV = EnvironmentId.make("env-ida");
  const IDA = { ...VERA, identity: { ...VERA.identity!, environmentId: IDA_ENV } };
  const twoMates = (threads: ReadonlyArray<EnvironmentThreadShell>): MatesActivityInput => ({
    projectIds: ["p-ida", "p-vera"],
    attention: attention(said({ working: 1 })),
    overviews: new Map([
      ["p-vera", VERA],
      ["p-ida", IDA],
    ]),
    hqCurrent: true,
    threads,
    sockets: new Map(),
    standing: new Set(),
    lastVisitedAtById: {},
  });
  const first = matesActivityOf(twoMates([WORKING]));

  it("gives back the whole reading when no Mate's inputs changed what it says", () => {
    // A streaming chat's shell moves its `updatedAt` on every event.
    const next = matesActivityOf(twoMates([{ ...WORKING, updatedAt: DONE }]), first);
    expect(next).toBe(first);
  });

  it.each<[string, Partial<EnvironmentThreadShell>]>([
    ["subject", { title: "Fix the build" }],
    [
      "its last words",
      {
        latestMessagePreview: { role: "assistant", text: "Built.", createdAt: DONE },
        latestUserMessagePreview: null,
      },
    ],
    ["step", { liveStep: { kind: "thinking", since: ASKED } }],
  ])("gives only the Mate whose %s changed a new entry", (_, change) => {
    const next = matesActivityOf(twoMates([{ ...WORKING, ...change }]), first);
    expect(next).not.toBe(first);
    expect(next.get("p-ida")).toBe(first.get("p-ida"));
    expect(next.get("p-vera")).not.toBe(first.get("p-vera"));
    expect(next.get("p-vera")).toEqual(
      matesActivityOf(twoMates([{ ...WORKING, ...change }])).get("p-vera"),
    );
  });

  it("drops a Mate that is no longer read", () => {
    const next = matesActivityOf({ ...twoMates([WORKING]), projectIds: ["p-vera"] }, first);
    expect([...next.keys()]).toEqual(["p-vera"]);
    expect(next.get("p-vera")).toBe(first.get("p-vera"));
  });
});

describe("seenResultsOf — what the person saw of a Mate's results", () => {
  const results = [
    { threadId: "t1", turnId: "turn-2", completedAt: DONE },
    { threadId: "t2", turnId: "turn-9", completedAt: DONE },
  ] as never;
  it.each([
    {
      name: "a chat visited since its turn ended",
      visits: { "env-vera:t1": "2026-10-03T09:06:00.000Z" },
      seen: ["turn-2"],
    },
    { name: "a chat visited before its turn ended", visits: { "env-vera:t1": ASKED }, seen: [] },
    { name: "a chat never visited", visits: {}, seen: [] },
  ])("$name", ({ visits, seen }) => {
    expect(seenResultsOf(said({ results }), visits)).toEqual(seen);
  });
});

describe("HQ evidence becomes current or last-known Mate words", () => {
  it.each(["Claude", "Codex"])(
    "keeps %s's limit and source time during an outage without a current marker",
    (provider) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(ASKED));
      const main = VERA.main!;
      const overview = {
        ...VERA,
        main: {
          ...main,
          updatedAt: ASKED,
          session: { status: "error" as const, lastError: `${provider} usage limit reached.` },
          latestTurn: { ...main.latestTurn!, state: "error" as const },
          usagePause: { resetsAt: DONE },
        },
      };
      const held = read({
        attention: attention(
          said({
            questions: [
              { threadId: ThreadId.make("t1"), turnId: TurnId.make("turn-1"), kind: "failed" },
            ],
          }),
          false,
        ),
        overviews: new Map([["p-vera", overview]]),
      });
      expect(held?.lastKnown?.at).toBe(ASKED);
      expect(lastKnownMateWords(held, "Skákala")).toContain(`Skákala hit the ${provider} limit`);
      expect(lastKnownMateWords(held, "Skákala")).toContain("Last known");
      expect(lastKnownMateWords(held, "Skákala")).toContain("; reset ");
      expect(mateStatus(held)).toBeNull();
      expect(mateRowView(held, "sleep", "Skákala").reply).toMatchObject({
        kind: "words",
        text: expect.stringContaining("Last known"),
      });
      const live = read({
        attention: attention(
          said({
            questions: [
              { threadId: ThreadId.make("t1"), turnId: TurnId.make("turn-1"), kind: "failed" },
            ],
          }),
        ),
        overviews: new Map([["p-vera", overview]]),
      });
      expect(mateStatus(live)).toMatchObject({
        kind: "limit",
        severity: "attention",
        provider,
        until: DONE,
      });
      expect(lastKnownMateWords(live, "Skákala")).toBeUndefined();
      vi.useRealTimers();
    },
  );
  it("keeps a reset-free streaming Claude refusal visible while the provider's turn stays active", () => {
    const overview = {
      ...VERA,
      main: {
        ...VERA.main!,
        session: { status: "running" as const, lastError: "Claude usage limit reached." },
        latestTurn: { ...VERA.main!.latestTurn!, state: "running" as const, completedAt: null },
      },
    };
    const live = read({
      attention: attention(said({ working: 1 })),
      overviews: new Map([["p-vera", overview]]),
    });
    expect(mateStatus(live)).toMatchObject({
      kind: "limit",
      severity: "attention",
      provider: "Claude",
      until: undefined,
    });
    expect(mateRowView(live, "sleep", "Skákala").reply).toMatchObject({
      text: "Skákala hit the Claude limit.",
    });
  });
  it("has no last-known claim where HQ holds no main state", () => {
    expect(
      lastKnownMateWords(
        read({ overviews: new Map([["p-vera", { ...VERA, main: null }]]) }),
        "Skákala",
      ),
    ).toBeUndefined();
  });
});

describe("an expired refusal from HQ", () => {
  it("a retained attention record cannot turn an expired refusal into a current menu failure", () => {
    const main = VERA.main!;
    const overview = {
      ...VERA,
      main: {
        ...main,
        session: { status: "stopped" as const, lastError: "Claude usage limit reached." },
        latestTurn: { ...main.latestTurn!, state: "error" as const },
        usagePause: { resetsAt: "2020-01-01T00:00:00Z" },
      },
    };
    const activity = read({
      attention: attention(
        said({
          questions: [
            { threadId: ThreadId.make("t1"), turnId: TurnId.make("turn-1"), kind: "failed" },
          ],
        }),
      ),
      overviews: new Map([["p-vera", overview]]),
    });
    expect(activity?.usageLimited).toBe(false);
    expect(activity?.kind).toBe("idle");
    expect(mateStatus(activity)).toBeNull();
  });
});
