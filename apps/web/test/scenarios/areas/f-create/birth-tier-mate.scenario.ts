import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { creation, receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";
import { environmentRecipe } from "./recipe.ts";

describe("a Mate born with a tier", () => {
  scenarioSuite((it) => {
    it.effect(
      "the one import carries the tier",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* environmentRecipe(s, "mate");
          yield* s.given.signedIn;
          const c = creation(s);
          yield* Effect.promise(async () => {
            await s.page.goto(`${s.web.origin}/zerops`);
            await receipt(
              s.page
                .locator(() =>
                  [
                    ...document.querySelectorAll<HTMLElement>(
                      '[data-zerops-surface="project-cards"] article[aria-label="Shop"] button',
                    ),
                  ].find((button) => button.textContent?.trim().startsWith("Add a Mate"))!,
                )
                .click(),
              "Shop's Add a Mate action",
            );
          });
          yield* c.fill("Name", "Nova");
          const imported = s.page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/rest/public/project/created-1/service-stack/import",
          );
          yield* c.click("Add Nova to Shop");
          expect(
            (yield* Effect.promise(() => receipt(imported, "Mate tier import accepted"))).status(),
          ).toBe(200);
          expect(
            s.drivers.zerops.world.imports.filter((entry) => entry.projectId === "created-1"),
          ).toHaveLength(1);
          const second = yield* s.given.browserActor();
          yield* second.given.signedIn;
          yield* Effect.promise(async () => {
            await second.page.goto(`${s.web.origin}/mate/created-1`);
            await receipt(
              second.page.waitForFunction(
                () =>
                  document
                    .querySelector('[data-zerops-surface="mate-empty-state"]')
                    ?.textContent?.includes("Container starting"),
                { polling: "raf" },
              ),
              "second device showed the tier Mate's progress",
            );
          });
          const imports = s.drivers.zerops.world.imports.filter(
            (entry) => entry.projectId === "created-1",
          );
          expect(imports).toHaveLength(1);
          expect(imports[0]!.yaml.includes("zcp@")).toBe(true);
          expect(imports[0]!.yaml.includes("hostname: api")).toBe(true);
          yield* s.then.noExternalNetwork;
        }),
      60_000,
    );
  });
});
