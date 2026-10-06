import * as Effect from "effect/Effect";
import { gitClient } from "../../../../../hq/test/harness/gitClient.ts";
import { mateInApp } from "../../../../../hq/test/harness/mates.ts";
import { groupCheckout, propose, stateBecomes } from "../../../../../hq/test/harness/recipe.ts";
import type { createScenario } from "../../harness/scenario.ts";

/** Publish the production recipe through a fixture Mate's actual HQ HTTP/git protocol. */
export const productionRecipe = (s: Effect.Success<ReturnType<typeof createScenario>>) =>
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
      { "4 — Small Production/import.yaml": "services:\n  - hostname: api\n    type: nodejs@22\n" },
      "Add the production recipe",
    );
    yield* checkout.push("Ada", number);
    yield* stateBecomes(core.call, owner, appId, number, "merged");
  });
