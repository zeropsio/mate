import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { createScenario } from "../../harness/scenario.ts";
import { percentile } from "../../fakes/h-budget/traffic.ts";
import { budgetObservations } from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;
const sum = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);

export function budgets(s: Scenario) {
  const observation = budgetObservations(s.drivers);
  const platformRequests = () =>
    [...s.drivers.zerops.requests].reduce(
      (count, [key, value]) => count + (key.startsWith("OPTIONS ") ? 0 : value),
      0,
    );
  const registrations = () => sum(s.drivers.zerops.registrations);
  return {
    given: {
      mates: Effect.fn("budgets.given.mates")(function* (names: string[]) {
        for (const name of names) yield* s.given.project(name, { mate: true, app: "Shop" });
      }),
      fiveTabs: Effect.fn("budgets.given.fiveTabs")(function* () {
        const tabs = [s];
        for (let index = 1; index < 5; index++) {
          const tab = yield* s.given.browserActor({ context: s.page.browserContext() });
          // Only the primary actor needs the new-actor factory; the UI controls are identical.
          tabs.push({ ...s, ...tab, given: { ...s.given, ...tab.given } });
        }
        return tabs;
      }),
    },
    when: {
      opensMate: (name: string) =>
        Effect.promise(async () => {
          await s.page
            .locator(`[data-zerops-surface="sidebar-mate"] ::-p-text(${name})`)
            .setTimeout(15_000)
            .click();
          await s.page.waitForFunction(
            (threadId) => location.href.includes(threadId),
            { timeout: 15_000, polling: "raf" },
            s.drivers.mates.get(name)!.thread.id,
          );
          await observation.mateReady(name);
        }),
      hqFirstData: (count: number) => Effect.promise(() => observation.hq.firstData(count)),
      menuReady: Effect.fn("budgets.menuReady")(function* (names: string[]) {
        yield* s.then.menu.row("Shop").appears();
        for (const name of names) yield* s.then.menu.row(name).appears();
        yield* Effect.promise(() => observation.hq.firstData(1));
      }),
      nextHqSegment: Effect.promise(async () => {
        const next = observation.hq.segments.length + 1;
        observation.hq.endSegment();
        await observation.hq.firstData(next);
      }),
    },
    measure: {
      platformRequests,
      registrations,
      hqSegments: () => observation.hq.segments,
      firstData: (after = 0) => {
        const samples = observation.hq.segments.slice(after).map((segment) => {
          if (segment.firstDataMs === null) throw new Error("HQ segment has not served data");
          return segment.firstDataMs;
        });
        return { samples, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
      },
      doorVisits: (name: string) =>
        observation.mateHttp
          .get(name)!
          .filter(
            (request) =>
              request.startsWith("POST ") && request.includes("/api/auth/zerops-throwaway"),
          ).length,
      mateRpcs: (name: string) => s.drivers.mates.get(name)!.requests.length,
    },
    // oxlint-disable-next-line unicorn/no-thenable
    then: {
      unopenedMates: (names: string[]) =>
        Effect.sync(() => {
          for (const name of names)
            expect(s.drivers.mates.get(name)!.requests, `Unopened ${name} received RPCs`).toEqual(
              [],
            );
        }),
      composerEnabled: Effect.promise(async () => {
        await s.page.waitForFunction(
          () =>
            [...document.querySelectorAll<HTMLElement>('[role="textbox"]')].some(
              (editor) =>
                editor.getBoundingClientRect().height > 0 &&
                editor.isContentEditable &&
                editor.getAttribute("aria-disabled") !== "true",
            ),
          { timeout: 15_000, polling: "raf" },
        );
      }),
    },
  };
}
