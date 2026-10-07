import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixtureWith } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

describe("E: deployment clocks", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches HQ calling a still-running stage build refused merely because its follow clock expired.
    it.effect(
      "HQ does not declare refused from a clock",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixtureWith();
          const a = environmentActions(f);
          yield* f.s.given.signedIn;
          yield* a.when.open("stage");
          const sha = yield* f.merge();
          yield* a.then.text(`Building ${sha.slice(0, 7)}`);
          const retained = yield* a.then.keepsStageRunning;
          yield* a.then.running("stage");
          yield* a.when.longRunningGap;
          yield* a.then.running("stage");
          yield* a.when.finish("stage");
          yield* a.then.text("Deployed").pipe(Effect.ensuring(retained));
        }),
      75_000,
    );
  });
});
