/**
 * What the one question after an application's first merge is told about its environments: which
 * of *Add stage* and *Add production* it may offer, and whether a production is held at all.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module addEnvironment.logic
 */
import type { GroupEnvironmentTier, ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";

export function questionFactsOf(input: {
  /** Whether this person may add an environment to the application (`mayAddEnvironment`). */
  readonly mayAdd: boolean;
  /** The tiers the recipe on `main` offers and the application lacks (`ZeropsProjectFlow.missing`). */
  readonly missing: ReadonlyArray<GroupEnvironmentTier>;
  /** The roles of the application's projects the account holds, declared in HQ or not. */
  readonly roles: ReadonlyArray<ZeropsEnvironmentRole | undefined>;
}): {
  readonly addable: { readonly stage: boolean; readonly production: boolean };
  /** A production project held in any state is a production. */
  readonly productionHeld: boolean;
} {
  const productionHeld = input.roles.includes("prod");
  return {
    addable: {
      // A Mate that is also the stage is the stage: no second one is asked for.
      stage: input.mayAdd && input.missing.includes("stage") && !input.roles.includes("devstage"),
      production: input.mayAdd && input.missing.includes("production") && !productionHeld,
    },
    productionHeld,
  };
}
