import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
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
} from "../../engine/MateEngine.ts";
import { rowStateOf } from "../../engine/read/conversationRow.ts";
import { inertMateEngine } from "../../engine/testing/inertEngine.ts";
import { chatsSource, engineAttentionReads, engineShellOf } from "../engineOverview.ts";
import { TASKS_CONVERSATION_ID, taskConversationId } from "../ZeropsTasks.ts";
import { mateAttentionOf } from "../zeropsAttentionValue.ts";
import { mateOverviewOf } from "./zeropsHqOverview.ts";

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
  // What the person typed: their latest message, unless a case says a page sent it.
  lastAsked:
    patch.lastAsked === undefined
      ? patch.lastPerson === undefined
        ? { text: "Deploy the api", at: T("2026-10-07T10:00:00.000Z") }
        : patch.lastPerson
      : patch.lastAsked,
  // The latest ask whoever made it: the person's, unless a case says another Mate asked since.
  latestAsk:
    patch.latestAsk !== undefined
      ? patch.latestAsk
      : patch.lastAsked === undefined
        ? patch.lastPerson === undefined
          ? { text: "Deploy the api", at: T("2026-10-07T10:00:00.000Z") }
          : patch.lastPerson
        : patch.lastAsked,
  awaits: [],
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

// witness: apps/server/src/zerops/engineOverview.ts | status: BEFORE_START.has(run.state) ? "starting" : "running", → status: "running",
it("HO17: An engine conversation reads to HQ in V1's literals and nothing else: no session and idle before any run, a starting session on a running turn while its run is admitted or being sent, running while it is on, approval or input while it asks, ready and completed after it completed, ready and interrupted after a Stop, a usage limit or a restart that did not continue it, and error after it failed", () => {
  const rows: ReadonlyArray<
    readonly [Partial<ConversationView>, string | null, string | null, string]
  > = [
    [{}, null, null, "idle"],
    [
      { activeRun: run(1, { state: "sending", startedAt: null }) },
      "starting",
      "running",
      "working",
    ],
    [{ activeRun: run(1) }, "running", "running", "working"],
    [
      {
        activeRun: run(1, { state: "waiting" }),
        openRequests: [request({ kind: "approval", requestKind: "command", detail: "rm" })],
      },
      "running",
      "running",
      "approval",
    ],
    [
      {
        activeRun: run(1, { state: "waiting" }),
        openRequests: [request({ kind: "question", questions: [], dismissible: true })],
      },
      "running",
      "running",
      "input",
    ],
    [{ lastEnded: ended(1, { kind: "completed" }) }, "ready", "completed", "idle"],
    [{ lastEnded: ended(1, { kind: "stopped", by: ana }) }, "ready", "interrupted", "idle"],
    [
      { lastEnded: ended(1, { kind: "failed", reason: "Model not found.", next: null }) },
      "error",
      "error",
      "failed",
    ],
    [
      { lastEnded: ended(1, { kind: "usage-limit", resetsAt: null }), pausedUntil: "unknown" },
      "ready",
      "interrupted",
      "idle",
    ],
    [
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
  ];
  for (const [patch, session, latestTurn, kind] of rows) {
    const shell = engineShellOf(view(patch));
    const main = overviewOf([shell]).main;
    assert.deepStrictEqual(
      [
        main?.session?.status ?? null,
        main?.latestTurn?.state ?? null,
        resolveThreadStatus(shell).kind,
      ],
      [session, latestTurn, kind],
    );
  }
});

// witness: apps/server/src/zerops/engineOverview.ts | return { ...base, status: "ready", lastError: null }; → return { ...base, status: "ready", lastError: run.end.words };
it("HO18: A restart that cut a run and did not continue it gives HQ no session failure, and the attention counts nothing waiting on it", () => {
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

// witness: apps/server/src/zerops/engineOverview.ts | asked.some((request) => request.ask.kind !== "approval") || waitsOnCard(view), → asked.some((request) => request.ask.kind !== "approval"),
it("HO19: A value asked of the person reads needs you on its conversation's shell and in the attention wherever the row waits on it, also after the turn that asked ended", () => {
  const rows: ReadonlyArray<Partial<ConversationView>> = [
    { activeRun: run(1, { state: "running" }) },
    { lastEnded: ended(1, { kind: "completed" }) },
  ];
  for (const patch of rows) {
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
    assert.deepStrictEqual(
      [
        row.kind,
        row.kind === "waiting" ? row.on : null,
        shell.hasPendingUserInput,
        resolveThreadStatus(shell).kind,
        mateAttentionOf([shell], undefined, source).questions.length,
      ],
      ["waiting", "vault", true, "input", 1],
    );
  }
});

// witness: apps/server/src/zerops/engineOverview.ts | const personText = person === null ? null : userAskPreviewText(person); → const personText = person === null ? null : person.text;
it("HO20: HQ previews the person's ask and the agent's last words as V1's shell does, their markdown read and a picture's label never shown: words beside a picture read alone, and a picture alone reads as its count", () => {
  const plain = overviewOf([engineShellOf(view())]).main;
  assert.deepStrictEqual(plain?.latestUserMessagePreview, { text: "Deploy the api" });
  assert.deepStrictEqual(plain?.latestMessagePreview, { role: "assistant", text: "On it." });

  const people = [
    {
      person: {
        text: "[Picture 1]\nEngine check 9: what number is in the picture?",
        attachments: [{ type: "image", mimeType: "image/png" }],
      },
      said: "Engine check 9: what number is in the picture?",
    },
    {
      person: { text: "[Picture 1]", attachments: [{ type: "image", mimeType: "image/png" }] },
      said: "1 image",
    },
    { person: { text: "Deploy **the api**", attachments: [] }, said: "Deploy the api" },
  ];
  for (const { person, said } of people) {
    const lastPerson = { ...person, at: T("2026-10-07T10:05:00.000Z") };
    const main = overviewOf([engineShellOf(view({ lastPerson }))]).main;
    assert.deepStrictEqual(main?.latestUserMessagePreview, { text: said });
    assert.deepStrictEqual(main?.latestMessagePreview, { role: "user", text: said });
  }

  const lastAgent = { text: "The number is **42**.", at: T("2026-10-07T10:04:00.000Z") };
  const agent = overviewOf([engineShellOf(view({ lastAgent }))]).main;
  assert.deepStrictEqual(agent?.latestMessagePreview, {
    role: "assistant",
    text: "The number is 42.",
  });
});

// witness: apps/server/src/zerops/engineOverview.ts | const words = messagePreviewText(line); → const words = line.trim() === "" ? null : line.trim();
it("HO21: HQ names a conversation by the first line of what the person typed that has words once its markdown is read, never by a page's request", () => {
  const typed = {
    text: "---\nStart two helpers (`sleep 25 && echo done` and **`exit 4`**)\nthen report",
    attachments: [],
    at: T("2026-10-07T10:05:00.000Z"),
  };
  const named = overviewOf([engineShellOf(view({ lastPerson: typed }))]).main;
  assert.strictEqual(named?.title, "Start two helpers (sleep 25 && echo done and exit 4)");

  const lastPerson = { text: "Open crew ports on appdev", at: T("2026-10-07T10:05:00.000Z") };
  const lastAsked = { text: "Build the tea catalog", at: T("2026-10-07T10:00:00.000Z") };
  const paged = overviewOf([engineShellOf(view({ lastPerson, lastAsked }))]).main;
  assert.strictEqual(paged?.title, "Build the tea catalog");
});

// witness: apps/server/src/zerops/engineOverview.ts | return question === undefined || rest !== "" ? rest : question; → return rest;
it("HO22: A task's agent asking a person is previewed by its words before the question, or by the question alone, never by the mark; in the tasks' one conversation only while its latest run is a task's", () => {
  const rows = [
    ["Two carts hold teas.\n\nQUESTION: Which one stays?", "Two carts hold teas."],
    ["QUESTION: Which one stays?", "Which one stays?"],
  ] as const;
  for (const [text, preview] of rows) {
    const shell = engineShellOf(
      view({
        conversationId: taskConversationId("task-1"),
        lastAgent: { text, at: T("2026-10-07T10:04:00.000Z") },
      }),
    );
    assert.strictEqual(shell.latestMessagePreview?.text, preview);
  }

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
  const ofTask = engineShellOf(
    view({
      conversationId: TASKS_CONVERSATION_ID,
      lastEnded: { ...ended(1, { kind: "completed" }), principal: task },
      lastAgent,
    }),
  );
  assert.strictEqual(ofTask.latestMessagePreview?.text, "Two carts hold teas.");
});

// witness: apps/server/src/zerops/engineOverview.ts | ? view.activeRun !== null || view.queued.length > 0 → ? view.lastAsked !== null
it("HO23: The tasks' one conversation is titled by the task at work, and Tasks while none is", () => {
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
  const idle = engineShellOf(
    view({
      conversationId: TASKS_CONVERSATION_ID,
      lastEnded: { ...ended(2, { kind: "completed" }), principal: task },
      lastAsked,
    }),
  );
  assert.deepStrictEqual([working.title, idle.title], ["#43 The teapot is missing", "Tasks"]);
});

// witness: apps/server/src/zerops/engineOverview.ts | const crewmate = profile?.kind === "crewmate" ? profile : undefined; → const crewmate = profile?.kind === "crewmate" && view.activeRun === null ? profile : undefined;
it("HO24: A crewmate's conversation is never one of the person's chats in HQ's overview, and the crew digest names it, working while its run is on", () => {
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

// witness: apps/server/src/zerops/engineOverview.ts | (view.pausedUntil !== null ? view.lastEnded : (view.queued[0] ?? view.lastEnded)); → (view.queued[0] ?? view.lastEnded);
it("HO25: While a usage limit holds a waiting message, HQ shows the pause with its reset and the number of messages it holds, never working, also when the reset is unknown", () => {
  const known = engineShellOf(
    view({
      lastEnded: ended(1, { kind: "usage-limit", resetsAt: T("2026-10-07T15:00:00.000Z") }),
      queued: [run(2, { state: "queued", startedAt: null, admittedAt: null })],
      pausedUntil: T("2026-10-07T15:00:00.000Z"),
    }),
  );
  const main = overviewOf([known]).main;
  assert.deepStrictEqual(
    [resolveThreadStatus(known).kind, main?.session?.status, main?.latestTurn?.state],
    ["idle", "ready", "interrupted"],
  );
  assert.deepStrictEqual(main?.usagePause, { resetsAt: "2026-10-07T15:00:00.000Z" });
  assert.strictEqual(known.usagePause?.held, 1);

  const unknown = engineShellOf(
    view({
      lastEnded: ended(1, { kind: "usage-limit", resetsAt: null }),
      queued: [run(2, { state: "queued", startedAt: null, admittedAt: null })],
      pausedUntil: "unknown",
    }),
  );
  assert.strictEqual(resolveThreadStatus(unknown).kind, "idle");
});

// witness: apps/server/src/zerops/engineOverview.ts | : (view.background ?? (rowStateOf(view).kind === "working" ? "working" : null)), → : view.background,
it("HO26: A turn due at a run's end, the agent's word on a value the person answered or its own turn on a finished job, counts as working in the attention, never as a result", () => {
  const rows: ReadonlyArray<Partial<ConversationView>> = [{ runDue: true }, { turnDue: true }];
  for (const patch of rows) {
    const shell = engineShellOf(view({ lastEnded: ended(1, { kind: "completed" }), ...patch }));
    const attention = mateAttentionOf([shell], undefined, source);
    assert.deepStrictEqual([attention.working, attention.results], [1, []]);
  }
});

// witness: apps/server/src/zerops/engineOverview.ts | .filter((view) => !view.archived && view.agent?.profile.kind !== "crewmate") → .filter((view) => view.agent?.profile.kind !== "crewmate")
it.effect(
  "HO27: In mate mode the chats carry the engine's own rows of the person's conversations at the Mate's revision, an archived or a crewmate's conversation left out, and the engine's newest protocol",
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
      assert.deepStrictEqual(chats.engine, { protocol: 1 });
    }),
);

// witness: apps/server/src/zerops/engineOverview.ts | view === undefined || view.archived ? Option.none() : Option.some(engineShellOf(view)), → view === undefined ? Option.none() : Option.some(engineShellOf(view)),
it.effect(
  "HO28: The attention reads the engine's conversations as one project's chats: a request waits, keyed by its conversation and its run; an archived conversation is none, one that cannot be read is a failed read, and a moved record is its thread's event",
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

      const done = view({ lastEnded: ended(1, { kind: "completed" }) });
      const results = mateAttentionOf(
        yield* engineAttentionReads(liveEngine([done])).threadsOf(),
        undefined,
        source,
      ).results;
      assert.deepStrictEqual(results, [
        { threadId: thread, turnId: turn(1), completedAt: "2026-10-07T10:05:00.000Z" },
      ]);
      const archived = engineAttentionReads(liveEngine([{ ...done, archived: true }]));
      assert.isTrue(Option.isNone(yield* archived.thread(thread)));

      const unreadable = engineAttentionReads({
        ...liveEngine([view()]),
        conversation: (id) => Effect.fail(new ViewUnreadable({ conversationId: id })),
      });
      const failed = yield* Effect.result(unreadable.thread(thread));
      assert.strictEqual(Result.isFailure(failed) ? failed.failure._tag : null, "ViewUnreadable");

      const events = yield* Stream.runCollect(
        engineAttentionReads(liveEngine([view()])).domainEvents,
      );
      assert.deepStrictEqual([...events], [{ aggregateKind: "thread", aggregateId: c }]);
    }),
);
