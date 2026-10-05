/**
 * What the one question after an application's first merge is told about its environments: which
 * of *Add stage* and *Add production* it may offer — the one rule every door asks
 * (`environmentAddable`) — and whether a production is held at all.
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

export function questionFactsOf(input: {
  /** Whether this person may add an environment to the application (`mayAddEnvironment`). */
  readonly mayAdd: boolean;
  /** An organization owner or admin (`environmentAddable`). */
  readonly writer: boolean;
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
      mayAdd: input.mayAdd,
      writer: input.writer,
      held,
    });
  return {
    addable: { stage: ask("stage"), production: ask("production") },
    productionHeld: held.production,
  };
}
