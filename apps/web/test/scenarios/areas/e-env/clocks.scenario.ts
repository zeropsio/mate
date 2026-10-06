import { describe, it, expect } from "@effect/vitest";
import { afterAll } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixtureWith } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

const setupFailures: string[] = [];
afterAll(() =>
  expect(setupFailures, "Known clock failure must reach its target assertion").toEqual([]),
);

describe("E: deployment clocks", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches HQ calling a still-running stage build refused merely because its follow clock expired.
    it.effect(
      "HQ does not declare refused from a clock",
      () => {
        let reachedTarget = false;
        return Effect.gen(function* () {
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
          reachedTarget = true;
          yield* a.when.finish("stage");
          yield* a.then.text("Deployed").pipe(Effect.ensuring(retained));
        }).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isFailure(exit) && !reachedTarget) setupFailures.push(String(exit.cause));
            }),
          ),
        );
      },
      75_000,
    );
  });
});
