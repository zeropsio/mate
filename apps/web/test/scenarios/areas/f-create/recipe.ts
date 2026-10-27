import * as Effect from "effect/Effect";
import type { RecipeTier } from "@t3tools/shared/hqRecipe";
import { publishRecipe } from "../../harness/mateAccess.ts";
import type { createScenario } from "../../harness/scenario.ts";

/** Publish a recipe tier (a Mate's, a stage's, a production's) through a fixture Mate's actual HQ HTTP/git protocol. */
export const environmentRecipe = (
  s: Effect.Success<ReturnType<typeof createScenario>>,
  tier: RecipeTier,
) =>
  Effect.gen(function* () {
    const credential = yield* s.given.project("Ada", { mate: true, app: "Shop" });
    if (credential === undefined) return yield* Effect.die("Ada must be enrolled by its fixture");
    yield* publishRecipe(s.drivers.core, s.owner, credential, s.appIds.get("Shop")!, tier);
  });
