import { describe, expect, it } from "vite-plus/test";

import { questionFactsOf } from "./addEnvironment.logic";

// What the one question after a first merge is told: a button only for a tier the one rule
// (`environmentAddable`) lets this person add, and a production in any state is a production.
describe("questionFactsOf", () => {
  const base = {
    mayAdd: true,
    writer: false,
    recipeRead: true,
    recipeTiers: ["stage", "production"] as const,
    held: [] as ReadonlyArray<{ id: string; tier: "stage" | "production" }>,
  };
  it.each([
    {
      case: "nothing held, both held by the recipe, the person may add",
      input: base,
      want: { addable: { stage: true, production: true }, productionHeld: false },
    },
    {
      case: "the person may not add",
      input: { ...base, mayAdd: false },
      want: { addable: { stage: false, production: false }, productionHeld: false },
    },
    {
      case: "the recipe holds only the stage",
      input: { ...base, recipeTiers: ["stage"] as const },
      want: { addable: { stage: true, production: false }, productionHeld: false },
    },
    {
      case: "a production in any state: held, half-made or being made",
      input: { ...base, held: [{ id: "p", tier: "production" as const }] },
      want: { addable: { stage: true, production: false }, productionHeld: true },
    },
    {
      case: "a stage is held (a Mate that is the stage too), a non-writer",
      input: { ...base, held: [{ id: "s", tier: "stage" as const }] },
      want: { addable: { stage: false, production: true }, productionHeld: false },
    },
    {
      case: "a stage is held, a writer: another may be added",
      input: { ...base, writer: true, held: [{ id: "s", tier: "stage" as const }] },
      want: { addable: { stage: true, production: true }, productionHeld: false },
    },
    {
      case: "the recipe is not read: nothing is offered",
      input: { ...base, recipeRead: false, recipeTiers: [] as const },
      want: { addable: { stage: false, production: false }, productionHeld: false },
    },
  ])("is $want.addable for $case", ({ input, want }) => {
    expect(questionFactsOf(input)).toEqual(want);
  });
});
