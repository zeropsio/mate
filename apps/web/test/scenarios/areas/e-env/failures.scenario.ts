import { describe, it, expect } from "@effect/vitest";
import { afterEach } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixture } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

const setupFailures: string[] = [];
afterEach(() =>
  expect(setupFailures.splice(0), "Known failure must reach its target assertion").toEqual([]),
);

describe("E: known release failures", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a failed release reverting to Approved as soon as a newer release starts building.
    it.effect.fails(
      "failed release stays failed while a colleague starts the next release",
      () => {
        let reachedTarget = false;
        return Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          yield* f.merge();
          yield* a.when.finish("stage");
          yield* f.release("v0.1.0");
          yield* a.when.finish("production", "FAILED");
          yield* f.s.given.signedIn;
          yield* a.when.open("production");
          yield* a.then.rowShows("v0.1.0", "Deploy failed");
          yield* f.merge("Correct the storefront build");
          yield* a.when.finish("stage");
          yield* f.release("v0.1.1");
          yield* a.then.rowShows("v0.1.1", "Approved");
          yield* a.then.running("production");
          reachedTarget = true;
          yield* a.then.rowShows("v0.1.0", "Deploy failed");
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
