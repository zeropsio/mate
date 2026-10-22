/**
 * Deleting a project with its code (`ZeropsDeleteApplicationDialog.logic.ts`): its stages go from
 * Zerops with the person's own access (`delete-project`), then HQ deletes the project with its
 * code (`delete-app` `withCode`). A stage already deleted by an earlier press of the same dialog is
 * not deleted again. Resolves once HQ deleted it; rejects with what to tell the person.
 */
import { useCallback } from "react";

import {
  deleteApplication,
  type DeleteApplicationTarget,
} from "~/components/zerops/ZeropsDeleteApplicationDialog.logic";

import { useAccountOperations } from "./accountOperations";
import { useDeleteProject } from "./deleteProject";
import { submitHqAppWrite } from "./hqAppWrite";
import { useZeropsSession } from "./ZeropsSessionProvider";

export type DeleteApplication = (
  target: DeleteApplicationTarget,
  /** Stages this dialog deleted already, by project id; each one deleted joins it. */
  deleted: Set<string>,
) => Promise<void>;

export function useDeleteApplication(): DeleteApplication {
  const { activeOrganization } = useZeropsSession();
  const operations = useAccountOperations();
  const deleteProject = useDeleteProject();
  return useCallback(
    async (target, deleted) => {
      if (activeOrganization === null) throw new Error("No organization is open.");
      const orgId = activeOrganization.id;
      await deleteApplication(target, {
        deleteProject: async (projectId) => {
          if (deleted.has(projectId)) return;
          await deleteProject(projectId);
          deleted.add(projectId);
        },
        deleteInHq: (appId) =>
          submitHqAppWrite(operations, { kind: "delete-app", orgId, appId, withCode: true }),
      });
    },
    [activeOrganization, deleteProject, operations],
  );
}
