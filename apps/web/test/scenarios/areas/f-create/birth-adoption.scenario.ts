import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { creation, receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";

describe("an adopted Mate birth", () => {
  scenarioSuite((it) => {
    it.effect("an interrupted existing-project adoption follows the decided deletion policy", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Existing");
        s.drivers.zerops.put("service-stack", {
          id: "existing-web",
          projectId: "Existing",
          clientId: "ORG",
          name: "web",
          status: "ACTIVE",
          serviceStackTypeInfo: {
            serviceStackTypeName: "nodejs",
            serviceStackTypeVersionName: "nodejs@22",
            serviceStackTypeCategory: "USER",
          },
        });
        const id = "9b4d065c-191d-413e-92ce-2bcdd08e0ee8";
        const born = yield* s.drivers.core.call("POST", "/api/births", {
          session: s.owner,
          body: {
            id,
            appId: s.appIds.get("Shop"),
            projectId: "Existing",
            face: "rose:seal",
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
        yield* c.text("Delete stops setting up the Mate and leaves the project untouched.");
        yield* c.text("Continue");
        yield* c.click("Delete");
        yield* c.text(
          "This stops setting up the Mate and leaves the existing project and its services untouched.",
        );
        yield* c.fill("Type Nova to confirm", "Nova");
        const deleted = s.page.waitForResponse(
          (response) =>
            response.request().method() === "DELETE" &&
            new URL(response.url()).pathname === `/api/births/${id}`,
        );
        yield* c.click("Delete Nova");
        expect(
          (yield* Effect.promise(() => receipt(deleted, "adopted birth deleted"))).status(),
        ).toBe(204);
        expect(s.drivers.zerops.rows("project").some((row) => row.id === "Existing")).toBe(true);
        expect(
          s.drivers.zerops.rows("service-stack").some((row) => row.id === "existing-web"),
        ).toBe(true);
        expect(s.drivers.zerops.requests.get("DELETE /project/Existing") ?? 0).toBe(0);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
