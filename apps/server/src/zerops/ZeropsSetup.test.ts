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
import { ZeropsSetup, ZeropsSetupReads, makeZeropsSetup } from "./ZeropsSetup.ts";
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
  readonly statusFile: Ref.Ref<unknown>;
  readonly threads: Ref.Ref<ReadonlyArray<OrchestrationThreadShell>>;
  readonly dispatched: Ref.Ref<ReadonlyArray<OrchestrationCommand>>;
  readonly admitted: Ref.Ref<ReadonlyArray<TurnPrincipal>>;
  readonly refusal: Ref.Ref<string | undefined>;
}

const makeWorld = Effect.gen(function* () {
  return {
    tags: yield* Ref.make<ReadonlyArray<string> | undefined>(ASKED),
    variables: yield* Ref.make<ReadonlyArray<string>>(["PATH"]),
    statusFile: yield* Ref.make<unknown>(undefined),
    threads: yield* Ref.make<ReadonlyArray<OrchestrationThreadShell>>([mainThread()]),
    dispatched: yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]),
    admitted: yield* Ref.make<ReadonlyArray<TurnPrincipal>>([]),
    refusal: yield* Ref.make<string | undefined>(undefined),
  } satisfies World;
});

const fakes = (world: World) =>
  Layer.mergeAll(
    Layer.succeed(ZeropsSetupReads, {
      tags: Ref.get(world.tags),
      serviceVariables: Ref.get(world.variables),
      statusFile: Ref.get(world.statusFile),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Ref.update(world.dispatched, (all) => [...all, command]).pipe(Effect.as({ sequence: 1 })),
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

/** A server on `database`; a second one on the same file is the same Mate after a restart. */
const serverOn = (world: World, database: string) =>
  Layer.effect(
    ZeropsSetup,
    makeZeropsSetup({ poll: Duration.millis(10), tagsTtl: Duration.millis(0) }),
  ).pipe(
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
) =>
  Effect.gen(function* () {
    const setup = yield* ZeropsSetup;
    return yield* body(setup);
  }).pipe(Effect.provide(serverOn(world, database)), Effect.scoped);

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
          assert.strictEqual(yield* setup.browserStandUp(browserSend(1)), "dispatch");
          assert.strictEqual(yield* setup.browserStandUp(browserSend(2)), "ignore");
          yield* Ref.set(world.tags, SIGNED);
          yield* ticks;
          assert.deepStrictEqual(yield* turnsOf(world), []);
        }),
      );
    }),
  );

  it.live("a browser's stand-up that failed leaves the stand-up to whoever comes next", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* withServer(world, freshDatabase(), (setup) =>
        Effect.gen(function* () {
          assert.strictEqual(yield* setup.browserStandUp(browserSend(1)), "dispatch");
          yield* setup.browserStandUpFailed(browserSend(1));
          yield* Ref.set(world.tags, SIGNED);
          yield* eventually(turnsOf(world), (turns) => turns.length === 1);
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
          yield* Ref.set(world.variables, ["GITEA_URL", "GITEA_TOKEN", "MATE_BROKER_URL"]);
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
