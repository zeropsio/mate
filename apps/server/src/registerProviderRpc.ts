import { ProviderUploadFeedbackError, WS_METHODS, type WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { ProviderMaintenanceRunner } from "./provider/providerMaintenanceRunner.ts";
import type { ProviderService } from "./provider/Services/ProviderService.ts";
import { refreshProviders, type RefreshProvidersDeps } from "./providerStatusRefresh.ts";
import type { RpcAdmit } from "./RpcUpdateAdmission.ts";
import { consumeResetCredit } from "./usage/resetCredit.ts";

type ProviderRpcTag =
  | typeof WS_METHODS.serverRefreshProviders
  | typeof WS_METHODS.providerUploadFeedback
  | typeof WS_METHODS.serverUpdateProvider
  | typeof WS_METHODS.providerConsumeResetCredit;

type ProviderRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: ProviderRpcTag }>;

type ProviderRpcHandlers = {
  readonly [Current in ProviderRpc as Rpc.Tag<Current>]: Rpc.ToHandlerFn<Current>;
};

interface RegisterProviderRpcDeps extends RefreshProvidersDeps {
  readonly providerService: ProviderService["Service"];
  readonly providerMaintenanceRunner: ProviderMaintenanceRunner["Service"];
  readonly admit: RpcAdmit;
}

export const registerProviderRpc = ({
  modelManifest,
  providerInstances,
  providerVersionCache,
  usageLimitSources,
  externalLauncher,
  providerRegistry,
  withZeropsAgentAuth,
  providerService,
  providerMaintenanceRunner,
  admit,
}: RegisterProviderRpcDeps) => {
  const refresh = refreshProviders({
    modelManifest,
    providerInstances,
    providerVersionCache,
    usageLimitSources,
    externalLauncher,
    providerRegistry,
    withZeropsAgentAuth,
  });
  const resetCredit = consumeResetCredit({ usageLimitSources, providerInstances });

  return {
    [WS_METHODS.serverRefreshProviders]: (input) =>
      admit(WS_METHODS.serverRefreshProviders, refresh(input)),
    [WS_METHODS.providerUploadFeedback]: (input) =>
      admit(
        WS_METHODS.providerUploadFeedback,
        providerService.uploadFeedback(input).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderUploadFeedbackError({
                threadId: input.threadId,
                cause,
              }),
          ),
        ),
      ),
    [WS_METHODS.serverUpdateProvider]: (input) =>
      admit(
        WS_METHODS.serverUpdateProvider,
        providerMaintenanceRunner
          .updateProvider(input)
          .pipe(
            Effect.flatMap((updated) =>
              withZeropsAgentAuth(updated.providers).pipe(
                Effect.map((providers) => ({ ...updated, providers })),
              ),
            ),
          ),
      ),
    [WS_METHODS.providerConsumeResetCredit]: (input) =>
      admit(WS_METHODS.providerConsumeResetCredit, resetCredit(input)),
  } satisfies ProviderRpcHandlers;
};
