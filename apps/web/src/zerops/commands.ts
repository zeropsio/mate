import {
  mateSetupRetryCommand,
  mateActionCommand,
  mateAuthCheckCommand,
} from "@t3tools/client-runtime/data";
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
import { Atom } from "effect/unstable/reactivity";

export function createZeropsCommandAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const standUpRetry = mateSetupRetryCommand(runtime);
  const agentAuthCheck = mateAuthCheckCommand(runtime);
  const agentLoginStart = mateActionCommand(runtime, "agentLoginStart");

  const agentLoginCancel = mateActionCommand(runtime, "agentLoginCancel");

  const agentLoginSubmitCode = mateActionCommand(runtime, "agentLoginSubmitCode");

  const agentSignOut = mateActionCommand(runtime, "agentSignOut");

  const loginAdd = mateActionCommand(runtime, "loginAdd");

  const loginRemove = mateActionCommand(runtime, "loginRemove");

  const browserInput = makeMateBrowserInputCommand(runtime);

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
  };
}
