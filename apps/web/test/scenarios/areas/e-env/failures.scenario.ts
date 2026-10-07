import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixture } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

describe("E: release failure history", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // A proved failed rollout cannot turn the last serving release into failure or success for the new one.
    it.effect(
      "a release that fails to land keeps the last proved production version live",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          yield* f.merge();
          yield* a.when.finish("stage");
          yield* f.release("v0.1.0");
          yield* a.when.finish("production");
          yield* f.s.given.signedIn;
          yield* a.when.open("production");
          yield* a.then.rowShows("v0.1.0", "Live");
          yield* f.merge("Correct the storefront build");
          yield* a.when.finish("stage");
          yield* f.release("v0.1.1");
          yield* a.when.finish("production", "FAILED");
          yield* a.then.rowShows("v0.1.1", "Deploy failed");
          yield* a.then.rowShows("v0.1.0", "Live");
        }),
      75_000,
    );
    // A newer release must not erase the failed deployment of an earlier release.
    it.effect(
      "failed release stays failed while a colleague starts the next release",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          yield* f.merge();
          yield* a.when.finish("stage");
          yield* f.release("v0.1.0");
          yield* a.when.finish("production", "FAILED");
          yield* f.s.given.signedIn;
          yield* a.when.open("production");
          yield* a.then.rowShows("v0.1.0", "Deploy failed");
          const keptFailure = yield* a.then.keepsWord("v0.1.0", "Deploy failed");
          yield* f.merge("Correct the storefront build");
          yield* a.when.finish("stage");
          yield* f.release("v0.1.1");
          yield* a.then.rowShows("v0.1.1", "Approved");
          yield* a.then.running("production");
          yield* a.then
            .rowShows("v0.1.0", "Deploy failed", { within: 15_000 })
            .pipe(Effect.ensuring(keptFailure));
        }),
      75_000,
    );
  });
});
