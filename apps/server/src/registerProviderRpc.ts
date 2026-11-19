import {
  type AuthSessionId,
  ProviderUploadFeedbackError,
  WS_METHODS,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { FileSystem } from "effect/FileSystem";
import type { Path } from "effect/Path";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { makeProviderInstallation } from "./provider/providerInstallation.ts";
import type { ProviderMaintenanceRunner } from "./provider/providerMaintenanceRunner.ts";
import type { ProviderAuthService } from "./provider/Services/ProviderAuthService.ts";
import type { ProviderService } from "./provider/Services/ProviderService.ts";
import { refreshProviders, type RefreshProvidersDeps } from "./providerStatusRefresh.ts";
import type { RpcAdmit } from "./RpcUpdateAdmission.ts";
import { consumeResetCredit } from "./usage/resetCredit.ts";

type ProviderRpcTag =
  | typeof WS_METHODS.serverRefreshProviders
  | typeof WS_METHODS.providerUploadFeedback
  | typeof WS_METHODS.serverUpdateProvider
  | typeof WS_METHODS.providerConsumeResetCredit
  | typeof WS_METHODS.providerAuthStart
  | typeof WS_METHODS.providerAuthRespond
  | typeof WS_METHODS.providerAuthComplete
  | typeof WS_METHODS.providerAuthCancel
  | typeof WS_METHODS.providerAuthLogout
  | typeof WS_METHODS.providerAuthSubscribe
  | typeof WS_METHODS.providerInstallStart
  | typeof WS_METHODS.providerInstallCancel
  | typeof WS_METHODS.providerInstallSubscribe
  | typeof WS_METHODS.providerInstallRemove;

type ProviderRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: ProviderRpcTag }>;

type ProviderRpcHandlers = {
  readonly [Current in ProviderRpc as Rpc.Tag<Current>]: Rpc.ToHandlerFn<
    Current,
    Rpc.Tag<Current> extends typeof WS_METHODS.providerInstallRemove ? FileSystem | Path : never
  >;
};

interface RegisterProviderRpcDeps extends RefreshProvidersDeps {
  readonly providerService: ProviderService["Service"];
  readonly providerMaintenanceRunner: ProviderMaintenanceRunner["Service"];
  readonly providerAuth: ProviderAuthService["Service"];
  readonly providerInstallation: Effect.Success<ReturnType<typeof makeProviderInstallation>>;
  readonly currentSessionId: AuthSessionId;
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
  providerAuth,
  providerInstallation,
  currentSessionId,
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
    [WS_METHODS.providerAuthStart]: (input) =>
      admit(WS_METHODS.providerAuthStart, providerAuth.start(input, currentSessionId)),
    [WS_METHODS.providerAuthRespond]: (input) =>
      Effect.annotateCurrentSpan({ instanceId: input.instanceId }).pipe(
        Effect.andThen(
          admit(WS_METHODS.providerAuthRespond, providerAuth.respond(input, currentSessionId)),
        ),
      ),
    [WS_METHODS.providerAuthComplete]: (input) =>
      admit(WS_METHODS.providerAuthComplete, providerAuth.complete(input, currentSessionId)),
    [WS_METHODS.providerAuthCancel]: (input) =>
      admit(WS_METHODS.providerAuthCancel, providerAuth.cancel(input, currentSessionId)),
    [WS_METHODS.providerAuthLogout]: (input) =>
      admit(WS_METHODS.providerAuthLogout, providerAuth.logout(input)),
    [WS_METHODS.providerAuthSubscribe]: (input) => providerAuth.subscribe(input, currentSessionId),
    [WS_METHODS.providerInstallStart]: (input) =>
      admit(WS_METHODS.providerInstallStart, providerInstallation.start(input)),
    [WS_METHODS.providerInstallCancel]: (input) =>
      admit(WS_METHODS.providerInstallCancel, providerInstallation.cancel(input)),
    [WS_METHODS.providerInstallSubscribe]: (input) => providerInstallation.subscribe(input),
    [WS_METHODS.providerInstallRemove]: (input) =>
      admit(WS_METHODS.providerInstallRemove, providerInstallation.remove(input)),
  } satisfies ProviderRpcHandlers;
};
