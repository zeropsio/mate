/**
 * What every door to *Add stage* and *Add production* asks: which tiers HQ offers this person to
 * add to an application (`environmentOffersOf`), what the one question after a first merge may
 * offer (`questionFactsOf`), and the way in — the projects page's own creation form, asked for
 * through `useSetUpEnvironment`.
 */
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  applicationEnvironments,
  listedEnvironmentsOf,
  type ApplicationEnvironmentFacts,
  type HeldEnvironment,
} from "@t3tools/client-runtime/zerops";
import { useCallback, useContext, useMemo } from "react";

import { hqNavigationAtom } from "../state/zerops";
import { addsEnvironmentInPlace } from "./addEnvironment.logic";
import {
  environmentOffersOf,
  questionFactsOf,
} from "@t3tools/client-runtime/zerops/addEnvironment";
import { HeldInventoryContext } from "./inventoryContext";
import { comingMember, menuTreeAtom } from "./menuRows";
import type { ZeropsProjectFlow } from "./projectFlows";
import { useSetUpEnvironment } from "./setUpEnvironment";
import { useZeropsInventory } from "./ZeropsInventoryProvider";

/**
 * The stages of each application being set up, as the menu's tree holds them (`menuTree`): its
 * Mates being made that are also the stage (`comingMember`'s `devstage`).
 */
function usePendingEnvironments(): ReadonlyMap<string, ReadonlyArray<HeldEnvironment>> {
  const menu = useAtomValue(menuTreeAtom);
  return useMemo(
    () =>
      new Map(
        menu.groups.map((group) => [
          group.id,
          group.members.flatMap((member): ReadonlyArray<HeldEnvironment> => {
            if (member.kind !== "mate" || member.placement !== null) return [];
            const coming = comingMember(member, group.name);
            return coming.kind === "devstage" ? [{ id: coming.projectId, tier: "stage" }] : [];
          }),
        ]),
      ),
    [menu],
  );
}

/**
 * What HQ's flow of an application tells its environments' facts, with its outside production
 * (`ZeropsProjectFlow.outside`), which leaves no production to add.
 */
type ApplicationEnvironmentReads = Pick<
  ApplicationEnvironmentFacts,
  "environments" | "recipeRead" | "recipeTiers" | "merged" | "pullRequests" | "changesKnown"
> &
  Pick<ZeropsProjectFlow, "outside">;

/**
 * Every fact an application's environments are told from (`applicationEnvironments`), gathered
 * once for every surface: HQ's offers to this person, the account's projects of the application
 * placed as a tier or as a Mate that is also the stage, creations under way, and what the
 * surface's flow read of HQ's environments, the recipe and the application's changes.
 */
export function useApplicationEnvironmentFacts(): (
  groupId: string,
  reads: ApplicationEnvironmentReads | undefined,
) => ApplicationEnvironmentFacts {
  const offers = useEnvironmentOffers();
  const inventory = useZeropsInventory();
  const kept = useContext(HeldInventoryContext);
  const projects = kept?.projects ?? inventory.projects;
  const pending = usePendingEnvironments();
  return useCallback(
    (groupId, reads) => ({
      environments: reads?.environments ?? [],
      ...listedEnvironmentsOf(groupId, projects),
      pending: pending.get(groupId) ?? [],
      recipeRead: reads?.recipeRead === true,
      recipeTiers: reads?.recipeTiers ?? [],
      offered: offers(groupId),
      merged: reads?.merged ?? [],
      pullRequests: reads?.pullRequests ?? [],
      changesKnown: reads?.changesKnown === true,
      productionOutside: reads?.outside !== undefined,
    }),
    [offers, pending, projects],
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
      environmentOffersOf(navigation.structure?.apps.find((app) => app.id === groupId)?.can),
    [navigation],
  );
}

/**
 * What the one question after an application's first merge may offer: the one rule over what the
 * application holds in any state (`applicationEnvironments`).
 */
export function useEnvironmentQuestionFacts(
  groupId: string,
  flow:
    | Pick<
        ZeropsProjectFlow,
        "recipeRead" | "recipeTiers" | "environmentInputs" | "merged" | "pullRequests" | "outside"
      >
    | undefined,
): ReturnType<typeof questionFactsOf> {
  const factsOf = useApplicationEnvironmentFacts();
  return useMemo(() => {
    const facts = factsOf(
      groupId,
      flow === undefined
        ? undefined
        : {
            environments: flow.environmentInputs,
            recipeRead: flow.recipeRead,
            recipeTiers: flow.recipeTiers,
            merged: flow.merged,
            pullRequests: flow.pullRequests,
            outside: flow.outside,
          },
    );
    return questionFactsOf({
      offered: facts.offered ?? { stage: false, production: false },
      recipeRead: facts.recipeRead,
      recipeTiers: facts.recipeTiers,
      held: applicationEnvironments(facts).held,
      productionOutside: facts.productionOutside,
    });
  }, [factsOf, flow, groupId]);
}

/** Opens the creation form for a stage or a production of an application, on the projects page. */
export function useAddEnvironment(): (groupId: string, tier: HeldEnvironment["tier"]) => void {
  const ask = useSetUpEnvironment((state) => state.ask);
  const navigate = useNavigate();
  const router = useRouter();
  return useCallback(
    (groupId, tier) => {
      if (addsEnvironmentInPlace(router.state.location.pathname, groupId)) {
        ask(groupId, tier);
        return;
      }
      // Asked once the projects page stands: asked first, the page being left could take the ask
      // and open the form there, only to lose it as the navigation unmounts that page.
      void navigate({ to: "/zerops" }).then(() => {
        ask(groupId, tier);
      });
    },
    [ask, navigate, router],
  );
}
