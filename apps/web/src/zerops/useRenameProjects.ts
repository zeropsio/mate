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
    async (renames) => {
      const organization = activeOrganization;
      // A rejection, never a throw out of the caller's own frame: its dialog must not stay pending.
      if (organization === null) throw new Error("No organization is open.");
      return runProjectRenames(renames, async ({ projectId, from, to }) => {
        // Only a project still named as it was planned from: one renamed since is said, not written.
        await runZeropsCommand(
          runtime.commands.renameProject(projectRef(organization.id, projectId), to, from),
        );
      });
    },
    [activeOrganization, projectRef, runtime.commands],
  );
}
