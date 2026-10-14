import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
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
          yield* environmentRecipe(s, role);
          yield* s.given.signedIn;
          const c = creation(s);
          yield* c.openAdd(role);
          yield* c.chooseDestination("zerops");
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
          yield* c.chooseDestination("zerops");
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

    it.effect(
      "An application with no code repositories asks for a repository before a branch",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          const { core, owner, appIds } = s.drivers;
          const repositories = yield* core.call("GET", `/api/apps/${appIds.get("Shop")}/repos`, {
            session: owner,
          });
          expect(repositories.status).toBe(200);
          expect(repositories.body).toEqual({
            repos: [expect.objectContaining({ name: RECIPE_REPO })],
          });
          yield* s.given.signedIn;
          const c = creation(s);
          yield* c.openAdd("production");
          yield* c.text("New production environment");
          expect(
            yield* Effect.promise(() =>
              s.page.$$eval(
                '[role="dialog"] input:not([type="radio"]):not([type="hidden"])',
                (nodes) => nodes.length,
              ),
            ),
            "ASSERTION: choosing the destination asks for no repository or branch fields",
          ).toBe(0);
          yield* c.chooseDestination("git");
          const labels = yield* Effect.promise(() =>
            s.page.$$eval('[data-zerops-surface="git-environment-form"] label', (nodes) =>
              nodes.map((node) => node.textContent?.trim()),
            ),
          );
          expect(
            labels,
            "ASSERTION: an empty application asks for Repository before Branch",
          ).toEqual(["Repository"]);
          yield* c.fill("Repository", "https://github.com/acme/app");
          yield* c.text("GitHub · a token comes next");
          yield* c.click("Continue");
          yield* c.text("A token that may write to it");
          yield* c.text("Create the token on GitHub");
          expect(
            yield* Effect.promise(() =>
              s.page.$$eval('[data-zerops-surface="git-environment-form"] label', (nodes) =>
                nodes.map((node) => node.textContent?.trim()),
              ),
            ),
          ).toEqual(["Token"]);
          yield* s.then.noExternalNetwork;
        }),
    );

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
