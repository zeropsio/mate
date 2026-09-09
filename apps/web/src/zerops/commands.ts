/**
 * The reviewed set of Zerops commands a client may issue.
 *
 * - `agentLoginStart` — server scope: `AuthTerminalOperateScope`.
 * - `agentLoginCancel` — server scope: `AuthTerminalOperateScope`.
 * - `browserInput` — server scope: `AuthOrchestrationOperateScope` (S8b).
 * - `mateUpdate` — server scope `exec:operate`; offered only where the
 *   descriptor's `capabilities.mateUpdate` is true (spec-mate.md §2.9, MU-2).
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

  const mateUpdate = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:mate:update",
    tag: WS_METHODS.zeropsMateUpdate,
  });

  return { agentLoginStart, agentLoginCancel, browserInput, mateUpdate };
}
