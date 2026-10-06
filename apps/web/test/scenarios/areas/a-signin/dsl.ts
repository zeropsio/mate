import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { Page } from "puppeteer-core";
import type { createScenario } from "../../harness/scenario.ts";
import { visibleText } from "../../harness/browser.ts";
import { deadline } from "../../harness/http.ts";
import { secondOrganization, endSessionCheck, handoverCount } from "./fake.ts";

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
      { timeout: page.getDefaultTimeout(), polling: "raf" },
    );
    const authorization = await page.$("::-p-aria(Continue with your Zerops account)");
    if (authorization) await authorization.click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some((button) =>
          button.innerText.includes("KRLS"),
        ),
      { timeout: page.getDefaultTimeout(), polling: "raf" },
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
    showsPerson: (name: string, reason = "Signed-in account menu missing") =>
      Effect.promise(async () => {
        try {
          await visibleText(page, "sidebar-account", name);
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
          throw new Error(
            `${reason}: ${name}\n${await page.evaluate(() => document.body.innerText)}`,
            { cause: error },
          );
        }
      }),
    selectOrganization: (name: string) =>
      Effect.promise(async () => {
        await openMenu();
        await page.locator(`::-p-aria(${name}[role="menuitemradio"])`).click();
        await visibleText(page, "sidebar-account", name);
      }),
    signOut: Effect.promise(async () => {
      await openMenu();
      await page.locator('::-p-aria(Sign out[role="menuitem"])').click();
    }),
    signedOut: Effect.promise(async () => {
      await page
        .locator('::-p-aria(Continue with your Zerops account[role="button"])')

        .wait();
      expect(await page.$('[data-zerops-surface="sidebar-account"]')).toBeNull();
      expect(await page.$('[data-zerops-surface="sidebar-environments"]')).toBeNull();
      expect(await page.$('[role="textbox"]')).toBeNull();
    }),
    needsAdministrator: Effect.promise(async () => {
      await page.waitForFunction(
        () => document.body.innerText.includes("An admin sets up Mate for this organization."),
        { polling: "raf", timeout: page.getDefaultTimeout() },
      );
    }),
    reload: Effect.promise(async () => {
      await page.reload();
    }),
    /** The account opened in the document the hand-over returned to, with no load after it. */
    openedInTheHandoverDocument: Effect.promise(async () => {
      const loaded = await page.evaluate(
        () => new URL(performance.getEntriesByType("navigation")[0]?.name ?? "").pathname,
      );
      expect(loaded, "The document reloaded after the hand-over").toMatch(/\/zerops\/authorized$/);
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
          { polling: "raf", timeout: page.getDefaultTimeout() },
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
});

export const retryHq = Effect.fn("signin.retryHq")(function* (s: Scenario) {
  yield* Effect.promise(() =>
    s.page
      .locator('::-p-aria([role="button"])')
      .filter(
        (element) =>
          element.textContent?.includes("HQ") === true && element.textContent.includes("Try again"),
      )

      .click(),
  );
});

/** A future self-renewal must not make the existing manual recovery path fail its setup. */
export const renewHq = Effect.fn("signin.renewHq")(function* (s: Scenario, name: string) {
  const outcome = yield* Effect.promise(async () => {
    const condition = await s.page.waitForFunction(
      (name) => {
        const renewed = [
          ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-environments"]'),
        ].some(
          (element) =>
            element.getBoundingClientRect().height > 0 &&
            element.innerText.split("\n").some((line) => line.trim() === name),
        );
        if (renewed) return "renewed";
        const retry = [
          ...document.querySelectorAll<HTMLButtonElement>('button, [role="button"]'),
        ].some(
          (element) =>
            element.getBoundingClientRect().height > 0 &&
            element.textContent?.includes("HQ") &&
            element.textContent.includes("Try again"),
        );
        return retry ? "retry" : false;
      },
      { timeout: s.page.getDefaultTimeout(), polling: "raf" },
      name,
    );
    try {
      return await condition.jsonValue();
    } finally {
      await condition.dispose();
    }
  });
  if (outcome === "retry") yield* retryHq(s);
});

export function unchangedHandovers(s: Scenario) {
  return Effect.sync(() => {
    const before = handoverCount(s.drivers);
    expect(before, "Initial sign-in must use the real account hand-over").toBe(1);
    return () =>
      Effect.sync(() =>
        expect(handoverCount(s.drivers), "Account hand-over repeated without a user sign-in").toBe(
          before,
        ),
      );
  });
}

export const allowHqRetries = Effect.fn("signin.allowHqRetries")(function* (
  s: Scenario,
  name: string,
  settle: () => Promise<void>,
) {
  yield* Effect.promise(async () => {
    for (let step = 0; step < 12; step++) {
      await s.clock.advanceStepped(10_000, { settle });
      try {
        await visibleText(s.page, "sidebar-environments", name, 1_000);
        return;
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
      }
    }
  });
});

/** How long after `from()` the page first has an answer from HQ's API (its door or a ticket). */
export function firstHqAnswer(page: Page) {
  let start: number | undefined;
  let answered: (ms: number) => void = () => undefined;
  let answer = new Promise<number>(() => undefined);
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (
      start !== undefined &&
      (path.endsWith("/api/door") || path.endsWith("/api/stream-ticket"))
    ) {
      answered(performance.now() - start);
      start = undefined;
    }
  });
  return {
    from: () => {
      start = performance.now();
      answer = new Promise<number>((resolve) => {
        answered = resolve;
      });
    },
    ms: Effect.promise(() => deadline(answer, "HQ's first answer to the page")),
  };
}
