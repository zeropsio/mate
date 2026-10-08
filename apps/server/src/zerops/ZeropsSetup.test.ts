// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationThreadShell,
  type ServerProvider,
  ConversationId,
  DEFAULT_MODEL_BY_PROVIDER,
  runId,
  wakeId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import { ServerCommandReadiness } from "../spi/serverCommandReadiness.ts";
import {
  inertMateEngine,
  MateEngine,
  type ConversationView,
  type WakeRequest,
} from "../engine/MateEngine.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import type { HqStanding } from "./ZeropsHqLink.ts";
import type { ProjectSigners } from "./ZeropsProjectSigners.ts";
import {
  ZeropsSetup,
  ZeropsSetupReads,
  makeZeropsSetup,
  standUpPollDelay,
  zcpProcessGone,
  type ZeropsSetupTimings,
} from "./ZeropsSetup.ts";
import { procStartTime } from "./zeropsSetupSteps.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";

const ZEROPS = resolveZeropsEnvironment({
  projectId: "project-mate",
  apiHost: undefined,
  apiToken: "the-mates-own-key",
})!;

const PROJECT: OrchestrationProject = {
  id: ProjectId.make("project-1"),
  title: "mate",
  workspaceRoot: "/var/www",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  deletedAt: null,
};

const mainThread = (overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell =>
  ({
    id: ThreadId.make("thread-main"),
    projectId: PROJECT.id,
    title: "New thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  }) as OrchestrationThreadShell;

/**
 * The Mate as its HQ sends it, `standupRequestedBy` naming who asked for its stand-up — from the
 * write that made its record (audit B3) — and whether its project is closed off.
 */
const linked = (standupRequestedBy: string | null, closedOff = true): HqStanding => ({
  kind: "linked",
  mate: {
    projectId: "project-mate",
    name: "mate",
    face: "coral:gem",
    standupRequestedBy,
    closedOff,
    appId: null,
    appName: null,
    changes: [],
  },
});
/** A provider instance as the picker sees it, the Zerops overlay applied. */
const instance = (driver: string, status: ServerProvider["status"] = "ready"): ServerProvider => ({
  instanceId: ProviderInstanceId.make(driver),
  driver: ProviderDriverKind.make(driver),
  displayName: driver,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status,
  auth: { status: status === "ready" ? "authenticated" : "unauthenticated" },
  checkedAt: "2026-10-01T10:00:00.000Z",
  models: [{ slug: `${driver}-model`, name: "Model", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
});

/** Somebody signed Claude Code in: the agent the stand-up waits on is there to run. */
const CLAUDE_SIGNED_IN = [instance("claudeAgent"), instance("codex", "error")];
/** Nobody signed anything in, and nothing else is set up: nothing on this Mate can run. */
const NOTHING_TO_RUN = [instance("claudeAgent", "error"), instance("codex", "error")];
const CURSOR_READY = [...NOTHING_TO_RUN, instance("cursor")];

const ASKED = linked("user-a");
const NOBODY_ASKED = linked(null);
/** The asker signed Claude in here. */
const SIGNED: ProjectSigners = { "claude-code": "user-a" };

interface World {
  /** Where the Mate stands with its HQ. */
  readonly hq: Ref.Ref<HqStanding>;
  /** Who this server saw sign each login in. */
  readonly signers: Ref.Ref<ProjectSigners>;
  readonly providers: Ref.Ref<ReadonlyArray<ServerProvider>>;
  readonly variables: Ref.Ref<ReadonlyArray<string>>;
  /** How many times where it stands with HQ was read. */
  readonly hqReads: Ref.Ref<number>;
  readonly statusFile: Ref.Ref<unknown>;
  /** The PIDs whose process is gone. */
  readonly goneProcesses: Ref.Ref<ReadonlyArray<number>>;
  readonly threads: Ref.Ref<ReadonlyArray<OrchestrationThreadShell>>;
  readonly dispatched: Ref.Ref<ReadonlyArray<OrchestrationCommand>>;
  readonly admitted: Ref.Ref<ReadonlyArray<TurnPrincipal>>;
  readonly refusal: Ref.Ref<string | undefined>;
  /** A dispatch never comes back: the server dies before its stand-up goes out. */
  readonly dispatchHangs: Ref.Ref<boolean>;
  readonly dispatchFailure: Ref.Ref<boolean>;
  /** The engine's conversations, the agents it was given and the wakes it armed. */
  readonly engineViews: Ref.Ref<ReadonlyArray<ConversationView>>;
  /** Whether the engine could read every conversation. */
  readonly engineComplete: Ref.Ref<boolean>;
  readonly assigned: Ref.Ref<ReadonlyArray<readonly [string, unknown]>>;
  /** Each import asked: the conversation, its source, and how many agents it had been given then. */
  readonly imported: Ref.Ref<ReadonlyArray<readonly [string, unknown, number]>>;
  readonly wakes: Ref.Ref<ReadonlyArray<WakeRequest>>;
  /** The run each wake started, by wake id, once it has. */
  readonly wokenRuns: Ref.Ref<
    Readonly<
      Record<
        string,
        { readonly end: unknown; readonly source?: string; readonly reached?: boolean | "unknown" }
      >
    >
  >;
}

const makeWorld = Effect.gen(function* () {
  return {
    hq: yield* Ref.make(ASKED),
    providers: yield* Ref.make<ReadonlyArray<ServerProvider>>(CLAUDE_SIGNED_IN),
    signers: yield* Ref.make<ProjectSigners>({}),
    // Made by the new press: it always sets the runtimes plan, even an empty one.
    variables: yield* Ref.make<ReadonlyArray<string>>(["PATH", "MATE_SETUP_RUNTIMES"]),
    hqReads: yield* Ref.make(0),
    statusFile: yield* Ref.make<unknown>(undefined),
    goneProcesses: yield* Ref.make<ReadonlyArray<number>>([]),
    threads: yield* Ref.make<ReadonlyArray<OrchestrationThreadShell>>([mainThread()]),
    dispatched: yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]),
    admitted: yield* Ref.make<ReadonlyArray<TurnPrincipal>>([]),
    refusal: yield* Ref.make<string | undefined>(undefined),
    dispatchHangs: yield* Ref.make(false),
    dispatchFailure: yield* Ref.make(false),
    engineViews: yield* Ref.make<ReadonlyArray<ConversationView>>([]),
    engineComplete: yield* Ref.make(true),
    assigned: yield* Ref.make<ReadonlyArray<readonly [string, unknown]>>([]),
    imported: yield* Ref.make<ReadonlyArray<readonly [string, unknown, number]>>([]),
    wakes: yield* Ref.make<ReadonlyArray<WakeRequest>>([]),
    wokenRuns: yield* Ref.make<
      Readonly<
        Record<
          string,
          {
            readonly end: unknown;
            readonly source?: string;
            readonly reached?: boolean | "unknown";
          }
        >
      >
    >({}),
  } satisfies World;
});

const fakes = (world: World) =>
  Layer.mergeAll(
    Layer.succeed(ZeropsSetupReads, {
      hq: Ref.update(world.hqReads, (count) => count + 1).pipe(Effect.andThen(Ref.get(world.hq))),
      signers: Ref.get(world.signers),
      serviceVariables: Ref.get(world.variables),
      statusFile: Ref.get(world.statusFile),
      processGone: (zcp) =>
        Effect.map(Ref.get(world.goneProcesses), (gone) => gone.includes(zcp.pid)),
      providers: Ref.get(world.providers),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.gen(function* () {
          if (yield* Ref.get(world.dispatchHangs)) return yield* Effect.never;
          if (yield* Ref.get(world.dispatchFailure))
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "dispatch refused",
            });
          // The engine takes a command id once, as its receipts do.
          const all = yield* Ref.get(world.dispatched);
          if (!all.some((held) => held.commandId === command.commandId)) {
            yield* Ref.set(world.dispatched, [...all, command]);
          }
          return { sequence: 1 };
        }),
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.some(PROJECT)),
      getShellSnapshot: () =>
        Effect.map(Ref.get(world.threads), (threads) => ({
          snapshotSequence: 1,
          projects: [],
          threads,
          updatedAt: "2026-10-01T10:00:00.000Z",
        })),
      getThreadShellById: (threadId) =>
        Effect.map(Ref.get(world.threads), (threads) =>
          Option.fromNullishOr(threads.find((thread) => thread.id === threadId)),
        ),
    }),
    Layer.mock(ZeropsTurnAdmission)({
      admit: ({ principal }) =>
        Ref.update(world.admitted, (all) => [...all, principal]).pipe(
          Effect.andThen(Ref.get(world.refusal)),
          Effect.flatMap((refusal) =>
            refusal === undefined
              ? Effect.void
              : Effect.fail(new OrchestrationDispatchCommandError({ message: refusal })),
          ),
        ),
    }),
    Layer.mock(ServerCommandReadiness)({ await: Effect.void, complete: Effect.void }),
    Layer.succeed(MateEngine, {
      ...inertMateEngine,
      conversations: Effect.map(
        Effect.all([Ref.get(world.engineViews), Ref.get(world.engineComplete)]),
        ([views, complete]) => ({
          views,
          unread: complete ? [] : [ConversationId.make("unread")],
          complete,
        }),
      ),
      conversation: (id) =>
        Effect.map(Ref.get(world.engineViews), (views) =>
          views.find((view) => view.conversationId === id),
        ),
      importHistory: (id, source) =>
        Effect.gen(function* () {
          const given = (yield* Ref.get(world.assigned)).length;
          yield* Ref.update(world.imported, (all) => [...all, [id, source, given] as const]);
          return 3;
        }),
      assignAgent: (id, agent) =>
        Effect.gen(function* () {
          yield* Ref.update(world.assigned, (all) => [...all, [id, agent] as const]);
          yield* Ref.update(world.engineViews, (views) => [
            ...views.filter((view) => view.conversationId !== id),
            { ...engineView(id), ...views.find((view) => view.conversationId === id), agent },
          ]);
          return true;
        }),
      wake: (request) =>
        Effect.gen(function* () {
          yield* Ref.update(world.wakes, (all) => [...all, request]);
          return { wakeId: wakeId(request.conversationId, request.kind, request.key) };
        }),
      runOf: (found) =>
        Effect.map(Ref.get(world.wokenRuns), (runs) => {
          const run = "wakeId" in found ? runs[found.wakeId] : undefined;
          return run === undefined
            ? undefined
            : {
                runId: runId(ConversationId.make("c"), 1),
                end: run.end as never,
                source: (run.source ?? null) as never,
                reachedAgent: run.reached ?? (run.end === null ? true : "unknown"),
              };
        }),
    }),
  );

/** A conversation the engine holds, nothing run in it yet. */
const engineView = (id: string): ConversationView => ({
  conversationId: ConversationId.make(id),
  seq: 1,
  agent: null,
  archived: false,
  createdAt: 0,
  updatedAt: 0,
  activeRun: null,
  queued: [],
  lastEnded: null,
  pausedUntil: null,
  openRequests: [],
  lastPerson: null,
  lastAgent: null,
  liveCall: null,
  background: null,
});

const FAST: ZeropsSetupTimings = {
  poll: Duration.millis(10),
  slowPoll: Duration.millis(10),
  fastFor: Duration.minutes(30),
};

/** A server on `database`; a second one on the same file is the same Mate after a restart. */
const serverOn = (
  world: World,
  database: string,
  timings: ZeropsSetupTimings = FAST,
  mateEngine: ServerConfig.MateEngineMode = "v1",
) =>
  Layer.effect(ZeropsSetup, makeZeropsSetup(timings)).pipe(
    Layer.provide(fakes(world)),
    Layer.provide(
      ServerConfig.layer({
        cwd: "/var/www",
        zerops: ZEROPS,
        mateEngine,
      } as ServerConfig.ServerConfig["Service"]),
    ),
    Layer.provide(
      Layer.effectDiscard(runMigrations()).pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename: database })),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

const withServer = <A, E>(
  world: World,
  database: string,
  body: (setup: ZeropsSetup["Service"]) => Effect.Effect<A, E>,
  timings: ZeropsSetupTimings = FAST,
  mateEngine: ServerConfig.MateEngineMode = "v1",
) =>
  Effect.gen(function* () {
    const setup = yield* ZeropsSetup;
    return yield* body(setup);
  }).pipe(Effect.provide(serverOn(world, database, timings, mateEngine)), Effect.scoped);

const freshDatabase = () =>
  NodePath.join(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-setup-")), "state.sqlite");

const turnsOf = (world: World) =>
  Effect.map(Ref.get(world.dispatched), (all) =>
    all.filter(
      (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
        command.type === "thread.turn.start",
    ),
  );

/** Lets the poll run a few times. */
const ticks = Effect.sleep(Duration.millis(80));

const eventually = <A>(read: Effect.Effect<A>, holds: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = yield* read;
      if (holds(value)) return value;
      yield* Effect.sleep(Duration.millis(10));
    }
    return assert.fail("the condition never held");
  });

describe("ZeropsSetup: the stand-up", () => {
  it.live("waits for the asker's sign-in, then sends the browser's ask once, as them", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* withServer(world, freshDatabase(), () =>
        Effect.gen(function* () {
          yield* ticks;
          assert.deepStrictEqual(yield* turnsOf(world), []);
          yield* Ref.set(world.signers, SIGNED);
          const [turn] = yield* eventually(turnsOf(world), (turns) => turns.length > 0);
          yield* ticks;
          assert.strictEqual((yield* turnsOf(world)).length, 1);
          assert.deepStrictEqual(
            [turn!.threadId, turn!.commandId, turn!.message.messageId, turn!.message.text],
            [
              "thread-main",
              "mate-standup-thread-main-1",
              "mate-standup-thread-main-1",
              "Stand up development of the project.",
            ],
          );
          // On the agent the person signed in, not the conversation's other one.
          assert.strictEqual(turn!.modelSelection?.instanceId, "claudeAgent");
          assert.deepStrictEqual((yield* Ref.get(world.admitted)).at(-1), {
            kind: "standup",
            startedBy: "user-a",
          });
        }),
      );
    }),
  );

  it.live("a restart repeats nothing", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* Ref.set(world.signers, SIGNED);
      yield* withServer(world, database, () =>
        eventually(turnsOf(world), (turns) => turns.length === 1),
      );
      yield* withServer(world, database, () => ticks);
      assert.strictEqual((yield* turnsOf(world)).length, 1);
    }),
  );

  it.live(
    "an admission failure stays visible across restart and only its asker can try again",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.signers, SIGNED);
        yield* Ref.set(world.refusal, "not signed in yet");
        const database = freshDatabase();
        yield* withServer(world, database, (setup) =>
          Effect.gen(function* () {
            yield* setup.awaitStandUp;
            assert.strictEqual(
              (yield* setup.document).steps.find((step) => step.id === "standup")?.state,
              "failed",
            );
            assert.strictEqual((yield* Ref.get(world.admitted)).length, 1);
          }),
        );
        yield* Ref.set(world.refusal, undefined);
        yield* withServer(world, database, (setup) =>
          Effect.gen(function* () {
            yield* setup.awaitStandUp;
            assert.strictEqual((yield* Ref.get(world.admitted)).length, 1);
            assert.isFalse(yield* setup.retry("someone-else"));
            assert.isTrue(yield* setup.retry("user-a"));
            assert.strictEqual((yield* turnsOf(world)).length, 1);
            assert.isFalse(yield* setup.retry("user-a"));
          }),
        );
      }),
  );

  it.live(
    "a failed dispatch ends once, persists its failure and a failed manual attempt also ends",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.signers, SIGNED);
        yield* Ref.set(world.dispatchFailure, true);
        const database = freshDatabase();
        yield* withServer(world, database, (setup) =>
          Effect.gen(function* () {
            yield* setup.awaitStandUp;
            assert.strictEqual(
              (yield* setup.document).steps.find((step) => step.id === "standup")?.state,
              "failed",
            );
            assert.isTrue(yield* setup.retry("user-a"));
            assert.strictEqual((yield* Ref.get(world.admitted)).length, 2);
            assert.strictEqual(
              (yield* setup.document).steps.find((step) => step.id === "standup")?.state,
              "failed",
            );
          }),
        );
        yield* Ref.set(world.dispatchFailure, false);
        yield* withServer(world, database, (setup) =>
          Effect.gen(function* () {
            yield* setup.awaitStandUp;
            assert.strictEqual((yield* turnsOf(world)).length, 0);
            assert.isTrue(yield* setup.retry("user-a"));
            assert.strictEqual((yield* turnsOf(world)).length, 1);
          }),
        );
      }),
  );

  it.live("a conversation already spoken in gets no stand-up", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
      yield* Ref.set(world.threads, [
        mainThread({ latestUserMessageAt: "2026-10-01T10:05:00.000Z" }),
      ]);
      yield* withServer(world, freshDatabase(), () => ticks);
      assert.deepStrictEqual(yield* turnsOf(world), []);
    }),
  );

  it.live("with no conversation yet, it opens one and sends there", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
      yield* Ref.set(world.threads, []);
      yield* withServer(world, freshDatabase(), () =>
        eventually(turnsOf(world), (turns) => turns.length === 1),
      );
      const [create, turn] = yield* Ref.get(world.dispatched);
      assert.strictEqual(create?.type, "thread.create");
      assert.strictEqual(
        turn?.type === "thread.turn.start" && turn.threadId,
        create?.type === "thread.create" && create.threadId,
      );
    }),
  );

  // Mate signs people in to Claude Code and Codex only; a Mate that runs on another agent stands
  // up all the same, as its asker, once that agent is ready.
  it.live("with nobody signed in, it stands up on a ready Cursor, as its asker, once", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.providers, NOTHING_TO_RUN);
      yield* withServer(world, freshDatabase(), () =>
        Effect.gen(function* () {
          yield* ticks;
          assert.deepStrictEqual(yield* turnsOf(world), []);
          yield* Ref.set(world.providers, CURSOR_READY);
          const [turn] = yield* eventually(turnsOf(world), (turns) => turns.length > 0);
          yield* ticks;
          assert.strictEqual((yield* turnsOf(world)).length, 1);
          assert.deepStrictEqual(
            [turn!.modelSelection?.instanceId, turn!.modelSelection?.model],
            ["cursor", "cursor-model"],
          );
          assert.deepStrictEqual((yield* Ref.get(world.admitted)).at(-1), {
            kind: "standup",
            startedBy: "user-a",
          });
        }),
      );
    }),
  );

  it.live("the asker's own sign-in comes before a ready Cursor", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
      yield* Ref.set(world.providers, [...CLAUDE_SIGNED_IN, instance("cursor")]);
      const [turn] = yield* withServer(world, freshDatabase(), () =>
        eventually(turnsOf(world), (turns) => turns.length > 0),
      );
      assert.strictEqual(turn!.modelSelection?.instanceId, "claudeAgent");
    }),
  );

  it.live("keeps the conversation's own model when it is already on that Cursor", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.providers, CURSOR_READY);
      yield* Ref.set(world.threads, [
        mainThread({
          modelSelection: { instanceId: ProviderInstanceId.make("cursor"), model: "composer-2" },
        }),
      ]);
      const [turn] = yield* withServer(world, freshDatabase(), () =>
        eventually(turnsOf(world), (turns) => turns.length > 0),
      );
      assert.deepStrictEqual(
        [turn!.modelSelection?.instanceId, turn!.modelSelection?.model],
        ["cursor", "composer-2"],
      );
    }),
  );

  // D10: a new conversation starts on Extra High, else the highest effort below Max; an effort the
  // conversation already has stays.
  it.live("the stand-up starts on the highest effort below Max, and keeps one already set", () =>
    Effect.gen(function* () {
      const reasoning = {
        optionDescriptors: [
          {
            id: "reasoning",
            label: "Reasoning",
            type: "select" as const,
            options: [
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium", isDefault: true },
              { id: "high", label: "High" },
              { id: "max", label: "Max" },
            ],
          },
        ],
      };
      const cursor: ServerProvider = {
        ...instance("cursor"),
        models: [
          { slug: "composer-2", name: "Composer", isCustom: false, capabilities: reasoning },
        ],
      };
      const standUpSelection = (thread: OrchestrationThreadShell) =>
        Effect.gen(function* () {
          const world = yield* makeWorld;
          yield* Ref.set(world.providers, [...NOTHING_TO_RUN, cursor]);
          yield* Ref.set(world.threads, [thread]);
          const [turn] = yield* withServer(world, freshDatabase(), () =>
            eventually(turnsOf(world), (turns) => turns.length > 0),
          );
          // The thread stores what its first turn runs on, so a reload reads it back.
          const stored = (yield* Ref.get(world.dispatched)).flatMap((command) =>
            command.type === "thread.meta.update" && command.modelSelection !== undefined
              ? [command.modelSelection.options]
              : [],
          );
          return { turn: turn!.modelSelection?.options, stored };
        });
      const onCursor = (options?: ReadonlyArray<{ id: string; value: string }>) =>
        mainThread({
          modelSelection: {
            instanceId: ProviderInstanceId.make("cursor"),
            model: "composer-2",
            ...(options ? { options } : {}),
          },
        });
      assert.deepStrictEqual(yield* standUpSelection(onCursor()), {
        turn: [{ id: "reasoning", value: "high" }],
        stored: [[{ id: "reasoning", value: "high" }]],
      });
      assert.deepStrictEqual(
        yield* standUpSelection(onCursor([{ id: "reasoning", value: "low" }])),
        { turn: [{ id: "reasoning", value: "low" }], stored: [] },
      );
    }),
  );

  it.live("keeps the conversation on its own ready instance over the registry's first", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.providers, [...CURSOR_READY, instance("opencode")]);
      yield* Ref.set(world.threads, [
        mainThread({
          modelSelection: { instanceId: ProviderInstanceId.make("opencode"), model: "big-pickle" },
        }),
      ]);
      const [turn] = yield* withServer(world, freshDatabase(), () =>
        eventually(turnsOf(world), (turns) => turns.length > 0),
      );
      assert.deepStrictEqual(
        [turn!.modelSelection?.instanceId, turn!.modelSelection?.model],
        ["opencode", "big-pickle"],
      );
    }),
  );

  // Grok and Cursor can say ready with a sign-in they could not read: that is no agent to run.
  it.live("never stands up on a Cursor whose sign-in it could not read", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.providers, [
        ...NOTHING_TO_RUN,
        { ...instance("cursor"), auth: { status: "unknown" } },
      ]);
      yield* withServer(world, freshDatabase(), () => ticks);
      assert.deepStrictEqual(yield* turnsOf(world), []);
    }),
  );

  /** Whether the Mate's record is still being read: two reads apart, the count moved. */
  const stillPolling = (world: World) =>
    Effect.gen(function* () {
      const before = yield* Ref.get(world.hqReads);
      yield* ticks;
      return (yield* Ref.get(world.hqReads)) > before;
    });

  it.live("a Mate made before the new press never starts one, and never polls for it", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.variables, ["PATH"]);
      yield* Ref.set(world.signers, SIGNED);
      yield* withServer(world, freshDatabase(), () => ticks);
      assert.deepStrictEqual([yield* turnsOf(world), yield* Ref.get(world.hqReads)], [[], 0]);
    }),
  );

  const settles: ReadonlyArray<[string, (world: World) => Effect.Effect<void>]> = [
    ["once it started the stand-up", (world) => Ref.set(world.signers, SIGNED)],
    ["when nobody asked for one", (world) => Ref.set(world.hq, NOBODY_ASKED)],
    [
      "when the conversation was already spoken in",
      (world) =>
        Effect.andThen(
          Ref.set(world.signers, SIGNED),
          Ref.set(world.threads, [mainThread({ latestUserMessageAt: "2026-10-01T10:05:00.000Z" })]),
        ),
    ],
  ];
  for (const [name, arrange] of settles) {
    it.live(`stops polling for good ${name}, across a restart too`, () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* arrange(world);
        const database = freshDatabase();
        yield* withServer(world, database, () =>
          Effect.gen(function* () {
            yield* ticks;
            assert.isFalse(yield* stillPolling(world));
          }),
        );
        const reads = yield* Ref.get(world.hqReads);
        yield* withServer(world, database, () => ticks);
        assert.strictEqual(yield* Ref.get(world.hqReads), reads);
      }),
    );
  }

  // Audit B3: HQ's record of the Mate carries its ask from the write that made it, so a linked
  // Mate naming nobody is one nobody asked for — settled at once, its project closed off or not.
  const nobodyAsked: ReadonlyArray<[string, HqStanding]> = [
    ["its project closed off", NOBODY_ASKED],
    ["its project not closed off yet", linked(null, false)],
  ];
  for (const [name, hq] of nobodyAsked) {
    it.live(`settles as none at once when nobody asked, ${name}`, () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.hq, hq);
        yield* withServer(world, freshDatabase(), (setup) =>
          Effect.gen(function* () {
            yield* ticks;
            assert.isFalse(yield* stillPolling(world));
            const document = yield* setup.document;
            assert.deepStrictEqual(
              document.steps.find((step) => step.id === "standup"),
              { id: "standup", state: "none", at: "" },
            );
          }),
        );
      }),
    );
  }

  // Who asked comes from HQ: until the link brings the Mate, nobody is known to have asked —
  // which is not "nobody asked", and never settles the stand-up as none.
  it.live("waits for its HQ to say who asked, however long, and never settles meanwhile", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.hq, { kind: "not-linked" });
      yield* Ref.set(world.signers, SIGNED);
      yield* withServer(world, freshDatabase(), () =>
        Effect.gen(function* () {
          yield* ticks;
          assert.deepStrictEqual(yield* turnsOf(world), []);
          assert.isTrue(yield* stillPolling(world));
          yield* Ref.set(world.hq, ASKED);
          yield* eventually(turnsOf(world), (turns) => turns.length === 1);
        }),
      );
    }),
  );

  it.live("polls while the stand-up is pending", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* withServer(world, freshDatabase(), () =>
        Effect.gen(function* () {
          assert.isTrue(yield* stillPolling(world));
        }),
      );
    }),
  );

  it.live("a stood-up Mate's setup document says its sign-in and its stand-up", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
      const database = freshDatabase();
      yield* withServer(world, database, (setup) =>
        Effect.gen(function* () {
          const [standUp] = yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          // Its turn asked, as the engine records it.
          yield* turnRow(database, standUp!.threadId, standUp!.message.messageId, "pending");
          const document = yield* setup.document;
          assert.deepStrictEqual(
            document.steps
              .filter((step) => step.id === "signin" || step.id === "standup")
              .map((step) => step.state),
            ["done", "running"],
          );
        }),
      );
    }),
  );

  it.live("a server that died between its claim and its send sends it once after a restart", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* Ref.set(world.signers, SIGNED);
      yield* Ref.set(world.dispatchHangs, true);
      yield* withServer(world, database, () => ticks);
      yield* Ref.set(world.dispatchHangs, false);
      yield* withServer(world, database, () =>
        eventually(turnsOf(world), (turns) => turns.length === 1),
      );
      const [turn] = yield* turnsOf(world);
      assert.strictEqual(turn!.commandId, "mate-standup-thread-main-1");
      assert.isFalse(yield* withServer(world, database, () => stillPolling(world)));
    }),
  );

  // The asker changed while the claim waited: it goes out as whoever holds an agent now.
  it.live(
    "a resumed claim whose person no longer holds the agent is sent as its asker who does",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        const database = freshDatabase();
        yield* Ref.set(world.hq, linked("user-b"));
        yield* Ref.set(world.signers, { "claude-code": "user-b" });
        yield* Ref.set(world.dispatchHangs, true);
        yield* withServer(world, database, () => ticks);
        yield* Ref.set(world.dispatchHangs, false);
        yield* Ref.set(world.hq, ASKED);
        yield* Ref.set(world.signers, SIGNED);
        yield* withServer(world, database, () =>
          eventually(turnsOf(world), (turns) => turns.length === 1),
        );
        assert.deepStrictEqual((yield* Ref.get(world.admitted)).at(-1), {
          kind: "standup",
          startedBy: "user-a",
        });
      }),
  );

  it.live("a resumed claim nobody who could send it holds the agent for settles, never stuck", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* Ref.set(world.signers, SIGNED);
      yield* Ref.set(world.dispatchHangs, true);
      yield* withServer(world, database, () => ticks);
      yield* Ref.set(world.dispatchHangs, false);
      // Someone else entirely holds the agent now.
      yield* Ref.set(world.signers, { "claude-code": "user-c" });
      yield* withServer(world, database, () => ticks);
      assert.deepStrictEqual(yield* turnsOf(world), []);
      assert.isFalse(yield* withServer(world, database, () => stillPolling(world)));
    }),
  );

  // A stand-up a browser sent before the server stood every Mate up itself is one that ran: never
  // sent again, its step what its own turn says — with no turn found and zcp silent, nothing; a
  // claim not confirmed out, waiting.
  const browserRecords = [
    ["browser", undefined],
    ["browser:claimed", "waiting"],
  ] as const;
  for (const [source, standup] of browserRecords) {
    it.live(`a browser's record from before (${source}) is a stand-up that ran`, () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        const database = freshDatabase();
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO zerops_stand_ups
            (project_id, thread_id, command_id, user_id, source, started_at)
            VALUES ('project-mate', 'thread-main', 'mate-standup-thread-main-1', 'user-a',
              ${source}, '2026-10-01T10:00:00.000Z')`;
        }).pipe(
          Effect.provide(
            Layer.effectDiscard(runMigrations()).pipe(
              Layer.provideMerge(NodeSqliteClient.layer({ filename: database })),
              Layer.provide(NodeServices.layer),
            ),
          ),
        );
        yield* Ref.set(world.signers, SIGNED);
        const document = yield* withServer(world, database, (setup) =>
          Effect.andThen(ticks, setup.document),
        );
        assert.deepStrictEqual(yield* turnsOf(world), []);
        assert.strictEqual(document.steps.find((step) => step.id === "standup")?.state, standup);
        assert.isFalse(yield* withServer(world, database, () => stillPolling(world)));
      }),
    );
  }
});

describe("ZeropsSetup: why a stand-up waits", () => {
  const waits: ReadonlyArray<[string, HqStanding, Readonly<Record<string, string>>]> = [
    [
      "zcp found no official HQ",
      { kind: "not-enrolled", outcome: Option.some({ state: "no_hq" }) },
      { reason: "no_hq" },
    ],
    [
      "HQ refused the enrollment",
      { kind: "not-enrolled", outcome: Option.some({ state: "refused", code: "not_a_mate" }) },
      { reason: "not_enrolled", code: "not_a_mate" },
    ],
    [
      "zcp said nothing this build reads",
      { kind: "not-enrolled", outcome: Option.none() },
      { reason: "not_enrolled" },
    ],
    ["enrolled, HQ has not sent the Mate", { kind: "not-linked" }, { reason: "not_linked" }],
    ["asked, the asker not signed in yet", ASKED, {}],
  ];
  for (const [name, hq, said] of waits) {
    it.live(`${name}`, () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.hq, hq);
        const step = yield* withServer(world, freshDatabase(), (setup) =>
          Effect.map(setup.document, (document) =>
            document.steps.find((entry) => entry.id === "standup"),
          ),
        );
        assert.deepStrictEqual(step, { id: "standup", state: "waiting", at: "", ...said });
      }),
    );
  }
});

describe("ZeropsSetup: what its setup document leaves out", () => {
  it.live("a Mate made before the new press says nothing of a sign-in", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.variables, ["PATH"]);
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          yield* ticks;
          const document = yield* setup.document;
          assert.isFalse(document.steps.some((step) => step.id === "signin"));
        }),
      );
    }),
  );
});

describe("ZeropsSetup: the document", () => {
  const stateOf = (setup: ZeropsSetup["Service"], id: string) =>
    Effect.map(setup.document, (document) => document.steps.find((step) => step.id === id)?.state);

  it.live("follows the Mate from a bare container to a stood-up one", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.hq, { kind: "not-enrolled", outcome: Option.none() });
      const database = freshDatabase();
      yield* withServer(world, database, (setup) =>
        Effect.gen(function* () {
          const states = Effect.all(
            ["container", "git", "runtimes", "signin", "standup"].map((id) => stateOf(setup, id)),
          );
          assert.deepStrictEqual(yield* states, [
            "done",
            "waiting",
            "unknown",
            "waiting",
            "waiting",
          ]);
          // zcp enrolled the Mate, and HQ sent it with who asked for its stand-up.
          yield* Ref.set(world.hq, ASKED);
          yield* Ref.set(world.statusFile, {
            version: 1,
            runtimes: { state: "importing", startedAt: "2026-10-01T10:01:00Z" },
            standup: { state: "idle" },
          });
          assert.deepStrictEqual(yield* states, ["done", "done", "running", "waiting", "waiting"]);
          yield* Ref.set(world.signers, SIGNED);
          const [standUp] = yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          yield* turnRow(database, standUp!.threadId, standUp!.message.messageId, "running");
          assert.deepStrictEqual(yield* states, ["done", "done", "running", "done", "running"]);
          yield* Ref.set(world.statusFile, {
            version: 1,
            runtimes: { state: "done", endedAt: "2026-10-01T10:03:00Z" },
            standup: { state: "done", endedAt: "2026-10-01T10:09:00Z" },
          });
          assert.deepStrictEqual(yield* states, ["done", "done", "done", "done", "done"]);
          // A git step once done stays done: the setup is a record, not a live probe.
          yield* Ref.set(world.hq, { kind: "not-enrolled", outcome: Option.none() });
          assert.strictEqual(yield* stateOf(setup, "git"), "done");
        }),
      );
    }),
  );
});

describe("ZeropsSetup: a stand-up says only what ran", () => {
  const stateOf = (setup: ZeropsSetup["Service"], id: string) =>
    Effect.map(setup.document, (document) => document.steps.find((step) => step.id === id)?.state);

  it.live("a Mate on Cursor is signed in once Cursor is ready, nobody signed in", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.hq, NOBODY_ASKED);
      yield* Ref.set(world.providers, NOTHING_TO_RUN);
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          assert.strictEqual(yield* stateOf(setup, "signin"), "waiting");
          yield* Ref.set(world.providers, CURSOR_READY);
          assert.strictEqual(yield* stateOf(setup, "signin"), "done");
        }),
      );
    }),
  );

  it.live("a New project's first Mate: no stand-up is ever done, and its sign-in stays", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      // Nobody asked a stand-up of it; its sign-in comes after the stand-up settled as none.
      yield* Ref.set(world.hq, NOBODY_ASKED);
      yield* Ref.set(world.statusFile, { version: 1, runtimes: { state: "none" } });
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          const states = Effect.all(["signin", "standup"].map((id) => stateOf(setup, id)));
          assert.deepStrictEqual(yield* states, ["waiting", "none"]);
          yield* ticks;
          assert.deepStrictEqual(yield* states, ["waiting", "none"]);
          yield* Ref.set(world.signers, { "claude-code": "user-b" });
          assert.deepStrictEqual(yield* states, ["done", "none"]);
          yield* ticks;
          assert.deepStrictEqual(yield* states, ["done", "none"]);
        }),
      );
    }),
  );

  it.live("a stand-up whose stage halves build on a second call runs until they return", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
      const half = (hostname: string, step: string, state: string) => ({ hostname, step, state });
      const database = freshDatabase();
      yield* withServer(world, database, (setup) =>
        Effect.gen(function* () {
          const [standUp] = yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          // The stand-up's own turn runs while zcp makes its two calls.
          yield* turnRow(database, standUp!.threadId, standUp!.message.messageId, "running");
          const sequence: ReadonlyArray<[unknown, string]> = [
            [
              {
                state: "running",
                phase: "development",
                services: [
                  half("appdev", "build", "running"),
                  half("appstage", "build", "pending"),
                ],
              },
              "running",
            ],
            [
              {
                state: "done",
                phase: "development",
                services: [half("appdev", "verify", "done"), half("appstage", "build", "pending")],
              },
              "running",
            ],
            [
              {
                state: "running",
                phase: "stage",
                services: [half("appdev", "verify", "done"), half("appstage", "build", "running")],
              },
              "running",
            ],
            [
              {
                state: "done",
                phase: "stage",
                services: [half("appdev", "verify", "done"), half("appstage", "verify", "done")],
              },
              "done",
            ],
          ];
          for (const [standup, expected] of sequence) {
            yield* Ref.set(world.statusFile, { version: 1, standup });
            assert.strictEqual(yield* stateOf(setup, "standup"), expected);
          }
        }),
      );
    }),
  );

  const awaitingStages = (startedAt: string) => ({
    state: "running",
    phase: "stage",
    startedAt,
    process: { pid: 4242, start: "98765" },
    services: [
      { hostname: "appdev", step: "verify", state: "done" },
      { hostname: "appstage", step: "build", state: "pending" },
    ],
  });
  const standUpStep = (setup: ZeropsSetup["Service"]) =>
    Effect.map(setup.document, (document) =>
      document.steps.find((candidate) => candidate.id === "standup"),
    );

  it.live("a stand-up ends short when an owner of its end answers: its process, its turn", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
      const database = freshDatabase();
      yield* withServer(world, database, (setup) =>
        Effect.gen(function* () {
          const [standUp] = yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          const { threadId } = standUp!;
          const messageId = standUp!.message.messageId;
          yield* turnRow(database, threadId, messageId, "running");
          yield* setup.noteStandUpCall({
            threadId,
            turnId: `turn-${messageId}`,
            startedAt: "2026-10-01T10:00:09.000Z",
          });
          yield* Ref.set(world.statusFile, {
            version: 1,
            standup: awaitingStages("2026-10-01T10:00:10Z"),
          });
          assert.strictEqual(
            (yield* standUpStep(setup))?.state,
            "running",
            "its turn runs: the call is to come",
          );
          yield* Ref.set(world.goneProcesses, [4242]);
          assert.deepStrictEqual(yield* standUpStep(setup), {
            id: "standup",
            state: "failed",
            at: "",
            reason: "process_gone",
          });
          yield* Ref.set(world.goneProcesses, []);
          yield* turnRow(database, threadId, messageId, "completed");
          assert.deepStrictEqual(yield* standUpStep(setup), {
            id: "standup",
            state: "failed",
            at: "",
            reason: "stage_not_built",
          });
          // A re-run in a later turn, waiting for its own stage call: its turn, not the first's.
          yield* turnRow(database, threadId, "a-later-message", "running");
          yield* setup.noteStandUpCall({
            threadId,
            turnId: "turn-a-later-message",
            startedAt: "2026-10-01T11:00:00.000Z",
          });
          yield* Ref.set(world.statusFile, {
            version: 1,
            standup: awaitingStages("2026-10-01T11:00:01Z"),
          });
          assert.strictEqual((yield* standUpStep(setup))?.state, "running");
        }),
      );
    }),
  );

  it.live(
    "a stand-up nothing recorded ends short when its own turn ends without the stage call",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.hq, NOBODY_ASKED);
        const database = freshDatabase();
        yield* withServer(world, database, (setup) =>
          Effect.gen(function* () {
            yield* ticks;
            yield* turnRow(database, "thread-main", "a-person-s-message", "running");
            yield* setup.noteStandUpCall({
              threadId: "thread-main",
              turnId: "turn-a-person-s-message",
              startedAt: "2026-10-01T10:00:09.000Z",
            });
            yield* Ref.set(world.statusFile, {
              version: 1,
              standup: awaitingStages("2026-10-01T10:00:10Z"),
            });
            assert.strictEqual((yield* standUpStep(setup))?.state, "running");
            yield* turnRow(database, "thread-main", "a-person-s-message", "completed");
            assert.deepStrictEqual(yield* standUpStep(setup), {
              id: "standup",
              state: "failed",
              at: "",
              reason: "stage_not_built",
            });
          }),
        );
      }),
  );

  const afterDev = {
    state: "done",
    phase: "development",
    services: [
      { hostname: "appdev", step: "verify", state: "done" },
      { hostname: "appstage", step: "build", state: "pending" },
    ],
  };
  const pendingStage: ReadonlyArray<
    [string, (database: string, threadId: string, messageId: string) => Effect.Effect<void>, string]
  > = [
    ["its own turn not read (its thread gone): zcp's word", () => Effect.void, "done"],
    [
      "its own turn over, a later message's turn running: zcp's word, never a flap",
      (database, threadId, messageId) =>
        Effect.andThen(
          turnRow(database, threadId, messageId, "completed"),
          turnRow(database, threadId, "a-later-message", "running"),
        ),
      "done",
    ],
    [
      "its own turn still running: the stage call is still to come",
      (database, threadId, messageId) => turnRow(database, threadId, messageId, "running"),
      "running",
    ],
  ];
  for (const [name, arrange, expected] of pendingStage) {
    it.live(`zcp done with the stage halves pending, ${name}`, () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.signers, SIGNED);
        const database = freshDatabase();
        yield* withServer(world, database, (setup) =>
          Effect.gen(function* () {
            const [standUp] = yield* eventually(turnsOf(world), (turns) => turns.length === 1);
            yield* arrange(database, standUp!.threadId, standUp!.message.messageId);
            yield* Ref.set(world.statusFile, { version: 1, standup: afterDev });
            assert.strictEqual(yield* stateOf(setup, "standup"), expected);
          }),
        );
      }),
    );
  }

  it.live("a stand-up claimed and not sent yet reads waiting, never left out", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
      // Its send never comes back: the claim stands, with no turn behind it yet.
      yield* Ref.set(world.dispatchHangs, true);
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          yield* eventually(Ref.get(world.admitted), (admitted) => admitted.length > 0);
          yield* ticks;
          assert.strictEqual(yield* stateOf(setup, "standup"), "waiting");
        }),
      );
    }),
  );
});

/**
 * A turn of the projection's, as the engine records one, written into the Mate's database; the
 * same turn written again is its later state.
 */
const turnRow = (database: string, threadId: string, messageId: string, state: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT OR REPLACE INTO projection_turns
        (thread_id, turn_id, pending_message_id, state, requested_at, checkpoint_files_json)
      VALUES (${threadId}, ${`turn-${messageId}`}, ${messageId}, ${state},
        '2026-10-01T10:00:00.000Z', '[]')
    `;
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: database })), Effect.orDie);

describe("ZeropsSetup: the git step reads the Mate's enrollment with HQ", () => {
  const steps: ReadonlyArray<[string, HqStanding, Record<string, string>]> = [
    ["enrolled and sent", ASKED, { state: "done" }],
    ["enrolled, HQ has not sent the Mate", { kind: "not-linked" }, { state: "done" }],
    [
      "pending: zcp has said nothing",
      { kind: "not-enrolled", outcome: Option.none() },
      { state: "waiting" },
    ],
    [
      "no official HQ",
      { kind: "not-enrolled", outcome: Option.some({ state: "no_hq" }) },
      { state: "failed", reason: "no_hq" },
    ],
    [
      "HQ refused",
      { kind: "not-enrolled", outcome: Option.some({ state: "refused", code: "not_a_mate" }) },
      { state: "failed", reason: "refused", code: "not_a_mate" },
    ],
  ];
  for (const [name, hq, said] of steps) {
    it.live(name, () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.hq, hq);
        yield* withServer(world, freshDatabase(), (setup) =>
          Effect.gen(function* () {
            const git = (yield* setup.document).steps.find((step) => step.id === "git");
            const { id: _id, at: _at, ...rest } = git ?? { id: "", at: "" };
            assert.deepStrictEqual(rest, said);
          }),
        );
      }),
    );
  }
});

describe("zcpProcessGone", () => {
  const goneOf = (pid: number, start: string) =>
    Effect.flatMap(FileSystem.FileSystem, (fs) => zcpProcessGone(fs, { pid, start })).pipe(
      Effect.provide(NodeServices.layer),
    );
  const ownStart = () => {
    try {
      return procStartTime(NodeFS.readFileSync("/proc/self/stat", "utf8"));
    } catch {
      return undefined;
    }
  };

  it.effect("a PID no process holds is gone", () =>
    Effect.map(goneOf(2 ** 22 + 7, "1"), (gone) => assert.isTrue(gone)),
  );
  it.effect("a live PID whose start zcp could not read is alive", () =>
    Effect.map(goneOf(process.pid, ""), (gone) => assert.isFalse(gone)),
  );
  it.effect(
    "a live PID under the start zcp wrote is alive; under another, a reused PID, gone",
    () =>
      Effect.gen(function* () {
        const start = ownStart();
        // Off Linux no start time reads, and a live PID is never declared gone over it.
        assert.deepStrictEqual(
          [yield* goneOf(process.pid, start ?? "1"), yield* goneOf(process.pid, "0-not-this-one")],
          start === undefined ? [false, false] : [false, true],
        );
      }),
  );
});

describe("standUpPollDelay", () => {
  const cases: ReadonlyArray<[string, Duration.Duration, Duration.Duration]> = [
    ["at boot", Duration.zero, Duration.seconds(10)],
    ["29 minutes in", Duration.minutes(29), Duration.seconds(10)],
    ["30 minutes in", Duration.minutes(30), Duration.seconds(60)],
    ["a day in", Duration.hours(24), Duration.seconds(60)],
  ];
  for (const [name, elapsed, delay] of cases) {
    it(`every ${Duration.toSeconds(delay)} s ${name}`, () =>
      assert.strictEqual(
        Duration.toMillis(standUpPollDelay(Duration.toMillis(elapsed))),
        Duration.toMillis(delay),
      ));
  }
});

describe("ZeropsSetup: the stand-up on the Mate engine", () => {
  const recordIn = (database: string, source: string, threadId = "thread-main") =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (source !== "") {
        yield* sql`INSERT INTO zerops_stand_ups
          (project_id, thread_id, command_id, user_id, source, started_at)
          VALUES ('project-mate', ${threadId}, 'mate-standup-thread-main-1', 'user-a',
            ${source}, '2026-10-01T10:00:00.000Z')`;
      }
      return yield* sql<{ readonly source: string; readonly commandId: string }>`
        SELECT source, command_id AS "commandId" FROM zerops_stand_ups`;
    }).pipe(
      Effect.provide(
        Layer.effectDiscard(runMigrations()).pipe(
          Layer.provideMerge(NodeSqliteClient.layer({ filename: database })),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );

  const onEngine = <A, E>(
    world: World,
    database: string,
    body: (setup: ZeropsSetup["Service"]) => Effect.Effect<A, E>,
  ) => withServer(world, database, body, FAST, "mate");

  it.live(
    "a Mate born on the engine stands up: a wake for the person who asked, into a new conversation given its agent",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        const database = freshDatabase();
        yield* Ref.set(world.threads, []);
        yield* Ref.set(world.signers, SIGNED);
        yield* onEngine(world, database, (setup) => setup.awaitStandUp);
        const [wake] = yield* Ref.get(world.wakes);
        assert.deepStrictEqual(
          [wake?.kind, wake?.principal, wake?.text, wake?.key.startsWith("mate-standup-")],
          [
            "standup",
            { kind: "standup", startedBy: "user-a" },
            "Stand up development of the project.",
            true,
          ],
        );
        const [[conversation, agent] = []] = yield* Ref.get(world.assigned);
        assert.strictEqual(conversation, wake?.conversationId);
        assert.deepStrictEqual(agent, {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          // The agent's default model: what a person's composer would send on it.
          model: DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("claudeAgent")],
          profile: { kind: "mate" },
        });
        // Admitted by the engine at the run's admitted transition, like any run: not here.
        assert.deepStrictEqual(yield* Ref.get(world.admitted), []);
        assert.deepStrictEqual(yield* Ref.get(world.dispatched), []);
        assert.deepStrictEqual(
          (yield* recordIn(database, "")).map((row) => row.source),
          ["server"],
        );
      }),
  );

  it.live("a flipped Mate's main conversation moves to the engine with its id and its agent", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      // Its stand-up settled on V1 long ago.
      yield* recordIn(database, "server");
      yield* Ref.set(world.providers, [instance("claudeAgent"), instance("codex")]);
      yield* onEngine(world, database, (setup) =>
        Effect.andThen(
          setup.awaitStandUp,
          eventually(Ref.get(world.assigned), (all) => all.length > 0),
        ),
      );
      assert.deepStrictEqual(yield* Ref.get(world.assigned), [
        [
          "thread-main",
          { instanceId: "codex", driver: "codex", model: "gpt-5.5", profile: { kind: "mate" } },
        ],
      ]);
      assert.deepStrictEqual(yield* Ref.get(world.wakes), []);
    }),
  );

  it.live(
    "a flipped Mate's main conversation brings its V1 record in before it takes its agent",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        const database = freshDatabase();
        yield* recordIn(database, "server");
        yield* Ref.set(world.providers, [instance("claudeAgent"), instance("codex")]);
        yield* onEngine(world, database, (setup) =>
          Effect.andThen(
            setup.awaitStandUp,
            eventually(Ref.get(world.assigned), (all) => all.length > 0),
          ),
        );
        assert.deepStrictEqual(yield* Ref.get(world.imported), [
          ["thread-main", { kind: "v1", threadId: "thread-main" }, 0],
        ]);
      }),
  );

  it.live("a stand-up still due on a flipped Mate goes into its main conversation", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
      yield* onEngine(world, freshDatabase(), (setup) => setup.awaitStandUp);
      const [wake] = yield* Ref.get(world.wakes);
      assert.deepStrictEqual(
        [wake?.conversationId, wake?.key],
        ["thread-main", "mate-standup-thread-main-1"],
      );
      // On the agent the person signed in, not the conversation's other one.
      const given = (yield* Ref.get(world.assigned)).at(-1)?.[1] as
        | { readonly instanceId: string }
        | undefined;
      assert.strictEqual(given?.instanceId, "claudeAgent");
    }),
  );

  it.live("a conversation already under way settles the stand-up as skipped", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* Ref.set(world.threads, []);
      yield* Ref.set(world.engineViews, [
        {
          ...engineView("mate-c"),
          agent: {
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            model: "m",
            profile: { kind: "mate" },
          },
          lastPerson: { text: "Hi", at: 1 },
        },
      ]);
      yield* Ref.set(world.signers, SIGNED);
      yield* onEngine(world, database, (setup) => setup.awaitStandUp);
      assert.deepStrictEqual(yield* Ref.get(world.wakes), []);
      assert.deepStrictEqual(
        (yield* recordIn(database, "")).map((row) => row.source),
        ["skipped"],
      );
    }),
  );

  it.live("a stand-up claimed before a restart goes once, under its claim's id", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* recordIn(database, "server:claimed");
      yield* Ref.set(world.signers, SIGNED);
      yield* onEngine(world, database, (setup) => setup.awaitStandUp);
      assert.deepStrictEqual(
        (yield* Ref.get(world.wakes)).map((wake) => [wake.conversationId, wake.key]),
        [["thread-main", "mate-standup-thread-main-1"]],
      );
      // Its wake is in the engine now: a later restart sends nothing again.
      yield* Ref.set(world.wokenRuns, {
        [wakeId(ConversationId.make("thread-main"), "standup", "mate-standup-thread-main-1")]: {
          end: null,
        },
      });
      yield* onEngine(world, database, (setup) => setup.awaitStandUp);
      assert.strictEqual((yield* Ref.get(world.wakes)).length, 1);
      assert.deepStrictEqual(
        (yield* recordIn(database, "")).map((row) => row.source),
        ["server"],
      );
    }),
  );

  it.live(
    "a stand-up the engine refused reads as a failed send, and its asker's retry goes again",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        const database = freshDatabase();
        yield* Ref.set(world.signers, SIGNED);
        yield* onEngine(world, database, (setup) =>
          Effect.gen(function* () {
            yield* setup.awaitStandUp;
            const [first] = yield* Ref.get(world.wakes);
            // The engine's admission refused it before anything of it ran.
            yield* Ref.set(world.wokenRuns, {
              [wakeId(first!.conversationId, "standup", first!.key)]: {
                end: { kind: "failed", reason: "Ana's sign-in was removed.", next: null },
                source: "inferred-from-effect",
                reached: false,
              },
            });
            const step = Effect.map(
              setup.document,
              (document) => document.steps.find((one) => one.id === "standup")?.state,
            );
            assert.strictEqual(yield* step, "failed");
            assert.isFalse(yield* setup.retry("user-b"));
            assert.isTrue(yield* setup.retry("user-a"));
          }),
        );
        const keys = (yield* Ref.get(world.wakes)).map((wake) => wake.key);
        assert.strictEqual(keys.length, 2);
        assert.notStrictEqual(keys[0], keys[1]);
        assert.deepStrictEqual(
          (yield* recordIn(database, "")).map((row) => row.source),
          ["server"],
        );
      }),
  );

  it.live(
    "a stand-up whose message may already be in the agent is never offered for a second try",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        const database = freshDatabase();
        yield* Ref.set(world.signers, SIGNED);
        yield* onEngine(world, database, (setup) =>
          Effect.gen(function* () {
            yield* setup.awaitStandUp;
            const [first] = yield* Ref.get(world.wakes);
            // Its session closed while the message was being sent: it may have arrived.
            yield* Ref.set(world.wokenRuns, {
              [wakeId(first!.conversationId, "standup", first!.key)]: {
                end: { kind: "failed", reason: "The session closed.", next: null },
                source: "inferred-from-effect",
                reached: "unknown",
              },
            });
            assert.isFalse(yield* setup.retry("user-a"));
          }),
        );
        assert.strictEqual((yield* Ref.get(world.wakes)).length, 1);
        assert.deepStrictEqual(
          (yield* recordIn(database, "")).map((row) => row.source),
          ["server"],
        );
      }),
  );

  it.live(
    "a stand-up V1 was running at the flip settles as cut by the switch, and its asker may try again",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        const database = freshDatabase();
        yield* recordIn(database, "server");
        // V1's boot reconcile is parked: its projection says running for good.
        yield* turnRow(database, "thread-main", "mate-standup-thread-main-1", "running");
        yield* onEngine(world, database, (setup) =>
          Effect.gen(function* () {
            yield* setup.awaitStandUp;
            const step = Effect.map(
              setup.document,
              (document) => document.steps.find((one) => one.id === "standup")?.state,
            );
            assert.strictEqual(yield* step, "failed");
            yield* Ref.set(world.signers, SIGNED);
            assert.isTrue(yield* setup.retry("user-a"));
          }),
        );
        assert.deepStrictEqual(
          (yield* Ref.get(world.wakes)).map((wake) => wake.conversationId),
          ["thread-main"],
        );
      }),
  );

  it.live("a stand-up V1 finished before the flip stays finished", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* recordIn(database, "server");
      yield* turnRow(database, "thread-main", "mate-standup-thread-main-1", "completed");
      yield* onEngine(world, database, (setup) =>
        Effect.gen(function* () {
          yield* setup.awaitStandUp;
          const step = Effect.map(
            setup.document,
            (document) => document.steps.find((one) => one.id === "standup")?.state,
          );
          assert.strictEqual(yield* step, "done");
          assert.isFalse(yield* setup.retry("user-a"));
        }),
      );
    }),
  );

  it.live(
    "a conversation the engine cannot read is never taken for none: the stand-up and the flip wait",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        const database = freshDatabase();
        yield* Ref.set(world.signers, SIGNED);
        yield* Ref.set(world.engineComplete, false);
        yield* onEngine(world, database, () =>
          Effect.gen(function* () {
            yield* ticks;
            assert.deepStrictEqual(yield* Ref.get(world.assigned), []);
            assert.deepStrictEqual(yield* Ref.get(world.wakes), []);
            assert.deepStrictEqual(yield* recordIn(database, ""), []);
            // Readable again: the flip and the stand-up go, into the main conversation.
            yield* Ref.set(world.engineComplete, true);
            yield* eventually(Ref.get(world.wakes), (wakes) => wakes.length === 1);
          }),
        );
        assert.deepStrictEqual(
          (yield* Ref.get(world.wakes)).map((wake) => wake.conversationId),
          ["thread-main"],
        );
      }),
  );

  it.live("the setup document reads the stand-up's run from the engine", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* Ref.set(world.signers, SIGNED);
      const key = wakeId(
        ConversationId.make("thread-main"),
        "standup",
        "mate-standup-thread-main-1",
      );
      const step = () =>
        onEngine(world, database, (setup) =>
          Effect.andThen(
            setup.awaitStandUp,
            Effect.map(
              setup.document,
              (document) => document.steps.find((one) => one.id === "standup")?.state,
            ),
          ),
        );
      yield* Ref.set(world.wokenRuns, { [key]: { end: null } });
      assert.strictEqual(yield* step(), "running");
      yield* Ref.set(world.wokenRuns, { [key]: { end: { kind: "completed" } } });
      assert.strictEqual(yield* step(), "done");
      yield* Ref.set(world.wokenRuns, {
        [key]: { end: { kind: "failed", reason: "x", next: null } },
      });
      assert.strictEqual(yield* step(), "failed");
    }),
  );
});
