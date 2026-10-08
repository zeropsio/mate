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
  inertMateEngine,
  ViewUnreadable,
  type ConversationView,
  type MateEngineService,
  type ViewRequest,
  type ViewRun,
} from "../engine/MateEngine.ts";
import { chatsSource, engineAttentionReads, engineShellOf } from "./engineOverview.ts";
import { mateAttentionOf } from "./zeropsAttentionValue.ts";
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
  lastPerson: { text: "Deploy the api", at: T("2026-10-07T10:00:00.000Z") },
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
  live: true,
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

  it("previews the agent's last words as V1's shell does, its markdown read", () => {
    const lastAgent = { text: "The number is **42**.", at: T("2026-10-07T10:04:00.000Z") };
    const main = overviewOf([engineShellOf(view({ lastAgent }))]).main;
    assert.deepStrictEqual(main?.latestMessagePreview, {
      role: "assistant",
      text: "The number is 42.",
    });
  });

  it.effect(
    "a thread V1 left running at the flip never shows working: mate mode reads only the engine",
    () =>
      Effect.gen(function* () {
        const v1Running = {
          ...engineShellOf(view({ activeRun: run(1) })),
          id: "v1-thread" as never,
        };
        const chats = chatsSource(
          liveEngine([view({ lastEnded: ended(1, { kind: "completed" }) })]),
          {
            threads: Effect.succeed([v1Running]),
            domainEvents: Stream.empty,
          },
          Effect.succeed(source),
        );
        const threads = yield* chats.threads;
        const overview = overviewOf(threads);
        assert.strictEqual(overview.main?.id, thread);
        assert.deepStrictEqual(
          overview.threads.list.map((digest) => [digest.id, digest.kind]),
          [[thread, "idle"]],
        );
        assert.strictEqual(mateAttentionOf(threads, undefined, source).working, 0);
      }),
  );

  it.effect(
    "in mate mode the chats carry the engine's own rows at the Mate's revision, and its protocol",
    () =>
      Effect.gen(function* () {
        const archived = { ...view(), conversationId: ConversationId.make("gone"), archived: true };
        const chats = chatsSource(
          liveEngine([view({ activeRun: run(1) }), archived]),
          { threads: Effect.succeed([]), domainEvents: Stream.empty },
          Effect.succeed(source),
        );
        const rows = chats.conversations === undefined ? [] : yield* chats.conversations;
        assert.deepStrictEqual(
          rows.map((row) => [row.conversationId, row.state.kind, row.revision]),
          [[c, "working", { environmentId: "env-1", epoch: 3, seq: 9 }]],
        );
        assert.deepStrictEqual(chats.engine, { protocol: 1 });
      }),
  );

  it("with the switch off, the chats are V1's, exactly as before", () => {
    const v1 = { threads: Effect.succeed([]), domainEvents: Stream.empty };
    assert.strictEqual(chatsSource(inertMateEngine, v1, Effect.succeed(source)), v1);
  });
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
