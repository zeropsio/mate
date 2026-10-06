import { receivedHqReplies } from "../../fakes/a-signin/replies.ts";
import { describe, it, expect } from "@effect/vitest";
import { afterAll } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installSignIn, holdMemberList } from "./fake.ts";
import {
  account,
  organizations,
  renewHq,
  sessionEnds,
  signInOrganization,
  unchangedHandovers,
  allowHqRetries,
  firstHqAnswer,
} from "./dsl.ts";

const accountScenario = Effect.fn("signin.scenario")(function* (sessionFault = false) {
  const s = yield* createScenario(
    [installSignIn],
    sessionFault ? { hq: { streamRecheck: 1_000 } } : {},
  );
  return { ...s, receivedReplies: receivedHqReplies(s.page, s.drivers.routes, s.hq.origin) };
});
const disposalMessage = `Error: Cannot access Atom {
  "_id": "Atom",
  "keepAlive": true,
  "lazy": true,
  "label": undefined
}: registry is disposed`;
const logoutDiagnostics: { name: string; raw: string[]; maximum: number }[] = [];
function accountForLogoutError(
  s: Effect.Success<ReturnType<typeof accountScenario>>,
  name: string,
  maximum: number,
) {
  return Effect.sync(() => {
    if (expectedTargets.get(name) !== true) return;
    const raw: string[] = [];
    for (let index = s.web.pageErrors.length - 1; index >= 0; index--) {
      if (s.web.pageErrors[index] === disposalMessage)
        raw.push(...s.web.pageErrors.splice(index, 1));
    }
    // The shared guard still sees every unmatched error; web.errors keeps the original log.
    logoutDiagnostics.push({ name, raw, maximum });
  });
}
const expectedTargets = new Map<string, boolean>();
function startExpectedFailure(name: string) {
  expectedTargets.set(name, false);
  return () => expectedTargets.set(name, true);
}
// afterAll runs outside Vitest's inversion of an expected failure and its afterEach hooks.
afterAll(() => {
  for (const { name, raw, maximum } of logoutDiagnostics) {
    expect(
      raw.every((error) => error === disposalMessage),
      `${name}: unexpected diagnostic`,
    ).toBe(true);
    expect(raw.length, `${name}: extra disposal errors`).toBeLessThanOrEqual(maximum);
  }
  for (const [name, reached] of expectedTargets)
    expect(reached, `${name}: expected failure did not reach its visible assertion`).toBe(true);
});

describe("A: sign-in, session and organizations", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a successful Zerops hand-over leaving the user at the door or without their menu, or
    // reloading the document to get there.
    it.effect("hand-over opens the account's menu", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* account(s.page).showsPerson("owner");
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.menu.row("Ada").appears();
        yield* account(s.page).openedInTheHandoverDocument;
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

    // Catches a reload minting a throwaway Zerops token for HQ's door though the account kept a
    // live HQ session: only HQ asking for a new session may mint one.
    it.effect.each([
      { members: "read at once", held: false },
      { members: "read late, as KRLS's", held: true },
    ])(
      "a reload with a kept HQ session mints no door token, its member list $members",
      ({ held }) =>
        Effect.gen(function* () {
          const s = yield* accountScenario();
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          yield* s.then.menu.row("Shop").appears();
          const members = held ? holdMemberList(s.drivers) : undefined;
          const mints = () =>
            s.drivers.zerops.requests.get("POST /client/ORG/integration-token") ?? 0;
          const first = mints();
          expect(first, "The first load enters HQ's door once").toBe(1);
          for (let load = 0; load < 2; load++) {
            const reads = (s.drivers.zerops.requests.get("GET /client/ORG/user/list") ?? 0) + 1;
            yield* account(s.page).reload;
            yield* s.then.menu.row(load === 0 ? "Shop" : "Shop 0").appears();
            // The member list read behind verifies the kept HQ; HQ's next word comes after it.
            yield* Effect.promise(() =>
              s.drivers.zerops.waitForRequest("GET /client/ORG/user/list", reads),
            );
            members?.release();
            // The application keeps its id: the colleague renames it by its first name each time.
            yield* s.when.hq.colleague.renamesProject("Shop", `Shop ${load}`);
            yield* s.then.menu.row(`Shop ${load}`).appears();
          }
          expect(mints(), "Two reloads mint no further door token").toBe(first);
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

    // Catches a reload or a new tab waiting on the organization's member list (KRLS: tens of
    // seconds) before it reaches the HQ whose session the account kept.
    it.effect("reload and a new tab reach the kept HQ without waiting for the member list", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const members = holdMemberList(s.drivers);
        const reloaded = firstHqAnswer(s.page);
        reloaded.from();
        yield* account(s.page).reload;
        const reload = yield* reloaded.ms;
        yield* s.then.menu.row("Shop").appears();
        const b = yield* s.given.browserActor({ context: s.page.browserContext() });
        const opened = firstHqAnswer(b.page);
        opened.from();
        yield* Effect.promise(() => b.page.goto(s.web.origin));
        const tab = yield* opened.ms;
        yield* b.then.menu.row("Shop").appears();
        process.stdout.write(
          `A first HQ answer while the member list is held: reload=${reload.toFixed(0)}ms new tab=${tab.toFixed(0)}ms\n`,
        );
        expect(
          members.pending(),
          "Both tabs reached HQ while membership replies are still held",
        ).toBeGreaterThanOrEqual(2);
        members.release();
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches an expired HQ session trapping an otherwise signed-in user even after Try again.
    it.effect("Try again renews an expired HQ session without account sign-in", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario(true);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const retainedAuthorization = yield* unchangedHandovers(s);
        yield* sessionEnds(s, "expiry");
        yield* s.when.hq.colleague.renamesProject("Shop", "Renewed");
        yield* renewHq(s, "Renewed");
        yield* s.then.menu.row("Renewed").appears();
        yield* account(s.page).showsPerson("owner");
        yield* retainedAuthorization();
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a transient HQ session-database failure permanently stopping live updates after recovery.
    it.effect("HQ session-check outage recovers without user intervention", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario(true);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        yield* sessionEnds(s, "outage");
        yield* s.when.hq.colleague.renamesProject("Shop", "HQ returned");
        yield* allowHqRetries(s, "HQ returned", s.receivedReplies);
        yield* s.then.menu
          .row("HQ returned")
          .appears({ within: 10_000 })
          .pipe(Effect.ensuring(Effect.all([s.then.noReload, s.then.noExternalNetwork])));
      }),
    );
    // Catches sign-out raising "registry is disposed" after clearing the account UI.
    it.effect("sign-out clears the account without registry disposal", () =>
      Effect.gen(function* () {
        const name = "sign-out clears the account without registry disposal";
        const reachedVisible = startExpectedFailure(name);
        const s = yield* accountScenario();
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
        yield* Effect.gen(function* () {
          yield* account(s.page).signOut;
          yield* account(s.page).signedOut;
          yield* account(s.page).reload;
          yield* account(s.page).signedOut;
          reachedVisible();
          // Copy diagnostics so the failure report survives exact-error accounting in finally.
          yield* Effect.sync(() =>
            expect([...s.web.pageErrors], "Sign-out must not raise registry is disposed").toEqual(
              [],
            ),
          );
          yield* s.then.noExternalNetwork;
        }).pipe(Effect.ensuring(accountForLogoutError(s, name, 1)));
      }),
    );

    // Catches a deliberate sign-out in tab B leaving tab A signed in, or ending it in an error.
    it.effect("sign-out in tab B signs tab A out too, without errors", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const b = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* Effect.promise(async () => {
          await b.page.goto(s.web.origin);
        });
        yield* account(b.page).showsPerson("owner");
        yield* b.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
        yield* account(b.page).signOut;
        yield* account(b.page).signedOut;
        // A tab in the background draws no frames: tab A is looked at in front.
        yield* Effect.promise(() => s.page.bringToFront());
        yield* account(s.page).signedOut;
        yield* Effect.sync(() =>
          expect([...s.web.pageErrors], "Sign-out must not raise registry is disposed").toEqual([]),
        );
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches one tab's new HQ session revoking the one a neighbouring tab of the account still uses.
    it.effect("a second tab entering HQ leaves the first tab's HQ live", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario(true);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        const b = yield* s.given.browserActor({ context: s.page.browserContext() });
        // Tab B waits at the door; the sign-in in tab A signs it in too, and both enter HQ.
        yield* Effect.promise(async () => {
          await b.page.goto(s.web.origin);
          await s.page.bringToFront();
        });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        yield* Effect.promise(() => b.page.bringToFront());
        yield* b.then.menu.row("Shop").appears();
        yield* s.when.hq.colleague.renamesProject("Shop", "Both live");
        yield* b.then.menu.row("Both live").appears({ within: 10_000 });
        yield* Effect.promise(() => s.page.bringToFront());
        yield* s.then.menu.row("Both live").appears({ within: 10_000 });
        yield* account(s.page).showsPerson("owner");
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches an expired HQ session permanently stopping live work until the user retries.
    it.effect("HQ session expires and renews itself", () =>
      Effect.gen(function* () {
        const s = yield* accountScenario(true);
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears();
        const retainedAuthorization = yield* unchangedHandovers(s);
        yield* sessionEnds(s, "expiry");
        yield* s.when.hq.colleague.renamesProject("Shop", "Automatically renewed");
        yield* allowHqRetries(s, "Automatically renewed", s.receivedReplies);
        yield* s.then.menu.row("Automatically renewed").appears({ within: 10_000 });
        yield* retainedAuthorization();
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
