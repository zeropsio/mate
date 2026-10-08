import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import { startCore, untilHealth } from "../../../../../hq/test/harness/runningCore.ts";
import { createScenario } from "../../harness/scenario.ts";
import {
  installArea,
  outageControls,
  reportsWork as reportWork,
  dropZerops,
  refusedHqRetry,
  refusedZeropsRetry,
  installSilentSleep,
  stallSleepSocket,
  newerHqProtocol,
  endHqStream,
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

export const stopHq = (s: Scenario) => s.drivers.core.stop;

export const declareNewerProtocol = (s: Scenario) => Effect.sync(() => newerHqProtocol(s.drivers));
export const endHqSession = (s: Scenario) => Effect.sync(() => endHqStream(s.drivers, 4401));
export const refuseHq = (s: Scenario) => Effect.sync(() => endHqStream(s.drivers, 4403));
export const resumeTab = (s: Scenario, trigger: "online" | "focus" | "visibilitychange") =>
  Effect.promise(() =>
    s.page.evaluate((trigger) => {
      (trigger === "visibilitychange" ? document : window).dispatchEvent(new Event(trigger));
    }, trigger),
  );

export const hqRefusalShown = (s: Scenario) =>
  Effect.promise(() =>
    s.page.waitForFunction(
      () => {
        const line = document.querySelector('[data-zerops-surface="sidebar-hq-outage"]');
        return (
          line?.textContent?.includes("Zerops refused HQ's access") === true &&
          !line.textContent.includes("not reachable")
        );
      },
      { timeout: 10_000, polling: "raf" },
    ),
  );

export const retryHq = (s: Scenario) =>
  Effect.promise(() => s.page.click('[data-zerops-surface="sidebar-hq-outage"]'));

export const startHq = Effect.fn("outage.startHq")(function* (s: Scenario, build?: string) {
  const previous = s.drivers.core;
  const core = yield* startCore(true, {
    zeropsHttp: { baseUrl: `${s.drivers.zerops.origin}/api/rest/public`, world: previous.fake },
    url: previous.url,
    gitRoot: previous.gitRoot,
    storeDir: previous.storeDir,
    stagingDir: previous.stagingDir,
    ...(build === undefined ? {} : { build }),
  });
  yield* untilHealth(core.call, "active");
  s.drivers.core = core;
  s.drivers.hq.replaceCore(core.origin);
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
      { timeout: 10_000, polling: "raf" },
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
      { timeout: 10_000, polling: "raf" },
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
        { timeout: 10_000, polling: "raf" },
      ),
    );
  });

export const cappedHqOutage = (s: Scenario) =>
  Effect.gen(function* () {
    yield* s.then.hq.isUnavailable;
    for (let attempt = 0; attempt < 8; attempt++) {
      const capped = yield* Effect.promise(() =>
        s.page.evaluate(
          () =>
            document
              .querySelector('[data-zerops-surface="sidebar-hq-outage"]')
              ?.textContent?.includes("Retrying every minute.") === true,
        ),
      );
      if (capped) return;
      const receipt = refusedHqRetry(s.page);
      yield* Effect.promise(() => s.clock.advance(30_000));
      yield* Effect.promise(() => receipt);
      yield* Effect.promise(() =>
        s.page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        ),
      );
    }
    throw new Error("HQ never reached its capped outage state after eight 30-second retry rounds");
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
      { timeout: 10_000, polling: "raf" },
    );
  });

export const lastingZeropsOutage = (s: Scenario) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 8; attempt++) {
      const shown = yield* Effect.promise(() =>
        s.page.evaluate(
          () =>
            document
              .querySelector<HTMLElement>('[data-zerops-surface="sidebar-account-line"]')
              ?.innerText.includes("Zerops isn't answering. Trying again…") === true,
        ),
      );
      if (shown) return;
      const receipt = refusedZeropsRetry(s.page);
      yield* Effect.promise(() => s.clock.advance(30_000));
      yield* Effect.promise(() => receipt);
      yield* Effect.promise(() =>
        s.page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        ),
      );
    }
    throw new Error("Zerops never showed its catching-up line after eight 30-second retry rounds");
  });

export const newSegmentWithoutSnapshot = (s: Scenario) =>
  Effect.promise(() => outageControls(s.drivers).nextSegmentWithoutSnapshot());

export const heartbeatsWithoutSnapshot = (s: Scenario) =>
  Effect.gen(function* () {
    // A responding transport cannot extend the scope's 20-second catchup deadline.
    for (let n = 0; n < 3; n++) {
      yield* Effect.promise(() => s.clock.advance(5_000));
      yield* Effect.promise(() => outageControls(s.drivers).ping());
    }
    yield* Effect.promise(() => s.clock.advance(5_000));
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
    await s.page.waitForFunction(() => !document.hidden, { timeout: 10_000, polling: "raf" });
  });

export const opensMate = (s: Scenario) =>
  Effect.promise(async () => {
    await s.page.bringToFront();
    await s.page.locator('[data-zerops-surface="sidebar-mate"]').setTimeout(10_000).click();
  });

export const messageAppears = (s: Scenario, words: string) =>
  Effect.promise(async () => {
    await s.drivers.mates.get("Ada")!.conversation.waitForMessage(words);
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
      { timeout: 10_000, polling: "raf" },
      words,
    );
  });
