import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixture } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

describe("E: deploy observation and the person's next action", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a pending build names the next action and Run again starts an explicit new operation",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          const zerops = f.s.drivers.zerops;
          let unanswered = true;
          zerops.handlers.unshift(async (request) =>
            unanswered &&
            request.method === "PUT" &&
            /\/app-version\/[^/]+\/build-and-deploy$/u.test(request.url.pathname)
              ? { status: 503, body: { message: "Submission did not answer" } }
              : undefined,
          );
          yield* f.s.given.signedIn;
          yield* a.when.open("stage");
          const sha = yield* f.merge();
          yield* a.then.text("Waiting for Zerops to start the build.");
          yield* a.then.text(
            "A person acts next: Inspect the original version in Zerops; use Run again if no build started",
          );
          unanswered = false;
          yield* Effect.promise(() =>
            f.s.page.locator('[data-zerops-surface="stop-service-job"] button').click(),
          );
          yield* a.then.text(`Building ${sha.slice(0, 7)}`);
          yield* a.when.finish("stage");
          yield* a.then.text("Deployed");
        }),
    );

    it.effect("an unresolved deploy stays on the service row without a deploy answer panel", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixture;
        const a = environmentActions(f);
        const zerops = f.s.drivers.zerops;
        yield* f.s.given.signedIn;
        yield* a.when.open("stage");
        const sha = yield* f.merge();
        yield* a.then.text(`Building ${sha.slice(0, 7)}`);
        zerops.handlers.unshift(async (request) =>
          request.headers.authorization === "Bearer hq" &&
          request.url.pathname.endsWith("/process/search")
            ? { status: 403, body: { message: "Observation no longer authorized" } }
            : undefined,
        );
        const follow = [...zerops.subscriptions.values()].find(
          (r) => r.apiToken === "hq" && r.kind === "app-version",
        );
        expect(follow).toBeDefined();
        zerops.sockets.get(follow!.receiver)!.close();
        yield* a.then.text("HQ could not follow this deploy to its end.");
        yield* a.then.text(
          "A person acts next: Inspect the original handles in Zerops; Run again is a new explicit operation",
        );
        yield* Effect.promise(async () => {
          const row = await f.s.page.$(
            '[data-zerops-surface="stop-service-job"][data-zerops-job-state="unresolved"]',
          );
          expect(row).not.toBeNull();
          expect(await row!.evaluate((element) => element.textContent)).toContain("Run again");
        });
      }),
    );
  });
});
