import { describe, expect, it } from "vite-plus/test";

import { questionFactsOf } from "./addEnvironment.logic";

// What the one question after a first merge is told (MODEL §9.6, §9.8, §9.11): a button only for a
// tier the recipe holds, the application lacks and the person may add; a production held in any
// state is a production; a Mate that serves as the stage is the stage.
describe("questionFactsOf", () => {
  const both = ["stage", "production"] as const;
  it.each([
    {
      case: "nothing held, both offered, the person may add",
      input: { mayAdd: true, missing: both, roles: ["dev"] as const },
      want: { addable: { stage: true, production: true }, productionHeld: false },
    },
    {
      case: "a production being created, in flight or failed",
      input: { mayAdd: true, missing: both, roles: [] as const, pending: ["production"] as const },
      want: { addable: { stage: true, production: false }, productionHeld: true },
    },
    {
      case: "a stage being created",
      input: { mayAdd: true, missing: both, roles: [] as const, pending: ["stage"] as const },
      want: { addable: { stage: false, production: true }, productionHeld: false },
    },
    {
      case: "the person may not add",
      input: { mayAdd: false, missing: both, roles: ["dev"] as const },
      want: { addable: { stage: false, production: false }, productionHeld: false },
    },
    {
      case: "the recipe holds only the stage",
      input: { mayAdd: true, missing: ["stage"] as const, roles: ["dev"] as const },
      want: { addable: { stage: true, production: false }, productionHeld: false },
    },
    {
      case: "a production project is held but not declared (being made, failed)",
      input: { mayAdd: true, missing: ["stage"] as const, roles: ["dev", "prod"] as const },
      want: { addable: { stage: true, production: false }, productionHeld: true },
    },
    {
      case: "a Mate that is the stage: the stage is there",
      input: { mayAdd: true, missing: both, roles: ["devstage"] as const },
      want: { addable: { stage: false, production: true }, productionHeld: false },
    },
    {
      case: "the recipe is not read: nothing is offered",
      input: { mayAdd: true, missing: [] as const, roles: ["dev"] as const },
      want: { addable: { stage: false, production: false }, productionHeld: false },
    },
  ])("is $want.addable for $case", ({ input, want }) => {
    expect(questionFactsOf(input)).toEqual(want);
  });
});
