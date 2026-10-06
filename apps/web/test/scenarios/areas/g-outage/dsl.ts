import * as Effect from "effect/Effect";
import { STREAM_POLICY } from "../../../../../../packages/client-runtime/src/data/streamMachine.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "@t3tools/client-runtime/zerops/data";
import type { Page } from "puppeteer-core";
import { createScenario } from "../../harness/scenario.ts";
import {
  installArea,
  outageControls,
  reportsWork as reportWork,
  dropZerops,
  installSilentSleep,
  stallSleepSocket,
} from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;
type Actor = Pick<Scenario, "page" | "clock" | "then">;

export const givenOutage = Effect.fn("outage.given")(function* () {
  const s = yield* createScenario([installArea]);
  yield* s.given.project("Ada", { mate: true, app: "Shop" });
  yield* Effect.promise(() => s.clock.install());
  yield* Effect.promise(() => installSilentSleep(s.page));
  return s;
});

export const reportsWork = (s: Scenario, name: string, subject: string, question?: string) =>
  reportWork(s.drivers, name, subject, question);

export const menuSays = (page: Page, words: string) =>
  Effect.promise(async () => {
    await page.bringToFront();
    await page.waitForFunction(
      (words) =>
        [
          ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-environments"]'),
        ].some(
          (element) =>
            element.getBoundingClientRect().height > 0 && element.innerText.includes(words),
        ),
      { timeout: page.getDefaultTimeout(), polling: "raf" },
      words,
    );
  });

export const menuRowGone = (page: Page, name: string) =>
  Effect.promise(async () => {
    await page.bringToFront();
    await page.waitForFunction(
      (name) =>
        [
          ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-environments"]'),
        ].every((element) => element.innerText.split("\n").every((line) => line.trim() !== name)),
      { timeout: page.getDefaultTimeout(), polling: "raf" },
      name,
    );
  });

export const caughtUp = (actor: Actor, name: string) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => actor.page.bringToFront());
    yield* menuSays(actor.page, name);
    yield* Effect.promise(() =>
      actor.page.waitForFunction(
        () => !document.querySelector('[data-zerops-surface="sidebar-hq-outage"]'),
        { timeout: actor.page.getDefaultTimeout(), polling: "raf" },
      ),
    );
  });

export const cappedHqOutage = (s: Scenario) =>
  Effect.gen(function* () {
    yield* s.then.hq.isUnavailable;
    yield* Effect.promise(() =>
      s.clock.advanceUntil(
        () =>
          s.page.evaluate(
            () =>
              document
                .querySelector('[data-zerops-surface="sidebar-hq-outage"]')
                ?.textContent?.includes("Retrying every minute.") === true,
          ),
        "HQ capped retry indicator",
        STREAM_POLICY.backoffCapMs,
      ),
    );
  });

export const zeropsGoesDown = (s: Scenario) => dropZerops(s.drivers);

export const zeropsCatchesUp = (s: Scenario) =>
  Effect.promise(async () => {
    await s.page.waitForFunction(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-account-line"]'),
        ].some(
          (element) =>
            element.getBoundingClientRect().height > 0 &&
            element.innerText.includes("Zerops isn't answering. Trying again…"),
        ),
      { timeout: s.page.getDefaultTimeout(), polling: "raf" },
    );
  });

export const lastingZeropsOutage = (s: Scenario) =>
  Effect.promise(() =>
    s.clock.advanceUntil(
      () =>
        s.page.evaluate(
          () =>
            document
              .querySelector<HTMLElement>('[data-zerops-surface="sidebar-account-line"]')
              ?.innerText.includes("Zerops isn't answering. Trying again…") === true,
        ),
      "Zerops catching-up indicator",
      Math.max(...DEFAULT_ZEROPS_GRANT_POLICY.renewalRetryMs),
    ),
  );

export const newSegmentWithoutSnapshot = (s: Scenario) =>
  Effect.promise(() => outageControls(s.drivers).nextSegmentWithoutSnapshot());

export const heartbeatsWithoutSnapshot = (s: Scenario) =>
  Effect.gen(function* () {
    // Nine acknowledged heartbeats in the NEW segment span 180 seconds of virtual browser time.
    for (let n = 0; n < 9; n++) {
      yield* Effect.promise(() => s.clock.advance(20_000));
      yield* Effect.promise(() => outageControls(s.drivers).ping());
    }
  });

export const stallsHq = (s: Scenario) =>
  Effect.gen(function* () {
    const stalled = yield* Effect.promise(() => outageControls(s.drivers).stall());
    yield* Effect.promise(() => stallSleepSocket(s.page));
    return stalled;
  });

export const frozenMenuStillSays = (s: Scenario, name: string, absent: string) =>
  Effect.promise(async () => {
    const words = await s.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-environments"]')]
        .map((element) => element.innerText)
        .join("\n"),
    );
    if (!words.split("\n").includes(name) || words.includes(absent))
      throw new Error("Stalled HQ recovered before the laptop woke");
  });

export const corruptMate = (s: Scenario, name: string) =>
  Effect.sync(() => outageControls(s.drivers).corruptMate(name));

export const checkpoint = (s: Scenario) => Effect.all([s.then.noReload, s.then.noExternalNetwork]);

/** Chrome lifecycle thaw leaves a headless renderer hidden; model the person returning to it. */
export const showsWokenTab = (s: Scenario) =>
  Effect.promise(async () => {
    const cdp = await s.page.createCDPSession();
    s.drivers.cleanup.push(() => cdp.detach());
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await s.page.waitForFunction(() => !document.hidden, {
      timeout: s.page.getDefaultTimeout(),
      polling: "raf",
    });
  });

export const opensMate = (s: Scenario) =>
  Effect.promise(async () => {
    await s.page.bringToFront();
    await s.page.locator('[data-zerops-surface="sidebar-mate"]').click();
  });

export const messageAppears = (s: Scenario, words: string) =>
  Effect.promise(async () => {
    await s.drivers.mates.get("Ada")!.waitForMessage(words);
    await s.page.waitForFunction(
      (words) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const element = node.parentElement;
          if (
            node.textContent === words &&
            element &&
            !element.closest('[role="textbox"]') &&
            element.getBoundingClientRect().height > 0
          )
            return true;
        }
        return false;
      },
      { timeout: s.page.getDefaultTimeout(), polling: "raf" },
      words,
    );
  });
