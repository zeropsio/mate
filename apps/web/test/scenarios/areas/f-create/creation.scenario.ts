import { describe, it, expect, afterEach } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installCreation } from "./fake.ts";
import { creation } from "./dsl.ts";
import { productionRecipe } from "./recipe.ts";

let refusalAssertionReached: boolean | undefined;
afterEach(() => {
  if (refusalAssertionReached !== undefined) {
    const observed = refusalAssertionReached;
    refusalAssertionReached = undefined;
    expect(observed, "Expected-failure setup must reach the refusal retry assertion").toBe(true);
  }
});

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
        yield* s.then.conversation.appears;
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

    // Catches the default agent-off production path refusing a valid recipe or silently installing an agent.
    it.effect("add production from its recipe with the agent off by default", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* productionRecipe(s);
        yield* s.given.signedIn;
        const c = creation(s);
        yield* c.openAdd("production");
        yield* c.fill("Environment", "Shop-b");
        yield* c.agentIsOff;
        yield* c.text("The project's production recipe");
        yield* c.click("Add production to Shop");
        yield* c.environmentAppears("Shop-b", "prod");
        yield* c.text("Shop-b is set up");
        yield* c.acceptedOnce("Shop-b");
        expect(
          s.drivers.zerops.requests.get(
            "PUT /project/created-1/first-class-recipe/development-container",
          ) ?? 0,
          "Agent-off creation must not install an agent container",
        ).toBe(0);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches allowing a second Mate to take an existing Mate's case-insensitive account name.
    it.effect("a taken Mate name is refused before creating anything", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const c = creation(s);
        yield* c.newProject;
        yield* c.fill("Its first Mate", "ada");
        yield* c.click("Create Garden with ada");
        yield* c.text("already");
        yield* c.pastRetryWindow;
        expect(c.writes()).toBe(0);
        yield* c.click("Cancel");
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // These two leave the page's clock running: with it frozen, the create's request was not sent
    // in 165 s (harness finding, reported). Settled requests show nothing is sent again.
    // Catches replaying a creation whose accepted response was lost. Its one new project of its
    // name, which a wholly read listing did not hold at the send, is its own: the creation goes on
    // with it (HANDOFF §4.3, orchestrator 2026-10-06), never making a second.
    it.effect("an uncertain creation goes on with its one new project, never a duplicate", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        // An organization with a Mate: New project is the menu's offered path (D11).
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const c = creation(s);
        c.loseCreationReply();
        yield* c.newProject;
        yield* c.submitProject;
        yield* c.text("Nova");
        yield* c.createAsked;
        yield* c.settled;
        yield* c.acceptedOnce("Garden - Nova");
        yield* s.then.menu.row("Garden").appears();
        expect(c.writes()).toBe(1);
        yield* s.then.noExternalNetwork;
      }),
    );
    // Catches adopting a project that may be somebody else's. Two new projects of its name: neither
    // is known to be its own, so it offers the projects and makes no duplicate.
    it.effect("an uncertain creation with two new projects of its name offers projects", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const c = creation(s);
        c.loseCreationReply();
        c.twinCreation();
        yield* c.newProject;
        yield* c.submitProject;
        yield* c.text("Go to projects");
        yield* c.settled;
        yield* c.acceptedOnce("Garden - Nova");
        expect(c.writes()).toBe(1);
        yield* s.then.noExternalNetwork;
      }),
    );
    // Catches retrying a definitive 403 tied to GET /project/<id> while checking the new project's setup.
    it.effect.fails("a refused creation read is not repeated after five seconds", () =>
      Effect.gen(function* () {
        refusalAssertionReached = false;
        const s = yield* createScenario([installCreation]);
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        const c = creation(s);
        c.refuseCreatedProjectAccess();
        yield* c.newProject;
        yield* c.submitProject;
        yield* c.refusedReadArrives;
        yield* c.text("Nova");
        yield* c.settled;
        const before = c.refusedReads();
        expect(before).toBeGreaterThanOrEqual(1);
        yield* Effect.promise(() => s.clock.advance(5_000));
        yield* c.pastRetryWindow;
        const after = c.refusedReads();
        yield* s.then.noExternalNetwork;
        refusalAssertionReached = true;
        expect(after, "Definitive 403 on the new project was automatically retried").toBe(before);
      }),
    );
  });
});
