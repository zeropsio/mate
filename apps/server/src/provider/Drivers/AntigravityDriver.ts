import {
  AntigravitySettings,
  ProviderDriverKind,
  ProviderSetupError,
  type RuntimeMode,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeAntigravityTextGeneration } from "../../textGeneration/AntigravityTextGeneration.ts";
import {
  buildAntigravityAcpSpawnInput,
  isAntigravitySignInRequiredError,
  makeAntigravityAcpRuntime,
  type AntigravityAcpRuntimeInput,
  withoutGoogleBilling,
} from "../acp/AntigravityAcpSupport.ts";
import { isolatedAntigravityGeminiDirectory } from "../acp/AntigravityGeminiDirectory.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeAntigravityAdapter } from "../Layers/AntigravityAdapter.ts";
import { makeAntigravityProvider, probeAntigravityCli } from "../Layers/AntigravityProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import * as ModelManifest from "../ModelManifest.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { discoverAntigravitySkills, resolveAntigravityUserHome } from "./AntigravitySkills.ts";

const DRIVER = ProviderDriverKind.make("antigravity");
const decodeSettings = Schema.decodeSync(AntigravitySettings);

export type AntigravityDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | ModelManifest.ModelManifest
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

/** Runs the user's agy (`agy acp`), signed in with the Google login agy saved. */
export const AntigravityDriver: ProviderDriver<AntigravitySettings, AntigravityDriverEnv> = {
  driverKind: DRIVER,
  metadata: { displayName: "Antigravity", supportsMultipleInstances: true },
  configSchema: AntigravitySettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const crypto = yield* SecureRandom.SecureRandom;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const loggers = yield* ProviderEventLoggers;
      const modelManifest = yield* ModelManifest.ModelManifest;
      const hostPlatform = yield* HostProcessPlatform;
      const settings = { ...config, enabled } satisfies AntigravitySettings;
      const processEnvironment = withoutGoogleBilling(
        mergeProviderInstanceEnvironment(environment),
      );
      const userHome = resolveAntigravityUserHome(hostPlatform, processEnvironment);
      const geminiHome = path.join(userHome, ".gemini");
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      // Google returns every model the account can use, including older
      // Gemini generations. The manifest names the current ones so the picker
      // folds the rest under its legacy section, as it does for Codex.
      const classifyModels = (draft: ServerProviderDraft) =>
        modelManifest.current.pipe(
          Effect.map((manifest) =>
            stampIdentity(ModelManifest.applyModelManifest(draft, manifest, DRIVER)),
          ),
        );

      const makeRuntime = Effect.fn("AntigravityDriver.makeRuntime")(function* ({
        runtimeMode,
        geminiDirectory,
        ...input
      }: Omit<AntigravityAcpRuntimeInput, "spawn" | "childProcessSpawner"> & {
        readonly runtimeMode?: RuntimeMode;
        /** A Gemini folder of the caller's own; default: the user's. */
        readonly geminiDirectory?: string;
      }) {
        const runtime = yield* makeAntigravityAcpRuntime({
          ...input,
          childProcessSpawner: spawner,
          spawn: buildAntigravityAcpSpawnInput({
            binaryPath: settings.binaryPath,
            cwd: input.cwd,
            environment: processEnvironment,
            runtimeMode,
            geminiDirectory,
          }),
        }).pipe(Effect.provideService(SecureRandom.SecureRandom, crypto));
        return {
          ...runtime,
          start: () =>
            runtime
              .start()
              .pipe(
                Effect.tapError((cause): Effect.Effect<void> =>
                  isAntigravitySignInRequiredError(cause) ? provider.onAuthRequired : Effect.void,
                ),
              ),
        };
      });

      /** A helper's session: tool-less, in a Gemini folder of its own that goes with the scope. */
      const makeIsolatedRuntime = Effect.fn("AntigravityDriver.makeIsolatedRuntime")(function* (
        cwd: string,
        clientName: string,
      ) {
        const geminiDirectory = yield* isolatedAntigravityGeminiDirectory(geminiHome).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError(
            (cause) =>
              new ProviderSetupError({
                instanceId,
                operation: "start",
                detail: "Could not prepare a Gemini folder for an Antigravity helper.",
                cause,
              }),
          ),
        );
        return yield* makeRuntime({
          cwd,
          clientInfo: { name: clientName, version: "0.0.0" },
          mcpServers: [],
          geminiDirectory,
        });
      });

      // Typed: the provider's catalog check calls it, and it publishes through the provider.
      const refreshModels: () => Effect.Effect<void, ProviderDriverError> = Effect.fn(
        "AntigravityDriver.refreshModels",
      )(
        function* () {
          const cwd = yield* fileSystem.makeTempDirectoryScoped({
            prefix: "t3-antigravity-catalog-",
          });
          const runtime = yield* makeIsolatedRuntime(cwd, "t3-code-provider-catalog");
          const started = yield* runtime.start();
          yield* provider.onSessionStarted(started);
          yield* Stream.runForEach(runtime.getEvents(), (event) => {
            if (event._tag === "EventStreamBarrier") {
              return Deferred.succeed(event.acknowledge, undefined).pipe(Effect.asVoid);
            }
            if (event._tag === "ConfigOptionsUpdated") {
              return provider.onConfigOptionsUpdated(event.configOptions);
            }
            return event._tag === "AvailableCommandsUpdated"
              ? provider.onAvailableCommands(event.availableCommands)
              : Effect.void;
          }).pipe(Effect.forkScoped);
          yield* runtime.drainEvents;
        },
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: "90 seconds",
          orElse: () =>
            Effect.fail(
              new ProviderDriverError({
                driver: DRIVER,
                instanceId,
                detail: "Antigravity model refresh timed out. Try again or check Google sign-in.",
              }),
            ),
        }),
        Effect.mapError((cause) =>
          cause._tag === "ProviderDriverError"
            ? cause
            : new ProviderDriverError({
                driver: DRIVER,
                instanceId,
                detail: isAntigravitySignInRequiredError(cause)
                  ? "Sign in to Antigravity before refreshing models."
                  : "Could not refresh Antigravity models. The previous model list is unchanged.",
                cause,
              }),
        ),
      );

      const provider = yield* makeAntigravityProvider(settings, {
        stampIdentity: classifyModels,
        // Kick the TTL-gated manifest refresh alongside the health check, as
        // Codex and Claude do. Without it an environment that only runs
        // Antigravity would keep classifying against a stale disk cache.
        probe: modelManifest.refreshInBackground.pipe(
          Effect.andThen(probeAntigravityCli(settings.binaryPath, processEnvironment)),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(HostProcessPlatform, hostPlatform),
        ),
        fetchCatalog: Effect.suspend(() => refreshModels()).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not read the Antigravity model catalog.", {
              detail: cause.detail,
            }),
          ),
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER,
              instanceId,
              detail: "Could not prepare the Antigravity provider status.",
              cause,
            }),
        ),
      );
      const defaultModel = modelManifest.current.pipe(
        Effect.map((manifest) => ModelManifest.manifestDefaultModel(manifest, DRIVER)),
      );
      const adapter = yield* makeAntigravityAdapter(settings, {
        instanceId,
        makeRuntime,
        defaultModel,
        onSessionStarted: provider.onSessionStarted,
        onConfigOptionsUpdated: provider.onConfigOptionsUpdated,
        onAvailableCommands: provider.onAvailableCommands,
        onAuthRequired: provider.onAuthRequired,
        ...(loggers.native ? { nativeEventLogger: loggers.native } : {}),
      });
      const textGeneration = yield* makeAntigravityTextGeneration({
        defaultModel,
        makeRuntime: (cwd) => makeIsolatedRuntime(cwd, "t3-code-text"),
      });

      return {
        instanceId,
        driverKind: DRIVER,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot: provider.snapshot,
        snapshotForCwd: (cwd) =>
          !enabled
            ? provider.snapshot.getSnapshot
            : discoverAntigravitySkills({ cwd, userHome }).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem),
                Effect.provideService(Path.Path, path),
                Effect.flatMap((skills) => provider.snapshotForCwd(cwd, skills)),
                Effect.mapError(
                  (cause) =>
                    new ProviderDriverError({
                      driver: DRIVER,
                      instanceId,
                      detail: "Could not read Antigravity workspace skills.",
                      cause,
                    }),
                ),
              ),
        adapter,
        textGeneration,
        refreshModels,
      } satisfies ProviderInstance;
    }),
};
