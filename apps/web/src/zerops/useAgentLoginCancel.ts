/**
 * Fires the agent-login cancel RPC (S7 fix2 finding 4): stops an
 * in-progress server-driven login session — the server writes Ctrl-C into
 * the session's own terminal and closes it. The resulting `cancelled` phase
 * rides the `ZeropsAgentAuth` snapshot's `login` field the same way
 * `start`'s outcome does (`useZeropsAgentAuth`); there is nothing further
 * for this hook to do with the RPC's own result.
 *
 * Deliberately its own hook, mirroring `useAgentLogin.ts` — the card offers
 * Cancel as a plain sibling action next to Sign in, not something layered
 * onto the start flow.
 */
import type { ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { zeropsFeeds } from "../state/zerops";
import { useAtomCommand } from "../state/use-atom-command";

export function useAgentLoginCancel(
  threadRef: ScopedThreadRef | null,
): (agentId: ZeropsAgentId) => void {
  const cancelLogin = useAtomCommand(zeropsFeeds.agentLoginCancel, "zerops agent login cancel");

  return useCallback(
    (agentId: ZeropsAgentId) => {
      if (threadRef === null) {
        return;
      }
      // `cancelLogin` already reports its own failure (useAtomCommand's
      // default reportFailure); there is nothing further to await here.
      void cancelLogin({
        environmentId: threadRef.environmentId,
        input: { agentId },
      });
    },
    [threadRef, cancelLogin],
  );
}
