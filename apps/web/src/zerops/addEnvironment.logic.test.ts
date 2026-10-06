import { describe, expect, it } from "vite-plus/test";

import { environmentOffersOf, questionFactsOf } from "./addEnvironment.logic";

// What the one question after a first merge is told: a button only for a tier the one rule
// (`environmentAddable`) offers — HQ's offer, the recipe, nothing of it here yet — and a production
// in any state is a production.
describe("questionFactsOf", () => {
  const base = {
    offered: { stage: true, production: true },
    recipeRead: true,
    recipeTiers: ["stage", "production"] as const,
    held: [] as ReadonlyArray<{ id: string; tier: "stage" | "production" }>,
  };
  it.each([
    {
      case: "nothing held, both held by the recipe, HQ offers both",
      input: base,
      want: { addable: { stage: true, production: true }, productionHeld: false },
    },
    {
      case: "HQ offers neither",
      input: { ...base, offered: { stage: false, production: false } },
      want: { addable: { stage: false, production: false }, productionHeld: false },
    },
    {
      case: "HQ offers only the stage",
      input: { ...base, offered: { stage: true, production: false } },
      want: { addable: { stage: true, production: false }, productionHeld: false },
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
      case: "a stage is held (a Mate that is the stage too)",
      input: { ...base, held: [{ id: "s", tier: "stage" as const }] },
      want: { addable: { stage: false, production: true }, productionHeld: false },
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

// The tiers HQ offers this person to add to an application, from its `can` record as streamed:
// a refusal, an unknown verb and an HQ that stopped answering offer nothing.
describe("environmentOffersOf", () => {
  const LIVE = { current: true, unavailableSince: null };
  const ALLOW = { allow: true };
  const SLOT_TAKEN = { allow: false, reason: "slot_taken" };
  it.each([
    {
      case: "both offered",
      can: { add_stage: ALLOW, add_production: ALLOW },
      hq: LIVE,
      want: { stage: true, production: true },
    },
    {
      case: "the stage's place taken",
      can: { add_stage: SLOT_TAKEN, add_production: ALLOW },
      hq: LIVE,
      want: { stage: false, production: true },
    },
    {
      case: "an HQ that says neither",
      can: {},
      hq: LIVE,
      want: { stage: false, production: false },
    },
    {
      case: "an HQ that stopped answering",
      can: { add_stage: ALLOW, add_production: ALLOW },
      hq: { current: false, unavailableSince: 1_000 },
      want: { stage: false, production: false },
    },
    { case: "an application HQ has not said", can: undefined, hq: LIVE, want: null },
  ])("$case", ({ can, hq, want }) => {
    expect(environmentOffersOf(can, hq)).toEqual(want);
  });
});
