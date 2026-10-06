import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { createScenario } from "../../harness/scenario.ts";
import { percentile, observeTabConnections } from "../../fakes/h-budget/traffic.ts";
import type { Page } from "puppeteer-core";
import { budgetObservations } from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export function budgets(s: Scenario) {
  const observation = budgetObservations(s.drivers);
  return {
    given: {
      mates: Effect.fn("budgets.given.mates")(function* (names: string[]) {
        for (const name of names) yield* s.given.project(name, { mate: true, app: "Shop" });
      }),
      /** The Mates' containers ACTIVE with their address not turned on. */
      addressesOff: Effect.sync(() => {
        for (const row of s.drivers.zerops.rows("service-stack"))
          if (row.name === "zcp")
            s.drivers.zerops.put("service-stack", { ...row, subdomainAccess: false });
      }),
      /** The app's stage and production, each a project of its own, as the menu's chips stand for. */
      stops: Effect.fn("budgets.given.stops")(function* (app: string) {
        yield* s.given.project("Staging", { kind: "stage", app });
        yield* s.given.project("Production", { kind: "production", app });
      }),
      plainProjects: Effect.fn("budgets.given.plainProjects")(function* (names: string[]) {
        for (const name of names) yield* s.given.project(name);
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
      observeTabConnections: (pages: Page[]) =>
        Effect.acquireRelease(
          Effect.promise(() => observeTabConnections(pages, observation.hq.origin)),
          (connections) => Effect.promise(() => connections.close()),
        ),
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
      browserSettled: Effect.promise(() => observation.browser.settled()),
      hqStateSettled: Effect.promise(() => observation.hq.stateSettled()),
      menuReady: Effect.fn("budgets.menuReady")(function* (names: string[]) {
        yield* s.then.menu.row("Shop").appears();
        for (const name of names) yield* s.then.menu.row(name).appears();
        yield* Effect.promise(() => observation.hq.firstData(1));
      }),
      nextHqSegment: Effect.promise(async () => {
        const next = observation.hq.segments.length + 1;
        observation.hq.endSegment();
        await observation.hq.opened(next);
      }),
    },
    measure: {
      browser: observation.browser.sample,
      /** One project's process history read, `GET /project/{id}/process`, and its preflight. */
      projectHistoryReads: () =>
        observation.browser.matching(/^(GET|OPTIONS) \/project\/[^/]+\/process(\?|$)/u),
      /** One project's own services read, `GET /project/{id}/service-stack`, and its preflight. */
      projectServiceReads: () =>
        observation.browser.matching(/^(GET|OPTIONS) \/project\/[^/]+\/service-stack(\?|$)/u),
      /** Projects' own rows, `GET /project/{id}`, and their preflights; never the search's. */
      projectReads: (ids?: ReadonlyArray<string>) =>
        observation.browser.matching(
          ids === undefined
            ? /^(GET|OPTIONS) \/project\/(?!search(\?|$))[^/?]+(\?|$)/u
            : new RegExp(`^(GET|OPTIONS) /project/(${ids.join("|")})(\\?|$)`, "u"),
        ),
      /** One project's public HTTP routing, `GET /project/{id}/public-http-routing`, and its preflight. */
      projectRoutingReads: () =>
        observation.browser.matching(/^(GET|OPTIONS) \/project\/[^/]+\/public-http-routing(\?|$)/u),
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
