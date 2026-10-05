/**
 * The two questions every door to *Add stage* and *Add production* asks: whether this person may
 * add one to an application (`mayAddEnvironment`), and the way in — the projects page's own
 * creation form, asked for through `useSetUpEnvironment`.
 */
import { useNavigate } from "@tanstack/react-router";
import { readZeropsMembership, type GroupEnvironmentTier } from "@t3tools/client-runtime/zerops";
import { useCallback, useContext } from "react";

import { mayAddEnvironment } from "~/components/zerops/projects/projectsView.logic";

import { HeldInventoryContext } from "./inventoryContext";
import { useSetUpEnvironment } from "./setUpEnvironment";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Whether this person may add a stage or a production to an application, by its id. */
export function useMayAddEnvironment(): (groupId: string) => boolean {
  const organization = useZeropsSession().activeOrganization;
  const inventory = useZeropsInventory();
  const held = useContext(HeldInventoryContext);
  const projects = held?.projects ?? inventory.projects;
  return useCallback(
    (groupId) =>
      organization !== null &&
      mayAddEnvironment({
        organization,
        projects: projects.filter((project) => readZeropsMembership(project).groupId === groupId),
      }),
    [organization, projects],
  );
}

/** Opens the creation form for a stage or a production of an application, on the projects page. */
export function useAddEnvironment(): (groupId: string, tier: GroupEnvironmentTier) => void {
  const ask = useSetUpEnvironment((state) => state.ask);
  const navigate = useNavigate();
  return useCallback(
    (groupId, tier) => {
      ask(groupId, tier);
      void navigate({ to: "/zerops" });
    },
    [ask, navigate],
  );
}
