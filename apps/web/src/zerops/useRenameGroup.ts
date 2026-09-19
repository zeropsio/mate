/**
 * Naming a project, from wherever a project is drawn.
 *
 * A project's name is not stored once: it lives on every environment in it as
 * a `mate:name:` tag, so a rename is one write per member (`groups.ts`). That
 * loop lived inside the projects screen, which is why the project's own page
 * — the page whose whole subject is that project — had no way to rename it
 * (the owner, 2026-09-19: "why isn't there options to rename group?").
 *
 * It needs nothing the projects screen has and other surfaces do not: the
 * active organization and the runtime's command factory, both from context.
 * The trouble it reports is the caller's to show, because where a failed write
 * belongs depends on the surface — a page says it under its heading, a menu
 * under the row it came from.
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { useCallback, useState } from "react";

import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { runZeropsCommand, useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

export interface RenameGroup {
  /** Writes `name` onto every environment of the group. */
  readonly rename: (group: ZeropsGroup, name: string) => Promise<void>;
  /** Whether a rename is in flight, so a second press cannot start another. */
  readonly renaming: boolean;
  /** Why the last one failed, in the platform's own words; `null` when none did. */
  readonly trouble: string | null;
}

export function useRenameGroup(): RenameGroup {
  const { activeOrganization } = useZeropsSession();
  const { projectRef, runtime } = useZeropsData();
  const [renaming, setRenaming] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  const rename = useCallback(
    async (group: ZeropsGroup, name: string) => {
      if (activeOrganization === null) return;
      setTrouble(null);
      setRenaming(true);
      try {
        // The name lives on every member; a rename is one write per member.
        for (const environment of group.environments) {
          await runZeropsCommand(
            runtime.commands.updateProjectGroupTags(
              projectRef(activeOrganization.id, environment.project.id),
              {
                groupId: group.groupId,
                ...(environment.role === undefined ? {} : { role: environment.role }),
                label: name,
              },
            ),
          );
        }
      } catch (cause) {
        setTrouble(zeropsErrorMessage(cause));
      } finally {
        setRenaming(false);
      }
    },
    [activeOrganization, projectRef, runtime.commands],
  );

  return { rename, renaming, trouble };
}
