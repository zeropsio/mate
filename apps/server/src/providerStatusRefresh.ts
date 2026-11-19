import {
  ProviderSetupError,
  type ServerProvider,
  type WS_METHODS,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { ExternalLauncher } from "./process/externalLauncher.ts";
import type { ModelManifest } from "./provider/ModelManifest.ts";
import type { ProviderVersionCache } from "./provider/providerMaintenance.ts";
import type { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import type { UsageLimitSources } from "./usage/UsageLimitSources.ts";

type RefreshProvidersInput = Rpc.Payload<
  Rpc.ExtractTag<RpcGroup.Rpcs<typeof WsRpcGroup>, typeof WS_METHODS.serverRefreshProviders>
>;

export interface RefreshProvidersDeps {
  readonly modelManifest: ModelManifest["Service"];
  readonly providerInstances: ProviderInstanceRegistry["Service"];
  readonly providerVersionCache: (typeof ProviderVersionCache)["Service"];
  readonly usageLimitSources: UsageLimitSources["Service"];
  readonly externalLauncher: ExternalLauncher["Service"];
  readonly providerRegistry: ProviderRegistry["Service"];
  readonly withZeropsAgentAuth: (
    providers: ReadonlyArray<ServerProvider>,
  ) => Effect.Effect<ReadonlyArray<ServerProvider>>;
}

export const refreshProviders =
  ({
    modelManifest,
    providerInstances,
    providerVersionCache,
    usageLimitSources,
    externalLauncher,
    providerRegistry,
    withZeropsAgentAuth,
  }: RefreshProvidersDeps) =>
  (input: RefreshProvidersInput) =>
    Effect.gen(function* () {
      // Only explicit catalog refreshes bypass T3's caches. Workspace
      // discovery and background status checks retain their timers.
      if (input.refreshModels) {
        yield* modelManifest.forceRefresh;
        const instances = yield* providerInstances.listInstances;
        yield* Effect.forEach(
          instances.filter(
            (instance) =>
              input.instanceId === undefined || input.instanceId === instance.instanceId,
          ),
          (instance) =>
            Effect.gen(function* () {
              yield* instance.invalidateCaches ?? Effect.void;
              const maintenance = yield* instance.snapshot.resolveMaintenance({
                fresh: true,
              });
              if (maintenance.packageName) providerVersionCache.delete(maintenance.packageName);
            }),
          { concurrency: "unbounded", discard: true },
        );
      }
      // An untargeted refresh is "re-read everything's status", which
      // includes quota from configured usage-limit sources. Awaited,
      // not forked: the RPC scope closes on return and would
      // interrupt a fork before the hub answered.
      if (input.instanceId === undefined) {
        yield* usageLimitSources.refresh;
        yield* externalLauncher.rediscoverEditors();
      }
      let providers = yield* input.cwd !== undefined && input.instanceId !== undefined
        ? providerRegistry.refreshWorkspaceSnapshot({
            instanceId: input.instanceId,
            cwd: input.cwd,
            fresh: input.fresh === true,
          })
        : input.instanceId !== undefined
          ? providerRegistry.refreshInstance(input.instanceId)
          : providerRegistry.refresh();
      if (input.refreshModels) {
        const instances = yield* providerInstances.listInstances;
        for (const instance of instances) {
          if (
            !instance.refreshModels ||
            (input.instanceId !== undefined && input.instanceId !== instance.instanceId) ||
            !providers.some(
              (provider) =>
                provider.instanceId === instance.instanceId &&
                provider.enabled &&
                provider.installed,
            )
          )
            continue;
          yield* instance.refreshModels().pipe(
            Effect.mapError(
              (error) =>
                new ProviderSetupError({
                  instanceId: instance.instanceId,
                  operation: "refresh-models",
                  detail: error.detail,
                }),
            ),
          );
          providers = yield* providerRegistry.refreshInstance(instance.instanceId);
        }
      }
      // A targeted refresh answers with the one provider it looked at;
      // the config stream carries the change to every client.
      return {
        providers: yield* withZeropsAgentAuth(
          input.instanceId === undefined
            ? providers
            : providers.filter((provider) => provider.instanceId === input.instanceId),
        ),
      };
    });
