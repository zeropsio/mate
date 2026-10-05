import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import { createScenario } from "../../harness/scenario.ts";
import { installArea, outageControls, reportsWork as reportWork, dropZerops } from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;
type Actor = Pick<Scenario, "page" | "clock" | "then">;

export const givenOutage = Effect.fn("outage.given")(function* () {
  const s = yield* createScenario([installArea]);
  yield* s.given.project("Ada", { mate: true, app: "Shop" });
  yield* Effect.promise(() => s.clock.install());
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
      { timeout: 10_000, polling: "raf" },
      words,
    );
  });

export const menuOmits = (page: Page, words: string) =>
  Effect.promise(async () => {
    await page.bringToFront();
    await page.waitForFunction(
      (words) =>
        [
          ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-environments"]'),
        ].every((element) => !element.innerText.includes(words)),
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

export const catchingUp = (actor: Actor) =>
  Effect.promise(async () => {
    await actor.page.waitForFunction(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-hq-outage"]'),
        ].some((element) => /Reconnecting|Updating|unavailable/.test(element.textContent ?? "")),
      { timeout: 10_000, polling: "raf" },
    );
  });

export const zeropsGoesDown = (s: Scenario) => dropZerops(s.drivers);

export const heartbeatsWithoutFacts = (s: Scenario) =>
  Effect.gen(function* () {
    const wire = outageControls(s.drivers);
    wire.silenceFacts();
    yield* s.when.hq.colleague.renamesProject("Shop", "Shop during lost updates");
    // Nine acknowledged heartbeats cover three 60-second silence windows in virtual browser time.
    for (let n = 0; n < 9; n++) {
      yield* Effect.promise(() => s.clock.advance(20_000));
      yield* Effect.promise(() => wire.ping());
    }
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
      { timeout: 10_000, polling: "raf" },
      words,
    );
  });
