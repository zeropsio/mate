import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { creation, receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";

describe("continuing a shared Mate birth", () => {
  scenarioSuite((it) => {
    it.effect(
      "a birth closed before the import continues with exactly one import",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          const c = creation(s);
          c.holdProjectCreation();
          yield* c.newProject;
          const bound = s.page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              /^\/api\/births\/[^/]+\/project$/u.test(new URL(response.url()).pathname),
          );
          yield* c.submitProject;
          expect(
            (yield* Effect.promise(() =>
              receipt(bound, "HQ bound the project before import"),
            )).status(),
          ).toBe(200);
          expect(
            s.drivers.zerops.world.imports.filter((entry) => entry.projectId === "created-1"),
          ).toHaveLength(0);
          yield* Effect.promise(() => s.page.close());
          yield* c.completeProjectCreation;

          const second = yield* s.given.browserActor();
          yield* second.given.signedIn;
          yield* Effect.promise(async () => {
            await second.page.goto(`${s.web.origin}/mate/created-1`);
            const imported = second.page.waitForResponse(
              (response) =>
                response.request().method() === "POST" &&
                new URL(response.url()).pathname ===
                  "/api/rest/public/project/created-1/service-stack/import",
            );
            await receipt(
              second.page.locator("::-p-aria(Continue)").click(),
              "Continue before import",
            );
            expect((await receipt(imported, "continued import accepted")).status()).toBe(200);
            expect(
              s.drivers.zerops.world.imports.filter((entry) => entry.projectId === "created-1"),
            ).toHaveLength(1);
            await receipt(
              second.page.waitForFunction(
                () =>
                  document
                    .querySelector('[data-zerops-surface="mate-empty-state"]')
                    ?.textContent?.includes("Container starting"),
                { polling: "raf" },
              ),
              "continued birth showed container-starting progress",
            );
          });
          expect(
            s.drivers.zerops.world.imports.filter((entry) => entry.projectId === "created-1"),
          ).toHaveLength(1);
          yield* s.then.noExternalNetwork;
        }),
      60_000,
    );
  });
});
