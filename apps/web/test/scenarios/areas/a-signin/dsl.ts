import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import type { createScenario } from "../../harness/scenario.ts";
import { visibleText } from "../../harness/browser.ts";
import { secondOrganization, endSessionCheck } from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export const signInOrganization = Effect.fn("signin.chooseOrganization")(function* (
  s: Scenario,
  page: Page = s.page,
) {
  yield* Effect.promise(async () => {
    s.web.setPerson(page, "personal");
    await s.web.setRoutes();
    await page.goto(s.web.origin);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some(
          (button) =>
            button.innerText.trim() === "Continue with your Zerops account" ||
            button.innerText.includes("KRLS"),
        ),
      { timeout: 10_000, polling: "raf" },
    );
    const authorization = await page.$("::-p-aria(Continue with your Zerops account)");
    if (authorization) await authorization.click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some((button) =>
          button.innerText.includes("KRLS"),
        ),
      { timeout: 10_000, polling: "raf" },
    );
    if (await page.$('::-p-aria(KRLS Owner[role="button"])'))
      await page.locator('::-p-aria(KRLS Owner[role="button"])').click();
    await visibleText(page, "sidebar-account", "KRLS");
  });
});

export function account(page: Page) {
  const openMenu = async () => {
    await page.locator('[data-zerops-surface="sidebar-account"]').click();
  };
  return {
    showsOrganization: (name: string) =>
      Effect.promise(() => visibleText(page, "sidebar-account", name)),
    showsPerson: (name: string) => Effect.promise(() => visibleText(page, "sidebar-account", name)),
    selectOrganization: (name: string) =>
      Effect.promise(async () => {
        await openMenu();
        await page.locator(`::-p-aria(${name}[role="menuitemradio"])`).click();
        await visibleText(page, "sidebar-account", name);
      }),
    needsAdministrator: Effect.promise(async () => {
      await page.waitForFunction(
        () => document.body.innerText.includes("An admin sets up Mate for this organization."),
        { polling: "raf", timeout: 10_000 },
      );
    }),
    reload: Effect.promise(async () => {
      await page.reload();
    }),
    lacksRows: (names: string[]) =>
      Effect.promise(async () => {
        await page.waitForFunction(
          (names) => {
            const rows = new Set(
              [
                ...document.querySelectorAll<HTMLElement>(
                  '[data-zerops-surface="sidebar-environments"]',
                ),
              ].flatMap((element) => element.innerText.split("\n").map((line) => line.trim())),
            );
            return names.every((name) => !rows.has(name));
          },
          { polling: "raf", timeout: 10_000 },
          names,
        );
      }),
  };
}

/** An existing HQ organization and a read-only membership where HQ has not been set up. */
export const organizations = Effect.fn("signin.organizations")(function* (s: Scenario) {
  secondOrganization(s.drivers);
  s.given.person("owner", { orgId: "OTHER", role: "READ_ONLY" });
  yield* s.given.project("Ada", { mate: true, app: "Shop" });
});

export const sessionEnds = Effect.fn("signin.sessionEnds")(function* (
  s: Scenario,
  fault: "outage" | "expiry",
) {
  yield* Effect.promise(() => s.hq.ready());
  yield* Effect.promise(() => endSessionCheck(s.drivers, [...s.hq.links.values()], fault));
  yield* s.then.hq.isUnavailable;
});

export const retryHq = Effect.fn("signin.retryHq")(function* (s: Scenario) {
  yield* Effect.promise(() => s.page.locator('[data-zerops-surface="sidebar-hq-outage"]').click());
});
