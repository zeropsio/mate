import type {
  EditorId,
  FileManagerRevealKind,
  MateHqKey,
  ServerConfigProvidersChangedPayload,
  ServerConfigStreamEvent,
  ServerProvider,
  WsSubscribeServerConfigRpc,
} from "@t3tools/contracts";
import {
  sameUsageLimitCommandCoverage,
  withUsageLimitsCommands,
} from "@t3tools/shared/usageLimits";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Rpc from "effect/rpc/Rpc";
import * as Stream from "effect/Stream";

import type { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";
import type { ServerConfig } from "./config.ts";
import type { RemoteOpenTargets } from "./environment/RemoteOpenTargets.ts";
import type { ServerEnvironment } from "./environment/ServerEnvironment.ts";
import type { Keybindings } from "./keybindings.ts";
import type { ExternalLauncher } from "./process/externalLauncher.ts";
import type { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "./serverSettings.ts";
import type { UsageLimitSources } from "./usage/UsageLimitSources.ts";
import { withoutUnworkableSlashCommands } from "./zerops/providerSlashCommands.ts";
import type { ZeropsAgentAuth } from "./zerops/ZeropsAgentAuth.ts";
import { overlayZeropsAgentAuth } from "./zerops/zeropsAgentProviderOverlay.ts";
import type { ZeropsHqLink } from "./zerops/ZeropsHqLink.ts";
import type { ZeropsMateUpdate } from "./zerops/ZeropsMateUpdate.ts";

const CONFIG_DISCOVERY_TIMEOUT = Duration.seconds(5);

const resolveDiscoveryForConfig = <A, E, R>(
  discovery: Effect.Effect<A, E, R>,
  onTimeout: () => A,
) =>
  discovery.pipe(
    Effect.timeoutOption(CONFIG_DISCOVERY_TIMEOUT),
    Effect.map(Option.getOrElse(onTimeout)),
  );

export const resolveAvailableEditorsForConfig = <A, E, R>(
  discovery: Effect.Effect<ReadonlyArray<A>, E, R>,
) => resolveDiscoveryForConfig(discovery, () => []);

export const resolveFileManagerRevealKindForConfig = <E, R>(
  discovery: Effect.Effect<FileManagerRevealKind | undefined, E, R>,
) => resolveDiscoveryForConfig(discovery, () => undefined);

/** The entries of `next` that differ from `sent`, or null when the list is unchanged. */
export function providersChangedSince(
  sent: ReadonlyArray<ServerProvider>,
  next: ReadonlyArray<ServerProvider>,
): ServerConfigProvidersChangedPayload | null {
  const sentById = new Map(sent.map((provider) => [provider.instanceId, JSON.stringify(provider)]));
  const providers = next.filter(
    (provider) => sentById.get(provider.instanceId) !== JSON.stringify(provider),
  );
  const instanceIds = next.map((provider) => provider.instanceId);
  const sameInstances =
    instanceIds.length === sent.length &&
    instanceIds.every((instanceId, index) => sent[index]?.instanceId === instanceId);
  return providers.length === 0 && sameInstances ? null : { providers, instanceIds };
}

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

interface ServerConfigFeedDeps {
  readonly keybindings: Keybindings["Service"];
  readonly providerRegistry: ProviderRegistry["Service"];
  readonly usageLimitSources: UsageLimitSources["Service"];
  readonly serverSettings: ServerSettings.ServerSettingsService["Service"];
  readonly serverEnvironment: ServerEnvironment["Service"];
  readonly serverAuth: EnvironmentAuth["Service"];
  readonly externalLauncher: ExternalLauncher["Service"];
  readonly remoteOpenTargets: RemoteOpenTargets["Service"];
  readonly config: ServerConfig["Service"];
  readonly zeropsAgentAuth: ZeropsAgentAuth["Service"];
  readonly zeropsMateUpdate: ZeropsMateUpdate["Service"];
  readonly hqKeyLink: ZeropsHqLink["Service"] | undefined;
  readonly currentHqKey: Effect.Effect<MateHqKey | null>;
  readonly withZeropsAgentAuth: (
    providers: ReadonlyArray<ServerProvider>,
  ) => Effect.Effect<ReadonlyArray<ServerProvider>>;
}

export const makeServerConfigFeed = ({
  keybindings,
  providerRegistry,
  usageLimitSources,
  serverSettings,
  serverEnvironment,
  serverAuth,
  externalLauncher,
  remoteOpenTargets,
  config,
  zeropsAgentAuth,
  zeropsMateUpdate,
  hqKeyLink,
  currentHqKey,
  withZeropsAgentAuth,
}: ServerConfigFeedDeps) => {
  // Only clients that answer /usage-limits themselves see it in the catalogs;
  // an older client would send the injected command to the provider.
  const loadServerConfig = (options: { readonly usageLimitsCommand: boolean }) =>
    Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.loadConfigState;
      const currentProviders = yield* providerRegistry.getProviders.pipe(
        Effect.flatMap(withZeropsAgentAuth),
      );
      const providers = options.usageLimitsCommand
        ? withUsageLimitsCommands(currentProviders, yield* usageLimitSources.current)
        : currentProviders;
      const settings = ServerSettings.redactServerSettingsForClient(
        yield* serverSettings.getSettings,
      );
      const environment = yield* serverEnvironment.getDescriptor;
      const auth = yield* serverAuth.getDescriptor();
      const hqKey = yield* currentHqKey;
      const availableEditors: ReadonlyArray<EditorId> = yield* resolveAvailableEditorsForConfig(
        externalLauncher.resolveAvailableEditors(),
      );
      const fileManagerRevealKind = availableEditors.includes("file-manager")
        ? yield* resolveFileManagerRevealKindForConfig(
            externalLauncher.resolveFileManagerRevealKind(),
          )
        : undefined;

      return {
        environment,
        auth,
        cwd: config.cwd,
        keybindingsConfigPath: config.keybindingsConfigPath,
        keybindings: keybindingsConfig.keybindings,
        issues: keybindingsConfig.issues,
        providers,
        availableEditors,
        // Same discovery-with-timeout treatment as editors: a slow probe
        // must not stall server.getConfig, so it degrades to no targets.
        remoteOpenTargets: yield* resolveAvailableEditorsForConfig(
          remoteOpenTargets.resolveTargets(),
        ),
        observability: {
          logsDirectoryPath: config.logsDir,
          localTracingEnabled: true,
          ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
          otlpTracesEnabled: config.otlpTracesUrl !== undefined,
          ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
          otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          ...(config.otlpLogsUrl !== undefined ? { otlpLogsUrl: config.otlpLogsUrl } : {}),
          otlpLogsEnabled: config.otlpLogsUrl !== undefined,
        },
        settings,
        ...(hqKey === null ? {} : { hqKey }),
        shellResumeCompletionMarker: true,
        ...(fileManagerRevealKind === undefined
          ? {}
          : {
              shellRevealInFileManager: true,
              shellRevealInFileManagerKind: fileManagerRevealKind,
            }),
      };
    });

  const subscribe = (input: Rpc.Payload<typeof WsSubscribeServerConfigRpc>) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const usageLimitsCommand = input.usageLimitsCommand === true;
        // Subscribe before the snapshot so changes made while it loads are buffered.
        const keybindingsChanges = yield* keybindings.subscribeChanges;
        const settingsChanges = yield* serverSettings.subscribeChanges;
        const config = yield* loadServerConfig({ usageLimitsCommand });
        const keybindingsUpdates = keybindingsChanges.pipe(
          Stream.map((event) => ({
            version: 1 as const,
            type: "keybindingsUpdated" as const,
            payload: {
              keybindings: event.keybindings,
              issues: event.issues,
            },
          })),
        );
        const providerStatuses = Stream.zipLatestWith(
          // The registry stream carries changes only. Seed it with the current
          // providers so a source refresh that lands before any provider change
          // still pairs up and reaches the client. On Zerops the agents' sign-in
          // flag changes what the picker offers, so its feed drives this too.
          Stream.zipLatestWith(
            Stream.concat(
              Stream.fromEffect(providerRegistry.getProviders),
              providerRegistry.streamChanges,
            ),
            Stream.concat(Stream.fromEffect(zeropsAgentAuth.latest), zeropsAgentAuth.changes),
            (providers, snapshot) =>
              withoutUnworkableSlashCommands(overlayZeropsAgentAuth(providers, snapshot)),
          ),
          usageLimitSources.streamChanges.pipe(
            // Quota updates already have their own stream. Republish the model
            // catalog only when the set of providers offered the command changes.
            Stream.changesWith(usageLimitsCommand ? sameUsageLimitCommandCoverage : () => true),
          ),
          (providers, sources) =>
            usageLimitsCommand ? withUsageLimitsCommands(providers, sources) : providers,
        ).pipe(
          // Both sides replay their current value, so the first pairing normally
          // repeats the snapshot the client already holds. Compare against that
          // snapshot rather than dropping blindly: a refresh that landed between
          // the snapshot and the subscription still goes out.
          (updates) => Stream.concat(Stream.make(config.providers), updates),
          Stream.changesWith((previous, next) => JSON.stringify(previous) === JSON.stringify(next)),
          Stream.drop(1),
          Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
        );
        // A provider entry carries its whole model and command catalog, and a
        // refresh restamps only the one it looked at: a capable client is sent
        // just the entries that differ from what it was last sent.
        const providerUpdates: Stream.Stream<ServerConfigStreamEvent> =
          input.providerChanges === true
            ? providerStatuses.pipe(
                Stream.mapAccum(
                  (): ReadonlyArray<ServerProvider> => config.providers,
                  (sent, providers) => {
                    const payload = providersChangedSince(sent, providers);
                    return [
                      providers,
                      payload === null
                        ? []
                        : [
                            {
                              version: 1 as const,
                              type: "providersChanged" as const,
                              payload,
                            },
                          ],
                    ] as const;
                  },
                ),
              )
            : providerStatuses.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
              );
        // The only source of reported quota: the stream emits the
        // current set before any change, so the snapshot carrying it too
        // would just send every client the same array twice per connect.
        // Gated on the subscriber's capability flag because an
        // already-shipped client decodes this stream against the old
        // event union and its whole config subscription dies on an
        // unknown member.
        const usageLimitSourceUpdates =
          input.usageLimitSources === true
            ? usageLimitSources.streamChanges.pipe(
                Stream.map((sources) => ({
                  version: 1 as const,
                  type: "usageLimitSourcesUpdated" as const,
                  payload: { sources },
                })),
              )
            : Stream.empty;
        const settingsUpdates = settingsChanges.pipe(
          Stream.map((settings) => ServerSettings.redactServerSettingsForClient(settings)),
          Stream.map((settings) => ({
            version: 1 as const,
            type: "settingsUpdated" as const,
            payload: { settings },
          })),
        );

        const mateUpdates =
          input.mateUpdate === true
            ? zeropsMateUpdate.changes.pipe(
                Stream.map((update) => ({
                  version: 1 as const,
                  type: "mateUpdate" as const,
                  payload: { update: update ?? null },
                })),
              )
            : Stream.empty;
        // Seeded with the snapshot's word so only a change goes out.
        const hqKeyUpdates =
          input.hqKey === true && hqKeyLink !== undefined
            ? hqKeyLink.changes.pipe(
                Stream.mapEffect(() => currentHqKey),
                (words) => Stream.concat(Stream.make(config.hqKey ?? null), words),
                Stream.changesWith(
                  (previous, next) => JSON.stringify(previous) === JSON.stringify(next),
                ),
                Stream.drop(1),
                Stream.map((hqKey) => ({
                  version: 1 as const,
                  type: "hqKey" as const,
                  payload: { hqKey },
                })),
              )
            : Stream.empty;
        const liveUpdates = Stream.merge(
          Stream.merge(mateUpdates, hqKeyUpdates),
          Stream.merge(
            keybindingsUpdates,
            Stream.merge(providerUpdates, Stream.merge(settingsUpdates, usageLimitSourceUpdates)),
          ),
        );

        return Stream.concat(
          Stream.make({ version: 1 as const, type: "snapshot" as const, config }),
          liveUpdates,
        );
      }),
    );

  return { load: loadServerConfig, subscribe };
};
