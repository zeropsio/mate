/**
 * Naming a project, from wherever a project is drawn.
 *
 * A project's name is its application's in HQ (ADR 0002): one record, renamed in one write, and
 * every surface draws it from HQ's stream once HQ says so. The trouble it reports is the caller's
 * to show, because where a failed write belongs depends on the surface — a page says it under its
 * heading, a menu under the row it came from.
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useState } from "react";

import { accountHqApi, officialHq, useAccountHq } from "./accountHq";
import { useZeropsSession } from "./ZeropsSessionProvider";

export interface RenameGroup {
  /** Renames the group's application in HQ. */
  readonly rename: (group: ZeropsGroup, name: string) => Promise<void>;
  /** Whether a rename is in flight, so a second press cannot start another. */
  readonly renaming: boolean;
  /** Why the last one failed, in HQ's own words; `null` when none did. */
  readonly trouble: string | null;
}

export function useRenameGroup(): RenameGroup {
  const { activeOrganization, client } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);
  const [renaming, setRenaming] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  const rename = useCallback(
    async (group: ZeropsGroup, name: string) => {
      if (activeOrganization === null) return;
      setTrouble(null);
      setRenaming(true);
      try {
        await accountHqApi(client, activeOrganization.id, officialHq(accountHq)).renameApp(
          group.groupId,
          name,
        );
      } catch (cause) {
        setTrouble(zeropsErrorMessage(cause));
      } finally {
        setRenaming(false);
      }
    },
    [accountHq, activeOrganization, client],
  );

  return { rename, renaming, trouble };
}
