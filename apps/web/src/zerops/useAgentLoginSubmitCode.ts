/**
 * Sends Claude's authorization code to its running login: the server types it
 * into the login terminal, then Enter (`zerops.agentLogin.submitCode`). What
 * happens next rides the agent-auth feed's `login` phase — `verifying-code`,
 * then `succeeded` or `failed` — like every other step of the login.
 *
 * Resolves whether the server took the code, so the field can keep what the
 * person pasted when it did not.
 */
import type { ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";

export function useAgentLoginSubmitCode(
  threadRef: ScopedThreadRef | null,
): (agentId: ZeropsAgentId, code: string) => Promise<boolean> {
  const submitCode = useAtomCommand(
    zeropsCommands.agentLoginSubmitCode,
    "zerops agent login submit code",
  );

  return useCallback(
    async (agentId: ZeropsAgentId, code: string) => {
      if (threadRef === null) return false;
      const result = await submitCode({
        environmentId: threadRef.environmentId,
        input: { agentId, code },
      });
      return result._tag === "Success";
    },
    [threadRef, submitCode],
  );
}
