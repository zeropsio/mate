/**
 * What every door to *Add stage* and *Add production* asks: which tiers HQ offers this person to
 * add to an application (`environmentOffersOf`), what the one question after a first merge may
 * offer (`questionFactsOf`), and the way in — the projects page's own creation form, asked for
 * through `useSetUpEnvironment`.
 */
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  buildZeropsGroupTree,
  readZeropsMembership,
  type HeldEnvironment,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useCallback, useContext, useMemo } from "react";

import { hqDown, hqNavigationAtom } from "../state/zerops";
import { environmentOffersOf, questionFactsOf } from "./addEnvironment.logic";
import { HeldInventoryContext } from "./inventoryContext";
import { placedPressesIn, useMatePresses } from "./matePress";
import { useNewProjectBirths } from "./newProjectBirth";
import type { ZeropsProjectFlow } from "./projectFlowContext";
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
 * The stages and productions of an application the platform accepted and HQ does not hold yet, as
 * the group tree draws them from this tab's presses (`placedPressesIn`).
 */
export function useGroupPendingEnvironments(groupId: string): ReadonlyArray<HeldEnvironment> {
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
      ).flatMap((member): ReadonlyArray<HeldEnvironment> =>
        member.kind === "stage" || member.kind === "production"
          ? [{ id: member.projectId, tier: member.kind }]
          : [],
      ),
    [groupId, listing, made, organizationId, presses],
  );
}

/**
 * The tiers HQ offers this person to add to an application, by its id (`environmentOffersOf`);
 * `null` while HQ has not said of it.
 */
export function useEnvironmentOffers(): (
  groupId: string,
) => ReturnType<typeof environmentOffersOf> {
  const navigation = useAtomValue(hqNavigationAtom);
  return useCallback(
    (groupId) =>
      environmentOffersOf(
        navigation.structure?.apps.find((app) => app.id === groupId)?.can,
        // Since when HQ stopped answering is words only; nothing is offered meanwhile.
        { current: navigation.live, unavailableSince: hqDown(navigation) ? 0 : null },
      ),
    [navigation],
  );
}

/**
 * What the one question after an application's first merge may offer: the one rule over what the
 * application holds in any state — HQ's environments, the projects the account made as a tier
 * (a Mate that is also the stage is a stage), creations under way.
 */
export function useEnvironmentQuestionFacts(
  groupId: string,
  flow: Pick<ZeropsProjectFlow, "recipeRead" | "recipeTiers" | "environmentInputs"> | undefined,
): ReturnType<typeof questionFactsOf> {
  const offered = useEnvironmentOffers()(groupId);
  const stage = offered?.stage === true;
  const production = offered?.production === true;
  const projects = useGroupProjects()(groupId);
  const pending = useGroupPendingEnvironments(groupId);
  return useMemo(
    () =>
      questionFactsOf({
        offered: { stage, production },
        recipeRead: flow?.recipeRead === true,
        recipeTiers: flow?.recipeTiers ?? [],
        held: [
          ...(flow?.environmentInputs ?? []).map((entry) => ({
            id: entry.projectId,
            tier: entry.tier,
          })),
          ...projects.flatMap((project): ReadonlyArray<HeldEnvironment> => {
            const { role } = readZeropsMembership(project);
            return role === "prod"
              ? [{ id: project.id, tier: "production" }]
              : role === "stage" || role === "devstage"
                ? [{ id: project.id, tier: "stage" }]
                : [];
          }),
          ...pending,
        ],
      }),
    [flow, pending, production, projects, stage],
  );
}

/** Opens the creation form for a stage or a production of an application, on the projects page. */
export function useAddEnvironment(): (groupId: string, tier: HeldEnvironment["tier"]) => void {
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
