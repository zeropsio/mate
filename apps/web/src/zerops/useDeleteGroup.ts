/**
 * Deleting a project that holds nothing — what a New project that stopped before its Mate leaves
 * (E2E 2026-10-03, F5).
 *
 * A project is its application in HQ (ADR 0002): HQ deletes one only while it holds no Mate, no
 * environment and no change, and refuses it otherwise (`app_not_empty`). The write settles when
 * HQ answers and rejects with HQ's refusal, so the dialog that asked can wait for it and say why.
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useCallback } from "react";

import { useAccountOperations } from "./accountOperations";
import { submitHqAppWrite } from "./hqAppWrite";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Deletes the group's application in HQ. */
export type DeleteGroup = (group: ZeropsGroup) => Promise<void>;

export function useDeleteGroup(): DeleteGroup {
  const { activeOrganization } = useZeropsSession();
  const operations = useAccountOperations();

  return useCallback(
    async (group: ZeropsGroup) => {
      if (activeOrganization === null) throw new Error("No organization is open.");
      await submitHqAppWrite(operations, {
        kind: "delete-app",
        orgId: activeOrganization.id,
        appId: group.groupId,
      });
    },
    [activeOrganization, operations],
  );
}
