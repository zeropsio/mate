import { CommandId, ProjectId } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { ProjectionTurnRepositoryLive } from "./persistence/Layers/ProjectionTurns.ts";
import { ProjectionThreadActivityRepositoryLive } from "./persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionPendingApprovalRepositoryLive } from "./persistence/Layers/ProjectionPendingApprovals.ts";
import * as ServerConfig from "./config.ts";
import { mateUpdateBootPending } from "./mateUpdateBoot.ts";
import { MateEngine, type MateEngineService } from "./engine/MateEngine.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import { forkParked } from "./serverActivation.ts";
import { ServerCommandReadiness } from "./spi/serverCommandReadiness.ts";
import {
  formatHostForUrl,
  formatZeropsServeOutput,
  isWildcardHost,
  resolveServeConnectionString,
} from "./startupAccess.ts";

export class ServerRuntimeStartupError extends Schema.TaggedError<ServerRuntimeStartupError>()(
  "ServerRuntimeStartupError",
  {
    mode: ServerConfig.RuntimeMode,
    host: Schema.NullOr(Schema.String),
    port: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Server runtime startup failed before command readiness.";
  }
}

export class ServerRuntimeStartup extends Context.Service<
  ServerRuntimeStartup,
  {
    readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
    readonly markHttpListening: Effect.Effect<void>;
    readonly enqueueCommand: <A, E>(
      effect: Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
  }
>()("t3/serverRuntimeStartup") {}

interface QueuedCommand {
  readonly run: Effect.Effect<void, never>;
}

type CommandReadinessState = "pending" | "ready" | ServerRuntimeStartupError;

interface CommandGate {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly signalCommandReady: Effect.Effect<void>;
  readonly failCommandReady: (error: ServerRuntimeStartupError) => Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

const settleQueuedCommand = <A, E>(deferred: Deferred.Deferred<A, E>, exit: Exit.Exit<A, E>) =>
  Exit.isSuccess(exit)
    ? Deferred.succeed(deferred, exit.value)
    : Deferred.failCause(deferred, exit.cause);

export const makeCommandGate = Effect.gen(function* () {
  const commandReady = yield* Deferred.make<void, ServerRuntimeStartupError>();
  const commandQueue = yield* Queue.unbounded<QueuedCommand>();
  const commandReadinessState = yield* Ref.make<CommandReadinessState>("pending");

  const commandWorker = Effect.forever(
    Queue.take(commandQueue).pipe(Effect.flatMap((command) => command.run)),
  );
  yield* Effect.forkScoped(commandWorker);

  return {
    awaitCommandReady: Deferred.await(commandReady),
    signalCommandReady: Effect.gen(function* () {
      yield* Ref.set(commandReadinessState, "ready");
      yield* Deferred.succeed(commandReady, undefined).pipe(Effect.orDie);
    }),
    failCommandReady: (error) =>
      Effect.gen(function* () {
        yield* Ref.set(commandReadinessState, error);
        yield* Deferred.fail(commandReady, error).pipe(Effect.orDie);
      }),
    enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const readinessState = yield* Ref.get(commandReadinessState);
        if (readinessState === "ready") {
          return yield* effect;
        }
        if (readinessState !== "pending") {
          return yield* readinessState;
        }

        const result = yield* Deferred.make<A, E | ServerRuntimeStartupError>();
        yield* Queue.offer(commandQueue, {
          run: Deferred.await(commandReady).pipe(
            Effect.flatMap(() => effect),
            Effect.exit,
            Effect.flatMap((exit) => settleQueuedCommand(result, exit)),
          ),
        });
        return yield* Deferred.await(result);
      }),
  } satisfies CommandGate;
});

export const resolveWelcomeBase = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
  const projectName = segments[segments.length - 1] ?? "project";

  return {
    cwd: serverConfig.cwd,
    projectName,
  } as const;
});

/**
 * The project at the server's working directory, made when it has none: the shell every client
 * lays the engine's conversations over. Its conversations are the engine's, made by their first
 * send or the stand-up, never here.
 */
export const resolveAutoBootstrapProject = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const path = yield* Path.Path;

  if (!serverConfig.autoBootstrapProjectFromCwd) return {} as const;
  const existingProject = yield* projectionReadModelQuery.getActiveProjectByWorkspaceRoot(
    serverConfig.cwd,
  );
  if (Option.isSome(existingProject)) return { bootstrapProjectId: existingProject.value.id };
  const bootstrapProjectId = ProjectId.make(yield* crypto.randomUUIDv4);
  yield* orchestrationEngine.dispatch({
    type: "project.create",
    commandId: CommandId.make(yield* crypto.randomUUIDv4),
    projectId: bootstrapProjectId,
    title: path.basename(serverConfig.cwd) || "project",
    workspaceRoot: serverConfig.cwd,
    createdAt: DateTime.formatIso(yield* DateTime.now),
  });
  return { bootstrapProjectId };
});

const resolveStartupBrowserTarget = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const localUrl = `http://localhost:${serverConfig.port}`;
  const bindUrl =
    serverConfig.host && !isWildcardHost(serverConfig.host)
      ? `http://${formatHostForUrl(serverConfig.host)}:${serverConfig.port}`
      : localUrl;
  const baseTarget = serverConfig.devUrl?.toString() ?? bindUrl;
  return baseTarget;
});

const maybeOpenBrowser = (target: string) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;
    if (serverConfig.noBrowser) {
      return;
    }
    const externalLauncher = yield* ExternalLauncher.ExternalLauncher;

    yield* externalLauncher.launchBrowser(target).pipe(
      Effect.catch(() =>
        Effect.logInfo("browser auto-open unavailable", {
          hint: `Open ${target} in your browser.`,
        }),
      ),
    );
  });

const runStartupPhase = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateSpans({ "startup.phase": phase }),
    Effect.withSpan(`server.startup.${phase}`),
  );

/**
 * The conversation's roots: the engine's start in `reactorScope`, after an automatic update's
 * boot fence when this boot is one.
 */
export const startConversationRoots = (input: {
  readonly engine: Pick<MateEngineService, "start" | "updateDrain">;
  readonly reactorScope: Scope.Scope;
  readonly updateStateFile: string | undefined;
}): Effect.Effect<void> =>
  runStartupPhase(
    "engine.start",
    Effect.gen(function* () {
      if (mateUpdateBootPending(input.updateStateFile)) {
        if (input.engine.updateDrain === undefined)
          return yield* Effect.die(new Error("This Mate cannot fence an automatic update boot."));
        yield* input.engine.updateDrain.begin;
      }
      yield* input.engine.start().pipe(Scope.provide(input.reactorScope));
    }),
  );

interface StartupOptions {
  readonly activate?: Effect.Effect<void>;
  readonly awaitAuxiliaryParked?: Effect.Effect<void>;
  readonly abort?: (error: ServerRuntimeStartupError) => Effect.Effect<void>;
}

export const make = (options?: StartupOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;
    const keybindings = yield* Keybindings.Keybindings;
    const mateEngine = yield* MateEngine;
    const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    const crypto = yield* Crypto.Crypto;
    // Optional: the full server layer provides it (server.ts); a startup
    // built on its own, as the startup integration test does, has no one
    // waiting on it.
    const commandReadiness = yield* Effect.serviceOption(ServerCommandReadiness);

    const commandGate = yield* makeCommandGate;
    const httpListening = yield* Deferred.make<void>();
    const reactorScope = yield* Scope.make("sequential");

    yield* Effect.addFinalizer(() => Scope.close(reactorScope, Exit.void));

    const startup = Effect.gen(function* () {
      yield* Effect.logDebug("startup phase: starting keybindings runtime");
      yield* runStartupPhase(
        "keybindings.start",
        keybindings.start.pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to start keybindings runtime", {
              path: error.configPath,
              detail: error.detail,
              cause: error.cause,
            }),
          ),
        ),
      );

      yield* Effect.logDebug("startup phase: starting server settings runtime");
      yield* runStartupPhase(
        "settings.start",
        serverSettings.start.pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to start server settings runtime", {
              path: error.settingsPath,
              operation: error.operation,
              providerInstanceId: error.providerInstanceId,
              environmentVariable: error.environmentVariable,
              cause: error.cause,
            }),
          ),
        ),
      );

      yield* Effect.logDebug("startup phase: starting the Mate engine");
      yield* startConversationRoots({
        engine: mateEngine,
        reactorScope,
        updateStateFile: serverConfig.zerops?.mateUpdateStateFile,
      });

      const welcomeBase = yield* resolveWelcomeBase;
      const environment = yield* serverEnvironment.getDescriptor;
      yield* Effect.logDebug("startup phase: preparing welcome payload");

      if (serverConfig.autoBootstrapProjectFromCwd) {
        yield* forkParked(
          runStartupPhase(
            "welcome.autobootstrap",
            Effect.gen(function* () {
              const bootstrapTargets = yield* resolveAutoBootstrapProject.pipe(
                Effect.provideService(Crypto.Crypto, crypto),
              );
              if (!bootstrapTargets.bootstrapProjectId) return;

              yield* Effect.logDebug("startup phase: publishing bootstrapped welcome event", {
                environmentId: environment.environmentId,
                cwd: welcomeBase.cwd,
                projectName: welcomeBase.projectName,
                bootstrapProjectId: bootstrapTargets.bootstrapProjectId,
              });
              yield* lifecycleEvents.publish({
                version: 1,
                type: "welcome",
                payload: {
                  environment,
                  ...welcomeBase,
                  ...bootstrapTargets,
                },
              });
            }).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("startup auto-bootstrap welcome failed", {
                  cause,
                }),
              ),
            ),
          ),
        );
      }

      yield* forkParked(
        Effect.gen(function* () {
          const connectionString = yield* resolveServeConnectionString();
          yield* runStartupPhase(
            "zerops.output",
            Console.log(formatZeropsServeOutput(connectionString, serverConfig.zerops?.hqOrigin)),
          );
          if (!serverConfig.noBrowser) {
            yield* runStartupPhase(
              "browser.open",
              maybeOpenBrowser(yield* resolveStartupBrowserTarget),
            );
          }
        }),
      );

      yield* Effect.logDebug("startup phase: waiting for http listener");
      yield* runStartupPhase("http.wait", Deferred.await(httpListening));
      yield* runStartupPhase(
        "auxiliary-roots.parked",
        options?.awaitAuxiliaryParked ?? Effect.void,
      );

      yield* runStartupPhase(
        "welcome.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "welcome",
          payload: { environment, ...welcomeBase },
        }),
      );
      yield* options?.activate ?? Effect.void;

      yield* Effect.logDebug("Accepting commands");
      yield* commandGate.signalCommandReady;
      if (Option.isSome(commandReadiness)) {
        yield* commandReadiness.value.complete;
      }
      yield* runStartupPhase(
        "ready.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "ready",
          payload: {
            at: DateTime.formatIso(yield* DateTime.now),
            environment,
          },
        }),
      );
      yield* Effect.logDebug("startup phase: complete");
    }).pipe(
      Effect.annotateSpans({
        "server.mode": serverConfig.mode,
        "server.port": serverConfig.port,
        "server.host": serverConfig.host ?? "default",
      }),
      Effect.withSpan("server.startup", { kind: "server", root: true }),
    );

    yield* Effect.forkScoped(
      Effect.exit(startup).pipe(
        Effect.flatMap((startupExit) => {
          if (Exit.isSuccess(startupExit)) return Effect.void;
          const error = new ServerRuntimeStartupError({
            mode: serverConfig.mode,
            host: serverConfig.host ?? null,
            port: serverConfig.port,
            cause: startupExit.cause,
          });
          return Effect.logError("server runtime startup failed", {
            cause: startupExit.cause,
          }).pipe(
            Effect.andThen(commandGate.failCommandReady(error)),
            Effect.andThen(options?.abort?.(error) ?? Effect.void),
          );
        }),
      ),
    );

    return {
      awaitCommandReady: commandGate.awaitCommandReady,
      markHttpListening: Deferred.succeed(httpListening, undefined),
      enqueueCommand: commandGate.enqueueCommand,
    } satisfies ServerRuntimeStartup["Service"];
  });

export const layerWithOptions = (options?: StartupOptions) =>
  Layer.effect(ServerRuntimeStartup, make(options)).pipe(
    Layer.provide(
      Layer.mergeAll(
        ProjectionTurnRepositoryLive,
        ProjectionThreadActivityRepositoryLive,
        ProjectionPendingApprovalRepositoryLive,
      ),
    ),
  );

export const layer = layerWithOptions();
