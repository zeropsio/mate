import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { creation, receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";
import { environmentRecipe } from "./recipe.ts";

describe("a stage born with its own Mate", () => {
  scenarioSuite((it) => {
    it.effect(
      "a stage with its own Mate shares its birth and imports the tier once",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* environmentRecipe(s, "stage");
          yield* s.given.signedIn;
          const c = creation(s);
          yield* c.openAdd("stage");
          yield* c.chooseDestination("zerops");
          yield* c.fill("Environment", "Shop-b");
          yield* c.withAgent;
          const imported = s.page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/rest/public/project/created-1/service-stack/import",
          );
          yield* c.click("Add stage to Shop");
          expect(
            (yield* Effect.promise(() => receipt(imported, "stage tier import accepted"))).status(),
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
              "second device showed the stage Mate's progress",
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
