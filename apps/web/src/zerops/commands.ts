/**
 * The reviewed set of Zerops commands a client may issue.
 *
 * - `agentLoginStart` — server scope: `AuthTerminalOperateScope`.
 * - `agentLoginCancel` — server scope: `AuthTerminalOperateScope`.
 * - `agentLoginSubmitCode` — server scope: `AuthTerminalOperateScope`; types
 *   Claude's authorization code into its login terminal.
 * - `agentSignOut` — server scope: `AuthTerminalOperateScope`; offered only
 *   where the descriptor's `capabilities.agentSignOut` is true. Stops the
 *   agent's live provider sessions, runs the CLI's own logout and clears the
 *   platform flag — any client may end any agent's project sign-in.
 * - `loginAdd` / `loginRemove` — server scope: `AuthTerminalOperateScope`;
 *   offered only where the descriptor's `capabilities.mateLogins` is true.
 *   Adds a login beyond the agents' defaults (crew mode's *Runs on*) — an
 *   account signed in afterwards through `agentLoginStart` with its id, or a
 *   Claude API key, which crosses the wire only here — or signs one out and
 *   forgets it.
 * - `browserInput` — server scope: `AuthOrchestrationOperateScope` (S8b).
 * - `gitProbeRemote` — server scope: `AuthOrchestrationReadScope`; a read, and
 *   the only party that can answer whether a checkout's remote actually
 *   answers (guide 4.5). The Git tab asks it on open and after each action,
 *   never on a timer.
 *
 * The resulting login state rides the read-only agent-auth feed; callers
 * await these commands only for the RPC result itself.
 */
import { makeMateBrowserInputCommand } from "@t3tools/client-runtime/data";
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

export function createZeropsCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const standUpRetry = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:standUp:retry",
    tag: WS_METHODS.zeropsStandUpRetry,
  });
  const agentAuthCheck = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentAuth:check",
    tag: WS_METHODS.zeropsAgentAuthCheck,
  });
  const agentLoginStart = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentLogin:start",
    tag: WS_METHODS.zeropsAgentLoginStart,
  });

  const agentLoginCancel = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentLogin:cancel",
    tag: WS_METHODS.zeropsAgentLoginCancel,
  });

  const agentLoginSubmitCode = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentLogin:submitCode",
    tag: WS_METHODS.zeropsAgentLoginSubmitCode,
  });

  const agentSignOut = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:agentLogin:signOut",
    tag: WS_METHODS.zeropsAgentLoginSignOut,
  });

  const loginAdd = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:login:add",
    tag: WS_METHODS.zeropsLoginAdd,
  });

  const loginRemove = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:login:remove",
    tag: WS_METHODS.zeropsLoginRemove,
  });

  const browserInput = makeMateBrowserInputCommand(runtime);

  const gitProbeRemote = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:git:probeRemote",
    tag: WS_METHODS.zeropsGitProbeRemote,
  });

  return {
    standUpRetry,
    agentAuthCheck,
    agentLoginStart,
    agentLoginCancel,
    agentLoginSubmitCode,
    agentSignOut,
    loginAdd,
    loginRemove,
    browserInput,
    gitProbeRemote,
  };
}
