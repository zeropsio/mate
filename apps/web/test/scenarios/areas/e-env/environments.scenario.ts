import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HqStreamMessage } from "@t3tools/shared/hqStream";
import { installArea as installChangeTransport, hqFramesFor } from "../d-change/fake.ts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixture, environmentFixtureWith } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

const decodeHqFrame = Schema.decodeSync(Schema.fromJsonString(HqStreamMessage));

describe("E: stage, production, release and rollback", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Production is releasable from navigation even if stage is absent, still building or failed.
    it.effect.each(["absent", "building", "failed"] as const)(
      "navigation reaches a production release while stage is %s",
      (stage) =>
        Effect.gen(function* () {
          const f = yield* environmentFixtureWith({}, { stage: stage !== "absent" });
          const a = environmentActions(f);
          const sha = yield* f.merge();
          if (stage === "failed") yield* a.when.finish("stage", "FAILED");
          yield* f.s.given.signedIn;
          yield* a.when.reviewFromFoldedChip;
          yield* a.then.releaseEntriesShow(sha);
          yield* a.when.click("Release v0.1.0");
          yield* a.when.finish("production");
          yield* a.then.text("Released");
          yield* a.when.click("Close");
          yield* a.when.open("production");
          yield* a.then.rowShows("v0.1.0", "Live");
          if (stage === "building") yield* a.then.running("stage");
          yield* f.s.then.noExternalNetwork;
        }),
    );

    // Closing the review and reloading must keep the accepted rollout, without a second build.
    it.effect("closing and reloading a release review keeps its pending rollout", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixtureWith({}, { stage: false });
        const a = environmentActions(f);
        yield* f.merge();
        yield* f.s.given.signedIn;
        yield* a.when.openFromNavigation;
        yield* a.when.releaseFromReview;
        yield* a.then.running("production");
        yield* a.when.click("Close");
        yield* a.when.reload;
        yield* a.then.rowShows("v0.1.0", "Approved");
        yield* a.then.running("production");
        expect(yield* a.then.productionBuildCount).toBe(1);
        yield* a.when.finish("production");
        yield* a.then.rowShows("v0.1.0", "Live");
        expect(yield* a.then.productionBuildCount).toBe(1);
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // Only a missing declared service can be added; the same press imports then deploys it.
    it.effect("Add service restores the declared missing service and deploys its main commit", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const a = environmentActions(f);
        const sha = yield* f.merge();
        yield* a.when.finish("stage");
        f.removeService("stage");
        yield* f.s.given.signedIn;
        yield* a.when.open("stage");
        yield* a.when.click("Add web");
        yield* a.when.finishImport("stage");
        yield* a.then.text(`Building ${sha.slice(0, 7)}`);
        yield* a.when.finish("stage");
        yield* a.then.text("Deployed");
        yield* a.then.text(sha.slice(0, 7));
        yield* f.s.then.noExternalNetwork;
      }),
    );

    // A colleague's accepted release must replace this review's unsent offer without another tag.
    it.effect("a colleague's release displaces an open local release offer", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixtureWith({}, { stage: false });
        const a = environmentActions(f);
        yield* f.merge();
        yield* f.s.given.signedIn;
        yield* a.when.openFromNavigation;
        yield* a.when.click("Review release");
        yield* a.then.text("Release v0.1.0");
        yield* f.release("v0.1.0");
        yield* a.then.text("Releasing v0.1.0");
        yield* a.then.running("production");
        expect(yield* a.then.productionBuildCount).toBe(1);
        yield* a.when.finish("production");
        yield* a.then.text("Released");
        yield* a.when.click("Close");
        yield* a.then.rowShows("v0.1.0", "Live");
        expect(yield* a.then.productionBuildCount).toBe(1);
        yield* f.s.then.noExternalNetwork;
      }),
    );

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

    it.effect(
      "rollback waits for the comparison before confirmation can be pressed",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          yield* Effect.promise(async () => installChangeTransport(f.s.drivers));
          yield* Effect.promise(() => f.s.web.setRoutes());
          const frames = hqFramesFor(f.s.drivers);
          const earlier = yield* f.merge();
          yield* a.when.finish("stage");
          yield* f.release("v0.1.0");
          yield* a.when.finish("production");
          yield* f.merge("Improve the storefront");
          yield* a.when.finish("stage");
          yield* f.release("v0.1.1");
          yield* a.when.finish("production");
          yield* f.s.given.signedIn;
          yield* a.when.open("production");
          yield* a.then.rowShows("v0.1.1", "Live");
          frames.hold((frame) => decodeHqFrame(frame).type === "compare");
          const submissions: string[] = [];
          f.s.page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname.endsWith("/rollback")
            )
              submissions.push(request.url());
          });
          yield* a.when.rollBack("v0.1.0");
          yield* Effect.promise(() => frames.received());
          yield* a.then.text("Comparing in HQ…");
          const confirmation = yield* Effect.promise(() =>
            f.s.page.locator('::-p-aria(Roll back to v0.1.0[role="button"])').waitHandle(),
          );
          expect(
            yield* Effect.promise(() =>
              confirmation.evaluate((button) => (button as HTMLButtonElement).disabled),
            ),
          ).toBe(true);
          expect(submissions).toHaveLength(0);
          frames.resume();
          yield* a.when.click("Roll back to v0.1.0");
          const process = yield* a.deployment("production");
          expect(submissions).toHaveLength(1);
          const jobs = yield* f.s.drivers.core.sql`
          SELECT label, sha, process_id FROM hq_deploy_job
          WHERE project_id = ${"Shop-production"} AND label = ${"v0.1.2"}`;
          expect(jobs).toEqual([
            expect.objectContaining({ label: "v0.1.2", sha: earlier, process_id: process.id }),
          ]);
          yield* a.when.finish("production");
          yield* a.then.text("Rolled back to v0.1.0");
          yield* a.when.click("Close");
          yield* a.then.rowShows("v0.1.2", "Live");
          yield* a.then.rowShows("v0.1.2", earlier.slice(0, 7));
          yield* f.s.then.noExternalNetwork;
        }),
      90_000,
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
