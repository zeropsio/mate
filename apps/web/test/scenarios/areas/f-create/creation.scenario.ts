import { scenarioSuite } from "../../harness/suite.ts";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { installCreation } from "./fake.ts";
import { creation } from "./dsl.ts";
import { environmentRecipe } from "./recipe.ts";

describe("F: creation through the hosted client", () => {
  scenarioSuite((it) => {
    for (const [role, tag] of [["stage", "stage"]] as const) {
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

    for (const role of ["stage"] as const) {
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
          yield* c.text("Same services as the project");
          yield* c.click(`Add ${role} to Shop`);
          yield* c.environmentAppears("Shop-b", "stage");
          yield* c.stageAdded;
          yield* c.acceptedOnce("Shop-b");
          yield* c.noAgentImported;
          yield* s.then.noExternalNetwork;
        }),
      );
    }

    it.effect("Production reserves its project and access without browser service imports", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* environmentRecipe(s, "production");
        yield* s.given.signedIn;
        const c = creation(s);
        yield* c.openAdd("production");
        yield* c.text("Its services arrive with the first approved release.");
        yield* c.click("Change its name…");
        yield* c.fill("Environment", "Shop-b");
        yield* Effect.promise(async () => {
          expect(
            await s.page.$('[data-zerops-surface="environment-creation-form"] [role="switch"]'),
          ).toBeNull();
          expect(await s.page.$('[aria-label="Starts with"]')).toBeNull();
        });
        yield* c.click("Add production to Shop");
        yield* c.environmentAppears("Shop-b", "prod");
        yield* c.text("Production and its access are reserved.");
        yield* c.acceptedOnce("Shop-b");
        yield* c.noAgentImported;
        expect(
          s.drivers.zerops.requests.get("POST /client/ORG/project/import") ?? 0,
          "ASSERTION: browser production birth never bundles services into project import",
        ).toBe(0);
        expect(
          s.drivers.zerops.requests.get("POST /project/created-1/service-stack/import") ?? 0,
          "ASSERTION: browser production birth never imports services into the reserved project",
        ).toBe(0);
        expect(
          s.drivers.zerops.rows("service-stack").filter((row) => row.projectId === "created-1"),
        ).toEqual([]);
        yield* s.then.noExternalNetwork;
      }),
    );

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
          yield* c.text("Set up production for Shop");
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

    it.effect("Escape from production setup returns focus to its project's surviving menu", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* environmentRecipe(s, "production");
        yield* s.given.signedIn;
        const c = creation(s);
        for (const step of ["destination", "repository", "token"] as const) {
          yield* Effect.promise(() =>
            s.page.goto(`${s.web.origin}/group/${s.drivers.appIds.get("Shop")}/flow`),
          );
          // Production starts at the project menu's Put it live; a Git branch production is set up
          // from its own form. The page's Put it live button would survive and take the focus back.
          yield* Effect.promise(async () => {
            const more = await s.page.waitForSelector('main button[aria-label="More for Shop"]');
            await more!.evaluate((element) => (element as HTMLElement).focus());
            await s.page.keyboard.press("Enter");
            await s.page.locator('[role="menuitem"]::-p-text(Put it live)').click();
          });
          yield* c.text("Put Shop live");
          yield* c.click("Set up production yourself…");
          yield* c.text("Set up production for Shop");
          if (step !== "destination") yield* c.chooseDestination("git");
          if (step === "token") {
            yield* c.fill("Repository", "https://github.com/acme/app");
            yield* c.click("Continue");
            yield* c.text("A token that may write to it");
          }
          yield* Effect.promise(async () => {
            await s.page.keyboard.press("Escape");
            await s.page.waitForSelector('[role="dialog"]', { hidden: true });
            const focused = await s.page.evaluate(() => ({
              tag: document.activeElement?.tagName,
              label: document.activeElement?.getAttribute("aria-label"),
            }));
            expect(
              focused,
              `ASSERTION: Escape from ${step} restores a usable project control`,
            ).toEqual({
              tag: "BUTTON",
              label: "More for Shop",
            });
          });
        }
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
