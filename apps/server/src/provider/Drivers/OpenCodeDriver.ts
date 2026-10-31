/**
 * OpenCodeDriver — `ProviderDriver` for the OpenCode runtime.
 *
 * Mirrors the Codex / Claude drivers: a plain value whose `create()`
 * bundles `snapshot` / `adapter` / `textGeneration` closures over the
 * per-instance `OpenCodeSettings`.
 *
 * Two instances with different `serverUrl`s therefore talk to independent
 * OpenCode servers; when no `serverUrl` is set, the adapter + text-generation
 * shares spin up their own scoped child processes, and those child
 * processes are released when the registry scope closes.
 *
 * @module provider/Drivers/OpenCodeDriver
 */
import { OpenCodeSettings, ProviderDriverKind } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { mergePathValues } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { ToolInvocationRegistry } from "../../spi/toolInvocation.ts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import { serveOpenCodeToolExecution } from "../../spi/openCodeToolExecution.ts";
import { makeManagedOpenCodeEnvironment } from "../openCodeManagedTools.ts";
import { makeOpenCodeTextGeneration } from "../../textGeneration/OpenCodeTextGeneration.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeOpenCodeAdapter } from "../Layers/OpenCodeAdapter.ts";
import { readOpenCodeGoUsageLimits } from "../Layers/openCodeUsageLimits.ts";
import {
  checkOpenCodeProviderStatus,
  makePendingOpenCodeProvider,
  openCodeSkillsToServerProviderSkills,
  openCodeCommandsToServerProviderSlashCommands,
} from "../Layers/OpenCodeProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { OpenCodeRuntime, loadOpenCodeCommands, runOpenCodeSdk } from "../opencodeRuntime.ts";
import * as OpenCodeServerOwner from "../OpenCodeServerOwner.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

const DRIVER_KIND = ProviderDriverKind.make("opencode");

function isOpenCodeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.opencode/bin/opencode") ||
    normalized.endsWith("/.opencode/bin/opencode.exe")
  );
}

/**
 * Puts the official installer's `~/.opencode/bin` on PATH after the inherited entries, as zcp's
 * OpenCode adapter looks: PATH first, then the installer's location. A Mate container's image installs
 * OpenCode there and only a login shell's rc adds it to PATH, so the supervised server never found it.
 */
export function withOpenCodeInstallerPath(
  environment: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform,
  pathService: Path.Path,
): NodeJS.ProcessEnv {
  if (platform === "win32") return environment;
  const installerBin = pathService.join(homeDir, ".opencode", "bin");
  return { ...environment, PATH: mergePathValues(environment.PATH, installerBin, platform) };
}

const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "opencode-ai",
  nativeUpdate: {
    args: ["upgrade"],
    isCommandPath: isOpenCodeNativeCommandPath,
  },
});

export type OpenCodeDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | OpenCodeRuntime
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

export const OpenCodeDriver: ProviderDriver<OpenCodeSettings, OpenCodeDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "OpenCode",
    supportsMultipleInstances: true,
  },
  configSchema: OpenCodeSettings,
  defaultConfig: (): OpenCodeSettings => decodeOpenCodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const openCodeRuntime = yield* OpenCodeRuntime;
      const serverConfig = yield* ServerConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
      const eventLoggers = yield* ProviderEventLoggers;
      const inheritedEnvironment = withOpenCodeInstallerPath(
        mergeProviderInstanceEnvironment(environment),
        serverConfig.homeDir,
        yield* HostProcessPlatform,
        pathService,
      );
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies OpenCodeSettings;
      // A managed local process can load the owned executor. External servers
      // retain their configuration and do not claim this capability.
      const toolExecution =
        effectiveConfig.serverUrl.trim() === "" && (yield* HostProcessPlatform) !== "win32"
          ? yield* serveOpenCodeToolExecution(instanceId)
          : undefined;
      const processEnv =
        toolExecution === undefined
          ? inheritedEnvironment
          : yield* makeManagedOpenCodeEnvironment(inheritedEnvironment, toolExecution).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderDriverError({
                    driver: DRIVER_KIND,
                    instanceId,
                    detail: "Managed workflow plugin could not be installed",
                    cause,
                  }),
              ),
            );

      const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
        resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
          binaryPath: effectiveConfig.binaryPath,
          env: processEnv,
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, pathService),
        ),
      );

      const adapter = yield* makeOpenCodeAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
        ...(toolExecution === undefined ? {} : { toolExecution }),
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const serverOwner = yield* OpenCodeServerOwner.make({
        binaryPath: effectiveConfig.binaryPath,
        directory: serverConfig.cwd,
        ...(effectiveConfig.serverPassword
          ? { serverPassword: effectiveConfig.serverPassword }
          : {}),
        environment: processEnv,
      });
      const textGeneration = yield* makeOpenCodeTextGeneration(effectiveConfig).pipe(
        Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, serverOwner),
      );

      const checkProvider = Effect.all(
        {
          provider: checkOpenCodeProviderStatus(effectiveConfig, serverConfig.cwd, processEnv),
          usageLimits: readOpenCodeGoUsageLimits({
            enabled: effectiveConfig.enabled,
            serverUrl: effectiveConfig.serverUrl,
            environment: processEnv,
          }),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(({ provider, usageLimits }) => ({ ...provider, usageLimits })),
        Effect.map(stampIdentity),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, serverOwner),
        Effect.provideService(OpenCodeRuntime, openCodeRuntime),
      );
      // NOTE: the local branch intentionally uses the shared SDK server
      // instead of `opencode debug skill` (loadSkillsFromCli). The CLI writes
      // its full JSON inventory to stdout, but the Bun-compiled binary does
      // not flush more than one 64KB pipe buffer to a non-TTY stdout, so the
      // piped output arrives truncated and unparseable — which degrades to an
      // empty skill list and poisons the workspace snapshot the `$` picker
      // reads. The SDK `app.skills` endpoint honors the per-request directory
      // and returns complete results regardless of size.
      const loadWorkspaceInventory = (client: Parameters<typeof loadOpenCodeCommands>[0]) =>
        Effect.all(
          {
            skills: openCodeRuntime.loadOpenCodeSkills(client),
            commands: loadOpenCodeCommands(client).pipe(
              Effect.timeout("10 seconds"),
              Effect.orElseSucceed(() => []),
            ),
          },
          { concurrency: "unbounded" },
        );
      const loadWorkspaceForCwd = (cwd: string) =>
        effectiveConfig.serverUrl.trim().length > 0
          ? Effect.scoped(
              Effect.gen(function* () {
                const server = yield* openCodeRuntime.connectToOpenCodeServer({
                  binaryPath: effectiveConfig.binaryPath,
                  directory: cwd,
                  serverUrl: effectiveConfig.serverUrl,
                  ...(effectiveConfig.serverPassword
                    ? { serverPassword: effectiveConfig.serverPassword }
                    : {}),
                  environment: processEnv,
                });
                const client = openCodeRuntime.createOpenCodeSdkClient({
                  baseUrl: server.url,
                  directory: cwd,
                  ...(effectiveConfig.serverPassword
                    ? { serverPassword: effectiveConfig.serverPassword }
                    : {}),
                });
                return yield* loadWorkspaceInventory(client);
              }),
            )
          : serverOwner.withServer((server) =>
              loadWorkspaceInventory(
                openCodeRuntime.createOpenCodeSdkClient({
                  baseUrl: server.url,
                  directory: cwd,
                  ...(server.serverPassword !== undefined
                    ? { serverPassword: server.serverPassword }
                    : {}),
                }),
              ),
            );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<OpenCodeSettings>>(
        {
          resolveMaintenance,
          getSettings: snapshotSettings.getSettings,
          streamSettings: snapshotSettings.streamSettings,
          haveSettingsChanged: haveProviderSnapshotSettingsChanged,
          checkProviderOnSettingsChange: () => false,
          refreshOnInterval: false,
          initialSnapshot: (settings) =>
            makePendingOpenCodeProvider(settings.provider).pipe(Effect.map(stampIdentity)),
          checkProvider,
          enrichSnapshot: ({ settings, snapshot, publishSnapshot }) =>
            resolveMaintenance().pipe(
              Effect.flatMap((maintenanceCapabilities) =>
                enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities, {
                  enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
                }),
              ),
              Effect.provideService(HttpClient.HttpClient, httpClient),
              Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
            ),
        },
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build OpenCode snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      // A successful plugin discovery belongs to this configured instance, not each overview.
      const [toolInvocationReady, invalidateNativeProof] = yield* Effect.cachedInvalidateWithTTL(
        toolExecution === undefined || !enabled
          ? Effect.succeed(false)
          : serverOwner
              .withServer((server) => {
                const client = openCodeRuntime.createOpenCodeSdkClient({
                  baseUrl: server.url,
                  directory: serverConfig.cwd,
                  ...(server.serverPassword === undefined
                    ? {}
                    : { serverPassword: server.serverPassword }),
                });
                return runOpenCodeSdk("tool.ids", (signal) =>
                  client.tool.ids({ directory: serverConfig.cwd }, { signal }),
                ).pipe(Effect.map((answer) => answer.data?.includes("mate_workflow") === true));
              })
              .pipe(
                Effect.timeout("10 seconds"),
                Effect.orElseSucceed(() => false),
              ),
        (exit) => (Exit.isSuccess(exit) && exit.value ? Duration.infinity : Duration.seconds(30)),
      );
      const executions = yield* Effect.serviceOption(ToolInvocationRegistry);
      const invalidateReadiness = Effect.gen(function* () {
        yield* invalidateNativeProof;
        if (instanceId === "opencode" && Option.isSome(executions)) {
          const installed = yield* executions.value.current;
          if (Option.isSome(installed)) yield* installed.value.invalidateReadiness;
        }
      });
      return {
        instanceId,
        toolInvocationReady,
        invalidateCaches: invalidateReadiness,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd: (cwd) =>
          !effectiveConfig.enabled
            ? snapshot.getSnapshot
            : Effect.all([
                snapshot.getSnapshot,
                loadWorkspaceForCwd(cwd).pipe(Effect.timeout("20 seconds")),
              ]).pipe(
                Effect.map(([machineSnapshot, { skills, commands }]) => ({
                  ...machineSnapshot,
                  skills: openCodeSkillsToServerProviderSkills(skills),
                  slashCommands: openCodeCommandsToServerProviderSlashCommands(commands),
                })),
                Effect.mapError(
                  (cause) =>
                    new ProviderDriverError({
                      driver: DRIVER_KIND,
                      instanceId,
                      detail: `Failed to probe OpenCode commands and skills for '${cwd}'`,
                      cause,
                    }),
                ),
              ),
        adapter: {
          ...adapter,
          startSession: (input) =>
            adapter.startSession(input).pipe(Effect.tapError(() => invalidateReadiness)),
          sendTurn: (input) =>
            adapter.sendTurn(input).pipe(Effect.tapError(() => invalidateReadiness)),
        },
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
