/**
 * Naming a project, from wherever a project is drawn.
 *
 * A project's name is its application's in HQ (ADR 0002), and every project of the application is
 * named in full in Zerops after it. Renaming it is one start at HQ (`start-app-rename`) on the
 * person's access token: HQ renames the application in the start's write, then each of its
 * projects in Zerops, as its operation, with or without this tab; the tab renames nothing itself.
 * Resolves once HQ took the start, under the operation id `id` (the same id again after an answer
 * that did not come); rejects with what to tell the person.
 */
import { useCallback } from "react";

import { useAccountOperations } from "./accountOperations";
import { writeTrouble } from "./zeropsWrite";
import { useZeropsSession } from "./ZeropsSessionProvider";

export type RenameGroup = (appId: string, name: string, id: string) => Promise<void>;

export function useRenameGroup(): RenameGroup {
  const { activeOrganization } = useZeropsSession();
  const operations = useAccountOperations();
  return useCallback(
    async (appId, name, id) => {
      if (activeOrganization === null) throw new Error("No organization is open.");
      const { progress, evidence } = await operations.submit({
        kind: "start-app-rename",
        orgId: activeOrganization.id,
        appId,
        id,
        name,
      });
      const trouble = writeTrouble(progress, evidence);
      if (trouble !== null) throw new Error(trouble);
    },
    [activeOrganization, operations],
  );
}
