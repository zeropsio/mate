/** Mate commands retain their owner's answer separately from the facts they change. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcInput, EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { OperationKind } from "./kind.ts";
export const MATE_ACTIONS = {
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
};
