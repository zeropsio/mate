import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { creation, receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";

describe("continuing a shared Chief birth", () => {
  scenarioSuite((it) => {
    it.effect(
      "a Chief continued on another device registers before its one import",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          const c = creation(s);
          c.holdProjectCreation();
          const bound = s.page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              /^\/api\/births\/[^/]+\/project$/u.test(new URL(response.url()).pathname),
          );
          yield* Effect.promise(async () => {
            await s.page.goto(`${s.web.origin}/chief`);
            await receipt(s.page.locator("::-p-aria(Set up Chief)").click(), "set up Chief");
            expect((await receipt(bound, "HQ bound the Chief project")).status()).toBe(200);
            await s.page.close();
          });
          yield* c.completeProjectCreation;

          const second = yield* s.given.browserActor();
          yield* second.given.signedIn;
          yield* Effect.promise(async () => {
            await second.page.goto(`${s.web.origin}/chief`);
            const order: string[] = [];
            second.page.on("request", (request) => {
              const path = new URL(request.url()).pathname;
              if (request.method() === "PUT" && /^\/api\/births\/[^/]+\/chief$/u.test(path))
                order.push("register");
              if (
                request.method() === "POST" &&
                path === "/api/rest/public/project/created-1/service-stack/import"
              )
                order.push("import");
            });
            const registered = second.page
              .waitForResponse(
                (response) =>
                  response.request().method() === "PUT" &&
                  /^\/api\/births\/[^/]+\/chief$/u.test(new URL(response.url()).pathname),
              )
              .catch(() => undefined);
            const imported = second.page.waitForResponse(
              (response) =>
                response.request().method() === "POST" &&
                new URL(response.url()).pathname ===
                  "/api/rest/public/project/created-1/service-stack/import",
            );
            await receipt(second.page.locator("::-p-aria(Continue)").click(), "continue Chief");
            expect((await receipt(imported, "Chief import")).status()).toBe(200);
            expect(order).toEqual(["register", "import"]);
            expect((await receipt(registered, "Chief registration"))?.status()).toBe(200);
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
