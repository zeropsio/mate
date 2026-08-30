/**
 * Fires the agent-login RPC (S7 follow-up F8): open the login terminal
 * panel, then ask the server to run the CLI's own login command and walk
 * its output. What the user needs to act on comes back on the
 * `ZeropsAgentAuth` row's `login` field (`useZeropsAgentAuth`), not from
 * this call directly.
 *
 * Deliberately thin — the RPC does all the deciding now; this hook is just
 * the wiring that fires it and makes the terminal panel visible so the user
 * can watch (and, once the CLI asks for it, paste a code into) the session
 * the server just started.
 */
import type { ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { zeropsFeeds } from "../state/zerops";
import { useAtomCommand } from "../state/use-atom-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { agentLoginTerminalToFocus } from "./agentLogin";

export function useAgentLogin(threadRef: ScopedThreadRef | null): (agentId: ZeropsAgentId) => void {
  const setTerminalOpen = useTerminalUiStateStore((state) => state.setTerminalOpen);
  const ensureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const startLogin = useAtomCommand(zeropsFeeds.agentLoginStart, "zerops agent login start");

  return useCallback(
    (agentId: ZeropsAgentId) => {
      if (threadRef === null) {
        return;
      }
      // Open the panel first — the CLI's own output starts arriving the
      // moment the server writes the login command, and the user needs the
      // pane visible from the start (not just once a paste prompt appears).
      // Which terminal this makes ACTIVE is corrected below once the RPC
      // resolves with the session's own id (S7 fix2 finding 3) — until then
      // this may open onto whatever terminal was already active.
      setTerminalOpen(threadRef, true);
      // `startLogin` already reports its own failure (useAtomCommand's
      // default reportFailure). A successful start focuses the login
      // session's own terminal tab, so the user isn't left looking at an
      // unrelated (or empty) pane while the card says it's waiting on them.
      void startLogin({
        environmentId: threadRef.environmentId,
        input: { agentId, threadId: threadRef.threadId },
      }).then((result) => {
        const terminalId = agentLoginTerminalToFocus(result);
        if (terminalId !== undefined) {
          ensureTerminal(threadRef, terminalId, { open: true, active: true });
        }
      });
    },
    [threadRef, setTerminalOpen, ensureTerminal, startLogin],
  );
}
