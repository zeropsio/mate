import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { creation, receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";

describe("an adopted Mate birth", () => {
  scenarioSuite((it) => {
    it.effect("continuing an adopted project registers its Mate before importing", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Existing");
        const id = "0c343b5b-a5bf-46e4-87db-5d4e64b16371";
        const born = yield* s.drivers.core.call("POST", "/api/births", {
          session: s.owner,
          body: {
            id,
            appId: s.appIds.get("Shop"),
            projectId: "Existing",
            face: "",
            intent: {
              projectName: "Existing",
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
        const claimed = yield* s.drivers.core.call("PUT", `/api/births/${id}/attempt`, {
          session: s.owner,
          body: { step: "import" },
        });
        expect(claimed.status).toBe(200);
        const refused = yield* s.drivers.core.call("PUT", `/api/births/${id}/attempt`, {
          session: s.owner,
          body: {
            step: "import",
            outcome: "refused",
            reason: "Import refused by Zerops.",
            at: (claimed.body as { at: string }).at,
          },
        });
        expect(refused.status).toBe(200);
        yield* s.given.signedIn;
        yield* Effect.promise(() => s.page.goto(`${s.web.origin}/mate/Existing`));
        const c = creation(s);
        yield* c.text("Import refused by Zerops.");
        const registration = s.page.waitForResponse((response) => {
          const path = new URL(response.url()).pathname;
          return (
            response.request().method() === "POST" &&
            (path === "/api/mates" || /^\/api\/apps\/[^/]+\/projects$/u.test(path))
          );
        });
        const imported = s.page
          .waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/rest/public/project/Existing/service-stack/import",
          )
          .catch(() => undefined);
        yield* c.click("Continue");
        const registered = yield* Effect.promise(() =>
          receipt(registration, "adopted Mate registered"),
        );
        expect(new URL(registered.url()).pathname).toBe("/api/mates");
        expect(registered.status()).toBe(201);
        expect(
          (yield* Effect.promise(() => receipt(imported, "adopted Mate import")))?.status(),
        ).toBe(200);
        const structure = (yield* s.drivers.core.call("GET", "/api/structure", {
          session: s.owner,
        })).body as {
          apps: {
            projects: {
              projectId: string;
              kind: string;
              mate: { birthId: string; face: string } | null;
            }[];
          }[];
        };
        expect(
          structure.apps
            .flatMap((app) => app.projects)
            .find((project) => project.projectId === "Existing"),
        ).toMatchObject({ kind: "mate", mate: { birthId: id, face: "" } });
        expect(
          s.drivers.zerops.world.imports.filter((entry) => entry.projectId === "Existing"),
        ).toHaveLength(1);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
