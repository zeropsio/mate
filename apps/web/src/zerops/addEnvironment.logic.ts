/**
 * What the one question after an application's first merge is told about its environments: which
 * of *Add stage* and *Add production* it may offer — the one rule every door asks
 * (`environmentAddable`) over HQ's offers.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module addEnvironment.logic
 */
import {
  environmentAddable,
  heldTiers,
  type GroupEnvironmentTier,
  type HeldEnvironment,
} from "@t3tools/client-runtime/zerops";
import { hqOffer, type HqOffers } from "@t3tools/shared/hqOffers";

export function questionFactsOf(input: {
  /** The tiers HQ offers this person to add to the application (`add_stage` / `add_production`). */
  readonly offered: {
    readonly stage: boolean;
    readonly production: boolean;
    readonly git?: boolean;
    readonly zerops?: { readonly stage: boolean; readonly production: boolean };
  };
  readonly recipeRead: boolean;
  /** The tiers the recipe on `main` holds. */
  readonly recipeTiers: ReadonlyArray<GroupEnvironmentTier>;
  /**
   * What the application holds, in any state, each once: HQ's environments, the projects the
   * account made as a tier (a Mate that is also the stage is a stage), creations under way.
   */
  readonly held: ReadonlyArray<HeldEnvironment>;
}): {
  /** A tier held in any state — held, half-made, being made — is not addable. */
  readonly addable: { readonly stage: boolean; readonly production: boolean };
} {
  const held = heldTiers(input.held);
  const ask = (tier: GroupEnvironmentTier) =>
    environmentAddable({
      tier,
      recipeRead: input.recipeRead,
      recipeTiers: input.recipeTiers,
      offered: input.offered.zerops?.[tier] ?? input.offered[tier],
      gitOffered: input.offered.git === true,
      held,
    });
  return { addable: { stage: ask("stage"), production: ask("production") } };
}

/**
 * The tiers HQ offers this person to add to an application (`add_stage` / `add_production`), from
 * its `can` record as HQ streamed it (`hqOffer`): only an allowed decision offers, and nothing while
 * HQ does not answer. `null` while HQ has not said of the application.
 */
export function environmentOffersOf(can: HqOffers | undefined): {
  readonly stage: boolean;
  readonly production: boolean;
  readonly git?: boolean;
  readonly zerops?: { readonly stage: boolean; readonly production: boolean };
} | null {
  if (can === undefined) return null;
  const offered = (verb: string) => hqOffer(can, verb).kind === "allowed";
  const zerops = { stage: offered("add_stage"), production: offered("add_production") };
  return offered("add_git_environment")
    ? { stage: true, production: true, git: true, zerops }
    : zerops;
}

/**
 * Whether *Add stage* or *Add production* opens its sheet over the page it was pressed on: the
 * projects page and the project's own page hold the form; anywhere else goes to the projects page
 * first, so closing the sheet never lands somewhere the person did not open.
 */
export function addsEnvironmentInPlace(pathname: string, groupId: string): boolean {
  return pathname === "/zerops" || pathname === `/group/${groupId}/flow`;
}
