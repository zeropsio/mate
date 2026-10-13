import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installCreation } from "./fake.ts";
import { creation } from "./dsl.ts";
import { environmentRecipe } from "./recipe.ts";

describe("F: creation through the hosted client", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const [role, tag] of [
      ["stage", "stage"],
      ["production", "prod"],
    ] as const) {
      // Catches adding an environment under the wrong name or losing the requested role in the project's view.
      it.effect(`add ${role} with an agent to an existing project`, () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          const c = creation(s);
          yield* c.openAdd(role);
          yield* c.fill("Environment", "Shop-b");
          yield* c.withAgent;
          yield* c.click(`Add ${role} to Shop`);
          yield* c.environmentAppears("Shop-b", tag);
          yield* c.acceptedOnce("Shop-b");
          yield* s.then.noExternalNetwork;
        }),
      );
    }

    for (const role of ["stage", "production"] as const) {
      // Catches a valid deployment recipe being refused or silently installing an agent by default.
      it.effect(`add ${role} from its recipe with the agent off by default`, () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* environmentRecipe(s, role);
          yield* s.given.signedIn;
          const c = creation(s);
          yield* c.openAdd(role);
          yield* c.fill("Environment", "Shop-b");
          yield* c.agentIsOff;
          yield* c.text(`The project's ${role} recipe`);
          yield* c.click(`Add ${role} to Shop`);
          yield* c.environmentAppears("Shop-b", role === "production" ? "prod" : "stage");
          yield* c.text("Shop-b is set up");
          yield* c.acceptedOnce("Shop-b");
          yield* c.noAgentImported;
          yield* s.then.noExternalNetwork;
        }),
      );
    }

    // Catches cleanup targeting a sibling or forgetting a failed birth before its deletion is proved.
    it.effect("Remove cleans up only the failed creation's project", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const c = creation(s);
        c.failProject();
        yield* c.newProject;
        yield* c.submitProject;
        yield* c.text("Details");
        expect(
          yield* Effect.promise(() => s.page.evaluate(() => document.body.innerText)),
        ).not.toContain("Project capacity exhausted");
        yield* c.click("Details");
        yield* c.text("Project capacity exhausted");
        yield* c.click("Remove");
        yield* s.then.menu.row("Ada").appears();
        yield* c.settled;
        yield* c.failedProjectRemoved;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
