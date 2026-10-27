/**
 * Deleting a project, as the account's `delete-project` operation: Zerops executes it and its
 * delete process says how it ended. Resolves once it finished; rejects with what to tell the
 * person — the texts the deletion always said.
 */
import type { OperationEnd } from "@t3tools/client-runtime/data";
import { useCallback } from "react";

import { useAccountOperations } from "./accountOperations";
import { useAccountData } from "./ZeropsAccountData";

const NOT_FOLLOWED =
  "The Zerops deletion process could not be followed. Check the project’s processes before deleting again.";

/** What the person is told of a deletion that did not finish; `null` once it did. */
function deletionTrouble(end: NonNullable<OperationEnd>): string | null {
  switch (end.stage) {
    case "done":
      return end.outcome === "succeeded"
        ? null
        : "The Zerops deletion process failed or was canceled.";
    case "refused":
      return end.reason;
    case "unsent":
      return "Zerops did not take the deletion. Try again.";
    default:
      return NOT_FOLLOWED;
  }
}

export function useDeleteProject(): (projectId: string) => Promise<void> {
  const operations = useAccountOperations();
  const { orgId } = useAccountData();
  return useCallback(
    async (projectId) => {
      if (orgId === null) throw new Error("No organization is open.");
      const { requestId } = await operations.submit({ kind: "delete-project", orgId, projectId });
      const trouble = deletionTrouble(await operations.untilEnd(requestId, orgId));
      if (trouble !== null) throw new Error(trouble);
    },
    [operations, orgId],
  );
}
