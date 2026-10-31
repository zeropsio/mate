import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  ConversationId,
  EnvironmentId,
  RequestId,
  runId,
  ThreadId,
  TurnId,
  type OrchestrationThreadShell,
  type RunEnd,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";

import {
  ViewUnreadable,
  type ConversationView,
  type MateEngineService,
  type ViewRequest,
  type ViewRun,
} from "../engine/MateEngine.ts";
import { rowStateOf } from "../engine/read/conversationRow.ts";
import { chatsSource, engineAttentionReads, engineShellOf } from "./engineOverview.ts";
import { mateAttentionOf } from "./zeropsAttentionValue.ts";
import { mateOverviewOf } from "./zeropsHqOverview.ts";
import { TASKS_CONVERSATION_ID, taskConversationId } from "./ZeropsTasks.ts";
import { inertMateEngine } from "../engine/testing/inertEngine.ts";

const c = ConversationId.make("thread-main");
/** The conversation's id is its V1 thread's: the shells carry it as one. */
const thread = ThreadId.make(c);
const turn = (n: number) => TurnId.make(runId(c, n));
const ana = { kind: "person", subject: "zerops:ana" } as const;
const T = (iso: string) => Date.parse(iso);

const run = (n: number, patch: Partial<ViewRun> = {}): ViewRun => ({
  id: runId(c, n),
  ordinal: n,
  state: "running",
  trigger: { kind: "person", itemId: `${c}/r/${n}/i/1` as never },
  principal: ana,
  end: null,
  endSource: null,
  queuedAt: T("2026-10-07T10:00:00.000Z"),
  admittedAt: T("2026-10-07T10:00:01.000Z"),
  startedAt: T("2026-10-07T10:00:02.000Z"),
  endedAt: null,
  unresponsiveSince: null,
  ...patch,
});

const ended = (n: number, end: RunEnd): ViewRun =>
  run(n, { state: "ended", end, endSource: "agent", endedAt: T("2026-10-07T10:05:00.000Z") });

const view = (patch: Partial<ConversationView> = {}): ConversationView => ({
  conversationId: c,
  seq: 9,
  agent: {
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    model: "m1",
    profile: { kind: "mate" },
  },
  archived: false,
  createdAt: T("2026-10-07T09:00:00.000Z"),
  updatedAt: T("2026-10-07T10:06:00.000Z"),
  activeRun: null,
  queued: [],
  lastEnded: null,
  pausedUntil: null,
  openRequests: [],
  lastPerson:
    patch.lastPerson === undefined
      ? { text: "Deploy the api", at: T("2026-10-07T10:00:00.000Z") }
      : patch.lastPerson,
  // What the person typed: their latest message, unless a test says a page sent it.
  lastAsked:
    patch.lastAsked === undefined
      ? patch.lastPerson === undefined
        ? { text: "Deploy the api", at: T("2026-10-07T10:00:00.000Z") }
        : patch.lastPerson
      : patch.lastAsked,
  lastAgent: { text: "On it.", at: T("2026-10-07T10:04:00.000Z") },
  liveCall: null,
  background: null,
  ...patch,
});

const request = (ask: ViewRequest["ask"]): ViewRequest => ({
  id: RequestId.make("q1"),
  runId: runId(c, 1),
  at: T("2026-10-07T10:03:00.000Z"),
  ask,
  answerable: true,
});

const auth: ZeropsAgentAuthSnapshot = { agents: [], logins: [] } as never;
const identity = { environmentId: "env-1", serverVersion: "0.14.31", update: null } as never;
const overviewOf = (threads: ReadonlyArray<OrchestrationThreadShell>) =>
  mateOverviewOf({ identity, threads, auth, crew: undefined });

const liveEngine = (views: ReadonlyArray<ConversationView>): MateEngineService => ({
  ...inertMateEngine,
  conversations: Effect.succeed({ views, unread: [], complete: true }),
  conversation: (id) => Effect.succeed(views.find((one) => one.conversationId === id)),
  changes: Stream.make(c),
});

const source = { environmentId: EnvironmentId.make("env-1"), epoch: 3, incarnation: "i" };

describe("HQ's overview of a Mate on the engine", () => {
  it.each<[string, Partial<ConversationView>, unknown, unknown, string]>([
    ["nothing ran yet", {}, null, null, "idle"],
    [
      "a run is admitted and being sent",
      { activeRun: run(1, { state: "sending", startedAt: null }) },
      "starting",
      "running",
      "working",
    ],
    ["a run is on", { activeRun: run(1) }, "running", "running", "working"],
    [
      "the agent asks for an approval",
      {
        activeRun: run(1, { state: "waiting" }),
        openRequests: [request({ kind: "approval", requestKind: "command", detail: "rm" })],
      },
      "running",
      "running",
      "approval",
    ],
    [
      "the agent asks a question",
      {
        activeRun: run(1, { state: "waiting" }),
        openRequests: [request({ kind: "question", questions: [], dismissible: true })],
      },
      "running",
      "running",
      "input",
    ],
    [
      "the run completed",
      { lastEnded: ended(1, { kind: "completed" }) },
      "ready",
      "completed",
      "idle",
    ],
    [
      "the run was stopped",
      { lastEnded: ended(1, { kind: "stopped", by: ana }) },
      "ready",
      "interrupted",
      "idle",
    ],
    [
      "the run failed",
      { lastEnded: ended(1, { kind: "failed", reason: "Model not found.", next: null }) },
      "error",
      "error",
      "failed",
    ],
    [
      "the run hit a usage limit",
      { lastEnded: ended(1, { kind: "usage-limit", resetsAt: null }), pausedUntil: "unknown" },
      "ready",
      "interrupted",
      "idle",
    ],
    [
      "a restart cut the run and it was not continued",
      {
        lastEnded: ended(1, {
          kind: "cut-by-restart",
          continuedBy: null,
          notContinued: "a newer person message",
          words: "Fen restarted.",
        }),
      },
      "ready",
      "interrupted",
      "idle",
    ],
  ])("%s: V1's literals, nothing else", (_title, patch, session, turn, kind) => {
    const shell = engineShellOf(view(patch));
    const main = overviewOf([shell]).main;
    assert.strictEqual(main?.session?.status ?? null, session);
    assert.strictEqual(main?.latestTurn?.state ?? null, turn);
    assert.strictEqual(resolveThreadStatus(shell).kind, kind);
  });

  // Milo, 2026-10-10: once the turn that asked ended, the face went done, then idle, and the menu
  // dropped "Needs an answer", while the card still stood open and the row still waited on it.
  it.each<[string, Partial<ConversationView>]>([
    ["while the turn that asked runs on", { activeRun: run(1, { state: "running" }) }],
    ["after the turn that asked ended", { lastEnded: ended(1, { kind: "completed" }) }],
  ])(
    "a value asked of the person reads needs you wherever the row waits on it: %s",
    (_title, patch) => {
      const asked = view({
        ...patch,
        openRequests: [
          request({
            kind: "vault",
            key: "STRIPE_SECRET_KEY",
            scope: { kind: "shared" },
            sensitive: true,
            reason: "Stripe charges cards.",
          }),
        ],
      });
      const row = rowStateOf(asked);
      const shell = engineShellOf(asked);
      const waits = row.kind === "waiting" && row.on === "vault";
      assert.strictEqual(shell.hasPendingUserInput, waits);
      assert.strictEqual(resolveThreadStatus(shell).kind === "input", waits);
      const attention = mateAttentionOf([shell], undefined, {
        environmentId: EnvironmentId.make("env-1"),
        epoch: 3,
        incarnation: "i",
      } as never);
      assert.strictEqual(attention.questions.length, waits ? 1 : 0);
    },
  );

  it("a guarded restart stays on its run without a session failure", () => {
    const shell = engineShellOf(
      view({
        lastEnded: ended(1, {
          kind: "cut-by-restart",
          continuedBy: null,
          notContinued: "archived",
          words: "Fen was restarted by Ana.",
        }),
      }),
    );
    assert.strictEqual(overviewOf([shell]).main?.session?.lastError, null);
    assert.strictEqual(mateAttentionOf([shell], undefined, source).waiting, 0);
  });

  it("carries the person's ask and the agent's last words as the row's previews, a usage pause with its reset", () => {
    const main = overviewOf([
      engineShellOf(
        view({
          lastEnded: ended(1, { kind: "usage-limit", resetsAt: T("2026-10-07T15:00:00.000Z") }),
          pausedUntil: T("2026-10-07T15:00:00.000Z"),
        }),
      ),
    ]).main;
    assert.deepStrictEqual(main?.latestUserMessagePreview, { text: "Deploy the api" });
    assert.deepStrictEqual(main?.latestMessagePreview, { role: "assistant", text: "On it." });
    assert.deepStrictEqual(main?.usagePause, { resetsAt: "2026-10-07T15:00:00.000Z" });
  });

  // Milo, 2026-10-08: the row read "[Picture 1]" for a pasted picture and its question.
  it.each([
    {
      name: "a picture and words",
      person: {
        text: "[Picture 1]\nEngine check 9: what number is in the picture?",
        attachments: [{ type: "image", mimeType: "image/png" }],
      },
      said: "Engine check 9: what number is in the picture?",
    },
    {
      name: "a picture alone",
      person: { text: "[Picture 1]", attachments: [{ type: "image", mimeType: "image/png" }] },
      said: "1 image",
    },
    {
      name: "words in markdown",
      person: { text: "Deploy **the api**", attachments: [] },
      said: "Deploy the api",
    },
  ])(
    "previews the person's message as V1's shell does, never a picture's label: $name",
    ({ person, said }) => {
      const lastPerson = { ...person, at: T("2026-10-07T10:05:00.000Z") };
      const main = overviewOf([engineShellOf(view({ lastPerson }))]).main;
      assert.deepStrictEqual(main?.latestUserMessagePreview, { text: said });
      assert.deepStrictEqual(main?.latestMessagePreview, { role: "user", text: said });
    },
  );

  // Milo's stress run 5: after a restart the menu row's subject read the shell's title, with
  // raw backticks: "(`sleep 25 && echo helper-job-done` and `sh -c …`)".
  it("a conversation's shell names the pool container its agent works in, and none while unbound", () => {
    const lease = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
    assert.deepStrictEqual(engineShellOf(view({ lease })).lease, lease);
    assert.strictEqual(engineShellOf(view()).lease, null);
    // Never a worktree: T3 removes a thread's worktree with the thread.
    assert.strictEqual(engineShellOf(view({ lease })).worktreePath, null);
  });

  it("names the conversation by the person's first words as plain words, its markdown read", () => {
    const lastPerson = {
      text: "---\nStart two helpers (`sleep 25 && echo done` and **`exit 4`**)\nthen report",
      attachments: [],
      at: T("2026-10-07T10:05:00.000Z"),
    };
    const main = overviewOf([engineShellOf(view({ lastPerson }))]).main;
    assert.strictEqual(main?.title, "Start two helpers (sleep 25 && echo done and exit 4)");
  });

  it("titles the conversation by what the person typed, never by a page's request", () => {
    const lastPerson = { text: "Open crew ports on appdev", at: T("2026-10-07T10:05:00.000Z") };
    const lastAsked = { text: "Build the tea catalog", at: T("2026-10-07T10:00:00.000Z") };
    const main = overviewOf([engineShellOf(view({ lastPerson, lastAsked }))]).main;
    assert.strictEqual(main?.title, "Build the tea catalog");
  });

  it("previews the agent's last words as V1's shell does, its markdown read", () => {
    const lastAgent = { text: "The number is **42**.", at: T("2026-10-07T10:04:00.000Z") };
    const main = overviewOf([engineShellOf(view({ lastAgent }))]).main;
    assert.deepStrictEqual(main?.latestMessagePreview, {
      role: "assistant",
      text: "The number is 42.",
    });
  });

  it.each([
    [
      "the words before its question",
      "Two carts hold teas.\n\nQUESTION: Which one stays?",
      "Two carts hold teas.",
    ],
    ["its question alone, never the mark", "QUESTION: Which one stays?", "Which one stays?"],
  ])("previews a task's agent asking a person by %s", (_, text, preview) => {
    const shell = engineShellOf(
      view({
        conversationId: taskConversationId("task-1"),
        lastAgent: { text, at: T("2026-10-07T10:04:00.000Z") },
      }),
    );
    assert.strictEqual(shell.latestMessagePreview?.text, preview);
  });

  it("previews the tasks' one conversation by its latest task's run, the question read as a task's", () => {
    const lastAgent = {
      text: "Two carts hold teas.\n\nQUESTION: Which one stays?",
      at: T("2026-10-07T10:04:00.000Z"),
    };
    // A person's run there is theirs: its words are read as they are.
    const ofPerson = engineShellOf(
      view({
        conversationId: TASKS_CONVERSATION_ID,
        lastEnded: ended(1, { kind: "completed" }),
        lastAgent,
      }),
    );
    assert.include(ofPerson.latestMessagePreview?.text ?? "", "QUESTION:");
    const task = { kind: "task", taskId: "task-1" } as const;
    const tasks = engineShellOf(
      view({
        conversationId: TASKS_CONVERSATION_ID,
        lastEnded: { ...ended(1, { kind: "completed" }), principal: task },
        lastAgent,
      }),
    );
    assert.strictEqual(tasks.latestMessagePreview?.text, "Two carts hold teas.");
  });

  it("titles the tasks' one conversation by the task at work, and Tasks while none is", () => {
    const task = { kind: "task", taskId: "task-2" } as const;
    const lastAsked = {
      text: "#43 The teapot is missing\n\nYou have a task",
      at: T("2026-10-07T10:00:00.000Z"),
    };
    const working = engineShellOf(
      view({
        conversationId: TASKS_CONVERSATION_ID,
        activeRun: run(2, { principal: task }),
        lastAsked,
      }),
    );
    assert.strictEqual(working.title, "#43 The teapot is missing");
    const idle = engineShellOf(
      view({
        conversationId: TASKS_CONVERSATION_ID,
        lastEnded: { ...ended(2, { kind: "completed" }), principal: task },
        lastAsked,
      }),
    );
    assert.strictEqual(idle.title, "Tasks");
  });

  it("a crewmate's conversation is the crew's: never one of the person's chats, its line reads its run", () => {
    const crewmate = ConversationId.make("crew-main-backend-1");
    const threads = [
      engineShellOf(view()),
      engineShellOf(
        view({
          conversationId: crewmate,
          agent: {
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            model: "m1",
            profile: { kind: "crewmate", id: "backend", name: "Backend" },
          },
          activeRun: run(1),
        }),
      ),
    ];
    const overview = mateOverviewOf({
      identity,
      threads,
      auth,
      crew: {
        status: "applied",
        crewmates: [
          {
            handle: "backend",
            displayName: "Backend",
            tint: "teal",
            kind: "writer",
            currentThreadId: crewmate,
            login: { id: "claudeAgent", label: "Claude" },
          },
        ],
        attention: [],
        board: { tasks: [] },
        run: null,
      } as never,
    });
    assert.deepStrictEqual(
      {
        chats: overview.threads.list.map((digest) => digest.id),
        crewmate:
          overview.crew.status === "applied"
            ? [overview.crew.crewmates[0]?.threadId, overview.crew.crewmates[0]?.threadKind]
            : undefined,
      },
      { chats: [thread], crewmate: [crewmate, "working"] },
    );
  });

  it.effect(
    "in mate mode the chats carry the engine's own rows at the Mate's revision, and its protocol",
    () =>
      Effect.gen(function* () {
        const archived = { ...view(), conversationId: ConversationId.make("gone"), archived: true };
        const chats = chatsSource(
          liveEngine([view({ activeRun: run(1) }), archived]),
          Effect.succeed(source),
        );
        const rows = yield* chats.conversations;
        assert.deepStrictEqual(
          rows.map((row) => [row.conversationId, row.state.kind, row.revision]),
          [[c, "working", { environmentId: "env-1", epoch: 3, seq: 9 }]],
        );
        assert.deepStrictEqual(chats.engine, { protocol: 1, taskAssignments: 1 });
      }),
  );
});

describe("HQ's overview of a Mate held by a usage limit", () => {
  it("shows the pause, never working, while a message waits for the reset, and counts what it holds", () => {
    const shell = engineShellOf(
      view({
        lastEnded: ended(1, { kind: "usage-limit", resetsAt: T("2026-10-07T15:00:00.000Z") }),
        queued: [run(2, { state: "queued", startedAt: null, admittedAt: null })],
        pausedUntil: T("2026-10-07T15:00:00.000Z"),
      }),
    );
    const main = overviewOf([shell]).main;
    assert.strictEqual(resolveThreadStatus(shell).kind, "idle");
    assert.deepStrictEqual(
      [main?.session?.status, main?.latestTurn?.state],
      ["ready", "interrupted"],
    );
    assert.deepStrictEqual(main?.usagePause, { resetsAt: "2026-10-07T15:00:00.000Z" });
    assert.strictEqual(shell.usagePause?.held, 1);
  });

  it("with an unknown reset, the held message never reads working either", () => {
    const shell = engineShellOf(
      view({
        lastEnded: ended(1, { kind: "usage-limit", resetsAt: null }),
        queued: [run(2, { state: "queued", startedAt: null, admittedAt: null })],
        pausedUntil: "unknown",
      }),
    );
    assert.strictEqual(resolveThreadStatus(shell).kind, "idle");
  });
});

describe("the Mate's attention on the engine", () => {
  it.effect(
    "counts a run on as working and a request as waiting, keyed by the conversation and its run",
    () =>
      Effect.gen(function* () {
        const reads = engineAttentionReads(
          liveEngine([
            view({
              activeRun: run(1, { state: "waiting" }),
              openRequests: [request({ kind: "approval", requestKind: "command", detail: "rm" })],
            }),
          ]),
        );
        assert.isTrue(Option.isSome(yield* reads.project));
        const attention = mateAttentionOf(yield* reads.threadsOf(), undefined, source);
        assert.strictEqual(attention.mainThreadId, thread);
        assert.strictEqual(attention.waiting, 1);
        assert.deepStrictEqual(attention.questions, [
          { threadId: thread, kind: "approval", turnId: turn(1) },
        ]);
      }),
  );

  // Milo's recheck on 0.15.44: the face read idle for 27 ms between the person's answer to a value
  // and the agent's word on it: the attention counted nothing working while the wake was due.
  it.effect.each([
    { due: "the agent's word on a value the person answered", patch: { runDue: true as const } },
    { due: "the agent's own turn on its finished job", patch: { turnDue: true as const } },
  ])("counts a turn due at a run's end as working, never a result: $due", ({ patch }) =>
    Effect.gen(function* () {
      const reads = engineAttentionReads(
        liveEngine([view({ lastEnded: ended(1, { kind: "completed" }), ...patch })]),
      );
      const attention = mateAttentionOf(yield* reads.threadsOf(), undefined, source);
      assert.deepStrictEqual([attention.working, attention.results], [1, []]);
    }),
  );

  it.effect("lists a completed run as a result, and drops an archived conversation", () =>
    Effect.gen(function* () {
      const done = view({ lastEnded: ended(1, { kind: "completed" }) });
      const reads = engineAttentionReads(liveEngine([done]));
      const attention = mateAttentionOf(yield* reads.threadsOf(), undefined, source);
      assert.deepStrictEqual(attention.results, [
        { threadId: thread, turnId: turn(1), completedAt: "2026-10-07T10:05:00.000Z" },
      ]);
      const archived = engineAttentionReads(liveEngine([{ ...done, archived: true }]));
      assert.isTrue(Option.isNone(yield* archived.thread(thread)));
    }),
  );

  it.effect(
    "a conversation it cannot read now is a failed read, never gone: the attention keeps it",
    () =>
      Effect.gen(function* () {
        const reads = engineAttentionReads({
          ...liveEngine([view()]),
          conversation: (id) => Effect.fail(new ViewUnreadable({ conversationId: id })),
        });
        const failed = yield* Effect.flip(reads.thread(thread));
        assert.strictEqual(failed._tag, "ViewUnreadable");
      }),
  );

  it.effect("hears of a conversation whose record moved as its thread's event", () =>
    Effect.gen(function* () {
      const reads = engineAttentionReads(liveEngine([view()]));
      const events = yield* Stream.runCollect(reads.domainEvents);
      assert.deepStrictEqual([...events], [{ aggregateKind: "thread", aggregateId: c }]);
    }),
  );
});
