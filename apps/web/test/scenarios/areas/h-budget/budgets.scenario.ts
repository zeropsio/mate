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
        const before = b.measure.platformRequests();
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        const requests = b.measure.platformRequests() - before;
        report(`H startup: ${requests} non-OPTIONS Zerops requests, 4 Mates`);
        expect(requests, "Platform startup request budget").toBeLessThanOrEqual(80);
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
        const before = b.measure.hqSegments().length;
        yield* Effect.forEach(tabs, (tab) => Effect.promise(() => tab.page.reload()), {
          concurrency: "unbounded",
        });
        yield* b.when.hqFirstData(before + 5);
        yield* Effect.forEach(tabs, (tab) => tab.then.menu.row("Shop").appears(), {
          concurrency: "unbounded",
        });
        yield* Effect.promise(() => s.hq.ready());
        expect(b.measure.hqSegments()).toHaveLength(before + 5);
        const timing = b.measure.firstData(before);
        report(
          `H five tabs: p50=${timing.p50.toFixed(1)}ms p95=${timing.p95.toFixed(1)}ms; socket-to-first-real-HQ-frame`,
        );
        expect(timing.samples).toHaveLength(5);
        // Wire arrival excludes UI scheduling; the readiness wait allows 15 s on a loaded laptop.
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

    // Targets today's per-Mate startup reads, which make a large organization slow and expensive.
    it.effect.fails("target: four-Mate startup uses at most twelve Zerops requests", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(names);
        const before = b.measure.platformRequests();
        yield* s.given.signedIn;
        yield* b.when.menuReady(names);
        yield* s.then.noExternalNetwork;
        const requests = b.measure.platformRequests() - before;
        report(`H target startup: ${requests} requests; target <=12`);
        reachedTargets.add("target: four-Mate startup uses at most twelve Zerops requests");
        expect(requests, "Startup must use units of Zerops requests").toBeLessThanOrEqual(12);
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
              const before = b.measure.registrations();
              yield* s.given.signedIn;
              yield* b.when.menuReady(inventory);
              counts.push(b.measure.registrations() - before);
              yield* s.then.noExternalNetwork;
            }),
          );
        }
        report(`H target registrations: 1 Mate=${counts[0]}, 4 Mates=${counts[1]}`);
        reachedTargets.add("target: menu registrations do not grow from one to four Mates");
        expect(
          counts[1],
          "Menu registration cost must be independent of Mate count",
        ).toBeLessThanOrEqual(counts[0]!);
      }),
    );

    // Targets retransmitting the whole unchanged HQ menu at every planned segment boundary.
    it.effect.fails("target: an unchanged next HQ segment transfers no state payload", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installBudget]);
        const b = budgets(s);
        yield* b.given.mates(["Ada", "Bea"]);
        yield* s.given.signedIn;
        yield* b.when.menuReady(["Ada", "Bea"]);
        yield* b.when.nextHqSegment;
        yield* s.then.menu.row("Shop").appears();
        yield* s.then.noExternalNetwork;
        const bytes = b.measure.hqSegments()[1]!.downBytes;
        report(`H target unchanged segment: ${bytes} payload bytes; target=0`);
        reachedTargets.add("target: an unchanged next HQ segment transfers no state payload");
        expect(bytes, "Unchanged HQ segment must not resend state").toBe(0);
      }),
    );
  });
});
