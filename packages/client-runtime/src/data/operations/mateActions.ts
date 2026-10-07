import { mateSetupScope } from "../families/mateSetup.ts";
/** Mate commands retain their owner's answer separately from the facts they change. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcInput, EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { OperationKind } from "./kind.ts";
export const MATE_ACTIONS = {
  standUpRetry: WS_METHODS.zeropsStandUpRetry,
  startProviderAuth: WS_METHODS.providerAuthStart,
  respondProviderAuth: WS_METHODS.providerAuthRespond,
  completeProviderAuth: WS_METHODS.providerAuthComplete,
  cancelProviderAuth: WS_METHODS.providerAuthCancel,
  logoutProviderAuth: WS_METHODS.providerAuthLogout,
  startProviderInstall: WS_METHODS.providerInstallStart,
  cancelProviderInstall: WS_METHODS.providerInstallCancel,
  removeProviderInstallation: WS_METHODS.providerInstallRemove,
  consumeResetCredit: WS_METHODS.providerConsumeResetCredit,
  refreshProviders: WS_METHODS.serverRefreshProviders,
  updateProvider: WS_METHODS.serverUpdateProvider,
  upsertKeybinding: WS_METHODS.serverUpsertKeybinding,
  removeKeybinding: WS_METHODS.serverRemoveKeybinding,
  updateSettings: WS_METHODS.serverUpdateSettings,
  signalProcess: WS_METHODS.serverSignalProcess,
  retryResourceTelemetry: WS_METHODS.serverRetryResourceTelemetry,

  agentLoginStart: WS_METHODS.zeropsAgentLoginStart,
  agentLoginCancel: WS_METHODS.zeropsAgentLoginCancel,
  agentLoginSubmitCode: WS_METHODS.zeropsAgentLoginSubmitCode,
  agentSignOut: WS_METHODS.zeropsAgentLoginSignOut,
  loginAdd: WS_METHODS.zeropsLoginAdd,
  loginRemove: WS_METHODS.zeropsLoginRemove,
  crewCommand: WS_METHODS.zeropsCrewCommand,
  crewFilesPut: WS_METHODS.zeropsCrewFilesPut,
  terminalOpen: WS_METHODS.terminalOpen,
  terminalClear: WS_METHODS.terminalClear,
  terminalRestart: WS_METHODS.terminalRestart,
  terminalClose: WS_METHODS.terminalClose,
} as const;
export type MateAction = keyof typeof MATE_ACTIONS;
export type MateActionInput<A extends MateAction> = EnvironmentRpcInput<(typeof MATE_ACTIONS)[A]>;
export type MateActionResult<A extends MateAction> = EnvironmentRpcSuccess<
  (typeof MATE_ACTIONS)[A]
>;
/** Authorization codes, API keys and file bodies never become retained operation intents. */
export interface MateActionIntent {
  readonly environmentId: string;
  readonly action: MateAction;
  readonly target: Readonly<Record<string, string>>;
}
declare module "../model.ts" {
  interface OperationIntents {
    readonly "mate-action": MateActionIntent;
  }
  interface OperationResults {
    readonly "mate-action": { readonly value: MateActionResult<MateAction> };
  }
}
export const mateAction: OperationKind<"mate-action"> = {
  kind: "mate-action",
  executor: "mate",
  // An RPC answer proves the command ended; it does not prove the resulting facts are current.
  reflected: () => false,
  settledBy: (read, intent, receipt) => {
    if (intent.action !== "standUpRetry" || receipt.acceptance.kind !== "accepted") return null;
    const owner = intent.target.setupOwner;
    if (owner === undefined) return null;
    const fact = read.fact("mateSetup", owner);
    const source = read.stream(mateSetupScope(owner));
    if (
      fact.kind !== "known" ||
      fact.value.kind !== "setup" ||
      fact.revision.kind !== "mate-link" ||
      fact.revision.sequence <= Number(intent.target.setupRevision) ||
      source.fault !== null
    )
      return null;
    if (fact.value.setup.standup === "done") return { kind: "succeeded" };
    if (fact.value.setup.standup === "failed")
      return {
        kind: "failed",
        reason: fact.value.setup.standupFailure ?? "The Mate reported that its stand-up stopped.",
      };
    return null;
  },
};
