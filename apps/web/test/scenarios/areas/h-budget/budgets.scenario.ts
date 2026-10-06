import { describe, expect, it } from "@effect/vitest";
import { afterEach } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installBudget } from "./fake.ts";
import { budgets } from "./dsl.ts";

const report = (line: string) => process.stdout.write(`${line}\n`);

const names = ["Ada", "Bea", "Cara", "Dora"];
const reachedTargets = new Set<string>();
afterEach(({ task }) => {
  if (task.name.startsWith("target:"))
    expect(
      reachedTargets.delete(task.name),
      "Expected failure must reach its budget assertion",
    ).toBe(true);
});

describe("H: hosted client budgets", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a request storm that prevents a populated organization menu becoming usable.
    it.effect("a populated menu starts within a finite platform request budget", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(names);
        const before = b.measure.browser();
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.when.browserSettled;
        const sample = b.measure.browser();
        const requests = sample.requests - before.requests;
        report(
          `H startup: browser total=${requests}, registrations=${sample.registrations - before.registrations}, other=${sample.otherRequests - before.otherRequests}; 4 Mates, settled`,
        );
        expect(requests, "Browser startup request budget").toBeLessThanOrEqual(60);
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

    // Catches extra tabs starving one another of the first HQ-backed application menu.
    it.effect("five tabs each receive real HQ data and show the application menu", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(["Ada"]);
        const tabs = yield* b.given.fiveTabs();
        for (const tab of tabs) {
          yield* Effect.promise(() => tab.page.bringToFront());
          yield* tab.given.signedIn;
          yield* tab.then.menu.row("Shop").appears();
        }
        // Cached rows can appear before the last tab's initial HQ snapshot arrives.
        yield* b.when.hqFirstData(5);
        const connections = yield* b.when.observeTabConnections(tabs.map((tab) => tab.page));
        const rounds: ReturnType<typeof b.measure.firstData>[] = [];
        for (let round = 1; round <= 3; round++) {
          const before = b.measure.hqSegments().length;
          // Earlier sign-in attempts may have closed before upgrading or receiving a frame.
          const receivedBefore = b.measure
            .hqSegments()
            .filter((s) => s.firstDataMs !== null).length;
          const countsBefore = connections.counts();
          yield* Effect.forEach(tabs, (tab) => Effect.promise(() => tab.page.reload()), {
            concurrency: "unbounded",
          });
          yield* b.when.hqFirstData(receivedBefore + 5);
          yield* Effect.forEach(tabs, (tab) => tab.then.menu.row("Shop").appears(), {
            concurrency: "unbounded",
          });
          yield* Effect.promise(() => s.hq.ready());
          for (const [index, count] of connections.counts().entries())
            expect(
              count - countsBefore[index]!,
              "At most one HQ connection per tab",
            ).toBeLessThanOrEqual(1);
          const timing = b.measure.firstData(before);
          expect(timing.samples).toHaveLength(5);
          rounds.push(timing);
          report(
            `H five tabs round ${round}: p50=${timing.p50.toFixed(1)}ms p95=${timing.p95.toFixed(1)}ms; socket-to-first-Shop-frame`,
          );
          if (timing.p50 <= 300 && timing.p95 <= 600) break;
        }
        // Rank whole rounds by their worst normalized target; never mix percentiles across rounds.
        const score = (timing: (typeof rounds)[number]) =>
          Math.max(timing.p50 / 300, timing.p95 / 600);
        const timing = rounds.reduce((best, round) => (score(round) < score(best) ? round : best));
        report(
          `H five tabs best of ${rounds.length}: p50=${timing.p50.toFixed(1)}ms p95=${timing.p95.toFixed(1)}ms`,
        );
        // Up to three rounds tolerate host load spikes; persistent slow delivery still fails.
        expect(timing.p50, "Five-tab first HQ data p50 target").toBeLessThanOrEqual(300);
        expect(timing.p95, "Five-tab first HQ data p95 target").toBeLessThanOrEqual(600);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a planned HQ segment rollover clearing rows or leaving the next segment stale.
    it.effect("an unchanged HQ segment rollover keeps rows and follows the next change", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(["Ada", "Bea"]);
        yield* s.given.signedIn;
        yield* b.when.menuReady(["Ada", "Bea"]);
        const retained = yield* s.then.menu.keepsRows(["Ada", "Bea"]);
        yield* b.when.nextHqSegment;
        yield* s.then.menu.row("Shop").appears();
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop after rollover");
        yield* s.then.menu.row("Shop after rollover").appears();
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.menu.row("Bea").appears();
        yield* retained;
        yield* s.then.noReload;
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
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.when.opensProductionChip;
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
        yield* Effect.promise(() => s.clock.advance(15 * 60_000));
        yield* b.when.browserSettled;
        const servicesIdle = b.measure.projectServiceReads() - servicesAtStart;
        const projectsIdle = b.measure.projectReads() - projectsAtStart;
        report(
          `H idle, owner: GET service-stack (with preflights) at start=${servicesAtStart}, over 15 min idle=${servicesIdle}; GET project (with preflights) at start=${projectsAtStart}, over 15 min idle (one renewal)=${projectsIdle}; 4 Mates`,
        );
        yield* s.then.noExternalNetwork;
        expect(servicesAtStart, "Per-project services reads at start").toBe(0);
        expect(servicesIdle, "Per-project services reads while idle").toBe(0);
        expect(projectsAtStart, "Own project rows at start").toBe(0);
        expect(projectsIdle, "Own project rows over one renewal").toBe(0);
      }),
    );

    // A Developer (NO_ACCESS member) is judged on the grant their listing names on each project:
    // a project's own row is read only where the listing names none, and here it names every one.
    it.effect("an idle Developer's session reads no own row their listing names a grant on", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(names);
        s.given.person("dev", {
          role: "Developer",
          grants: Object.fromEntries(names.map((name) => [name, "BASIC_USER"])),
        });
        s.given.asPerson("dev");
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* b.when.browserSettled;
        const projectsAtStart = b.measure.projectReads();
        yield* Effect.promise(() => s.clock.advance(15 * 60_000));
        yield* b.when.browserSettled;
        const projectsIdle = b.measure.projectReads() - projectsAtStart;
        report(
          `H idle, Developer granted on 4 Mates: GET project (with preflights) at start=${projectsAtStart}, over 15 min idle (one renewal)=${projectsIdle}`,
        );
        yield* s.then.noExternalNetwork;
        expect(projectsAtStart, "Own project rows at start").toBe(0);
        expect(projectsIdle, "Own project rows over one renewal").toBe(0);
      }),
    );

    // Catches the per-project reads Mate s.r.o.'s start made on 2026-10-06 (229 requests): each
    // project's own row, its services and its public routing, read for no surface that shows them.
    // An owner reads no project's own row: whose a Mate is comes from HQ.
    it.effect(
      "a Mate s.r.o.-like menu starts with no per-project row, services or routing read",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installBudget]);
          const b = budgets(s);
          yield* b.given.mates(names);
          yield* b.given.stops("Shop");
          yield* b.given.plainProjects(["Plain1", "Plain2"]);
          yield* s.given.signedIn;
          yield* b.when.menuReady(names);
          yield* b.when.browserSettled;
          const own = b.measure.projectReads();
          const others = b.measure.projectReads(["Staging", "Production", "Plain1", "Plain2"]);
          const services = b.measure.projectServiceReads();
          const routing = b.measure.projectRoutingReads();
          report(
            `H start, 8 projects (4 Mates, stage, production, 2 plain), with preflights: GET project=${own} (of which not a Mate's ${others}), GET service-stack=${services}, GET public-http-routing=${routing}`,
          );
          yield* s.then.noExternalNetwork;
          expect(own, "Own project rows at start").toBe(0);
          expect(others, "Own rows of projects no Mate is drawn for").toBe(0);
          expect(services, "Per-project services reads at start").toBe(0);
          expect(routing, "Per-project public routing reads at start").toBe(0);
        }),
    );

    // Targets today's per-Mate startup reads, which make a large organization slow and expensive.
    it.effect.fails(
      "target: browser startup uses at most eight registrations and eight other requests",
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
            `H target startup: browser registrations=${registrations}, other=${otherRequests}, total=${registrations + otherRequests}; targets <=8 each`,
          );
          reachedTargets.add(
            "target: browser startup uses at most eight registrations and eight other requests",
          );
          expect(registrations, "Browser startup registrations").toBeLessThanOrEqual(8);
          expect(otherRequests, "Browser startup non-registration requests").toBeLessThanOrEqual(8);
        }),
    );

    // Targets menu registrations growing with the number of Mates instead of organization scope.
    it.effect.fails("target: menu registrations do not grow from one to four Mates", () =>
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
          `H target registrations: 1 Mate=${counts[0]}, 4 Mates + 6 plain projects=${counts[1]}; settled, target <=8 and no growth`,
        );
        reachedTargets.add("target: menu registrations do not grow from one to four Mates");
        expect(counts[0], "One-Mate menu registration ceiling").toBeLessThanOrEqual(8);
        expect(
          counts[1],
          "Four-Mate and plain-project menu registration ceiling",
        ).toBeLessThanOrEqual(8);
        expect(
          counts[1],
          "Menu registration cost must be independent of Mate count",
        ).toBeLessThanOrEqual(counts[0]!);
      }),
    );

    // Catches retransmitting the whole unchanged HQ menu at every planned segment boundary.
    it.effect("target: an unchanged next HQ segment transfers no state payload", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(["Ada", "Bea"]);
        yield* s.given.signedIn;
        yield* b.when.menuReady(["Ada", "Bea"]);
        yield* b.when.nextHqSegment;
        yield* s.then.menu.row("Shop").appears();
        yield* b.when.hqStateSettled;
        yield* s.then.noExternalNetwork;
        const bytes = b.measure.hqSegments()[1]!.stateBytes;
        report(
          `H target unchanged segment: ${bytes} menu-state payload bytes; target=0, ignores ping/roles`,
        );
        reachedTargets.add("target: an unchanged next HQ segment transfers no state payload");
        expect(bytes, "Unchanged HQ segment must not resend state").toBe(0);
      }),
    );
  });
});
