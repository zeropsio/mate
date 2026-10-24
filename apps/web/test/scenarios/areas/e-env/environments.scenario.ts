import { inProcessCore } from "../../harness/hqCore.ts";
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
    it.effect(
      "A Git environment arriving after first paint renders without a project and its mounted removal returns an HQ receipt",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          yield* f.s.given.signedIn;
          yield* Effect.promise(() => f.s.page.setViewport({ width: 1786, height: 1000 }));
          yield* inProcessCore(f.s.drivers.core)
            .sql`INSERT INTO hq_environment(id,target,app_id,tier,name,sources,branch,delivery,created_by) VALUES ('git-admit','git',${f.appId}::uuid,'stage','git-witness','{main}','staging','direct','owner')`;
          yield* f.s.drivers.core.call("PATCH", `/api/apps/${f.appId}`, {
            session: f.s.owner,
            body: { name: "Shop" },
          });
          yield* Effect.promise(() =>
            f.s.page.goto(`${f.s.web.origin}/group/${f.appId}/git-admit`),
          );
          yield* a.then.text(
            "Nothing pushed yet · pushes on the next merge",
            '[data-zerops-surface="git-stop-detail"]',
          );
          expect(
            yield* Effect.promise(() =>
              f.s.page.$eval(
                '[data-zerops-surface="git-delivery-status"] p',
                (element) => element.textContent,
              ),
            ),
          ).toBe("Nothing pushed yet · pushes on the next merge");
          yield* a.when.click("Remove environment");
          yield* a.then.text("Removing this environment never deletes an external");
          const removed = f.s.page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              /\/api\/git-targets\/[^/]+$/.test(new URL(response.url()).pathname) &&
              response.status() === 200,
            { timeout: 15_000 },
          );
          yield* a.when.click("Confirm removal");
          expect((yield* Effect.promise(() => removed)).status()).toBe(200);
          const accepted = yield* inProcessCore(f.s.drivers.core).sql<{
            readonly receipt: {
              readonly executor: string;
              readonly requestId: string;
              readonly acceptance: { readonly kind: string };
            };
          }>`SELECT receipt FROM hq_git_target_receipt WHERE intent->>'kind'='remove-git-environment' AND app_id=${f.appId}::uuid`;
          expect(accepted).toHaveLength(1);
          expect(accepted[0]!.receipt.executor).toBe("hq");
          expect(accepted[0]!.receipt.requestId).not.toBe("");
          expect(accepted[0]!.receipt.acceptance.kind).toBe("accepted");
          expect(
            yield* inProcessCore(f.s.drivers.core)
              .sql`SELECT 1 FROM hq_environment WHERE id='git-admit'`,
          ).toHaveLength(0);
          yield* f.s.then.noExternalNetwork;
        }),
    );
    // Production is releasable from navigation even if stage is absent, still building or failed.
    it.effect.each(["absent", "building", "failed"] as const)(
      "navigation reaches a production release while stage is %s",
      (stage) =>
        Effect.gen(function* () {
          const f = yield* environmentFixtureWith({}, { stage: stage !== "absent" });
          const a = environmentActions(f);
          yield* f.merge("Ship the storefront");
          if (stage === "failed") yield* a.when.finish("stage", "FAILED");
          yield* f.s.given.signedIn;
          yield* a.when.reviewFromReleaseTag;
          yield* a.then.releaseEntriesShow("Ship the storefront");
          yield* a.when.click("Release v0.1.0 to production");
          yield* a.when.finish("production");
          yield* a.then.text("v0.1.0 is live");
          yield* a.when.click("Close");
          yield* a.when.open("production");
          yield* a.then.rowShows("v0.1.0", "Live");
          if (stage === "building") {
            yield* a.when.open("stage");
            yield* a.then.text(
              "Building",
              '[data-zerops-surface="stop-service-job"][data-zerops-job-state="building"]',
            );
          }
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
        yield* a.then.text(
          `Building ${sha.slice(0, 7)}`,
          '[data-zerops-surface="stop-service-job"][data-zerops-job-state="building"]',
        );
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
        yield* a.then.text("v0.1.0 is live");
        yield* a.when.click("Close");
        yield* a.then.rowShows("v0.1.0", "Live");
        expect(yield* a.then.productionBuildCount).toBe(1);
        yield* f.s.then.noExternalNetwork;
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
        yield* a.then.text(
          `Building ${sha.slice(0, 7)}`,
          '[data-zerops-surface="stop-service-job"][data-zerops-job-state="building"]',
        );
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
        yield* a.then.text("v0.1.0 is live");
        yield* a.when.click("Close");
        yield* a.then.rowShows("v0.1.0", "Live");
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
          const jobs = yield* inProcessCore(f.s.drivers.core).sql`
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
