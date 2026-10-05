import { describe, it, expect } from "@effect/vitest";
import { afterEach } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installSignIn } from "./fake.ts";
import { account, organizations, retryHq, sessionEnds, signInOrganization } from "./dsl.ts";

const expectedTargets = new Map<string, boolean>([
  ["HQ session-check outage recovers without user intervention", false],
]);
// Setup, fault injection and navigation errors must not count as known failures.
afterEach(({ task }) => {
  if (!expectedTargets.has(task.name)) return;
  expect(expectedTargets.get(task.name), "Expected failure must reach its visible assertion").toBe(
    true,
  );
  expectedTargets.set(task.name, false);
});

describe("A: sign-in, session and organizations", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a successful Zerops hand-over leaving the user at the door or without their menu.
    it.effect("hand-over opens the account's menu", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installSignIn]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a reload sending a signed-in user back through account authorization.
    it.effect("reload keeps the account signed in", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installSignIn]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        yield* account(s.page).reload;
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches organization selection showing the previous organization's projects or losing the way back.
    it.effect("switching organizations clears previous work and can return", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installSignIn]);
        yield* organizations(s);
        yield* signInOrganization(s);
        yield* s.then.menu.row("Shop").appears();
        yield* account(s.page).selectOrganization("Second");
        yield* account(s.page).needsAdministrator;
        yield* account(s.page).lacksRows(["Shop", "Ada"]);
        yield* account(s.page).selectOrganization("KRLS");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches reload silently selecting a different organization and exposing the wrong workspace.
    it.effect("reload restores the selected organization", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installSignIn]);
        yield* organizations(s);
        yield* signInOrganization(s);
        yield* account(s.page).selectOrganization("Second");
        yield* account(s.page).needsAdministrator;
        yield* account(s.page).reload;
        yield* account(s.page).showsOrganization("Second");
        yield* account(s.page).needsAdministrator;
        yield* account(s.page).lacksRows(["Shop", "Ada"]);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches opening another tab needlessly requiring a fresh account hand-over.
    it.effect("another tab restores the same signed-in account", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installSignIn]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const b = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* Effect.promise(async () => {
          await b.page.goto(s.web.origin);
        });
        yield* account(b.page).showsPerson("owner");
        yield* b.then.menu.row("Shop").appears();
        yield* account(s.page).showsPerson("owner");
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches an expired HQ session trapping an otherwise signed-in user even after Try again.
    it.effect("Try again renews an expired HQ session without account sign-in", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installSignIn]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        yield* sessionEnds(s, "expiry");
        yield* s.when.hq.colleague.renamesProject("Shop", "Renewed");
        yield* retryHq(s);
        yield* s.then.menu.row("Renewed").appears();
        yield* account(s.page).showsPerson("owner");
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Targets transient HQ session-database failure permanently stopping live updates after recovery.
    it.effect.fails("HQ session-check outage recovers without user intervention", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installSignIn]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        yield* sessionEnds(s, "outage");
        yield* s.when.hq.colleague.renamesProject("Shop", "HQ returned");
        yield* Effect.promise(() => s.clock.advance(120_000));
        expectedTargets.set("HQ session-check outage recovers without user intervention", true);
        yield* s.then.menu
          .row("HQ returned")
          .appears({ within: 10_000 })
          .pipe(Effect.ensuring(Effect.all([s.then.noReload, s.then.noExternalNetwork])));
      }),
    );
  });
});
