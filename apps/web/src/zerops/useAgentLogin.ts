/**
 * Fires the agent-login RPC (S7 follow-up F8), then asks the server to run
 * the CLI's own login command and walk its output. Callers can keep the
 * terminal in the shared drawer or embed the dedicated session in their
 * own surface. What the user needs to act on comes back on the
 * `ZeropsAgentAuth` row's `login` field (`useZeropsAgentAuth`), not from
 * this call directly.
 *
 * Deliberately thin — the RPC does all the deciding now; this hook is just
 * the wiring that fires it and, for drawer callers, makes that surface
 * visible so the user can watch (and, once the CLI asks for it, paste a
 * code into) the session the server just started.
 */
import type { ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { agentLoginTerminalToFocus } from "@t3tools/client-runtime/zerops/agentLogin";

export function useAgentLogin(
  threadRef: ScopedThreadRef | null,
  options: { readonly terminalSurface?: "drawer" | "embedded" } = {},
): (agentId: ZeropsAgentId) => void {
  const setTerminalOpen = useTerminalUiStateStore((state) => state.setTerminalOpen);
  const ensureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const startLogin = useAtomCommand(zeropsCommands.agentLoginStart, "zerops agent login start");
  const terminalSurface = options.terminalSurface ?? "drawer";

  return useCallback(
    (agentId: ZeropsAgentId) => {
      if (threadRef === null) {
        return;
      }
      // Drawer callers open their existing panel first — the CLI's output
      // starts arriving as soon as the server writes the login command.
      // Embedded callers already own a visible surface and attach it to the
      // returned login session through the live auth snapshot.
      if (terminalSurface === "drawer") {
        setTerminalOpen(threadRef, true);
      }
      // `startLogin` already reports its own failure (useAtomCommand's
      // default reportFailure). A successful start focuses the login
      // session's own terminal tab, so the user isn't left looking at an
      // unrelated (or empty) pane while the card says it's waiting on them.
      void startLogin({
        environmentId: threadRef.environmentId,
        input: { agentId, threadId: threadRef.threadId },
      }).then((result) => {
        const terminalId = agentLoginTerminalToFocus(result);
        if (terminalSurface === "drawer" && terminalId !== undefined) {
          ensureTerminal(threadRef, terminalId, { open: true, active: true });
        }
      });
    },
    [threadRef, setTerminalOpen, ensureTerminal, startLogin, terminalSurface],
  );
}
