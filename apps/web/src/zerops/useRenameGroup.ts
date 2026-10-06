/**
 * Naming a project, from wherever a project is drawn.
 *
 * A project's name is its application's in HQ (ADR 0002): one record, renamed in one write. Every
 * project of the application is named in full in Zerops after it, so the write is followed by each
 * project's own rename there (`projectRenames.logic.ts`), their targets planned before HQ's write
 * from the name the application had. HQ's refusal rejects and nothing else happens; a project
 * Zerops refuses is returned with why, and `retry` sends the same targets again.
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { readZeropsMembership } from "@t3tools/client-runtime/zerops";
import { useCallback, useContext } from "react";

import { useAccountOperations } from "./accountOperations";
import { submitHqAppWrite } from "./hqAppWrite";
import {
  planProjectRenames,
  type ProjectRename,
  type ProjectRenameFailure,
} from "./projectRenames.logic";
import { useRenameProjects } from "./useRenameProjects";
import { HeldInventoryContext } from "./inventoryContext";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** The projects Zerops did not rename: none once the application and all its projects are. */
export type RenameGroup = (
  group: ZeropsGroup,
  name: string,
) => Promise<ReadonlyArray<ProjectRenameFailure>>;

export interface GroupRenaming {
  readonly rename: RenameGroup;
  /** The failed renames again, with the targets they were planned with. */
  readonly retry: (
    renames: ReadonlyArray<ProjectRename>,
  ) => Promise<ReadonlyArray<ProjectRenameFailure>>;
}

export function useRenameGroup(): GroupRenaming {
  const { activeOrganization } = useZeropsSession();
  const operations = useAccountOperations();
  const inventory = useZeropsInventory();
  // Every project the account holds, one the grant withholds included: it is a member still.
  const held = useContext(HeldInventoryContext);
  const projects = held?.projects ?? inventory.projects;
  const renameProjects = useRenameProjects();

  const rename = useCallback(
    async (group: ZeropsGroup, name: string) => {
      if (activeOrganization === null) throw new Error("No organization is open.");
      // Before HQ's write, from the name the application has: the targets stay as planned.
      const plan = planProjectRenames(
        projects.filter((project) => readZeropsMembership(project).groupId === group.groupId),
        group.nameSource === "unread" ? undefined : group.name,
        name.trim(),
      );
      await submitHqAppWrite(operations, {
        kind: "rename-app",
        orgId: activeOrganization.id,
        appId: group.groupId,
        name,
      });
      return renameProjects(plan);
    },
    [activeOrganization, operations, projects, renameProjects],
  );

  return { rename, retry: renameProjects };
}
