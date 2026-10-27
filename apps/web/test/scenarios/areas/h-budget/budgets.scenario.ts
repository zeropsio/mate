import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installBudget } from "./fake.ts";
import { budgets } from "./dsl.ts";

const report = (line: string) => process.stdout.write(`${line}\n`);

const names = ["Ada", "Bea", "Cara", "Dora"];
// One registration pair per organization-wide family (project, service, process, app version,
// public HTTP routing, public port routing): a fixed count that never grows with the projects or
// Mates shown.
const REGISTRATIONS = 12;

describe("H: hosted client budgets", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // App detail scales with the cards in view (the owner, 2026-10-11, asked each card for its
    // "quick history of latest PRs"): applications nobody can see add no history reads.
    it.effect(
      "Projects holds app detail only for the cards in view as the organization grows",
      () =>
        Effect.gen(function* () {
          for (const count of [1, 16])
            yield* Effect.scoped(
              Effect.gen(function* () {
                const s = yield* createScenario([installBudget]);
                const b = budgets(s);
                for (let index = 0; index < count; index++)
                  yield* s.given.project(`Mate-${index}`, {
                    mate: index < 5,
                    kind: index < 5 ? "mate" : "stage",
                    app: index === 0 ? "Shop" : `App-${index}`,
                  });
                yield* s.given.signedIn;
                yield* b.when.menuReady(["Mate-0"]);
                yield* b.when.projectsReady;
                yield* b.when.projectsAre(count);
                yield* b.when.browserSettled;
                // A card in view holds its detail whether it is painted or still stands in.
                const visibleApps = Effect.promise(() =>
                  s.page.evaluate(() => {
                    const row = document.querySelector('[data-zerops-surface="project-cards"]')!;
                    const viewport = row.getBoundingClientRect();
                    return Array.from(row.querySelectorAll(':scope > [role="listitem"]'))
                      .filter((card) => {
                        const box = card.getBoundingClientRect();
                        return (
                          box.right > Math.max(0, viewport.left) &&
                          box.left < Math.min(innerWidth, viewport.right) &&
                          box.bottom > 0 &&
                          box.top < innerHeight
                        );
                      })
                      .map((card) => card.getAttribute("aria-label")!);
                  }),
                );
                const expectVisibleDemand = Effect.gen(function* () {
                  const applications = yield* visibleApps;
                  yield* b.when.appDetailsAre(applications);
                  expect(b.measure.appDetails().toSorted()).toEqual(
                    applications.map((name) => s.appIds.get(name)).toSorted(),
                  );
                  return applications;
                });
                const before = yield* expectVisibleDemand;
                const order = yield* Effect.promise(() =>
                  s.page.$$eval(
                    '[data-zerops-surface="project-cards"] > [role="listitem"]',
                    (cards) => cards.map((card) => card.getAttribute("aria-label")!),
                  ),
                );
                const cardNames =
                  count === 1 ? ["Shop"] : ["Shop", "App-1", "App-2", "App-3", "App-4"];
                expect(order.toSorted()).toEqual(cardNames.toSorted());
                expect(before).toContain(order[0]);
                if (count > 1) {
                  expect(before.length).toBeLessThan(5);
                  yield* Effect.promise(async () => {
                    await s.page.evaluate(() => {
                      const row = document.querySelector('[data-zerops-surface="project-cards"]')!;
                      row.scrollTo({ left: row.scrollWidth, behavior: "instant" });
                    });
                    await s.page.waitForFunction(() => {
                      const row = document.querySelector('[data-zerops-surface="project-cards"]')!;
                      const card = row.firstElementChild!.getBoundingClientRect();
                      return card.right <= row.getBoundingClientRect().left;
                    });
                  });
                  yield* b.when.browserSettled;
                  const after = yield* expectVisibleDemand;
                  expect(after).not.toContain(order[0]);
                  expect(after).toContain(order.at(-1));
                }
                yield* s.then.noExternalNetwork;
              }),
            );
        }),
    );

    // Leaving Projects releases the cards' detail; Usage's source migration owns its RPC budget.
    it.effect("opening Usage releases Projects detail demand", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(["Ada"]);
        yield* s.given.signedIn;
        yield* b.when.projectsReady;
        yield* b.when.appDetailsAre(["Shop"]);
        yield* b.when.opensUsage;
        yield* b.when.appDetailsAre([]);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches menu discovery connecting every Mate and spending container resources before a click.
    it.effect("showing four Mates in the menu opens no Mate RPC connection", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(names);
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.then.unopenedMates(names);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches opening one Mate fanning out to other containers or never enabling its composer.
    it.effect("opening one Mate spends one door visit and leaves the other three unopened", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(names);
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.when.opensMate("Ada");
        yield* s.then.conversation.appears;
        yield* b.then.composerEnabled;
        expect(b.measure.doorVisits("Ada")).toBe(1);
        expect(b.measure.mateRpcs("Ada"), "Opening RPC budget").toBeLessThanOrEqual(30);
        yield* b.then.unopenedMates(names.slice(1));
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches returning to a parked Mate repeating account authorization and delaying the chat.
    it.effect("returning to an opened Mate reuses its door authorization", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(["Ada", "Bea"]);
        yield* s.given.signedIn;
        yield* b.when.menuReady(["Ada", "Bea"]);
        for (const name of ["Ada", "Bea", "Ada"]) {
          yield* b.when.opensMate(name);
          yield* s.then.conversation.appears;
          yield* b.then.composerEnabled;
        }
        expect(b.measure.doorVisits("Ada")).toBe(1);
        expect(b.measure.doorVisits("Bea")).toBe(1);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches navigation starting detail reads: a Mate without its address shown nowhere holds no
    // project history, at start or over an idle session.
    it.effect("Mates without their address read no project history while nothing shows them", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(names);
        yield* b.given.addressesOff;
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.when.browserSettled;
        const atStart = b.measure.projectHistoryReads();
        yield* Effect.promise(() => s.clock.advance(120_000));
        yield* b.when.browserSettled;
        const idle = b.measure.projectHistoryReads() - atStart;
        report(
          `H no address: GET project process history (with preflights) at start=${atStart}, over 2 min idle=${idle}; 4 Mates`,
        );
        yield* s.then.noExternalNetwork;
        expect(atStart, "Process history reads at start").toBe(0);
        expect(idle, "Process history reads while idle").toBe(0);
      }),
    );

    // Catches a per-project routings read for an organization reader: at start, with the
    // production menu open, or repeated over an idle session.
    it.effect("an organization reader reads no project's routings, shown or idle", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(names);
        yield* s.given.project("Shop-live", {
          app: "Shop",
          kind: "production",
          environmentName: "live",
        });
        s.given.asPerson("reader");
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.when.opensAddresses;
        yield* b.when.browserSettled;
        const atStart = b.measure.projectRoutingReads();
        yield* Effect.promise(() => s.clock.advance(120_000));
        yield* b.when.browserSettled;
        const idle = b.measure.projectRoutingReads() - atStart;
        report(
          `H routings: GET public-http-routing (with preflights) at start=${atStart}, over 2 min idle=${idle}; 4 Mates, production menu open`,
        );
        yield* s.then.noExternalNetwork;
        expect(atStart, "Per-project routings reads at start").toBe(0);
        expect(idle, "Per-project routings reads while idle").toBe(0);
      }),
    );

    // Catches a per-project services or access read: at start, or repeated over an idle session
    // that outlasts the access grant's renewal. The owner is judged on their membership, and whose
    // a Mate is comes from HQ: no project's own row is read, then or at a renewal.
    it.effect("an idle owner's session reads no project's services or own row", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(names);
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.when.browserSettled;
        const servicesAtStart = b.measure.projectServiceReads();
        const projectsAtStart = b.measure.projectReads();
        const variablesAtStart = b.measure.variableReads();
        yield* Effect.promise(() => s.clock.advance(15 * 60_000));
        yield* b.when.browserSettled;
        const servicesIdle = b.measure.projectServiceReads() - servicesAtStart;
        const projectsIdle = b.measure.projectReads() - projectsAtStart;
        const variablesIdle = b.measure.variableReads() - variablesAtStart;
        report(
          `H idle, owner: GET service-stack (with preflights) at start=${servicesAtStart}, over 15 min idle=${servicesIdle}; GET project (with preflights) at start=${projectsAtStart}, over 15 min idle (one renewal)=${projectsIdle}; 4 Mates`,
        );
        yield* s.then.noExternalNetwork;
        expect(servicesAtStart, "Per-project services reads at start").toBe(0);
        expect(servicesIdle, "Per-project services reads while idle").toBe(0);
        expect(projectsAtStart, "Own project rows at start").toBe(0);
        expect(projectsIdle, "Own project rows over one renewal").toBe(0);
        report(`H variables: startup=${variablesAtStart}, idle=${variablesIdle}; 4 Mates`);
        expect(variablesAtStart, "No variables search at menu load").toBe(0);
        expect(variablesIdle, "No variables search while idle").toBe(0);
      }),
    );

    // A Developer (NO_ACCESS member) is judged on the grant their listing names on each project:
    // a project's own row is read only where the listing names none, and here it names every one.
    it.effect("an idle Developer's session reads no own row their listing names a grant on", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        // The grants exist before HQ reads the projects: HQ's organisation view ages before it
        // learns a grant made after that read.
        s.given.person("dev", {
          role: "Developer",
          grants: Object.fromEntries(names.map((name) => [name, "BASIC_USER"])),
        });
        yield* b.given.mates(names);
        s.given.asPerson("dev");
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.when.browserSettled;
        const projectsAtStart = b.measure.projectReads();
        const variablesAtStart = b.measure.variableReads();
        yield* Effect.promise(() => s.clock.advance(15 * 60_000));
        yield* b.when.browserSettled;
        const projectsIdle = b.measure.projectReads() - projectsAtStart;
        const variablesIdle = b.measure.variableReads() - variablesAtStart;
        report(
          `H idle, Developer granted on 4 Mates: GET project (with preflights) at start=${projectsAtStart}, over 15 min idle (one renewal)=${projectsIdle}`,
        );
        yield* s.then.noExternalNetwork;
        expect(projectsAtStart, "Own project rows at start").toBe(0);
        expect(projectsIdle, "Own project rows over one renewal").toBe(0);
        report(`H variables: startup=${variablesAtStart}, idle=${variablesIdle}; 4 Mates`);
        expect(variablesAtStart, "No variables search at menu load").toBe(0);
        expect(variablesIdle, "No variables search while idle").toBe(0);
      }),
    );

    // Catches startup reads that make a populated organization slow and expensive.
    it.effect(
      "browser startup uses at most its organization-wide registrations and eight other requests",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installBudget]);
          const b = budgets(s);
          yield* b.given.mates(names);
          const before = b.measure.browser();
          yield* s.given.signedIn;
          yield* b.when.menuReady(names);
          yield* b.when.browserSettled;
          yield* s.then.noExternalNetwork;
          const sample = b.measure.browser();
          const registrations = sample.registrations - before.registrations;
          const otherRequests = sample.otherRequests - before.otherRequests;
          report(
            `H target startup: browser registrations=${registrations}, other=${otherRequests}, total=${registrations + otherRequests}; targets <=${REGISTRATIONS} registrations, <=8 others`,
          );
          expect(registrations, "Browser startup registrations").toBeLessThanOrEqual(REGISTRATIONS);
          expect(otherRequests, "Browser startup non-registration requests").toBeLessThanOrEqual(8);
        }),
    );

    // Catches menu registrations growing with the number of Mates instead of organization scope.
    it.effect("target: menu registrations do not grow from one to four Mates", () =>
      Effect.gen(function* () {
        const counts: number[] = [];
        for (const inventory of [["Ada"], names]) {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const s = yield* createScenario([installBudget]);
              const b = budgets(s);
              yield* b.given.mates(inventory);
              if (inventory.length === 4)
                yield* b.given.plainProjects([
                  "Plain1",
                  "Plain2",
                  "Plain3",
                  "Plain4",
                  "Plain5",
                  "Plain6",
                ]);
              const before = b.measure.browser();
              yield* s.given.signedIn;
              yield* b.when.menuReady(inventory);
              yield* b.when.browserSettled;
              counts.push(b.measure.browser().registrations - before.registrations);
              yield* s.then.noExternalNetwork;
            }),
          );
        }
        report(
          `H target registrations: 1 Mate=${counts[0]}, 4 Mates + 6 plain projects=${counts[1]}; settled, target <=${REGISTRATIONS} and no growth`,
        );
        expect(counts[0], "One-Mate menu registration ceiling").toBeLessThanOrEqual(REGISTRATIONS);
        expect(
          counts[1],
          "Four-Mate and plain-project menu registration ceiling",
        ).toBeLessThanOrEqual(REGISTRATIONS);
        expect(
          counts[1],
          "Menu registration cost must be independent of Mate count",
        ).toBeLessThanOrEqual(counts[0]!);
      }),
    );
  });
});
