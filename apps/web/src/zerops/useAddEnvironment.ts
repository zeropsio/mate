/**
 * What every door to *Add stage* and *Add production* asks: whether this person may add one to an
 * application (`mayAddEnvironment`), what the one question after a first merge may offer
 * (`questionFactsOf`), and the way in — the projects page's own creation form, asked for through
 * `useSetUpEnvironment`.
 */
import { useNavigate } from "@tanstack/react-router";
import {
  buildZeropsGroupTree,
  readZeropsMembership,
  type GroupEnvironmentTier,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useCallback, useContext, useMemo } from "react";

import { mayAddEnvironment } from "~/components/zerops/projects/projectsView.logic";

import { questionFactsOf } from "./addEnvironment.logic";
import { HeldInventoryContext } from "./inventoryContext";
import { placedPressesIn, useMatePresses } from "./matePress";
import { useNewProjectBirths } from "./newProjectBirth";
import { useSetUpEnvironment } from "./setUpEnvironment";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** The account's projects of an application, as the inventory holds them. */
function useGroupProjects(): (groupId: string) => ReadonlyArray<ZeropsProject> {
  const inventory = useZeropsInventory();
  const held = useContext(HeldInventoryContext);
  const projects = held?.projects ?? inventory.projects;
  return useCallback(
    (groupId) => projects.filter((project) => readZeropsMembership(project).groupId === groupId),
    [projects],
  );
}

/**
 * The stages and productions of an application the platform accepted and HQ does not hold yet,
 * each as the group tree draws it from this tab's presses (`placedPressesIn`): being made, or
 * failed.
 */
export function useGroupPendingEnvironments(groupId: string): ReadonlyArray<{
  readonly id: string;
  readonly tier: GroupEnvironmentTier;
  readonly name: string;
  readonly failed: boolean;
}> {
  const { listing } = useZeropsCandidates();
  const presses = useMatePresses();
  const made = useNewProjectBirths((state) => state.births);
  const organizationId = useZeropsSession().activeOrganization?.id;
  return useMemo(
    () =>
      (
        buildZeropsGroupTree(heldCandidates(listing).rows, {
          order: "name",
          births: placedPressesIn(presses, organizationId, Object.values(made)),
        }).groups.find((entry) => entry.group.groupId === groupId)?.group.pending ?? []
      ).flatMap((member) =>
        member.kind === "stage" || member.kind === "production"
          ? [
              {
                id: member.projectId,
                tier: member.kind,
                name: member.name,
                failed: member.failed === true,
              },
            ]
          : [],
      ),
    [groupId, listing, made, organizationId, presses],
  );
}

/** Whether this person may add a stage or a production to an application, by its id. */
export function useMayAddEnvironment(): (groupId: string) => boolean {
  const organization = useZeropsSession().activeOrganization;
  const projectsOf = useGroupProjects();
  return useCallback(
    (groupId) =>
      organization !== null && mayAddEnvironment({ organization, projects: projectsOf(groupId) }),
    [organization, projectsOf],
  );
}

/**
 * What the one question after an application's first merge may offer, given the tiers the recipe
 * holds and the application lacks.
 */
export function useEnvironmentQuestionFacts(
  groupId: string,
  missing: ReadonlyArray<GroupEnvironmentTier>,
): ReturnType<typeof questionFactsOf> {
  const mayAdd = useMayAddEnvironment()(groupId);
  const projects = useGroupProjects()(groupId);
  const pending = useGroupPendingEnvironments(groupId);
  return useMemo(
    () =>
      questionFactsOf({
        mayAdd,
        missing,
        roles: projects.map((project) => readZeropsMembership(project).role),
        pending: pending.map((entry) => entry.tier),
      }),
    [mayAdd, missing, pending, projects],
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
