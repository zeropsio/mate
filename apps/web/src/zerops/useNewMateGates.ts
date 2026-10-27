/**
 * Why *Add a Mate* stands off for a project drawn, before anyone presses it (`newMateGate`):
 * from the setup files and changes other surfaces already hold — this holds nothing and reads
 * nothing of its own, so a project nobody has read stays as it was, Add on.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsGroupPendingMember } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useCallback, useContext, useMemo } from "react";

import {
  newMateDoorMates,
  newMateGate,
} from "../components/zerops/ZeropsEnvironmentCreationDialog.logic";
import { hqDown, hqNavigationAtom } from "../state/zerops";
import { projectNameInApp } from "@t3tools/client-runtime/zerops";
import { InventoryContext } from "./inventoryContext";
import { useAppsChanges } from "./projectFlows";
import { useHqAppDetails } from "./useHqAppDetail";
import { heldRecipeState } from "./useZeropsGroupRecipe";

/** A project as the menu and the projects page draw it. */
export interface NewMateGateEntry {
  readonly group: {
    readonly groupId: string;
    readonly name: string;
    readonly pending: ReadonlyArray<ZeropsGroupPendingMember>;
  };
  readonly environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>;
}

/**
 * The reason Add a Mate is off for a drawn project; `null` while Add may be pressed. Read over
 * every application HQ lists, so a caller asks of any project it draws, whenever it draws it.
 */
export function useNewMateGate(): (entry: NewMateGateEntry) => string | null {
  const navigation = useAtomValue(hqNavigationAtom);
  const key = navigation.structure?.apps.map((app) => app.id).join("\n") ?? "";
  const appIds = useMemo(() => (key === "" ? [] : key.split("\n")), [key]);
  const details = useHqAppDetails(appIds);
  const { changes } = useAppsChanges(appIds);
  // A change's Mate no longer drawn is named from the inventory, where one is held.
  const projects = useContext(InventoryContext)?.projects;
  const mateNames = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, projectNameInApp(project)])),
    [projects],
  );
  const down = hqDown(navigation);
  return useCallback(
    ({ group, environments }) => {
      const detail = details[group.groupId];
      if (down || detail === undefined) return null;
      return newMateGate({
        groupName: group.name,
        recipe: heldRecipeState(detail, "mate"),
        mates: newMateDoorMates({ environments, pending: group.pending }),
        changes: changes.get(group.groupId)?.pullRequests,
        mateName: (projectId) => mateNames.get(projectId),
      });
    },
    [changes, details, down, mateNames],
  );
}
