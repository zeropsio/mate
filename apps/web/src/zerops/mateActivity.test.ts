import { lastKnownMateWords } from "./lastKnownMate.logic";
import { mateRowView } from "../components/zerops/SidebarMateRow.logic";
import { mateStatus } from "./mateStatus.logic";
import type { MateAttentionRead } from "@t3tools/client-runtime/data";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  ConversationRow,
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

import type { ZeropsAgentActivity } from "./agentActivity";
import {
  matesActivityOf,
  seenResultsOf,
  socketStands,
  type MatesActivityInput,
} from "./mateActivity";

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

  // The owner, 2026-10-15: "unread is not highlighted at all". One rule wherever a Mate is drawn:
  // its main chat's latest result — finished or failed — newer than what this person has seen.
  // HQ counts what the person saw on any device; this device's visit is ahead of HQ where it
  // proves the result seen, and the only word on a failure, which HQ does not count.
  const FAILED: Partial<MateAttention> = {
    waiting: 1,
    questions: [{ threadId: ThreadId.make("t1"), kind: "failed", turnId: null }],
  };
  const FAILED_MAIN = {
    ...VERA,
    main: {
      ...VERA.main!,
      session: { status: "error" as const, lastError: "The build broke" },
      latestTurn: { ...VERA.main!.latestTurn!, state: "error" as const },
    },
  };
  const BEFORE = ASKED;
  const AFTER = "2026-10-03T09:06:00.000Z";
  const MARKED = new Date(Date.parse(DONE) - 1).toISOString();
  it.each([
    { name: "HQ counts it unseen, never opened here", unseen: 1, visit: undefined, unread: true },
    {
      name: "HQ says it was seen on another device, never opened here",
      unseen: 0,
      visit: undefined,
      unread: false,
    },
    {
      name: "opened here after it ended, before HQ hears so",
      unseen: 1,
      visit: AFTER,
      unread: false,
    },
    { name: "HQ silent, opened here before it ended", unseen: null, visit: BEFORE, unread: true },
    { name: "HQ silent, never opened here", unseen: null, visit: undefined, unread: false },
    { name: "marked unread here, HQ counting it seen", unseen: 0, visit: MARKED, unread: true },
    {
      name: "a failed run, opened here before it failed",
      says: FAILED,
      overview: FAILED_MAIN,
      unseen: 0,
      visit: BEFORE,
      unread: true,
    },
    {
      name: "a failed run, opened here since",
      says: FAILED,
      overview: FAILED_MAIN,
      unseen: 0,
      visit: AFTER,
      unread: false,
    },
    {
      name: "at work, HQ counting an earlier result unseen",
      says: { working: 1 },
      overview: { ...VERA, main: { ...VERA.main!, latestTurn: { ...WORKING.latestTurn! } } },
      unseen: 1,
      visit: undefined,
      unread: false,
    },
  ])(
    "A Mate is unread while its latest result is newer than what this person has seen: $name",
    ({ says, overview, unseen, visit, unread }) => {
      const activity = read({
        attention: attention(said(says), true, unseen),
        overviews: new Map([["p-vera", overview ?? VERA]]),
        lastVisitedAtById: visit === undefined ? {} : { "env-vera:t1": visit },
      });
      expect(activity?.unread).toBe(unread);
    },
  );

  it("A Mate's engine row unread follows the same rule: a failed run not seen yet", () => {
    const failedRow = engineRow("t1", {
      state: { kind: "failed", errorLine: "The build broke" },
      latestRun: { id: "run-1", end: { kind: "crashed", reason: "x" }, endedAt: Date.parse(DONE) },
    });
    const of = (visit: string, unseen: number) =>
      read({
        attention: attention(said(FAILED), true, unseen),
        overviews: onEngine(failedRow),
        lastVisitedAtById: { "env-vera:t1": visit },
      })?.unread;
    expect([of(BEFORE, 0), of(AFTER, 0)]).toEqual([true, false]);
  });

  it("reads the words of the chat the attention names off its shell where this page holds it", () => {
    const shell = { ...WORKING, title: "Fix the build" };
    const activity = read({
      attention: attention(said({ working: 1 })),
      threads: [shell],
      overviews: new Map([["p-vera", VERA]]),
      // Its socket stands: the shell this page holds is current.
      sockets: new Map([["p-vera", VERA_ENV]]),
      standing: new Set([VERA_ENV]),
    });
    expect(activity).toMatchObject({ threadId: "t1", kind: "working", subject: "Fix the build" });
    expect(activity?.remembered).toBeUndefined();
  });

  // The owner, 2026-10-27: a row read "Thinking" for the 16 minutes and 49 steps its Mate worked.
  // This page follows a Mate's conversations only while it is open: the shell it held from then
  // stops where the run was when the person left.
  it("reads HQ's live word of the chat over a shell this page no longer follows: its steps go on", () => {
    const left = { ...WORKING, liveStep: { kind: "thinking" as const, since: ASKED } };
    const onIt = Schema.decodeUnknownSync(MateLiveView)({
      ...Schema.encodeSync(MateLiveView)(VERA),
      main: {
        ...Schema.encodeSync(MateLiveView)(VERA).main,
        session: { status: "running", lastError: null },
        latestTurn: {
          turnId: "turn-1",
          state: "running",
          requestedAt: ASKED,
          startedAt: ASKED,
          completedAt: null,
        },
        liveStep: {
          kind: "calls",
          since: ASKED,
          calls: [
            {
              id: "call-build",
              activityKind: "tool.updated",
              itemType: "command_execution",
              title: "Command run",
              detail: "Bash: pnpm build",
              toolName: "Bash",
              command: "pnpm build",
              input: { description: "Build the app" },
              startedAt: ASKED,
            },
          ],
        },
      },
    });
    const activity = read({
      attention: attention(said({ working: 1 })),
      threads: [left],
      overviews: new Map([["p-vera", onIt]]),
      standing: new Set(),
    });
    expect(activity).toMatchObject({ kind: "working", liveStep: { words: "Build the app" } });
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

  it("A new chat HQ's overview does not name yet is dated by its own result, not HQ's last word of another", () => {
    const ended = "2026-10-03T08:00:00.000Z";
    const activity = read({
      attention: attention(
        said({
          mainThreadId: "t9" as never,
          results: [{ threadId: "t9", turnId: "turn-9", completedAt: ended }] as never,
        }),
        true,
        1,
      ),
    });
    expect(activity).toMatchObject({ threadId: "t9", at: ended, unread: true });
  });

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

const decodeRow = Schema.decodeUnknownSync(ConversationRow);
/** Vera on the engine: HQ relays her own rows beside her main chat's shell fields. */
const engineRow = (id: string, patch: Record<string, unknown>) =>
  decodeRow({
    conversationId: id,
    agent: { instanceId: "codex", driver: "codex", model: null, profile: { kind: "mate" } },
    revision: { environmentId: "env-vera", epoch: 1, seq: 9 },
    state: { kind: "idle" },
    activeRunId: null,
    latestRun: null,
    subject: "Ship the release",
    snippet: null,
    at: Date.parse(DONE),
    askedAt: null,
    ...patch,
  });
const onEngine = (...rows: ReadonlyArray<ConversationRow>) =>
  new Map([["p-vera", { ...VERA, conversations: rows }]]);

describe("matesActivityOf — an engine Mate whose rows HQ relays", () => {
  it.each([true, false])(
    "Decision: last-known content stays until replaced by newer content; no placeholder flashes (attention: %s)",
    (withAttention) => {
      const run = engineRow("t1", {
        state: { kind: "working", since: Date.parse(ASKED), waitsOnHelpers: false },
        subject: "Add a login page",
      });
      const main = {
        ...VERA.main!,
        session: { status: "running" as const, lastError: null },
        latestTurn: { ...WORKING.latestTurn!, completedAt: null },
        liveStep: { kind: "thinking" as const, since: ASKED },
      };
      for (const [conversations, liveStep, expected] of [
        [undefined, main.liveStep, "Thinking"],
        [[run], main.liveStep, "Thinking"],
        [[{ ...run, revision: { ...run.revision, seq: 10 } }], main.liveStep, "Thinking"],
        [[run], { kind: "writing" as const, since: DONE }, "Writing"],
      ] as const) {
        const activity = read({
          attention: withAttention ? attention(said({ working: 1 })) : {},
          overviews: new Map([
            [
              "p-vera",
              {
                ...VERA,
                main: { ...main, liveStep },
                ...(conversations === undefined ? {} : { conversations }),
              },
            ],
          ]),
        });
        expect(mateRowView(activity, "working")).toMatchObject({
          state: "working",
          ask: "Add a login page",
          slot: { kind: "clock", since: ASKED },
          reply: { kind: "live", words: expected },
        });
      }
    },
  );

  it.each([
    { id: "t1", state: { kind: "idle" }, working: 0 },
    {
      id: "other-chat",
      state: { kind: "working", since: Date.parse(ASKED), waitsOnHelpers: false },
      working: 1,
    },
  ])(
    "keeps the main chat's live step out of a finished or different conversation ($id)",
    ({ id, state, working }) => {
      const activity = read({
        attention: attention(said({ mainThreadId: ThreadId.make(id), working })),
        overviews: new Map([
          [
            "p-vera",
            {
              ...VERA,
              main: { ...VERA.main!, liveStep: { kind: "thinking", since: ASKED } },
              conversations: [engineRow(id, { state })],
            },
          ],
        ]),
      });
      expect(activity?.liveStep).toBeUndefined();
    },
  );

  // Milo restarted mid-run, a helper and its job still running: the reconnect notice read "Last
  // known 10:23 AM: Milo had no active work". HQ's attention counts runs, not background work.
  it.each([
    {
      name: "waits on its helpers",
      waitsOnHelpers: true,
      words: "Milo was waiting for its helpers.",
    },
    { name: "rests", waitsOnHelpers: false, words: "Milo had no active work." },
  ])(
    "the last-known line says what background work the row knows of when HQ's word goes stale (its row $name)",
    ({ waitsOnHelpers, words }) => {
      const held = read({
        attention: attention(said({ mainThreadId: ThreadId.make("t1"), working: 0 }), false),
        overviews: onEngine(
          engineRow("t1", {
            state: waitsOnHelpers
              ? { kind: "working", since: Date.parse(ASKED), waitsOnHelpers: true }
              : { kind: "idle" },
          }),
        ),
      });
      expect(lastKnownMateWords(held, "Milo")).toContain(`: ${words}`);
    },
  );

  // Recheck at a restart cut (2026-10-12): the face flashed idle for ~150 ms as the cut run's
  // continuation queued: the row said so before HQ's count of the runs at work did.
  it.each([
    {
      name: "a queued run, a restart's continuation",
      state: { kind: "queued", since: Date.parse(ASKED) },
      face: "working",
    },
    {
      name: "a run at work",
      state: { kind: "working", since: Date.parse(ASKED), waitsOnHelpers: false },
      face: "working",
    },
    { name: "nothing", state: { kind: "idle" }, face: "idle" },
  ])(
    "an engine Mate's face works while its own row says it does, before HQ's count of it: $name",
    ({ state, face }) => {
      const activity = read({
        attention: attention(said({ mainThreadId: ThreadId.make("t1"), working: 0 })),
        overviews: onEngine(engineRow("t1", { state })),
      });
      expect(activity?.face).toBe(face);
    },
  );

  // Pass 41: the menu's row has one line under the name, and while HQ's word is stale that line
  // is this one — it keeps what the Mate was on.
  it.each([
    { task: "Inspect checkout", words: "Ada was working on: Inspect checkout" },
    { task: undefined, words: "Ada was working." },
  ])("the last-known line of a working Mate says what it was on: $words", ({ task, words }) => {
    const held = {
      lastKnown: { kind: "working", at: ASKED },
      ...(task === undefined ? {} : { task }),
    } as unknown as Parameters<typeof lastKnownMateWords>[0];
    expect(lastKnownMateWords(held, "Ada")).toContain(`: ${words}`);
  });

  // Run 4 (B +1:02): the reconnect notice quoted the last message raw, a table's pipes included.
  it("the last-known line quotes the row's last words as plain words on one line", () => {
    const held = read({
      attention: attention(said({ mainThreadId: ThreadId.make("t1"), working: 0 }), false),
      overviews: onEngine(
        engineRow("t1", {
          snippet: `## Deploys\n\n| Service | State |\n|---|---|\n| api | **up** |\n${"| web | down |\n".repeat(30)}`,
        }),
      ),
    });
    const words = lastKnownMateWords(held, "Milo")!;
    expect(words).toContain("Milo had no active work. Deploys Service State api up web down");
    expect(words).not.toMatch(/[|#*\n]/u);
    expect(words).toMatch(/…$/u);
  });

  it('"Last known <time>" on an unreachable Mate shows when HQ last observed that activity (the engine row\'s update time), never when the activity started; a running duration keeps the run-start clock.', () => {
    const started = new Date(2026, 9, 28, 22, 35, 43).getTime();
    const observed = new Date(2026, 9, 28, 23, 4, 10).getTime();
    const overviews = onEngine(
      engineRow("t1", {
        state: { kind: "working", since: started, waitsOnHelpers: false },
        activeRunId: "t1/r/25",
        latestRun: { id: "t1/r/25", end: null, endedAt: null },
        at: observed,
      }),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 28, 23, 6));
    try {
      const live = read({ attention: attention(said({ working: 1 })), overviews });
      expect(mateRowView(live, "working").slot).toEqual({
        kind: "clock",
        since: new Date(started).toISOString(),
      });
      const held = read({ attention: attention(said({ working: 1 }), false), overviews });
      expect(lastKnownMateWords(held, "Pepa", "24-hour")).toBe(
        "Last known 23:04: Pepa was working on: Ship the release",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a working Mate's menu clock counts from this run's start and only moves forward", () => {
    // Recorded 2026-10-09: the clock opened at the previous run's end (14:23), then jumped six
    // times as the queue's, the provider's and the relay's dates arrived.
    const sent = Date.parse(DONE) + 14 * 60_000;
    const at = (seconds: number) => sent + seconds * 1000;
    const steps: ReadonlyArray<{
      readonly second: number;
      readonly working: number;
      readonly waiting?: number;
      readonly state: Record<string, unknown>;
      readonly clock: number | null;
    }> = [
      { second: -1, working: 0, state: { kind: "idle" }, clock: null },
      // Sent: the attention works before the row has heard of the run.
      { second: 0, working: 1, state: { kind: "idle" }, clock: 0 },
      { second: 1, working: 1, state: { kind: "queued", since: at(0.5) }, clock: 1 },
      {
        second: 23,
        working: 1,
        state: { kind: "working", since: at(22.9), waitsOnHelpers: false },
        clock: 23,
      },
      {
        second: 61,
        working: 0,
        waiting: 1,
        state: { kind: "waiting", on: "question", words: "Table or list?" },
        clock: null,
      },
      {
        second: 70,
        working: 1,
        state: { kind: "working", since: at(24), waitsOnHelpers: false },
        clock: 70,
      },
      { second: 78, working: 0, state: { kind: "idle" }, clock: null },
    ];
    let previous: ReadonlyMap<string, ZeropsAgentActivity> | undefined;
    const clocks = steps.map(({ second, working, waiting = 0, state }) => {
      previous = matesActivityOf(
        {
          projectIds: ["p-vera"],
          attention: attention(
            said({
              working,
              waiting,
              questions:
                waiting === 0 ? [] : ([{ threadId: "t1", kind: "input", turnId: null }] as never),
            }),
          ),
          overviews: onEngine(engineRow("t1", { state, at: Date.parse(DONE) })),
          hqCurrent: true,
          threads: [],
          sockets: new Map(),
          standing: new Set(),
          lastVisitedAtById: {},
        },
        previous,
        at(second),
      );
      const { slot } = mateRowView(previous.get("p-vera"), "working");
      return slot.kind === "clock"
        ? Math.round((at(second) - Date.parse(slot.since)) / 1000)
        : null;
    });
    expect(clocks).toEqual(steps.map(({ clock }) => clock));
  });

  it("reads its words and what it waits on off its own row, not its main chat's fields", () => {
    const helpers = engineRow("t1", {
      state: { kind: "working", since: Date.parse(ASKED), waitsOnHelpers: true },
    });
    expect(
      read({ attention: attention(said({ working: 1 })), overviews: onEngine(helpers) }),
    ).toMatchObject({
      threadId: "t1",
      kind: "working",
      face: "working",
      subject: "Ship the release",
      waitsOnHelpers: true,
      at: ASKED,
    });
    const asking = engineRow("t1", {
      state: { kind: "waiting", on: "question", words: "Which tag?" },
    });
    expect(
      read({
        attention: attention(
          said({
            waiting: 1,
            questions: [{ threadId: "t1", kind: "input", turnId: null }] as never,
          }),
        ),
        overviews: onEngine(asking),
      }),
    ).toMatchObject({ kind: "input", face: "needs", question: "Which tag?" });
  });

  it("reads a chat its main chat's fields do not name off that chat's own row", () => {
    const other = engineRow("t9", { subject: "Rotate the keys" });
    const activity = read({
      attention: attention(said({ mainThreadId: "t9" as never, working: 1 })),
      overviews: onEngine(other),
    });
    expect(activity).toMatchObject({ threadId: "t9", kind: "working", subject: "Rotate the keys" });
  });

  it("reads its main conversation off its row without the attention value too", () => {
    const paused = engineRow("t1", { state: { kind: "paused", resetsAt: null } });
    expect(read({ overviews: onEngine(paused) })).toMatchObject({
      threadId: "t1",
      face: "sleep",
      usageLimited: true,
      limitProvider: "Codex",
      subject: "Ship the release",
    });
  });

  it("keeps the shell this page holds of a chat over HQ's row of it", () => {
    const activity = read({
      attention: attention(said({ working: 1 })),
      threads: [{ ...WORKING, title: "Fix the build" }],
      overviews: onEngine(engineRow("t1", {})),
      // Its socket stands: the shell this page holds is current.
      standing: new Set([VERA_ENV]),
    });
    expect(activity).toMatchObject({ subject: "Fix the build" });
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
    // Vera's socket stands: the shell this page holds of her chat is current.
    standing: new Set([VERA_ENV]),
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
        session: { status: "stopped" as const, lastError: "You've hit your weekly limit" },
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

it("direct and HQ attention keep the same restart item even when conversation words lag", () => {
  const interruption = {
    turnId: TurnId.make("cut-turn"),
    restart: { cause: "replaced" as const, at: DONE },
    continuation: "manual" as const,
  };
  const value: MateAttention = {
    source: {
      environmentId: EnvironmentId.make("env-vera"),
      epoch: 2,
      incarnation: "boot2",
      revision: 1,
    },
    mainThreadId: ThreadId.make("t1"),
    lastThreadId: ThreadId.make("t1"),
    working: 0,
    waiting: 1,
    results: [],
    questions: [
      { threadId: ThreadId.make("t1"), turnId: interruption.turnId, kind: "failed", interruption },
    ],
    truncated: false,
  };
  for (const threads of [[], [WORKING]]) {
    const input: MatesActivityInput = {
      projectIds: ["vera"],
      attention: { vera: { attention: value, live: true, unseen: 0 } },
      overviews: new Map([["vera", VERA]]),
      hqCurrent: true,
      threads,
      sockets: new Map(),
      // Its socket stands: a shell this page holds is current.
      standing: new Set([VERA_ENV]),
      lastVisitedAtById: {},
    };
    const read = matesActivityOf(input).get("vera");
    expect(read?.interruption).toEqual(interruption);
    expect(mateStatus(read)).toMatchObject({ kind: "interrupted", severity: "attention" });

    const question = matesActivityOf({
      ...input,
      attention: {
        vera: {
          attention: {
            ...value,
            questions: [
              {
                threadId: ThreadId.make("t1"),
                turnId: interruption.turnId,
                kind: "input",
                interruption,
              },
            ],
          },
          live: true,
          unseen: 0,
        },
      },
      threads: [{ ...WORKING, hasPendingUserInput: true, pendingQuestion: "Which database?" }],
    }).get("vera");
    expect(mateStatus(question)).toMatchObject({ kind: "answer", severity: "attention" });
    expect(mateRowView(question, "needs", "Vera").reply).toMatchObject({ text: "Which database?" });
    const continued = matesActivityOf({
      ...input,
      attention: {
        vera: {
          attention: {
            ...value,
            source: { ...value.source, revision: 2 },
            waiting: 0,
            questions: [],
          },
          live: true,
          unseen: 0,
        },
      },
    }).get("vera");
    expect(continued?.interruption).toBeUndefined();
    expect(mateStatus(continued)).toBeNull();
  }
});

describe("matesActivityOf — the conversation the person is looking at", () => {
  const ON_SCREEN = "env-vera:t1";
  const FINISHED: EnvironmentThreadShell = {
    ...WORKING,
    latestTurn: { ...WORKING.latestTurn!, state: "completed", completedAt: DONE },
    updatedAt: DONE,
  };
  // Its socket, the chat last visited before this turn ended.
  const socket = {
    sockets: new Map([["p-vera", VERA_ENV]]),
    standing: new Set([VERA_ENV]),
    lastVisitedAtById: { [ON_SCREEN]: ASKED },
  };

  it.each([
    {
      name: "HQ counts it unseen, before HQ hears it was seen",
      input: { attention: attention(said({ results: [] }), true, 1), onScreen: ON_SCREEN },
      kind: "idle",
    },
    {
      name: "HQ counts it unseen, another conversation on screen",
      input: { attention: attention(said(), true, 1), onScreen: "env-vera:t2" },
      kind: "done",
    },
    {
      name: "HQ counts it unseen, nothing on screen",
      input: { attention: attention(said(), true, 1), onScreen: null },
      kind: "done",
    },
    {
      name: "its socket's result, before the visit is marked",
      input: { overviews: null, threads: [FINISHED], ...socket, onScreen: ON_SCREEN },
      kind: "idle",
    },
    {
      name: "its socket's result, off screen",
      input: { overviews: null, threads: [FINISHED], ...socket, onScreen: null },
      kind: "done",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: Partial<MatesActivityInput>;
    kind: string;
  }>)(
    "a result the person is looking at never shows as unseen, even before HQ hears it was seen: $name",
    ({ input, kind }) => {
      const activity = read(input);
      expect([activity?.kind, activity?.unread]).toEqual([kind, kind === "done"]);
    },
  );

  it("a turn's end and the next turn, on screen, never show done between them", () => {
    const steps = [
      attention(said({ working: 1 }), true, 0),
      // The turn ended: HQ counts its result unseen before the client's seen reaches it.
      attention(said({ working: 0 }), true, 1),
      attention(said({ working: 0 }), true, 0),
      attention(said({ working: 1 }), true, 0),
    ];
    let previous: ReadonlyMap<string, ZeropsAgentActivity> | undefined;
    const kinds = steps.map((step) => {
      previous = matesActivityOf(
        {
          projectIds: ["p-vera"],
          attention: step,
          overviews: new Map([["p-vera", VERA]]),
          hqCurrent: true,
          threads: [],
          sockets: new Map(),
          standing: new Set(),
          lastVisitedAtById: {},
          onScreen: ON_SCREEN,
        },
        previous,
      );
      return previous.get("p-vera")?.kind;
    });
    expect(kinds).toEqual(["working", "idle", "idle", "working"]);
  });
});

describe("a Mate's own socket", () => {
  it.each([
    ["stands while connected", "connected", false, true],
    ["stands while only blinking", "reconnecting", false, true],
    [
      "still stands while a wake replaces it, until the replacement answers or fails",
      "connecting",
      true,
      true,
    ],
    ["does not stand while it connects for the first time", "connecting", false, false],
    ["does not stand once offline", "offline", true, false],
    ["does not stand once refused", "error", true, false],
  ] as const)("%s", (_, phase, stoodBefore, stands) => {
    expect(socketStands(phase, stoodBefore)).toBe(stands);
  });
});
