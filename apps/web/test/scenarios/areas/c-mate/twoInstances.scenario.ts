import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { eachInstanceShowsAda, ownerSignsInAdasAgent } from "./dsl.ts";

describe("C: an open Mate against every HQ instance", () => {
  scenarioSuite((it) => {
    // witness: packages/client-runtime/src/zerops/agentOwnership.ts | return recorded === input.viewerSubject ? "mine" : "someone-else"; → return recorded !== input.viewerSubject ? "mine" : "someone-else";
    it.effect(
      "the person who signed in a Mate's agent finds its composer open to write in, whichever HQ instance answers",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* ownerSignsInAdasAgent(s);
          const looks = yield* eachInstanceShowsAda(s, "owner");
          expect(
            looks.map((look) => look.gate),
            "ASSERTION: each instance's page opens the signer's composer",
          ).toEqual(["a composer to write in", "a composer to write in"]);
        }),
    );
  });
});
