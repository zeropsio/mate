import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { completedHttp } from "../../harness/completedHttp.ts";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";

describe("continuing a shared Mate birth", () => {
  scenarioSuite((it) => {
    it.effect(
      "a birth closed after import acceptance continues without a second import",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.project("created-1");
          yield* s.given.signedIn;
          const id = "2a8e855c-22a4-4a84-a6bc-966531b2c4c6";
          const born = yield* s.drivers.core.call("POST", "/api/births", {
            session: s.owner,
            body: {
              id,
              appId: s.appIds.get("Shop"),
              face: "rose:seal",
              intent: {
                projectName: "Garden - Nova",
                recipe: { kind: "none" },
                agents: ["codex"],
                standUp: false,
                automated: false,
                placement: { role: "dev", name: "Nova", chief: false },
                location: null,
                userRoles: [],
              },
            },
          });
          expect(born.status).toBe(201);
          const bound = yield* s.drivers.core.call("PUT", `/api/births/${id}/project`, {
            session: s.owner,
            body: { projectId: "created-1" },
          });
          expect(bound.status).toBe(200);
          const claimed = yield* s.drivers.core.call("PUT", `/api/births/${id}/attempt`, {
            session: s.owner,
            body: { step: "import" },
          });
          expect(claimed.status).toBe(200);
          // The platform accepted the import but the original tab stopped before recording its answer.
          const imported = yield* HttpClient.execute(
            HttpClientRequest.post(
              `${s.drivers.routes["https://api.app-prg1.zerops.io"]}/api/rest/public/project/created-1/service-stack/import`,
            ).pipe(
              HttpClientRequest.setHeader("authorization", "Bearer personal"),
              HttpClientRequest.bodyJsonUnsafe({
                yaml: "services:\n  - hostname: zcp\n    type: zcp@1\n",
              }),
            ),
          ).pipe(Effect.provide(FetchHttpClient.layer));
          expect(imported.status).toBe(200);
          expect(
            s.drivers.zerops.world.imports.filter((entry) => entry.projectId === "created-1"),
          ).toHaveLength(1);
          yield* Effect.promise(async () => {
            await s.page.goto(`${s.web.origin}/mate/created-1`);
            await receipt(
              s.page.locator("::-p-aria(Continue)").wait(),
              "accepted import awaiting its receipt",
            );
            await s.page.close();
          });

          const second = yield* s.given.browserActor();
          yield* second.given.signedIn;
          yield* Effect.promise(async () => {
            await second.page.goto(`${s.web.origin}/mate/created-1`);
            const recorded = second.page.waitForResponse(
              (response) =>
                response.request().method() === "PUT" &&
                new URL(response.url()).pathname === "/api/presses/created-1" &&
                (response.request().postData()?.includes('"importProcessId"') ?? false),
            );
            const settled = completedHttp(second.page);
            try {
              await receipt(
                second.page.locator("::-p-aria(Continue)").click(),
                "Continue after import acceptance",
              );
              expect((await receipt(recorded, "HQ recorded the recovered import")).status()).toBe(
                200,
              );
              await receipt(settled(), "Continue after accepted import settled");
            } finally {
              settled.close();
            }
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
