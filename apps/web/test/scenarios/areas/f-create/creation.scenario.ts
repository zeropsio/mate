import { describe, it, expect, afterEach } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installCreation } from "./fake.ts";
import { creation } from "./dsl.ts";

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
    // Catches creating the first Mate under the application's name or losing its conversation hand-off.
    it.effect("new project creates its named first Mate", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.signedIn;
        const c = creation(s);
        yield* c.newProject;
        yield* c.submitProject;
        yield* c.text("Nova");
        yield* s.then.conversation.appears;
        yield* c.acceptedOnce("Nova");
        yield* s.then.menu.row("Garden").appears();
        yield* c.mateAppearsInProject("Nova", "Garden");
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
        yield* c.acceptedOnce("Nova");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.menu.row("Nova").appears();
        yield* c.mateAppearsInProject("Nova", "Shop");
        yield* s.then.noExternalNetwork;
      }),
    );

    for (const role of ["stage", "production"] as const) {
      // Catches adding an environment under the wrong name or losing the requested role in the project's view.
      it.effect(`add ${role} with an agent to an existing project`, () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          const c = creation(s);
          yield* c.openAdd(role);
          yield* c.fill("Environment", `Shop-${role}`);
          yield* c.withAgent;
          yield* c.click(`Add ${role} to Shop`);
          yield* c.environmentAppears(`Shop-${role}`, role);
          yield* c.acceptedOnce(`Shop-${role}`);
          yield* c.text(`Shop-${role}`);
          yield* s.then.noExternalNetwork;
        }),
      );
    }

    // Catches allowing a second Mate to take an existing Mate's case-insensitive account name.
    it.effect("a taken Mate name is refused before creating anything", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        const c = creation(s);
        yield* c.newProject;
        yield* c.fill("Its first Mate", "ada");
        yield* c.click("Create Garden with ada");
        yield* c.text("already");
        expect(c.writes()).toBe(0);
        yield* c.click("Cancel");
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches replaying a creation whose accepted response was lost, including after reload.
    it.effect("an uncertain creation offers projects and does not make a duplicate", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installCreation]);
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        const c = creation(s);
        c.loseCreationReply();
        yield* c.newProject;
        yield* c.submitProject;
        yield* c.text("Go to projects");
        yield* c.acceptedOnce("Nova");
        expect(c.writes()).toBe(1);
        yield* Effect.promise(() => s.clock.advance(60_000));
        yield* c.settled;
        yield* c.click("Go to projects");
        yield* c.text("Garden");
        yield* Effect.promise(() => s.page.reload());
        yield* s.then.menu.row("Garden").appears();
        yield* Effect.promise(() => s.clock.advance(60_000));
        yield* c.settled;
        yield* c.acceptedOnce("Nova");
        expect(c.writes()).toBe(1);
        yield* s.then.noExternalNetwork;
      }),
    );
    // Targets repeating a definitive permission refusal while checking a newly created project's setup.
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
        expect(before).toBe(1);
        yield* Effect.promise(() => s.clock.advance(5_000));
        yield* c.settled;
        const after = c.refusedReads();
        yield* s.then.noExternalNetwork;
        refusalAssertionReached = true;
        expect(after, "Definitive 403 on the new project was automatically retried").toBe(before);
      }),
    );
  });
});
