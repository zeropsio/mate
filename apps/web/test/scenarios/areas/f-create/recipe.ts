import * as Effect from "effect/Effect";
import { gitClient } from "../../../../../hq/test/harness/gitClient.ts";
import { mateInApp } from "../../../../../hq/test/harness/mates.ts";
import { groupCheckout, propose, stateBecomes } from "../../../../../hq/test/harness/recipe.ts";
import { RECIPE_TIER_PATHS, type RecipeTier } from "@t3tools/shared/hqRecipe";
import type { createScenario } from "../../harness/scenario.ts";

/** Publish a recipe tier (a Mate's, a stage's, a production's) through a fixture Mate's actual HQ HTTP/git protocol. */
export const environmentRecipe = (
  s: Effect.Success<ReturnType<typeof createScenario>>,
  tier: RecipeTier,
) =>
  Effect.gen(function* () {
    yield* s.given.project("Ada", { mate: true, registered: false });
    const { core, owner, appIds } = s.drivers;
    const { appId, credential, auth } = yield* mateInApp(
      core.call,
      core.fake,
      owner,
      "Ada",
      "Shop",
      appIds,
    );
    const number = yield* propose(core.call, auth);
    const checkout = yield* groupCheckout(
      yield* gitClient,
      core.origin,
      credential,
      appId,
      "recipe",
    );
    yield* checkout.write(
      { [RECIPE_TIER_PATHS[tier]]: "services:\n  - hostname: api\n    type: nodejs@22\n" },
      `Add the ${tier} recipe`,
    );
    yield* checkout.push("Ada", number);
    yield* stateBecomes(core.call, owner, appId, number, "merged");
  });
