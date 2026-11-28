/**
 * Adding an environment to a group: what its form chooses before the one start HQ runs — a Mate's birth (`create-birth`) or a stage's or a production's
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
import type { RecipeTier } from "./recipeTier.ts";

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
 * - `tier`: a tier of the group repo, as `main` holds it. HQ reads and converts it for the platform.
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
