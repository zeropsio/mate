/**
 * The reviewed set of Zerops commands a client may issue.
 *
 * - `agentLoginStart` — server scope: `AuthTerminalOperateScope`.
 * - `agentLoginCancel` — server scope: `AuthTerminalOperateScope`.
 * - `browserInput` — server scope: `AuthOrchestrationOperateScope` (S8b).
 * - `dataConsoleCall` — server scope: `AuthOrchestrationReadScope` (read-only
 *   in this slice — `dataconsole-api.md` §3, spec-dataconsole.md §4.3).
 *
 * The resulting login state rides the read-only agent-auth feed; callers
 * await these commands only for the RPC result itself.
 */
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

export function createZeropsCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const agentLoginStart = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentLogin:start",
    tag: WS_METHODS.zeropsAgentLoginStart,
  });

  const agentLoginCancel = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentLogin:cancel",
    tag: WS_METHODS.zeropsAgentLoginCancel,
  });

  const browserInput = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:browserInput",
    tag: WS_METHODS.zeropsBrowserInput,
  });

  const dataConsoleCall = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:dataConsoleCall",
    tag: WS_METHODS.zeropsDataConsoleCall,
  });

  return { agentLoginStart, agentLoginCancel, browserInput, dataConsoleCall };
}
