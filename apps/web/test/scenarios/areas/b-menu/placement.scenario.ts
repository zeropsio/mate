import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { productionRecipe } from "../f-create/recipe.ts";
import { menuScenario } from "./dsl.ts";

describe("B: authoritative placement", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("a Mate used as stage occupies the stage slot and explains who deploys it", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* productionRecipe(s);
        yield* s.colleague.moves("Ada", "Shop", "devstage");
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.menu.opensApplication("Shop");
        yield* s.menu.environmentSlots("Ada — deployed by its agent", ["Add production"]);
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect("proven deletion frees the production slot without losing the surviving Mate", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario([], { hq: { reconcileEvery: 200, streamRecheck: 200 } });
        yield* productionRecipe(s);
        yield* s.given.project("Production", {
          app: "Shop",
          kind: "production",
          environmentName: "production",
        });
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.menu.opensApplication("Shop");
        yield* s.menu.environmentSlots("Nothing deployed yet", []);
        yield* s.colleague.deletes("Production");
        yield* s.menu.environmentSlots("Not added", ["Add production"]);
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
