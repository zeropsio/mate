import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { eachInstanceShowsAda, ownerSignsInAdasAgent } from "../c-mate/dsl.ts";

describe("B: the menu against every HQ instance", () => {
  scenarioSuite((it) => {
    // witness: packages/client-runtime/src/data/projections/hqProjectPeople.ts | for (const logins of [signedInNow, everSignedIn]) { → for (const logins of []) {
    it.effect(
      "a colleague's menu shows a Mate's row with its agent's signer's face, whichever HQ instance answers",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* ownerSignsInAdasAgent(s);
          const looks = yield* eachInstanceShowsAda(s, "dev");
          expect(
            looks.map((look) => look.seat),
            "ASSERTION: each instance's menu wears the signer's face",
          ).toEqual(["initials: Oowner's Mate", "initials: Oowner's Mate"]);
        }),
    );
  });
});
