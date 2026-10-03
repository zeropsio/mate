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
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import { ServerCommandReadiness } from "../spi/serverCommandReadiness.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import type { HqStanding } from "./ZeropsHqLink.ts";
import type { ProjectSigners } from "./ZeropsProjectSigners.ts";
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

/**
 * The Mate as its HQ sends it, `standupRequestedBy` naming who asked for its stand-up, its birth
 * whole once its project is closed off (the press records the ask before the close-off).
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
const ASKED = linked("user-a");
const NOBODY_ASKED = linked(null);
/** The asker signed Claude in here. */
const SIGNED: ProjectSigners = { "claude-code": "user-a" };

interface World {
  /** Where the Mate stands with its HQ. */
  readonly hq: Ref.Ref<HqStanding>;
  /** Who this server saw sign each login in. */
  readonly signers: Ref.Ref<ProjectSigners>;
  readonly variables: Ref.Ref<ReadonlyArray<string>>;
  /** How many times where it stands with HQ was read. */
  readonly hqReads: Ref.Ref<number>;
  readonly statusFile: Ref.Ref<unknown>;
  readonly threads: Ref.Ref<ReadonlyArray<OrchestrationThreadShell>>;
  readonly dispatched: Ref.Ref<ReadonlyArray<OrchestrationCommand>>;
  readonly admitted: Ref.Ref<ReadonlyArray<TurnPrincipal>>;
  readonly refusal: Ref.Ref<string | undefined>;
  /** A dispatch never comes back: the server dies before its stand-up goes out. */
  readonly dispatchHangs: Ref.Ref<boolean>;
}

const makeWorld = Effect.gen(function* () {
  return {
    hq: yield* Ref.make(ASKED),
    signers: yield* Ref.make<ProjectSigners>({}),
    // Made by the new press: it always sets the runtimes plan, even an empty one.
    variables: yield* Ref.make<ReadonlyArray<string>>(["PATH", "MATE_SETUP_RUNTIMES"]),
    hqReads: yield* Ref.make(0),
    statusFile: yield* Ref.make<unknown>(undefined),
    threads: yield* Ref.make<ReadonlyArray<OrchestrationThreadShell>>([mainThread()]),
    dispatched: yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]),
    admitted: yield* Ref.make<ReadonlyArray<TurnPrincipal>>([]),
    refusal: yield* Ref.make<string | undefined>(undefined),
    dispatchHangs: yield* Ref.make(false),
  } satisfies World;
});

const fakes = (world: World) =>
  Layer.mergeAll(
    Layer.succeed(ZeropsSetupReads, {
      hq: Ref.update(world.hqReads, (count) => count + 1).pipe(Effect.andThen(Ref.get(world.hq))),
      signers: Ref.get(world.signers),
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

  it.live("a turn admission refuses goes out once admission lets it", () =>
    Effect.gen(function* () {
      const world = yield* makeWorld;
      yield* Ref.set(world.signers, SIGNED);
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
      yield* withServer(world, database, () => ticks, { ...FAST, noneAfter: Duration.minutes(5) });
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
    [
      "HQ names nobody who asked, its birth not whole yet",
      linked(null, false),
      { reason: "awaiting_request" },
    ],
    ["asked, the asker not signed in yet", ASKED, {}],
  ];
  for (const [name, hq, said] of waits) {
    it.live(`${name}`, () =>
      Effect.gen(function* () {
        const world = yield* makeWorld;
        yield* Ref.set(world.hq, hq);
        const step = yield* withServer(
          world,
          freshDatabase(),
          (setup) =>
            Effect.map(setup.document, (document) =>
              document.steps.find((entry) => entry.id === "standup"),
            ),
          { ...FAST, noneAfter: Duration.minutes(5) },
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

/** A turn of the projection's, as the engine records one, written into the Mate's database. */
const turnRow = (database: string, threadId: string, messageId: string, state: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_turns
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
