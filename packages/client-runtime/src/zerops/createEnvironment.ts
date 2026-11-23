/**
 * Adding an environment to a group: what its form's choice is, and what this client checks of it
 * before the one start HQ runs — a Mate's birth (`create-birth`) or a stage's or a production's
 * `environment` operation. Every step is HQ's on the person's token; nothing here acts.
 *
 * Production reserves its project and access only: its services arrive with an approved release.
 * Other environments use a tier read from the group repo (`recipeTier.ts`).
 *
 * Pure: no network (rule R1).
 *
 * @module createEnvironment
 */

import type { ZeropsEnvironmentRole } from "./groups.ts";
import {
  deployTargetTier,
  mateTier,
  recipeTierZcpServices,
  type MateTier,
  type RecipeTier,
} from "./recipeTier.ts";

/**
 * Whether a new environment gets a `zcp` container — and so an agent, and a
 * conversation — or is a deployment target mate only watches.
 *
 * The default is deliberate: `dev`, `devstage` and `stage` are places somebody
 * works, so they get one. `prod` does not. An agent with a shell in production
 * is a different product decision from anything settled so far, and a default
 * is the wrong way to make it — a caller that wants one has to say so.
 */
export function defaultAgentForRole(role: ZeropsEnvironmentRole): boolean {
  // A stage is a deploy target, as its form's note says; an agent there is
  // the person's decision, like production's. A dev environment, on its own
  // or with its stage half, is a Mate by default.
  return role === "dev" || role === "devstage";
}

/**
 * Where the new environment's application comes from.
 *
 * - `tier`: a tier of the group repo, as `main` holds it. The plan converts it
 *   for the platform (`recipeTier.ts`).
 * - `none`: no application yet. The agent is the first thing in the
 *   environment and sets the rest up — which is the whole point of having one.
 *
 * There is no third option any more. The group repo is the one place a
 * group's shape is written down (D13); cloning a sibling's export carried
 * service shapes without their build setup, so it produced environments that
 * looked created and could not build.
 */
export type EnvironmentRecipeChoice =
  | {
      readonly kind: "tier";
      readonly tier: RecipeTier;
      readonly revision: string;
      readonly yaml: string;
    }
  | { readonly kind: "none" };

/**
 * What a Mate's birth imports beside its container (`mateTier`), or why it cannot be born: no
 * name, a recipe not merged yet, or one that declares its own Zerops Control Plane (a project
 * holds one Mate, audit D2). Its project, key and import are HQ's birth operation's.
 */
export function mateBirthTier(input: {
  readonly name: string;
  readonly recipe: EnvironmentRecipeChoice;
}):
  | { readonly ok: true; readonly tier?: MateTier }
  | { readonly ok: false; readonly reason: string } {
  if (input.name.trim().length === 0) return { ok: false, reason: "An environment needs a name." };
  if (input.recipe.kind === "none") return { ok: true };
  const tier = mateTier(input.recipe.yaml);
  if (tier === undefined) return { ok: false, reason: NO_RECIPE };
  const zcp = recipeTierZcpServices(input.recipe.yaml);
  if (zcp.length > 0)
    return {
      ok: false,
      reason: `This project's recipe declares a Zerops Control Plane (${zcp.join(", ")}). A Mate brings its own: take it out of the recipe, then try again.`,
    };
  return { ok: true, tier };
}

/**
 * The Zerops import YAML a stage without a Mate is added with (`deployTargetTier`), which HQ's
 * `environment` operation imports, or why there is none: no name, nothing in it, or a recipe not
 * merged yet. A production imports no services: it takes none.
 */
export function stageRecipe(input: {
  readonly name: string;
  readonly recipe: EnvironmentRecipeChoice;
}): { readonly ok: true; readonly yaml: string } | { readonly ok: false; readonly reason: string } {
  if (input.name.trim().length === 0) return { ok: false, reason: "An environment needs a name." };
  if (input.recipe.kind === "none")
    return {
      ok: false,
      reason: "An environment with neither an agent nor an application has nothing in it.",
    };
  const yaml = deployTargetTier(input.recipe.yaml);
  return yaml === undefined ? { ok: false, reason: NO_RECIPE } : { ok: true, yaml };
}

const NO_RECIPE = "This project has no recipe merged yet.";
