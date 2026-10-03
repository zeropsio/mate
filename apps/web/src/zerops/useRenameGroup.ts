/**
 * Naming a project, from wherever a project is drawn.
 *
 * A project's name is its application's in HQ (ADR 0002): one record, renamed in one write, and
 * every surface draws it from HQ's stream once HQ says so. The write settles when HQ answers and
 * rejects with HQ's refusal, so the dialog that asked can wait for it and say why.
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useCallback } from "react";

import { accountHqApi, officialHq, useAccountHq } from "./accountHq";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Renames the group's application in HQ. */
export type RenameGroup = (group: ZeropsGroup, name: string) => Promise<void>;

export function useRenameGroup(): RenameGroup {
  const { activeOrganization, client } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);

  return useCallback(
    async (group: ZeropsGroup, name: string) => {
      if (activeOrganization === null) throw new Error("No organization is open.");
      await accountHqApi(client, activeOrganization.id, officialHq(accountHq)).renameApp(
        group.groupId,
        name,
      );
    },
    [accountHq, activeOrganization, client],
  );
}
