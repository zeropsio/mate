// @effect-diagnostics nodeBuiltinImport:off
/**
 * Every failed send is heard exactly once — the reactor and ingestion run
 * together, against a fake adapter that tells each driver's events in the
 * order its real adapter tells them. A failure is heard by one record the
 * person reads: the turn's break (`runtime.error`, ingestion's) or the
 * message's failure to start (`provider.turn.start.failed`, the reactor's).
 * Never both, never none — however late ingestion reads the adapter's events.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterTurnEndedError,
  type ProviderServiceError,
} from "../../provider/Errors.ts";
import { ProviderAuthService } from "../../provider/Services/ProviderAuthService.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { makeProviderRegistryLayer } from "../../provider/testUtils/providerRegistryMock.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadLiveStep from "../ThreadLiveStep.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProviderCommandReactorLive } from "./ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionLive } from "./ProviderRuntimeIngestion.ts";

const THREAD = ThreadId.make("thread-1");
const TURN = TurnId.make("turn-1");
const STOPPED = (name: string) =>
  `${name} stopped unexpectedly. Send a message to pick up where it left off.`;
const PICTURE = "A picture you attached could not be read. Attach it again and send.";

type Driver = "claudeAgent" | "codex" | "opencode" | "cursor" | "grok" | "antigravity";
type Emit = (
  type: ProviderRuntimeEvent["type"],
  rest?: { readonly turnId?: TurnId; readonly payload?: unknown },
) => Effect.Effect<void>;

/** What the fake adapter does: while the send runs, and after it returned. */
interface Script {
  /** The last send: its events, then its result or failure. */
  readonly send: (emit: Emit) => Effect.Effect<void, ProviderServiceError>;
  readonly later?: (emit: Emit) => Effect.Effect<void>;
  /**
   * The send is a follow-up into a running turn: an earlier message opened
   * it (its send succeeded), and this one steers into it.
   */
  readonly steer?: boolean;
  /** Sends after the last one's failure — a resend on a new session — succeed, opening the turn. */
  readonly resendOpens?: boolean;
}

const started = (emit: Emit) => emit("turn.started", { turnId: TURN, payload: {} });
const failedTurn = (emit: Emit, errorMessage: string, terminalReason?: string) =>
  emit("turn.completed", {
    turnId: TURN,
    payload: { state: "failed", errorMessage, ...(terminalReason ? { terminalReason } : {}) },
  });
const said = (emit: Emit, message: string, errorClass: string) =>
  emit("runtime.error", { turnId: TURN, payload: { message, class: errorClass } });
const exited = (emit: Emit, exitKind?: "error" | "graceful") =>
  emit("session.exited", { payload: exitKind === undefined ? {} : { exitKind } });
const turnEnded = (driver: Driver, detail: string) =>
  new ProviderAdapterTurnEndedError({ provider: driver, threadId: THREAD, turnId: TURN, detail });
const requestFailed = (driver: Driver, detail: string) =>
  new ProviderAdapterRequestError({ provider: driver, method: "turn/start", detail });

/** Cursor, Grok and Antigravity hold the whole turn in their send; the others return once it starts. */
const holdsTurn = (driver: Driver) =>
  driver === "cursor" || driver === "grok" || driver === "antigravity";

const NAMES: Record<Driver, string> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok",
  antigravity: "Antigravity",
};

/** Each driver's failures, told in the order its adapter tells them. */
function scriptFor(
  driver: Driver,
  failure: "crash" | "ordinary" | "usage-limit" | "start" | "attachment" | "after-start",
): Script {
  const words = STOPPED(NAMES[driver]);
  switch (failure) {
    case "crash":
      switch (driver) {
        case "claudeAgent":
          return {
            send: started,
            later: (emit) =>
              said(emit, words, "process_exit").pipe(
                Effect.andThen(failedTurn(emit, words)),
                Effect.andThen(exited(emit, "graceful")),
              ),
          };
        case "codex":
          return { send: started, later: (emit) => exited(emit) };
        case "opencode":
          return {
            send: started,
            later: (emit) =>
              said(emit, words, "process_exit").pipe(Effect.andThen(exited(emit, "error"))),
          };
        case "cursor":
        case "grok":
          return {
            send: (emit) =>
              started(emit).pipe(
                Effect.andThen(failedTurn(emit, words, "process_exit")),
                Effect.andThen(exited(emit, "error")),
                Effect.andThen(Effect.fail(turnEnded(driver, words))),
              ),
          };
        case "antigravity":
          // Its connection's end stops the session before the prompt's failure.
          return {
            send: (emit) =>
              started(emit).pipe(
                Effect.andThen(exited(emit, "error")),
                Effect.andThen(Effect.fail(turnEnded(driver, words))),
              ),
          };
      }
    // falls through: every driver returned above
    case "ordinary": {
      const error = "Model request failed: 500";
      return holdsTurn(driver)
        ? {
            send: (emit) =>
              started(emit).pipe(
                Effect.andThen(failedTurn(emit, error)),
                Effect.andThen(Effect.fail(turnEnded(driver, error))),
              ),
          }
        : {
            send: started,
            later: (emit) =>
              said(emit, error, "provider_error").pipe(Effect.andThen(failedTurn(emit, error))),
          };
    }
    case "usage-limit": {
      const limit = `${NAMES[driver]} usage limit reached.`;
      switch (driver) {
        case "claudeAgent":
        case "codex":
        case "opencode":
          return {
            send: started,
            later: (emit) =>
              said(emit, limit, "usage_limit").pipe(
                Effect.andThen(failedTurn(emit, limit, "usage_limit")),
              ),
          };
        case "grok":
          return {
            send: (emit) =>
              started(emit).pipe(
                Effect.andThen(failedTurn(emit, limit, "usage_limit")),
                Effect.andThen(Effect.fail(turnEnded(driver, limit))),
              ),
          };
        case "cursor":
        case "antigravity":
          // No typed limit in their protocol: an ordinary failure, in its words.
          return {
            send: (emit) =>
              started(emit).pipe(
                Effect.andThen(failedTurn(emit, limit)),
                Effect.andThen(Effect.fail(turnEnded(driver, limit))),
              ),
          };
      }
    }
    // falls through: every driver returned above
    case "start":
      return {
        send: () =>
          Effect.fail(
            new ProviderAdapterProcessError({ provider: driver, threadId: THREAD, detail: words }),
          ),
      };
    case "attachment":
      // Cursor reads its pictures after its turn opens; every other adapter before.
      return driver === "cursor"
        ? {
            send: (emit) =>
              started(emit).pipe(
                Effect.andThen(failedTurn(emit, PICTURE)),
                Effect.andThen(Effect.fail(turnEnded(driver, PICTURE))),
              ),
          }
        : { send: () => Effect.fail(requestFailed(driver, PICTURE)) };
    case "after-start":
      // A failure after the turn started: in the send for whoever's send can
      // fail then, else the turn's own failure once the send returned.
      return driver === "claudeAgent" || driver === "codex"
        ? {
            send: started,
            later: (emit) =>
              failedTurn(emit, "stream disconnected before completion").pipe(Effect.asVoid),
          }
        : {
            send: (emit) =>
              started(emit).pipe(
                Effect.andThen(failedTurn(emit, "prompt failed")),
                Effect.andThen(Effect.fail(turnEnded(driver, "prompt failed"))),
              ),
          };
  }
}

/**
 * The reactor and ingestion over one engine, with a fake ProviderService that
 * runs the script. `lagMs` holds back the adapter's events from ingestion — a
 * busy worker — while the send's own result returns at once.
 */
function makeRun(driver: Driver, script: Script, lagMs: number) {
  return Effect.gen(function* () {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "send-failure-heard-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
    );
    const pubsub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const instanceId = ProviderInstanceId.make(driver);
    const provider = ProviderDriverKind.make(driver);
    const sessions: Array<ProviderSession> = [];
    let sequence = 0;
    let sendCalls = 0;
    const emit: Emit = (type, rest) =>
      Effect.gen(function* () {
        sequence += 1;
        const event = {
          type,
          eventId: EventId.make(`evt-${sequence}`),
          provider,
          providerInstanceId: instanceId,
          threadId: THREAD,
          createdAt: `2026-01-01T00:${String(Math.floor(sequence / 60)).padStart(2, "0")}:${String(sequence % 60).padStart(2, "0")}.000Z`,
          ...(rest?.turnId === undefined ? {} : { turnId: rest.turnId }),
          payload: rest?.payload ?? {},
        } as unknown as ProviderRuntimeEvent;
        if (lagMs > 0) {
          yield* PubSub.publish(pubsub, event).pipe(
            Effect.delay(`${lagMs} millis`),
            Effect.forkDetach,
          );
        } else {
          yield* PubSub.publish(pubsub, event);
        }
      });
    const now = "2026-01-01T00:00:00.000Z";
    const service: ProviderServiceShape = {
      startSession: (threadId, input) =>
        Effect.sync(() => {
          const session: ProviderSession = {
            provider,
            providerInstanceId: instanceId,
            status: "ready",
            runtimeMode: input.runtimeMode ?? "full-access",
            ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
            ...(input.modelSelection?.model === undefined
              ? {}
              : { model: input.modelSelection.model }),
            threadId,
            createdAt: now,
            updatedAt: now,
          };
          sessions.push(session);
          return session;
        }),
      sendTurn: () => {
        sendCalls += 1;
        const send =
          script.steer === true && sendCalls === 1
            ? started
            : sendCalls > 1 && script.resendOpens === true
              ? started
              : script.send;
        return send(emit).pipe(Effect.as({ threadId: THREAD, turnId: TURN }));
      },
      compactThread: () => Effect.void,
      interruptTurn: () => Effect.void,
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      stopSession: () => Effect.void,
      listSessions: () => Effect.succeed(sessions),
      // Claude's send that met a closed session never reached the agent.
      getCapabilities: () =>
        Effect.succeed({
          sessionModelSwitch: "in-session",
          ...(driver === "claudeAgent" ? { closedSendUndelivered: true } : {}),
        }),
      getInstanceInfo: (id) =>
        Effect.succeed({
          instanceId: id,
          driverKind: provider,
          displayName: undefined,
          enabled: true,
          continuationIdentity: { driverKind: provider, continuationKey: `${driver}:${id}` },
        }),
      assertConversationRollbackSupported: () => Effect.die("unsupported"),
      rollbackConversation: () => Effect.die("unsupported"),
      uploadFeedback: () => Effect.die("unsupported"),
      get streamEvents() {
        return Stream.fromPubSub(pubsub);
      },
    };

    const engineLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    );
    const layer = Layer.mergeAll(ProviderCommandReactorLive, ProviderRuntimeIngestionLive).pipe(
      Layer.provideMerge(engineLayer),
      Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
      Layer.provideMerge(ThreadBackgroundLiveness.layer),
      Layer.provideMerge(ThreadPlanProgress.layer),
      Layer.provideMerge(ThreadLiveStep.layer),
      Layer.provideMerge(RepositoryIdentityResolver.layer),
      Layer.provideMerge(Layer.succeed(ProviderService, service)),
      Layer.provideMerge(
        Layer.mock(ProviderAuthService, { tryHandlePromptCommand: () => Effect.succeed(false) }),
      ),
      Layer.provideMerge(makeProviderRegistryLayer([{ instanceId }] as never)),
      Layer.provideMerge(
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          renameBranch: () => Effect.die("unused"),
          pruneWorktrees: () => Effect.void,
          createWorktree: () => Effect.die("unused"),
        }),
      ),
      Layer.provideMerge(
        Layer.succeed(VcsStatusBroadcaster, {
          getStatus: () => Effect.die("unused"),
          refreshLocalStatus: () => Effect.die("unused"),
          refreshStatus: () => Effect.die("unused"),
          streamStatus: () => Stream.die("unused"),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(TextGeneration, {
          generateBranchName: () => Effect.die("unused"),
          generateThreadTitle: () => Effect.die("unused"),
        }),
      ),
      Layer.provideMerge(CheckpointStore.layer.pipe(Layer.provide(VcsDriverRegistry.layer))),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
      Layer.provideMerge(NodeServices.layer),
    );

    return yield* Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshot = yield* ProjectionSnapshotQuery;
      const reactor = yield* ProviderCommandReactor;
      const ingestion = yield* ProviderRuntimeIngestionService;
      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: baseDir,
        defaultModelSelection: { instanceId, model: "model" },
        createdAt: now,
      });
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-create"),
        threadId: THREAD,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId, model: "model" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });
      yield* ingestion.start();
      yield* reactor.start();
      // The ingestion worker subscribes before the first event.
      yield* Effect.sleep("20 millis");

      const send = (index: number) =>
        engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`cmd-turn-start-${index}`),
          threadId: THREAD,
          message: {
            messageId: MessageId.make(`message-${index}`),
            role: "user",
            text: index === 1 ? "work on it" : "and the footer too",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          createdAt: `2026-01-01T00:00:0${index}.500Z`,
        });
      yield* send(1);
      yield* reactor.drain;
      if (script.steer === true) {
        // The first message's turn runs; the follow-up steers into it.
        yield* Effect.sleep(`${lagMs + 60} millis`);
        yield* ingestion.drain;
        yield* send(2);
        yield* reactor.drain;
      }
      if (script.later) yield* script.later(emit);
      // Everything the adapter said reaches ingestion, however late.
      yield* Effect.sleep(`${lagMs + 60} millis`);
      yield* ingestion.drain;
      yield* reactor.drain;
      yield* ingestion.drain;

      const thread = (yield* snapshot.getSnapshot()).threads.find((entry) => entry.id === THREAD)!;
      return { thread, sendCalls };
    }).pipe(Effect.provide(layer));
  });
}

/**
 * A follow-up into a running turn that breaks as it goes: Claude, Codex and
 * OpenCode take the follow-up and the turn breaks after, in its events; Cursor,
 * Grok and Antigravity hold the follow-up's prompt, which fails, ending the
 * running turn.
 */
function steerScriptFor(driver: Driver, failure: "crash" | "ordinary" | "usage-limit"): Script {
  const fresh = scriptFor(driver, failure);
  if (!holdsTurn(driver)) return { ...fresh, send: () => Effect.void, steer: true };
  const words =
    failure === "crash"
      ? STOPPED(NAMES[driver])
      : failure === "usage-limit"
        ? `${NAMES[driver]} usage limit reached.`
        : "Model request failed: 500";
  const reason =
    failure === "crash"
      ? "process_exit"
      : failure === "usage-limit" && driver === "grok"
        ? "usage_limit"
        : undefined;
  // The steer's failure ends the running turn — whoever opened it — and the
  // send fails typed as that turn's.
  switch (driver) {
    case "antigravity":
      return {
        steer: true,
        send: (emit) =>
          (failure === "crash" ? exited(emit, "error") : failedTurn(emit, words, reason)).pipe(
            Effect.andThen(Effect.fail(turnEnded(driver, words))),
          ),
      };
    default:
      return {
        steer: true,
        send: (emit) =>
          failedTurn(emit, words, reason).pipe(
            Effect.andThen(failure === "crash" ? exited(emit, "error") : Effect.void),
            Effect.andThen(Effect.fail(turnEnded(driver, words))),
          ),
      };
  }
}

/**
 * Claude's stream ends while its message is built: the prompt queue is shut.
 * The send fails as a closed session, opening no turn; the reactor resends on
 * a new session, which takes it and finishes.
 */
const claudeDeadQueue: Script = {
  send: () =>
    Effect.fail(
      new ProviderAdapterSessionClosedError({ provider: "claudeAgent", threadId: THREAD }),
    ),
  resendOpens: true,
  later: (emit) =>
    emit("turn.completed", { turnId: TURN, payload: { state: "completed" } }).pipe(Effect.asVoid),
};

const FAILURES = [
  "crash",
  "ordinary",
  "usage-limit",
  "start",
  "attachment",
  "after-start",
] as const;
const DRIVERS: ReadonlyArray<Driver> = [
  "claudeAgent",
  "codex",
  "opencode",
  "cursor",
  "grok",
  "antigravity",
];

describe("every failed send is heard exactly once", () => {
  for (const driver of DRIVERS) {
    for (const failure of FAILURES) {
      for (const lagMs of [0, 250]) {
        it.live(
          `${driver}: ${failure}${lagMs > 0 ? ", ingestion lagging" : ""}`,
          () =>
            Effect.gen(function* () {
              const { thread } = yield* makeRun(driver, scriptFor(driver, failure), lagMs);
              const records = thread.activities.filter(
                (activity) =>
                  activity.kind === "runtime.error" ||
                  activity.kind === "provider.turn.start.failed",
              );
              // Heard once: one record the person reads, from one writer.
              expect(records.map((activity) => activity.kind)).toEqual([
                failure === "start" || (failure === "attachment" && driver !== "cursor")
                  ? "provider.turn.start.failed"
                  : "runtime.error",
              ]);
              // And never left working: the turn, if any, is over, and the
              // session says why.
              expect(thread.latestTurn?.state ?? null).not.toBe("running");
              expect(thread.session?.lastError ?? null).not.toBeNull();
              if (failure === "usage-limit" && driver !== "cursor" && driver !== "antigravity") {
                expect(
                  (records[0]?.payload as { readonly turnEnd?: unknown } | undefined)?.turnEnd,
                ).toBe("usage-limit");
              }
              if (failure === "crash") {
                expect(
                  (records[0]?.payload as { readonly turnEnd?: unknown } | undefined)?.turnEnd,
                ).toBe("crash");
              }
              // A picture it could not read is said plainly, on every driver.
              if (failure === "attachment") {
                expect(thread.session?.lastError ?? "").toContain(PICTURE);
              }
            }).pipe(Effect.scoped),
          20_000,
        );
      }
    }
  }
});

describe("every failed follow-up into a running turn is heard exactly once", () => {
  for (const driver of DRIVERS) {
    for (const failure of ["crash", "ordinary", "usage-limit"] as const) {
      for (const lagMs of [0, 250]) {
        it.live(
          `${driver}: the turn breaks as a follow-up steers into it: ${failure}${lagMs > 0 ? ", ingestion lagging" : ""}`,
          () =>
            Effect.gen(function* () {
              const script = steerScriptFor(driver, failure);
              const { thread } = yield* makeRun(driver, script, lagMs);
              if (!holdsTurn(driver) && script.later === undefined) return;
              const records = thread.activities.filter(
                (activity) =>
                  activity.kind === "runtime.error" ||
                  activity.kind === "provider.turn.start.failed",
              );
              // The running turn's break, once: never the follow-up's start too.
              expect(records.map((activity) => activity.kind)).toEqual(["runtime.error"]);
              expect(thread.latestTurn?.state ?? null).not.toBe("running");
              expect(thread.session?.lastError ?? null).not.toBeNull();
              if (failure === "crash") {
                expect(
                  (records[0]?.payload as { readonly turnEnd?: unknown } | undefined)?.turnEnd,
                ).toBe("crash");
              }
            }).pipe(Effect.scoped),
          20_000,
        );
      }
    }
  }
});

describe("a message Claude could not take", () => {
  it.live("its stream ended while the message was built: resent on a new session", () =>
    Effect.gen(function* () {
      const { thread, sendCalls } = yield* makeRun("claudeAgent", claudeDeadQueue, 0);
      // The message went through on a new session, and nothing failed.
      expect(sendCalls).toBe(2);
      expect(
        thread.activities.filter(
          (activity) =>
            activity.kind === "runtime.error" || activity.kind === "provider.turn.start.failed",
        ),
      ).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
