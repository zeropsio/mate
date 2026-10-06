/**
 * What the one question after an application's first merge is told about its environments: which
 * of *Add stage* and *Add production* it may offer — the one rule every door asks
 * (`environmentAddable`) over HQ's offers — and whether a production is held at all.
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
  readonly offered: { readonly stage: boolean; readonly production: boolean };
  readonly recipeRead: boolean;
  /** The tiers the recipe on `main` holds. */
  readonly recipeTiers: ReadonlyArray<GroupEnvironmentTier>;
  /**
   * What the application holds, in any state, each once: HQ's environments, the projects the
   * account made as a tier (a Mate that is also the stage is a stage), creations under way.
   */
  readonly held: ReadonlyArray<HeldEnvironment>;
}): {
  readonly addable: { readonly stage: boolean; readonly production: boolean };
  /** A production in any state — held, half-made, being made — is a production. */
  readonly productionHeld: boolean;
} {
  const held = heldTiers(input.held);
  const ask = (tier: GroupEnvironmentTier) =>
    environmentAddable({
      tier,
      recipeRead: input.recipeRead,
      recipeTiers: input.recipeTiers,
      offered: input.offered[tier],
      held,
    });
  return {
    addable: { stage: ask("stage"), production: ask("production") },
    productionHeld: held.production,
  };
}

/**
 * The tiers HQ offers this person to add to an application (`add_stage` / `add_production`), from
 * its `can` record as HQ streamed it (`hqOffer`): only an allowed decision offers, and nothing while
 * HQ does not answer. `null` while HQ has not said of the application.
 */
export function environmentOffersOf(
  can: HqOffers | undefined,
  hq: Parameters<typeof hqOffer>[2],
): { readonly stage: boolean; readonly production: boolean } | null {
  if (can === undefined) return null;
  const offered = (verb: string) => hqOffer(can, verb, hq).kind === "allowed";
  return { stage: offered("add_stage"), production: offered("add_production") };
}
