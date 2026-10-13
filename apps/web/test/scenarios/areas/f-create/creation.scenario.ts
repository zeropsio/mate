import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installCreation } from "./fake.ts";
import { creation } from "./dsl.ts";
import { environmentRecipe } from "./recipe.ts";

describe("F: creation through the hosted client", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a wrong full Zerops name, leaking its application prefix into the Mate UI, or losing the conversation hand-off.
    it.effect("new project creates its named first Mate", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        // An organization with a Mate: New project is the menu's offered path (D11).
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const c = creation(s);
        yield* c.newProject;
        yield* c.submitProject;
        yield* c.text("Nova");
        yield* Effect.promise(async () => {
          const composer = await s.page
            .waitForSelector('[role="textbox"]', { visible: true, timeout: 15_000 })
            .catch(() => null);
          expect(
            composer,
            "ASSERTION: a new Mate's known HQ ownership admits its composer before HQ's overview",
          ).not.toBeNull();
        });
        yield* c.acceptedOnce("Garden - Nova");
        yield* s.then.menu.row("Garden").appears();
        yield* s.then.noExternalNetwork;
      }),
    );
    // Catches Add Mate losing its requested name or placing it outside the selected empty project.
    it.effect("an empty project gets its first Mate", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.app("Shop");
        yield* s.given.signedIn;
        const c = creation(s);
        yield* c.openAdd("Mate");
        yield* c.fill("Name", "Nova");
        yield* c.click("Add Nova to Shop");
        yield* s.then.conversation.appears;
        yield* c.acceptedOnce("Shop - Nova");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.menu.row("Nova").appears();
        yield* c.mateAppearsInProject("Nova", "Shop");
        yield* s.then.noExternalNetwork;
      }),
    );

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

    // Catches an accepted birth losing its exact project when the tab closes before attach/key.
    it.effect("closing the tab before setup retains the birth's accepted project", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const c = creation(s);
        c.holdProjectCreation();
        yield* c.newProject;
        const bound = c.projectBound();
        yield* c.submitProject;
        yield* bound;
        yield* c.noSetupYet;
        const address = s.page.url();
        const context = s.page.browserContext();
        expect(
          yield* Effect.promise(async () => {
            const confirmations: string[] = [];
            const closed = new Promise<void>((resolve) => s.page.once("close", () => resolve()));
            s.page.on("dialog", async (dialog) => {
              confirmations.push(dialog.type());
              await dialog.accept();
            });
            await s.page.close({ runBeforeUnload: true });
            await closed;
            return confirmations;
          }),
          "ASSERTION: closing a running setup confirms the browser's unload warning",
        ).toEqual(["beforeunload"]);
        const reopened = yield* s.given.browserActor({ context });
        yield* Effect.promise(() => reopened.page.goto(address));
        const resumed = creation({ ...s, ...reopened });
        yield* c.completeProjectCreation;
        yield* resumed.finishSetup;
        yield* reopened.then.conversation.appears;
        yield* resumed.originalSetupOnly;
        yield* reopened.then.menu.row("Ada").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Finish setup recreating an accepted container/key after the creation view is lost.
    it.effect("reload after an imported container finishes the original Mate's setup", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const c = creation(s);
        c.stopAfterContainer();
        yield* c.newProject;
        yield* c.submitProject;
        yield* c.text("Details");
        expect(
          yield* Effect.promise(() => s.page.evaluate(() => document.body.innerText)),
        ).not.toContain("isolation could not be read");
        yield* c.click("Details");
        yield* c.text("isolation could not be read");
        yield* c.settled;
        c.allowSetup();
        yield* c.reload;
        yield* c.finishSetup;
        yield* s.then.conversation.appears;
        yield* c.originalSetupOnly;
        yield* s.then.menu.row("Ada").appears();
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
