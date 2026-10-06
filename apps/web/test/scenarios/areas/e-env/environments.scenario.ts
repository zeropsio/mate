import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixture } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

describe("E: stage, production, release and rollback", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a merged storefront change whose stage deployment is never shown to the user.
    it.effect("merge starts a visible stage deployment", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const { s, merge } = f;
        const a = environmentActions(f);
        const sha = yield* merge();
        yield* s.given.signedIn;
        yield* a.when.open("stage");
        yield* a.then.text(`Building ${sha.slice(0, 7)}`);
        yield* a.then.running("stage");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a stage deployment that keeps building after Zerops reports success.
    it.effect("stage deployment ends with the deployed commit", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const a = environmentActions(f);
        const sha = yield* f.merge();
        yield* f.s.given.signedIn;
        yield* a.when.open("stage");
        yield* a.then.text(`Building ${sha.slice(0, 7)}`);
        yield* a.when.finish("stage");
        yield* a.then.text("Deployed");
        yield* a.then.text(sha.slice(0, 7));
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // Catches losing a stage deployment's result when the user reloads its page.
    it.effect("stage deployment result survives reload", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const a = environmentActions(f);
        const sha = yield* f.merge();
        yield* a.when.finish("stage");
        yield* f.s.given.signedIn;
        yield* a.when.open("stage");
        yield* a.then.text("Deployed");
        yield* a.when.reload;
        yield* a.then.text("Deployed");
        yield* a.then.text(sha.slice(0, 7));
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // Catches a stage someone rolled back in Zerops, without a build, still naming the newer commit:
    // its push names the restored version only by id.
    it.effect(
      "a rollback without a build shows the restored version's commit on the stage",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          const earlier = yield* f.merge();
          yield* a.when.finish("stage");
          const later = yield* f.merge("Improve the storefront");
          yield* a.when.finish("stage");
          yield* f.s.given.signedIn;
          yield* a.when.open("stage");
          yield* a.then.text(`web\n${later.slice(0, 7)}`);
          yield* a.when.rollBackOnZerops("stage");
          yield* a.then.text(`web\n${earlier.slice(0, 7)}`);
          yield* f.s.then.noExternalNetwork;
        }),
      90_000,
    );

    // Catches a failed stage build being presented as successful with no way to retry.
    it.effect("failed stage build says why and offers Run again", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const a = environmentActions(f);
        yield* f.merge();
        yield* a.when.finish("stage", "FAILED");
        yield* f.s.given.signedIn;
        yield* a.when.open("stage");
        yield* a.then.text("Storefront build failed");
        yield* a.then.text("Run again");
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // Catches Review release failing to send the chosen version to production.
    it.effect("release review deploys its version to production", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const a = environmentActions(f);
        yield* f.merge();
        yield* a.when.finish("stage");
        yield* f.s.given.signedIn;
        yield* a.when.open("production");
        yield* a.when.releaseFromReview;
        yield* a.when.finish("production");
        yield* a.then.text("Released");
        yield* a.when.click("Close");
        yield* a.then.rowShows("v0.1.0", "Live");
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // Catches a release started by a colleague remaining invisible until reload.
    it.effect("colleague release appears while production is still building", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const a = environmentActions(f);
        yield* f.merge();
        yield* a.when.finish("stage");
        yield* f.s.given.signedIn;
        yield* a.when.open("production");
        yield* a.then.text("Review release");
        const sameDocument = yield* a.then.keepsDocument;
        yield* f.release("v0.1.0");
        yield* a.then.rowShows("v0.1.0", "Approved");
        yield* a.then.running("production");
        yield* sameDocument;
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // Catches production forgetting which release is live after a page reload.
    it.effect("production release result survives reload", () =>
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
        yield* a.when.reload;
        yield* a.then.rowShows("v0.1.0", "Live");
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // Catches an invalid release version leaving the production action enabled.
    it.effect("invalid version prevents releasing production", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const a = environmentActions(f);
        yield* f.merge();
        yield* a.when.finish("stage");
        yield* f.s.given.signedIn;
        yield* a.when.open("production");
        yield* a.when.click("Review release");
        yield* a.when.editVersion("not-a-version");
        yield* a.then.text("Use major.minor.patch, for example 1.0.0.");
        yield* a.then.releaseDisabled;
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // Catches Roll back losing the earlier release's commit or failing to make a new live version.
    it.effect(
      "rollback deploys the earlier commit as a new release",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          const earlier = yield* f.merge();
          yield* a.when.finish("stage");
          yield* f.release("v0.1.0");
          yield* a.when.finish("production");
          yield* f.s.given.signedIn;
          yield* a.when.open("production");
          yield* a.then.rowShows("v0.1.0", "Live");
          yield* f.merge("Improve the storefront");
          yield* a.when.finish("stage");
          yield* f.release("v0.1.1");
          yield* a.when.finish("production");
          yield* a.then.rowShows("v0.1.1", "Live");
          yield* a.when.rollBack("v0.1.0");
          yield* a.when.click("Roll back to v0.1.0");
          yield* a.when.finish("production");
          yield* a.then.text("Rolled back to v0.1.0");
          yield* a.when.click("Close");
          yield* a.then.rowShows("v0.1.2", "Live");
          yield* a.then.rowShows("v0.1.2", earlier.slice(0, 7));
          yield* f.s.then.noExternalNetwork;
        }),
      90_000,
    );
  });
});
