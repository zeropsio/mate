import type { SharedBirth } from "@t3tools/client-runtime/data";
import {
  planEnvironmentCreation,
  type EnvironmentCreationPlan,
  type EnvironmentRecipeChoice,
  type RecipeTier,
} from "@t3tools/client-runtime/zerops";
import { grantsWritableBy } from "@t3tools/client-runtime/zerops/projectAccess";
import { CHIEF_TAG } from "./chief";

export interface PinnedBirthRecipe {
  readonly revision: string;
  readonly tier: RecipeTier;
  readonly yaml: string;
}

/**
 * Reconstructs the recorded plan only from its immutable recipe revision, its access as the
 * presser may write it (`grantsWritableBy`): an owner marker recorded for its maker never stops
 * an admin's Continue.
 */
export function continuedBirthPlan(
  birth: SharedBirth,
  orgId: string,
  recipe: PinnedBirthRecipe | undefined,
  /** The organization role of the person pressing Continue. */
  presserRole: string | undefined,
): EnvironmentCreationPlan {
  const intent = birth.intent;
  if (intent === undefined || intent.placement.role === "prod")
    return { ok: false, reason: "This birth's original plan is unavailable." };
  let choice: EnvironmentRecipeChoice = { kind: "none" };
  if (intent.recipe.kind === "tier") {
    if (
      recipe === undefined ||
      recipe.revision !== intent.recipe.revision ||
      recipe.tier !== intent.recipe.tier
    )
      return { ok: false, reason: "The original recipe is unavailable." };
    choice = { kind: "tier", ...recipe };
  }
  const plan = planEnvironmentCreation({
    clientId: orgId,
    role: intent.placement.role,
    name: intent.projectName,
    recipe: choice,
    withAgent: true,
    agents: intent.agents,
    birth: birth.id,
    userRoles: grantsWritableBy(intent.userRoles, presserRole),
    ...(intent.location === null ? {} : { location: intent.location }),
  });
  if (!plan.ok || !intent.placement.chief) return plan;
  return {
    ok: true,
    steps: plan.steps.map((step) =>
      step.kind === "create-project" ? { ...step, tagList: [...step.tagList, CHIEF_TAG] } : step,
    ),
  };
}
