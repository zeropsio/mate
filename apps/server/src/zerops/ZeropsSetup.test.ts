// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import { ServerCommandReadiness } from "../spi/serverCommandReadiness.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import {
  ZeropsSetup,
  ZeropsSetupReads,
  makeZeropsSetup,
  standUpPollDelay,
  type ZeropsSetupTimings,
} from "./ZeropsSetup.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";

const ZEROPS = resolveZeropsEnvironment({
  projectId: "project-mate",
  apiHost: undefined,
  allowedOrigins: [],
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

const ASKED = ["mate:face:coral:gem", "mate:standup:user-a"];
const SIGNED = [...ASKED, "mate:signer:claude-code:user-a"];

interface World {
  readonly tags: Ref.Ref<ReadonlyArray<string> | undefined>;
  readonly variables: Ref.Ref<ReadonlyArray<string>>;
  /** How many times the project's tags were read from the platform. */
  readonly tagReads: Ref.Ref<number>;
  readonly statusFile: Ref.Ref<unknown>;
  readonly threads: Ref.Ref<ReadonlyArray<OrchestrationThreadShell>>;
  readonly dispatched: Ref.Ref<ReadonlyArray<OrchestrationCommand>>;
  readonly admitted: Ref.Ref<ReadonlyArray<TurnPrincipal>>;
  readonly refusal: Ref.Ref<string | undefined>;
  /** A dispatch never comes back: the server dies before its stand-up goes out. */
  readonly dispatchHangs: Ref.Ref<boolean>;
  /** How long one read of the tags takes. */
  readonly tagsTake: Ref.Ref<Duration.Duration>;
}

const makeWorld = Effect.gen(function* () {
  return {
    tags: yield* Ref.make<ReadonlyArray<string> | undefined>(ASKED),
    // Made by the new press: it always sets the runtimes plan, even an empty one.
    variables: yield* Ref.make<ReadonlyArray<string>>(["PATH", "MATE_SETUP_RUNTIMES"]),
    tagReads: yield* Ref.make(0),
    statusFile: yield* Ref.make<unknown>(undefined),
    threads: yield* Ref.make<ReadonlyArray<OrchestrationThreadShell>>([mainThread()]),
    dispatched: yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]),
    admitted: yield* Ref.make<ReadonlyArray<TurnPrincipal>>([]),
    refusal: yield* Ref.make<string | undefined>(undefined),
    dispatchHangs: yield* Ref.make(false),
    tagsTake: yield* Ref.make(Duration.zero),
  } satisfies World;
});

const fakes = (world: World) =>
  Layer.mergeAll(
    Layer.succeed(ZeropsSetupReads, {
      tags: Ref.update(world.tagReads, (count) => count + 1).pipe(
        Effect.andThen(Effect.flatMap(Ref.get(world.tagsTake), Effect.sleep)),
        Effect.andThen(Ref.get(world.tags)),
      ),
      serviceVariables: Ref.get(world.variables),
      statusFile: Ref.get(world.statusFile),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.gen(function* () {
          if (yield* Ref.get(world.dispatchHangs)) return yield* Effect.never;
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
  );

const FAST: ZeropsSetupTimings = {
  poll: Duration.millis(10),
  slowPoll: Duration.millis(10),
  fastFor: Duration.minutes(30),
  noneAfter: Duration.millis(0),
  tagsTtl: Duration.millis(0),
  tagsFailedTtl: Duration.millis(0),
  claimMaxAge: Duration.minutes(2),
};

/** A server on `database`; a second one on the same file is the same Mate after a restart. */
const serverOn = (world: World, database: string, timings: ZeropsSetupTimings = FAST) =>
  Layer.effect(ZeropsSetup, makeZeropsSetup(timings)).pipe(
    Layer.provide(fakes(world)),
    Layer.provide(
      ServerConfig.layer({
        cwd: "/var/www",
        zerops: ZEROPS,
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
) =>
  Effect.gen(function* () {
    const setup = yield* ZeropsSetup;
    return yield* body(setup);
  }).pipe(Effect.provide(serverOn(world, database, timings)), Effect.scoped);

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
          yield* Ref.set(world.tags, SIGNED);
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
            kind: "session",
            subject: "zerops-user:user-a",
          });
        }),
      );
    }),
  );

  it.live("a restart repeats nothing", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* Ref.set(world.tags, SIGNED);
      yield* withServer(world, database, () =>
        eventually(turnsOf(world), (turns) => turns.length === 1),
      );
      yield* withServer(world, database, () => ticks);
      assert.strictEqual((yield* turnsOf(world)).length, 1);
    }),
  );

  it.live("a turn admission refuses goes out once admission lets it", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, SIGNED);
      yield* Ref.set(world.refusal, "not signed in yet");
      yield* withServer(world, freshDatabase(), () =>
        Effect.gen(function* () {
          yield* ticks;
          assert.deepStrictEqual(yield* turnsOf(world), []);
          yield* Ref.set(world.refusal, undefined);
          yield* eventually(turnsOf(world), (turns) => turns.length === 1);
        }),
      );
    }),
  );

  it.live("a conversation already spoken in gets no stand-up", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, SIGNED);
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
      yield* Ref.set(world.tags, SIGNED);
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

  /** Whether the tags are still being read: two reads apart, the count moved. */
  const stillPolling = (world: World) =>
    Effect.gen(function* () {
      const before = yield* Ref.get(world.tagReads);
      yield* ticks;
      return (yield* Ref.get(world.tagReads)) > before;
    });

  it.live("a Mate made before the new press never starts one, and never polls for it", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.variables, ["PATH"]);
      yield* Ref.set(world.tags, SIGNED);
      yield* withServer(world, freshDatabase(), () => ticks);
      assert.deepStrictEqual([yield* turnsOf(world), yield* Ref.get(world.tagReads)], [[], 0]);
    }),
  );

  const settles: ReadonlyArray<[string, (world: World) => Effect.Effect<void>]> = [
    ["once it started the stand-up", (world) => Ref.set(world.tags, SIGNED)],
    ["when nobody asked for one", (world) => Ref.set(world.tags, ["mate:face:coral:gem"])],
    [
      "when the conversation was already spoken in",
      (world) =>
        Effect.andThen(
          Ref.set(world.tags, SIGNED),
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
        const reads = yield* Ref.get(world.tagReads);
        yield* withServer(world, database, () => ticks);
        assert.strictEqual(yield* Ref.get(world.tagReads), reads);
      }),
    );
  }

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

  it.live("a stood-up Mate's setup document reads no tags", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, SIGNED);
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          const reads = yield* Ref.get(world.tagReads);
          const document = yield* setup.document;
          assert.strictEqual(yield* Ref.get(world.tagReads), reads);
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

  it.live("a browser's stand-up after a settled none goes through: nothing ran", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, ["mate:face:coral:gem"]);
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          yield* ticks;
          assert.strictEqual(yield* setup.browserStandUp(browserSend(1)), "dispatch");
        }),
      );
    }),
  );

  const browserSend = (attempt: number): OrchestrationCommand =>
    ({
      type: "thread.turn.start",
      commandId: `mate-standup-thread-main-${attempt}`,
      threadId: "thread-main",
    }) as unknown as OrchestrationCommand;

  it.live("a browser's stand-up while the server's ran is ignored; the same command passes", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, SIGNED);
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          assert.deepStrictEqual(
            [
              yield* setup.browserStandUp(browserSend(2)),
              yield* setup.browserStandUp(browserSend(1)),
            ],
            ["ignore", "dispatch"],
          );
        }),
      );
    }),
  );

  it.live("a browser's stand-up first is the one: the server starts none", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          assert.strictEqual(yield* setup.browserStandUp(browserSend(1)), "claimed");
          yield* setup.browserStandUpEnded(browserSend(1), "through");
          assert.strictEqual(yield* setup.browserStandUp(browserSend(2)), "ignore");
          yield* Ref.set(world.tags, SIGNED);
          yield* ticks;
          assert.deepStrictEqual(yield* turnsOf(world), []);
        }),
      );
    }),
  );

  it.live("while a browser's stand-up is on its way the server waits, still looking", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, SIGNED);
      yield* Ref.set(world.refusal, "not yet");
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          assert.strictEqual(yield* setup.browserStandUp(browserSend(1)), "claimed");
          // The send is on its way: the server would be admitted now, and starts none.
          yield* Ref.set(world.refusal, undefined);
          yield* ticks;
          assert.deepStrictEqual(yield* turnsOf(world), []);
          // The send did not go through: the server, still looking, starts its own.
          yield* setup.browserStandUpEnded(browserSend(1), "failed");
          yield* eventually(turnsOf(world), (turns) => turns.length === 1);
        }),
      );
    }),
  );

  it.live("a browser's failed send never withdraws the server's own stand-up", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* Ref.set(world.tags, SIGNED);
      yield* withServer(world, database, (setup) =>
        Effect.gen(function* () {
          yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          // The same command, as an old client sends it: it owns no claim.
          assert.strictEqual(yield* setup.browserStandUp(browserSend(1)), "dispatch");
          yield* setup.browserStandUpEnded(browserSend(1), "failed");
        }),
      );
      yield* Ref.set(world.dispatched, []);
      yield* withServer(world, database, () => ticks);
      assert.deepStrictEqual(yield* turnsOf(world), []);
    }),
  );

  it.live("on a Mate made before the new press a browser's stand-up claims nothing", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.variables, ["PATH"]);
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          assert.deepStrictEqual(
            [
              yield* setup.browserStandUp(browserSend(1), "user-a"),
              yield* setup.browserStandUp(browserSend(2), "user-a"),
            ],
            ["dispatch", "dispatch"],
          );
        }),
      );
    }),
  );

  it.live("a claim no loop will take over is withdrawn after 2 minutes", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      // Unmarked at boot, so no loop runs; marked by the time a browser sends.
      yield* Ref.set(world.variables, ["PATH"]);
      yield* withServer(
        world,
        freshDatabase(),
        (setup) =>
          Effect.gen(function* () {
            yield* ticks;
            yield* Ref.set(world.variables, ["PATH", "MATE_SETUP_RUNTIMES"]);
            assert.strictEqual(yield* setup.browserStandUp(browserSend(1), "user-a"), "claimed");
            yield* setup.browserStandUpEnded(browserSend(1), "unknown");
            yield* Effect.sleep(Duration.millis(80));
            assert.strictEqual(yield* setup.browserStandUp(browserSend(2), "user-a"), "claimed");
          }),
        { ...FAST, claimMaxAge: Duration.millis(50) },
      );
    }),
  );

  it.live("a claim taken over with nobody to send it as settles, never stuck", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, ["mate:face:coral:gem"]);
      const database = freshDatabase();
      yield* withServer(
        world,
        database,
        (setup) =>
          Effect.gen(function* () {
            assert.strictEqual(yield* setup.browserStandUp(browserSend(2)), "claimed");
            yield* setup.browserStandUpEnded(browserSend(2), "unknown");
            yield* Effect.sleep(Duration.millis(200));
          }),
        { ...FAST, claimMaxAge: Duration.millis(50), noneAfter: Duration.minutes(5) },
      );
      assert.deepStrictEqual(yield* turnsOf(world), []);
      assert.isFalse(yield* withServer(world, database, () => stillPolling(world)));
    }),
  );

  it.live("a claim taken over is sent as the person whose browser sent it", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      // Signed in, but the tags name no asker any more.
      yield* Ref.set(world.tags, ["mate:signer:claude-code:user-a"]);
      yield* withServer(
        world,
        freshDatabase(),
        (setup) =>
          Effect.gen(function* () {
            assert.strictEqual(yield* setup.browserStandUp(browserSend(2), "user-a"), "claimed");
            yield* eventually(turnsOf(world), (turns) => turns.length === 1);
            assert.deepStrictEqual((yield* Ref.get(world.admitted)).at(-1), {
              kind: "session",
              subject: "zerops-user:user-a",
            });
          }),
        { ...FAST, claimMaxAge: Duration.millis(50), noneAfter: Duration.minutes(5) },
      );
    }),
  );

  it.live("a browser's claim that never ended is the server's after 2 minutes, same ids", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, SIGNED);
      yield* withServer(
        world,
        freshDatabase(),
        (setup) =>
          Effect.gen(function* () {
            assert.strictEqual(yield* setup.browserStandUp(browserSend(2)), "claimed");
            // Its server restarted mid-send: the claim is never ended.
            const [turn] = yield* eventually(turnsOf(world), (turns) => turns.length === 1);
            assert.deepStrictEqual(
              [turn!.commandId, turn!.message.messageId],
              ["mate-standup-thread-main-2", "mate-standup-thread-main-2"],
            );
            yield* ticks;
            assert.strictEqual((yield* turnsOf(world)).length, 1);
          }),
        { ...FAST, claimMaxAge: Duration.millis(50) },
      );
    }),
  );

  it.live(
    "a browser's send that may have gone out keeps its claim; one that failed withdraws it",
    () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.tags, SIGNED);
        yield* withServer(world, freshDatabase(), (setup) =>
          Effect.gen(function* () {
            assert.strictEqual(yield* setup.browserStandUp(browserSend(2)), "claimed");
            yield* setup.browserStandUpEnded(browserSend(2), "unknown");
            yield* ticks;
            assert.deepStrictEqual(yield* turnsOf(world), [], "an unknown end left the claim");
            yield* setup.browserStandUpEnded(browserSend(2), "failed");
            yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          }),
        );
      }),
  );

  it.live("a server that died between its claim and its send sends it once after a restart", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      const database = freshDatabase();
      yield* Ref.set(world.tags, SIGNED);
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
});

describe("ZeropsSetup: what an unauthenticated caller can make it do", () => {
  const LIVE: ZeropsSetupTimings = {
    ...FAST,
    tagsTtl: Duration.seconds(15),
    tagsFailedTtl: Duration.seconds(30),
  };
  const flood = (setup: ZeropsSetup["Service"]) =>
    Effect.all(
      Array.from({ length: 20 }, () => setup.document),
      { concurrency: "unbounded" },
    );

  it.live("a flood of setup reads asks the platform for the tags once", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* withServer(
        world,
        freshDatabase(),
        (setup) => Effect.andThen(flood(setup), flood(setup)),
        LIVE,
      );
      assert.strictEqual(yield* Ref.get(world.tagReads), 1);
    }),
  );

  it.live("a request that gives up mid-read leaves the read to finish for the next", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tagsTake, Duration.millis(200));
      yield* withServer(
        world,
        freshDatabase(),
        (setup) =>
          Effect.gen(function* () {
            // The poll's own first read is done, and its cache has gone stale.
            yield* Effect.sleep(Duration.millis(400));
            const before = yield* Ref.get(world.tagReads);
            const first = yield* Effect.forkChild(setup.document);
            yield* Effect.sleep(Duration.millis(50));
            yield* Fiber.interrupt(first);
            yield* setup.document;
            yield* flood(setup);
            assert.strictEqual((yield* Ref.get(world.tagReads)) - before, 1);
          }),
        { ...LIVE, poll: Duration.minutes(10), tagsTtl: Duration.millis(100) },
      );
    }),
  );

  it.live("a failed tag read is not tried again for 30 seconds", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.tags, undefined);
      yield* withServer(
        world,
        freshDatabase(),
        (setup) => Effect.andThen(flood(setup), Effect.andThen(ticks, flood(setup))),
        LIVE,
      );
      assert.strictEqual(yield* Ref.get(world.tagReads), 1);
    }),
  );

  const quiet: ReadonlyArray<[string, (world: World) => Effect.Effect<void>]> = [
    ["a Mate made before the new press", (world) => Ref.set(world.variables, ["PATH"])],
    [
      "a Mate whose stand-up nobody asked for",
      (world) => Ref.set(world.tags, ["mate:face:coral:gem"]),
    ],
  ];
  for (const [name, arrange] of quiet) {
    it.live(`${name} reads no tags for its setup, and says nothing of a sign-in`, () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* arrange(world);
        yield* withServer(world, freshDatabase(), (setup) =>
          Effect.gen(function* () {
            yield* ticks;
            const reads = yield* Ref.get(world.tagReads);
            const documents = yield* flood(setup);
            assert.strictEqual(yield* Ref.get(world.tagReads), reads);
            assert.isFalse(documents[0]!.steps.some((step) => step.id === "signin"));
          }),
        );
      }),
    );
  }
});

describe("ZeropsSetup: the document", () => {
  const stateOf = (setup: ZeropsSetup["Service"], id: string) =>
    Effect.map(setup.document, (document) => document.steps.find((step) => step.id === id)?.state);

  it.live("follows the Mate from a bare container to a stood-up one", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* withServer(world, freshDatabase(), (setup) =>
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
          yield* Ref.update(world.variables, (now) => [
            ...now,
            "GITEA_URL",
            "GITEA_TOKEN",
            "MATE_BROKER_URL",
          ]);
          yield* Ref.set(world.statusFile, {
            version: 1,
            runtimes: { state: "importing", startedAt: "2026-10-01T10:01:00Z" },
            standup: { state: "idle" },
          });
          assert.deepStrictEqual(yield* states, ["done", "done", "running", "waiting", "waiting"]);
          yield* Ref.set(world.tags, SIGNED);
          yield* eventually(turnsOf(world), (turns) => turns.length === 1);
          assert.deepStrictEqual(yield* states, ["done", "done", "running", "done", "running"]);
          yield* Ref.set(world.statusFile, {
            version: 1,
            runtimes: { state: "done", endedAt: "2026-10-01T10:03:00Z" },
            standup: { state: "done", endedAt: "2026-10-01T10:09:00Z" },
          });
          assert.deepStrictEqual(yield* states, ["done", "done", "done", "done", "done"]);
          // A git step once done stays done: the setup is a record, not a live probe.
          yield* Ref.set(world.variables, []);
          assert.strictEqual(yield* stateOf(setup, "git"), "done");
        }),
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
