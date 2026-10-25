import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HqStreamMessage } from "@t3tools/shared/hqStream";
import { installArea as installChangeTransport, hqFramesFor } from "../d-change/fake.ts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixture, environmentFixtureWith } from "./fake.ts";
import { addGitEnvironment, environmentActions, environmentJobs, gitEnvironments } from "./dsl.ts";

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
          const environmentId = yield* addGitEnvironment(f, { tier: "stage", name: "git-witness" });
          yield* Effect.promise(() =>
            f.s.page.goto(`${f.s.web.origin}/group/${f.appId}/${environmentId}`),
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
          );
          yield* a.when.click("Confirm removal");
          const removedResponse = yield* Effect.promise(() => removed);
          expect(removedResponse.status()).toBe(200);
          const receipt = (yield* Effect.promise(() => removedResponse.json())) as {
            readonly executor: string;
            readonly requestId: string;
            readonly acceptance: { readonly kind: string };
          };
          expect(receipt.executor).toBe("hq");
          expect(receipt.requestId).not.toBe("");
          expect(receipt.acceptance.kind).toBe("accepted");
          yield* gitEnvironments(f, (environments) =>
            environments.every((environment) => environment.id !== environmentId),
          );
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
          // The rollback is release v0.1.2 of the earlier commit, and its build is that release's job.
          const releases = (yield* f.s.drivers.core.call("GET", `/api/apps/${f.appId}/releases`, {
            session: f.s.owner,
          })).body as {
            releases: { tag: string; rollbackOf: string | null; entries: { sha: string }[] }[];
          };
          expect(releases.releases.filter((release) => release.tag === "v0.1.2")).toEqual([
            expect.objectContaining({
              rollbackOf: "v0.1.0",
              entries: [expect.objectContaining({ sha: earlier })],
            }),
          ]);
          const jobs = yield* environmentJobs(f, "production", (jobs) =>
            jobs.some((job) => job.processId === process.id),
          );
          expect(jobs.filter((job) => job.processId === process.id)).toEqual([
            expect.objectContaining({ cause: "release", sha: earlier, processId: process.id }),
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
