/**
 * Renames projects in Zerops by targets already planned (`projectRenames.logic.ts`), through the
 * account's one writer of a project's record, which puts every tag back as it found it.
 */
import { useCallback } from "react";

import {
  runProjectRenames,
  type ProjectRename,
  type ProjectRenameFailure,
} from "./projectRenames.logic";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { runZeropsCommand, useZeropsData } from "./zeropsDataContext";

export type RenameProjects = (
  renames: ReadonlyArray<ProjectRename>,
) => Promise<ReadonlyArray<ProjectRenameFailure>>;

export function useRenameProjects(): RenameProjects {
  const { activeOrganization } = useZeropsSession();
  const { projectRef, runtime } = useZeropsData();

  return useCallback(
    (renames) => {
      const organization = activeOrganization;
      if (organization === null) throw new Error("No organization is open.");
      return runProjectRenames(renames, async ({ projectId, to }) => {
        await runZeropsCommand(
          runtime.commands.renameProject(projectRef(organization.id, projectId), to),
        );
      });
    },
    [activeOrganization, projectRef, runtime.commands],
  );
}
