import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  TurnId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import * as EnvironmentAuth from "../src/auth/EnvironmentAuth.ts";
import * as ServerConfig from "../src/config.ts";
import * as ServerEnvironment from "../src/environment/ServerEnvironment.ts";
import * as Keybindings from "../src/keybindings.ts";
import { OrchestrationLayerLive } from "../src/orchestration/runtimeLayer.ts";
import * as OrchestrationEngine from "../src/orchestration/Services/OrchestrationEngine.ts";
import * as OrchestrationReactor from "../src/orchestration/Services/OrchestrationReactor.ts";
import * as ProjectionSnapshotQuery from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeSqlitePersistenceLive } from "../src/persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../src/persistence/ProviderSessionRuntime.ts";
import * as ExternalLauncher from "../src/process/externalLauncher.ts";
import { ProviderSessionDirectoryLive } from "../src/provider/Layers/ProviderSessionDirectory.ts";
import * as ProviderService from "../src/provider/Services/ProviderService.ts";
import * as ProviderSessionDirectory from "../src/provider/Services/ProviderSessionDirectory.ts";
import * as ProviderSessionReaper from "../src/provider/Services/ProviderSessionReaper.ts";
import * as RepositoryIdentityResolver from "../src/project/RepositoryIdentityResolver.ts";
import * as ServerLifecycleEvents from "../src/serverLifecycleEvents.ts";
import * as ServerRuntimeStartup from "../src/serverRuntimeStartup.ts";
import { engineLayerInert } from "../src/engine/layer.ts";
import * as ServerSettings from "../src/serverSettings.ts";

const providerInstanceId = ProviderInstanceId.make("codex");
const projectId = ProjectId.make("project-startup-orphan");
const threadId = ThreadId.make("thread-startup-orphan");
const legacyThreadId = ThreadId.make("thread-legacy-restart");
const legacyTurnId = TurnId.make("turn-legacy-restart");
const stoppedBindingThreadId = ThreadId.make("thread-startup-orphan-stopped-binding");
const resumeCursor = { schemaVersion: 1, sessionId: "provider-session-before-restart" };
const stoppedBindingResumeCursor = {
  schemaVersion: 1,
  sessionId: "provider-session-stopped-before-restart",
};

const makePersistedRuntimeLayer = (dbPath: string) => {
  const persistence = makeSqlitePersistenceLive(dbPath);
  const orchestration = OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(persistence),
  );
  const directory = ProviderSessionDirectoryLive.pipe(
    Layer.provide(ProviderSessionRuntime.layer),
    Layer.provide(persistence),
  );
  return Layer.mergeAll(orchestration, directory);
};

const startupDependencies = Layer.mergeAll(
  Layer.mock(Keybindings.Keybindings)({
    start: Effect.void,
  }),
  ServerSettings.layerTest(),
  Layer.succeed(OrchestrationReactor.OrchestrationReactor, {
    start: () => Effect.void,
  }),
  Layer.succeed(ProviderSessionReaper.ProviderSessionReaper, {
    start: () => Effect.void,
  }),
  ServerLifecycleEvents.layer,
  Layer.succeed(ServerEnvironment.ServerEnvironment, {
    getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-startup-orphan")),
    getDescriptor: Effect.succeed({
      environmentId: EnvironmentId.make("environment-startup-orphan"),
      label: "Startup orphan test",
      version: "test",
      platform: { os: "linux", arch: "x64" },
      capabilities: {},
    } as never),
  }),
  Layer.mock(EnvironmentAuth.EnvironmentAuth)({}),
  Layer.mock(ExternalLauncher.ExternalLauncher)({
    launchBrowser: () => Effect.void,
  }),
  Layer.succeed(
    HttpServer.HttpServer,
    HttpServer.HttpServer.of({
      address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 3773),
      serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
    }),
  ),
  Layer.succeed(ProviderService.ProviderService, {
    startSession: () => Effect.die("unused"),
    sendTurn: () => Effect.die("unused"),
    compactThread: () => Effect.die("unused"),
    interruptTurn: () => Effect.die("unused"),
    respondToRequest: () => Effect.die("unused"),
    respondToUserInput: () => Effect.die("unused"),
    stopSession: () => Effect.die("unused"),
    listSessions: () => Effect.succeed([]),
    getCapabilities: () => Effect.die("unused"),
    assertConversationRollbackSupported: () => Effect.die("unused"),
    getInstanceInfo: () => Effect.die("unused"),
    rollbackConversation: () => Effect.die("unused"),
    uploadFeedback: () => Effect.die("unused"),
    streamEvents: Stream.empty,
  }),
);

it.effect(
  "recovers a persisted starting session before opening the command gate after restart",
  () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const firstRuntime = makePersistedRuntimeLayer(config.dbPath);
      const now = yield* DateTime.now;
      const createdAt = DateTime.formatIso(now);
      const legacyError = `Radotin - Eddy's container was replaced at ${createdAt}; its running turn was interrupted. Send a message to continue.`;
      let preUpgradeCursor = 0;

      yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngine.OrchestrationEngineService;
        const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;

        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("command-create-project"),
          projectId,
          title: "Startup orphan project",
          workspaceRoot: "/tmp/startup-orphan-project",
          defaultModelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("command-create-thread"),
          threadId,
          projectId,
          title: "Startup orphan thread",
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("command-start-pending-turn"),
          threadId,
          message: {
            messageId: MessageId.make("message-pending-before-restart"),
            role: "user",
            text: "Persist this queued turn before restart",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("command-mark-session-starting"),
          threadId,
          session: {
            threadId,
            status: "starting",
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        for (const [kind, requestId] of [
          ["user-input.requested", "native-question"],
          ["approval.requested", "native-approval"],
        ] as const) {
          yield* engine.dispatch({
            type: "thread.activity.append",
            commandId: CommandId.make(`request:${requestId}`),
            threadId,
            createdAt,
            activity: {
              id: EventId.make(requestId),
              kind,
              tone: "info",
              summary: "Dead provider request",
              turnId: null,
              createdAt,
              payload: {
                requestId,
                responseMode: "native",
                questions: [
                  {
                    id: "where",
                    header: "Target",
                    question: "Where?",
                    options: [],
                    multiSelect: false,
                  },
                ],
              },
            },
          });
        }
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create-legacy"),
          threadId: legacyThreadId,
          projectId,
          title: "Legacy restart",
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        const legacySession = {
          threadId: legacyThreadId,
          providerName: "codex",
          providerInstanceId,
          runtimeMode: "full-access" as const,
          lastError: null,
          updatedAt: createdAt,
        };
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("legacy-running"),
          threadId: legacyThreadId,
          createdAt,
          session: { ...legacySession, status: "running", activeTurnId: legacyTurnId },
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("legacy-error"),
          threadId: legacyThreadId,
          createdAt,
          session: {
            ...legacySession,
            status: "error",
            activeTurnId: null,
            lastError: legacyError,
          },
        });
        preUpgradeCursor = yield* engine.latestSequence;
        yield* directory.upsert({
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId,
          status: "running",
          resumeCursor,
          runtimePayload: { activeTurnId: null, unrelated: "preserve-me" },
          runtimeMode: "full-access",
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("command-create-stopped-binding-thread"),
          threadId: stoppedBindingThreadId,
          projectId,
          title: "Startup orphan with stopped binding",
          modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("command-start-stopped-binding-pending-turn"),
          threadId: stoppedBindingThreadId,
          message: {
            messageId: MessageId.make("message-stopped-binding-pending-before-restart"),
            role: "user",
            text: "Persist another queued turn before restart",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("command-mark-stopped-binding-session-starting"),
          threadId: stoppedBindingThreadId,
          session: {
            threadId: stoppedBindingThreadId,
            status: "starting",
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: createdAt,
          },
          createdAt,
        });
        yield* directory.upsert({
          threadId: stoppedBindingThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId,
          status: "stopped",
          resumeCursor: stoppedBindingResumeCursor,
          runtimePayload: { activeTurnId: "stale", unrelated: "also-preserve-me" },
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(firstRuntime));

      const secondRuntime = makePersistedRuntimeLayer(config.dbPath);
      const startupLayer = ServerRuntimeStartup.layer.pipe(
        Layer.provideMerge(secondRuntime),
        Layer.provideMerge(startupDependencies),
        Layer.provideMerge(engineLayerInert),
      );

      const result = yield* Effect.gen(function* () {
        const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
        const engine = yield* OrchestrationEngine.OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
        const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
        const sql = yield* SqlClient.SqlClient;

        yield* startup.markHttpListening;
        yield* startup.awaitCommandReady;

        const restartedThread = Option.getOrThrow(yield* query.getThreadDetailById(threadId));
        const restartedStoppedBindingThread = Option.getOrThrow(
          yield* query.getThreadDetailById(stoppedBindingThreadId),
        );
        const legacy = Option.getOrThrow(yield* query.getThreadDetailById(legacyThreadId));
        assert.deepStrictEqual(legacy.session?.interruption, {
          turnId: legacyTurnId,
          restart: { cause: "replaced", at: createdAt },
          continuation: "manual",
        });
        assert.strictEqual(legacy.latestTurn?.state, "interrupted");
        const head = yield* engine.latestSequence;
        const replay = yield* Stream.runCollect(
          engine.readThreadEvents({
            threadId: legacyThreadId,
            fromSequenceExclusive: preUpgradeCursor,
            toSequenceInclusive: head,
          }),
        );
        assert.strictEqual(replay.length, 1);
        const correction = replay[0];
        assert.strictEqual(correction?.type, "thread.session-set");
        if (correction?.type !== "thread.session-set")
          throw new Error("Missing replayable restart correction");
        assert.deepStrictEqual(
          correction.payload.session.interruption,
          legacy.session?.interruption,
        );
        assert.isAbove(correction.sequence, preUpgradeCursor);
        const original = yield* Stream.runCollect(
          engine.readThreadEvents({
            threadId: legacyThreadId,
            fromSequenceExclusive: 0,
            toSequenceInclusive: preUpgradeCursor,
          }),
        );
        assert.isTrue(
          original.some(
            (event) =>
              event.type === "thread.session-set" &&
              event.payload.session.lastError === legacyError,
          ),
        );
        assert.strictEqual(
          restartedThread.session?.interruption?.messageId,
          "message-pending-before-restart",
        );
        assert.deepStrictEqual(
          restartedThread.activities.find((activity) => activity.kind === "runtime.interrupted")
            ?.payload,
          { interruption: restartedThread.session?.interruption },
        );
        const shell = (yield* query.getShellSnapshot()).threads.find(
          (thread) => thread.id === threadId,
        );
        assert.strictEqual(shell?.hasPendingUserInput, false);
        assert.strictEqual(shell?.hasPendingApprovals, false);
        assert.isTrue(
          restartedThread.activities.some((activity) => activity.kind === "user-input.resolved"),
        );
        assert.isTrue(
          restartedThread.activities.some((activity) => activity.kind === "approval.resolved"),
        );
        const pendingRows = yield* sql<{ readonly threadId: string }>`
          SELECT thread_id AS "threadId"
          FROM projection_turns
          WHERE thread_id IN (${threadId}, ${stoppedBindingThreadId})
            AND turn_id IS NULL
            AND state = 'pending'
        `;
        const settleExit = yield* Effect.exit(
          engine.dispatch({
            type: "thread.settle",
            commandId: CommandId.make("command-settle-after-restart"),
            threadId,
          }),
        );
        const snoozeExit = yield* Effect.exit(
          engine.dispatch({
            type: "thread.snooze",
            commandId: CommandId.make("command-snooze-after-restart"),
            threadId,
            snoozedUntil: DateTime.formatIso(DateTime.add(now, { hours: 1 })),
          }),
        );
        const newTurnExit = yield* Effect.exit(
          engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make("command-new-turn-after-restart"),
            threadId,
            message: {
              messageId: MessageId.make("message-new-turn-after-restart"),
              role: "user",
              text: "Continue immediately after restart",
              attachments: [],
            },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            createdAt,
          }),
        );
        const binding = Option.getOrThrow(yield* directory.getBinding(threadId));
        const stoppedBinding = Option.getOrThrow(
          yield* directory.getBinding(stoppedBindingThreadId),
        );

        return {
          sessionStatus: restartedThread.session?.status,
          activeTurnId: restartedThread.session?.activeTurnId,
          interruption: restartedThread.session?.interruption,
          lastError: restartedThread.session?.lastError,
          latestTurn: restartedThread.latestTurn,
          pendingTurnCount: pendingRows.length,
          settleSucceeded: Exit.isSuccess(settleExit),
          snoozeSucceeded: Exit.isSuccess(snoozeExit),
          newTurnSucceeded: Exit.isSuccess(newTurnExit),
          bindingStatus: binding.status,
          resumeCursor: binding.resumeCursor,
          runtimePayload: binding.runtimePayload,
          stoppedBindingSessionStatus: restartedStoppedBindingThread.session?.status,
          stoppedBindingStatus: stoppedBinding.status,
          stoppedBindingResumeCursor: stoppedBinding.resumeCursor,
          stoppedBindingRuntimePayload: stoppedBinding.runtimePayload,
        };
      }).pipe(Effect.provide(startupLayer));

      assert.deepStrictEqual(result, {
        sessionStatus: "interrupted",
        activeTurnId: null,
        interruption: {
          turnId: null,
          messageId: MessageId.make("message-pending-before-restart"),
          restart: { cause: "restarted", at: createdAt },
          continuation: "manual",
        },
        lastError: null,
        latestTurn: null,
        pendingTurnCount: 0,
        settleSucceeded: true,
        snoozeSucceeded: true,
        newTurnSucceeded: true,
        bindingStatus: "stopped",
        resumeCursor,
        runtimePayload: { activeTurnId: null, unrelated: "preserve-me" },
        stoppedBindingSessionStatus: "interrupted",
        stoppedBindingStatus: "stopped",
        stoppedBindingResumeCursor,
        stoppedBindingRuntimePayload: {
          activeTurnId: null,
          unrelated: "also-preserve-me",
        },
      });
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-orphaned-provider-session-startup-",
        }).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
);
