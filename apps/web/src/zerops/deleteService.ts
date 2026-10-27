/**
 * Deleting a service, as the account's `delete-service` operation: only a person's confirmed
 * *Delete* of a service its tier no longer declares asks it; HQ never deletes one. Resolves once
 * Zerops finished; rejects with what to tell the person.
 */
import type { OperationEnd } from "@t3tools/client-runtime/data";
import { useCallback } from "react";

import { useAccountOperations } from "./accountOperations";
import { useAccountData } from "./ZeropsAccountData";

/** What the person is told of a deletion that did not finish; `null` once it did. */
function deletionTrouble(end: NonNullable<OperationEnd>): string | null {
  switch (end.stage) {
    case "done":
      return end.outcome === "succeeded" ? null : "Zerops did not delete it.";
    case "refused":
      return end.reason;
    case "unsent":
      return "Zerops did not take the deletion. Try again.";
    default:
      return "The deletion could not be followed. Check the project’s processes before deleting again.";
  }
}

export function useDeleteService(): (projectId: string, serviceId: string) => Promise<void> {
  const operations = useAccountOperations();
  const { orgId } = useAccountData();
  return useCallback(
    async (projectId, serviceId) => {
      if (orgId === null) throw new Error("No organization is open.");
      const { requestId } = await operations.submit({
        kind: "delete-service",
        orgId,
        projectId,
        serviceId,
      });
      const trouble = deletionTrouble(await operations.untilEnd(requestId, orgId));
      if (trouble !== null) throw new Error(trouble);
    },
    [operations, orgId],
  );
}
