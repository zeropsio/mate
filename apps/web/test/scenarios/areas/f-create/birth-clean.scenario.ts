import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { creation, receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";

describe("a shared Mate birth", () => {
  scenarioSuite((it) => {
    it.effect(
      "a clean Mate is imported once and its shared birth shows its progress",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          const c = creation(s);
          yield* c.newProject;
          const bound = s.page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              /^\/api\/births\/[^/]+\/project$/u.test(new URL(response.url()).pathname),
          );
          const imported = s.page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/rest/public/project/created-1/service-stack/import",
          );
          yield* c.submitProject;
          expect(
            (yield* Effect.promise(() => receipt(bound, "HQ bound the clean birth"))).status(),
          ).toBe(200);
          expect(
            (yield* Effect.promise(() =>
              receipt(imported, "Zerops accepted the clean import"),
            )).status(),
          ).toBe(200);
          const imports = s.drivers.zerops.world.imports.filter(
            (entry) => entry.projectId === "created-1",
          );
          expect(imports).toHaveLength(1);
          expect(imports[0]!.yaml.includes("zcp@")).toBe(true);
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
              "second device showed container-starting progress",
            );
          });
          yield* s.then.noExternalNetwork;
        }),
      60_000,
    );
  });
});
