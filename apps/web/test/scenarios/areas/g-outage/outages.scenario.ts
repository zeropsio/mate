import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  givenOutage,
  reportsWork,
  menuSays,
  menuRowGone,
  caughtUp,
  cappedHqOutage,
  stallsHq,
  frozenMenuStillSays,
  checkpoint,
  showsWokenTab,
  stopHq,
  startHq,
  declareNewerProtocol,
  refuseHq,
  resumeTab,
  hqRefusalShown,
  retryHq,
} from "./dsl.ts";

describe("G: outages, sleep and several tabs", () => {
  scenarioSuite((it) => {
    // A replaced Core must resubscribe the open tab, including after backoff reaches its cap.
    it.effect("HQ restart and a new build recover the open tab without reloading", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        for (const build of [undefined, "redeployed-core"]) {
          yield* s.when.hq.socket.drops;
          yield* stopHq(s);
          yield* cappedHqOutage(s);
          yield* startHq(s, build);
          if (build !== undefined) yield* declareNewerProtocol(s);
          yield* s.when.hq.socket.returns;
          yield* Effect.promise(() => s.clock.advanceStepped(60_000));
          yield* caughtUp(s, "Shop");
        }
        yield* checkpoint(s);
      }),
    );
    // Returning input wakes backoff, but only a fresh HQ answer clears the header.
    for (const trigger of ["online", "focus", "visibilitychange"] as const)
      it.effect(`${trigger} recovers HQ during capped backoff without reloading`, () =>
        Effect.gen(function* () {
          const s = yield* givenOutage();
          yield* s.given.signedIn;
          yield* caughtUp(s, "Shop");
          yield* s.when.hq.socket.drops;
          yield* cappedHqOutage(s);
          yield* s.when.hq.socket.returns;
          yield* resumeTab(s, trigger);
          yield* caughtUp(s, "Shop");
          yield* checkpoint(s);
        }),
      );

    // A genuine refusal is shown as a refusal and incidental wake events cannot undo it.
    it.effect("HQ refusal says why and waits for an explicit retry", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* refuseHq(s);
        yield* hqRefusalShown(s);
        yield* retryHq(s);
        yield* caughtUp(s, "Shop");
        yield* checkpoint(s);
      }),
    );

    // Catches a laptop wake leaving the pre-sleep menu frozen after HQ changed while asleep.
    it.effect("wake after an hour reconciles an HQ change without reloading", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        const stalled = yield* stallsHq(s);
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop while stalled");
        yield* Effect.promise(() => stalled.waitForDownstream("Shop while stalled"));
        yield* Effect.promise(() => s.clock.advance(30_000));
        yield* menuRowGone(s.page, "Shop while stalled");
        yield* menuSays(s.page, "Shop");
        yield* Effect.promise(() => s.clock.sleep());
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop after wake");
        yield* Effect.promise(() => stalled.waitForDownstream("Shop after wake"));
        yield* frozenMenuStillSays(s, "Shop", "Shop after wake");
        yield* Effect.promise(() => s.clock.wake(3_600_000));
        yield* showsWokenTab(s);
        for (let step = 0; step < 5; step++) {
          yield* Effect.promise(() =>
            s.clock.advanceStepped(1_000, {
              settle: () =>
                s.page.evaluate(
                  () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
                ),
            }),
          );
        }
        yield* caughtUp(s, "Shop after wake");
        yield* checkpoint(s);
      }),
    );

    // Catches one signed-in tab missing a colleague's rename received by the other tab.
    it.effect("two tabs of one account both receive a live rename", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        const tab = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* tab.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* caughtUp(tab, "Shop");
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop in both tabs");
        yield* caughtUp(s, "Shop in both tabs");
        yield* caughtUp(tab, "Shop in both tabs");
        yield* tab.then.noReload;
        yield* checkpoint(s);
      }),
    );

    // Catches closing one tab tearing down the remaining tab's account or live subscriptions.
    it.effect("closing the second tab leaves the first receiving changes", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        const tab = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* tab.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* caughtUp(tab, "Shop");
        yield* Effect.promise(() => tab.page.close());
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop surviving tab");
        yield* caughtUp(s, "Shop surviving tab");
        yield* checkpoint(s);
      }),
    );

    // Catches an HQ outage erasing the last known task instead of retaining it as stale.
    it.effect("HQ down retains the last known task beside the catching-up indicator", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* reportsWork(s, "Ada", "Inspect checkout before outage");
        yield* s.given.signedIn;
        yield* menuSays(s.page, "Inspect checkout before outage");
        yield* s.when.hq.socket.drops;
        yield* s.then.hq.isUnavailable;
        yield* cappedHqOutage(s);
        yield* menuSays(s.page, "Inspect checkout before outage").pipe(
          Effect.ensuring(checkpoint(s)),
        );
        const placement = yield* Effect.promise(() =>
          s.page.evaluate(() => {
            const sidebar = [
              ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-menu"]'),
            ].find((node) => node.getBoundingClientRect().height > 0);
            const indicator = sidebar?.querySelector<HTMLElement>(
              '[data-zerops-surface="sidebar-hq-outage"]',
            );
            const menu = sidebar?.querySelector<HTMLElement>(
              '[data-zerops-surface="sidebar-environments"]',
            );
            const task = [
              ...(menu?.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-mate-snippet"]',
              ) ?? []),
            ].find((node) => node.textContent?.includes("Inspect checkout before outage"));
            if (indicator == null || task == null || sidebar == null)
              throw new Error("Task and catching-up indicator must both be drawn");
            const statusBox = indicator.getBoundingClientRect();
            const taskBox = task.getBoundingClientRect();
            const menuBox = sidebar.getBoundingClientRect();
            return {
              taskLine: task.textContent,
              sameMenu: task.closest('[data-zerops-surface="sidebar-menu"]') === sidebar,
              statusVisible: statusBox.width > 0 && statusBox.height > 0,
              taskVisible: taskBox.width > 0 && taskBox.height > 0,
              statusInside:
                statusBox.left >= menuBox.left &&
                statusBox.right <= menuBox.right &&
                statusBox.top >= menuBox.top &&
                statusBox.bottom <= menuBox.bottom,
              taskInside:
                taskBox.left >= menuBox.left &&
                taskBox.right <= menuBox.right &&
                taskBox.top >= menuBox.top &&
                taskBox.bottom <= menuBox.bottom,
              headerAboveTask: statusBox.bottom <= taskBox.top,
            };
          }),
        );
        expect(placement).toEqual({
          taskLine: expect.stringMatching(
            /^Last known .+: Ada was working on: Inspect checkout before outage$/u,
          ),
          sameMenu: true,
          statusVisible: true,
          taskVisible: true,
          statusInside: true,
          taskInside: true,
          headerAboveTask: true,
        });
      }),
    );
  });
});
