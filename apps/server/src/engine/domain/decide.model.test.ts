// @effect-diagnostics globalConsole:off - a failing seed prints its shrunk script when asked.
import { describe, expect, it } from "@effect/vitest";

import { describeFailure, runSeed, shrink, type Failure } from "../testing/model.ts";
import { gateSeeds } from "../testing/rng.ts";

const SEEDS = gateSeeds(Number(process.env.ENGINE_PROOF_SEEDS ?? 100));
const STEPS = Number(process.env.ENGINE_PROOF_STEPS ?? 200);

/** Every distinct broken invariant, each shown by its shortest shrunk script. */
const explore = () => {
  const byInvariant = new Map<string, Failure>();
  for (const seed of SEEDS) {
    const failure = runSeed(seed, STEPS, {
      unorderedSettles: process.env.ENGINE_PROOF_UNORDERED === "1",
    });
    if (failure === undefined) continue;
    const known = byInvariant.get(failure.violation.invariant);
    if (known !== undefined && known.played.length <= failure.played.length) continue;
    byInvariant.set(failure.violation.invariant, shrink(failure));
  }
  return byInvariant;
};

describe("decide and evolve against the engine's rules (seeded model run)", () => {
  it("every generated conversation keeps every invariant", () => {
    const found = explore();
    const report = [...found.values()].map(describeFailure).join("\n\n");
    if (process.env.ENGINE_PROOF_PRINT) console.log(report);
    expect(report).toBe("");
  });
});
