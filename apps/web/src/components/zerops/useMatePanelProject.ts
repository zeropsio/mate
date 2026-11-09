/**
 * The project a Mate's panels show: its application, found the way the origin ask card finds it
 * (the Mate's project in HQ's structure), its places and what goes to production next, and the
 * door to the project's page. A place opens its own page, and the release its review, from the
 * shared components themselves.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useApplicationOfProject } from "~/zerops/useGitEnvironmentFormInputs";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useApplicationPlaces } from "./system";
import type { MatePanelProject } from "./MatePanelPlaces";

const NO_ENVIRONMENT = "" as EnvironmentId;

export function useMatePanelProject(
  environmentId: EnvironmentId | null | undefined,
): MatePanelProject | undefined {
  const navigate = useNavigate();
  const mate = useKnownMate(environmentId ?? NO_ENVIRONMENT);
  const location = useMateOfEnvironment(environmentId);
  const application = useApplicationOfProject(location?.projectId ?? mate?.projectId);
  const groupId = application?.id;
  const { groupName, places, next, groupFlow } = useApplicationPlaces(groupId ?? "");
  const name = groupName ?? application?.name;
  return useMemo(
    () =>
      groupId === undefined || name === undefined
        ? undefined
        : {
            groupId,
            name,
            places,
            next,
            groupFlow,
            onOpenProject: () => {
              void navigate({ to: "/group/$groupId/flow", params: { groupId } });
            },
          },
    [groupFlow, groupId, name, navigate, next, places],
  );
}
