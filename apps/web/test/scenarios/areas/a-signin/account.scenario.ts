import { describe, it, expect } from "@effect/vitest";
import { afterAll } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installSignIn } from "./fake.ts";
import {
  account,
  organizations,
  retryHq,
  sessionEnds,
  signInOrganization,
  unchangedHandovers,
  allowHqRetries,
} from "./dsl.ts";

const browserChecks: { pageErrors: string[]; blocked: string[] }[] = [];
const accountScenario = Effect.fn("signin.scenario")(function* () {
  const s = yield* createScenario([installSignIn]);
  browserChecks.push(s.web);
  return s;
});
const expectedTargets = new Map<string, boolean>();
function startExpectedFailure(name: string) {
  expectedTargets.set(name, false);
  return () => expectedTargets.set(name, true);
}
// afterAll runs outside Vitest's inversion of an expected failure and its afterEach hooks.
afterAll(() => {
  expect(
    browserChecks.flatMap((web) => web.pageErrors),
    "Uncaught browser errors",
  ).toEqual([]);
  expect(
    browserChecks.flatMap((web) => web.blocked),
    "Unmapped browser network",
  ).toEqual([]);
  for (const [name, reached] of expectedTargets)
    expect(reached, `${name}: expected failure did not reach its visible assertion`).toBe(true);
});

describe("A: sign-in, session and organizations", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a successful Zerops hand-over leaving the user at the door or without their menu.
    it.effect("hand-over opens the account's menu", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario();
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
        const s = yield* accountScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const retainedAuthorization = yield* unchangedHandovers(s);
        yield* account(s.page).reload;
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* retainedAuthorization();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches organization selection showing the previous organization's projects or losing the way back.
    it.effect("switching organizations clears previous work and can return", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario();
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
        const s = yield* accountScenario();
        yield* organizations(s);
        yield* signInOrganization(s);
        yield* account(s.page).selectOrganization("Second");
        yield* account(s.page).needsAdministrator;
        const retainedAuthorization = yield* unchangedHandovers(s);
        yield* account(s.page).reload;
        yield* account(s.page).showsOrganization("Second");
        yield* account(s.page).needsAdministrator;
        yield* account(s.page).lacksRows(["Shop", "Ada"]);
        yield* retainedAuthorization();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches opening another tab needlessly requiring a fresh account hand-over.
    it.effect("another tab restores the same signed-in account", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const retainedAuthorization = yield* unchangedHandovers(s);
        const b = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* Effect.promise(async () => {
          await b.page.goto(s.web.origin);
        });
        yield* account(b.page).showsPerson("owner");
        yield* b.then.menu.row("Shop").appears();
        yield* account(s.page).showsPerson("owner");
        yield* retainedAuthorization();
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches an expired HQ session trapping an otherwise signed-in user even after Try again.
    it.effect("Try again renews an expired HQ session without account sign-in", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario();
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
        const reachedVisible = startExpectedFailure(
          "HQ session-check outage recovers without user intervention",
        );
        const s = yield* accountScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        yield* sessionEnds(s, "outage");
        yield* s.when.hq.colleague.renamesProject("Shop", "HQ returned");
        yield* allowHqRetries(s, "HQ returned");
        reachedVisible();
        yield* s.then.menu
          .row("HQ returned")
          .appears({ within: 10_000 })
          .pipe(Effect.ensuring(Effect.all([s.then.noReload, s.then.noExternalNetwork])));
      }),
    );
    // Catches sign-out leaving account work visible or restoring it on reload.
    // Blocked by the uncaught logout disposal error; see README for the shared API request.
    it.effect.skip("sign-out clears the account's work", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario();
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        yield* account(s.page).signOut;
        yield* account(s.page).signedOut;
        yield* account(s.page).reload;
        yield* account(s.page).signedOut;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches tab B's sign-out unexpectedly ending tab A's active session.
    // Reproduces today, but its separate disposal errors need explicit shared accounting first.
    it.effect.fails(
      "sign-out in tab B leaves tab A's session usable",
      () =>
        Effect.gen(function* () {
          const reachedVisible = startExpectedFailure(
            "sign-out in tab B leaves tab A's session usable",
          );
          const s = yield* accountScenario();
          yield* Effect.promise(() => s.clock.install());
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          yield* s.then.menu.row("Shop").appears();
          const b = yield* s.given.browserActor({ context: s.page.browserContext() });
          yield* Effect.promise(() => b.clock.install());
          yield* Effect.promise(async () => {
            await b.page.goto(s.web.origin);
          });
          yield* account(b.page).showsPerson("owner");
          yield* b.then.menu.row("Shop").appears();
          yield* account(b.page).signOut;
          yield* account(b.page).signedOut;
          reachedVisible();
          yield* account(s.page).showsPerson("owner");
          yield* s.then.menu.row("Shop").appears();
          yield* s.then.noExternalNetwork;
        }),
      { skip: true },
    );

    // Catches an expired HQ session permanently stopping live work until the user retries.
    it.effect.fails("HQ session expires and renews itself", () =>
      Effect.gen(function* () {
        const reachedVisible = startExpectedFailure("HQ session expires and renews itself");
        const s = yield* accountScenario();
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const retainedAuthorization = yield* unchangedHandovers(s);
        yield* sessionEnds(s, "expiry");
        yield* s.when.hq.colleague.renamesProject("Shop", "Automatically renewed");
        yield* allowHqRetries(s, "Automatically renewed");
        reachedVisible();
        yield* s.then.menu.row("Automatically renewed").appears({ within: 10_000 });
        yield* retainedAuthorization();
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
