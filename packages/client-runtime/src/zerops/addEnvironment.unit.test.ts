import { expect, it } from "vite-plus/test";

import { environmentOffersOf, questionFactsOf } from "./addEnvironment.ts";

// witness: packages/client-runtime/src/zerops/addEnvironment.ts | const offered = (verb: string) => hqOffer(can, verb).kind === "allowed"; → const offered = (verb: string) => hqOffer(can, verb).kind !== "refused";
it("ZV18: Adding a stage or a production is offered only on HQ's allowed decision for that tier; a refused or unsaid tier offers nothing, and an application HQ has not said of has no offers yet", () => {
  expect(
    environmentOffersOf({ add_stage: { allow: true }, add_production: { allow: true } }),
  ).toEqual({
    stage: true,
    production: true,
  });
  expect(
    environmentOffersOf({
      add_stage: { allow: false, reason: "slot_taken" },
      add_production: { allow: true },
    }),
  ).toEqual({ stage: false, production: true });
  expect(environmentOffersOf({})).toEqual({ stage: false, production: false });
  expect(environmentOffersOf(undefined)).toBeNull();
});

// witness: packages/client-runtime/src/zerops/addEnvironment.ts | gitOffered: input.offered.git === true, → gitOffered: false,
it("ZV19: HQ's offer of a Git environment offers both a stage and a production without any recipe, its own Zerops offers kept beside it", () => {
  const offered = environmentOffersOf({ add_git_environment: { allow: true } });
  expect(offered).toEqual({
    stage: true,
    production: true,
    git: true,
    zerops: { stage: false, production: false },
  });
  expect(
    questionFactsOf({ offered: offered!, recipeRead: false, recipeTiers: [], held: [] }).addable,
  ).toEqual({
    stage: true,
    production: true,
  });
});

const base = {
  offered: { stage: true, production: true },
  recipeRead: true,
  recipeTiers: ["stage", "production"],
  held: [],
} as const;

// witness: packages/client-runtime/src/zerops/addEnvironment.ts | const held = heldTiers(input.held); → const held = heldTiers([]);
it("ZV20: A tier the application already holds in any state, a Mate that is also the stage included, is not offered again", () => {
  expect(questionFactsOf({ ...base, held: [{ id: "p", tier: "production" }] }).addable).toEqual({
    stage: true,
    production: false,
  });
  expect(questionFactsOf({ ...base, held: [{ id: "s", tier: "stage" }] }).addable).toEqual({
    stage: false,
    production: true,
  });
});

// witness: packages/client-runtime/src/zerops/addEnvironment.ts | production: input.productionOutside !== true && ask("production"), → production: ask("production"),
it("ZV21: Add production is never offered where production is said to be deployed outside Mate, whatever HQ and the recipe offer", () => {
  expect(questionFactsOf({ ...base, productionOutside: true }).addable).toEqual({
    stage: true,
    production: false,
  });
});
