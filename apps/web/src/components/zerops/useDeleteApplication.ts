/**
 * Deleting a project with its code (`ZeropsDeleteApplicationDialog.logic.ts`): one start at HQ
 * (`start-app-deletion`) on the person's access token, naming the stages their dialog listed as
 * going. HQ deletes those stages from Zerops, then the project with its code, as its operation; the
 * tab deletes nothing itself. Resolves once HQ took the start, under the operation id `id` (the
 * same id again after an answer that did not come); rejects with what to tell the person.
 */
import { useCallback } from "react";

import type { DeleteApplicationTarget } from "./ZeropsDeleteApplicationDialog.logic";

import { useAccountOperations } from "~/zerops/accountOperations";
import { writeTrouble } from "~/zerops/zeropsWrite";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

type DeleteApplication = (target: DeleteApplicationTarget, id: string) => Promise<void>;

export function useDeleteApplication(): DeleteApplication {
  const { activeOrganization } = useZeropsSession();
  const operations = useAccountOperations();
  return useCallback(
    async (target, id) => {
      if (activeOrganization === null) throw new Error("No organization is open.");
      const { progress, evidence } = await operations.submit({
        kind: "start-app-deletion",
        orgId: activeOrganization.id,
        appId: target.appId,
        id,
        stages: target.stages.map((stage) => stage.projectId),
      });
      const trouble = writeTrouble(progress, evidence);
      if (trouble !== null) throw new Error(trouble);
    },
    [activeOrganization, operations],
  );
}
