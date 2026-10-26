import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { Page } from "puppeteer-core";
import type { createScenario } from "../../harness/scenario.ts";
import { openAccountMenu, showsText, visibleText } from "../../harness/browser.ts";
import { rendered } from "../../harness/completedHttp.ts";
import { deadline } from "../../harness/http.ts";
import { answerInZerops, openZeropsWindow } from "../../harness/deviceLogin.ts";
import {
  secondOrganization,
  endSessionCheck,
  everySocketRechecked,
  handoverCount,
} from "./fake.ts";

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
            button.innerText.includes("ACME"),
        ),
      { polling: "raf" },
    );
    const authorization = await page.$("::-p-aria(Continue with your Zerops account)");
    if (authorization) await authorization.click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some((button) =>
          button.innerText.includes("ACME"),
        ),
      { polling: "raf" },
    );
    if (await page.$('::-p-aria(ACME Owner[role="button"])'))
      await page.locator('::-p-aria(ACME Owner[role="button"])').click();
    await visibleText(page, "sidebar-account-organization", "ACME");
  });
});

export function account(page: Page) {
  const openMenu = () => openAccountMenu(page);
  return {
    showsOrganization: (name: string) =>
      Effect.promise(() => visibleText(page, "sidebar-account-organization", name)),
    showsPerson: (name: string) => Effect.promise(() => visibleText(page, "sidebar-account", name)),
    selectOrganization: (name: string) =>
      Effect.promise(async () => {
        await openMenu();
        await page.locator(`::-p-aria(${name}[role="menuitemradio"])`).click();
        await visibleText(page, "sidebar-account-organization", name);
      }),
    signOut: Effect.promise(async () => {
      await openMenu();
      await page.locator('::-p-aria(Sign out[role="menuitem"])').click();
    }),
    signedOut: Effect.promise(async () => {
      await page.locator('::-p-aria(Continue with your Zerops account[role="button"])').wait();
      expect(await page.$('[data-zerops-surface="sidebar-account"]')).toBeNull();
      expect(await page.$('[data-zerops-surface="sidebar-environments"]')).toBeNull();
      expect(await page.$('[role="textbox"]')).toBeNull();
    }),
    needsAdministrator: (core: Scenario["drivers"]["core"]["kind"]) =>
      Effect.promise(async () => {
        const notices = {
          "in-process": "An admin sets up HQ for this organization.",
          external:
            "An Owner or Admin of this organization must sign in to Mate first. Then try again.",
        };
        await page.waitForFunction(
          (notices) => notices.some((notice) => document.body.innerText.includes(notice)),
          { polling: "raf" },
          Object.values(notices),
        );
        expect(
          await page.evaluate(() => document.body.innerText),
          "ASSERTION: the selected organization shows its HQ's administrator requirement",
        ).toContain(notices[core]);
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
          { polling: "raf" },
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
  fault: "outage" | "expiry" | "refusal",
) {
  yield* Effect.promise(() => s.hq.ready());
  yield* Effect.promise(() => endSessionCheck(s.drivers, [...s.hq.links.values()], fault));
});

/** HQ looks at every socket's session again, and every one stays open. */
export const hqKeepsEverySession = Effect.fn("signin.hqKeepsEverySession")(function* (s: Scenario) {
  yield* Effect.promise(() => everySocketRechecked(s.drivers, s.hq.links));
});

export const retryHq = Effect.fn("signin.retryHq")(function* (s: Scenario) {
  yield* Effect.promise(() =>
    s.page.locator('button[data-zerops-surface="sidebar-hq-outage"]').click(),
  );
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
    // Each look follows a renderer turn, so what the advance changed is drawn.
    for (let step = 0; step < 12; step++) {
      await s.clock.advanceStepped(10_000, { settle });
      await rendered(s.page);
      if (await showsText(s.page, "sidebar-environments", name)) return;
    }
    await visibleText(s.page, "sidebar-environments", name);
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

/** Device login from the landing: the Zerops window, what the person does there, what Mate says. */
export function zeropsWindow(s: Scenario, page: Page = s.page) {
  const deviceLogin = s.drivers.zerops.deviceLogin;
  return {
    /** Clicks `button` on Mate's side; the window it opens, routed and on the consent page. */
    opens: (button: string) =>
      Effect.promise(() => openZeropsWindow(s.web, s.drivers.zerops, page, button)),
    answers: (window: Page, decision: "Approve" | "Deny") =>
      Effect.promise(() => answerInZerops(window, decision)),
    /** The consent page the last window was pointed at: the API's link and this client's asks. */
    lastConsentPage: Effect.sync(() => {
      const shown = deviceLogin.consentPages.at(-1);
      if (!shown) throw new Error("No consent page was shown");
      return shown;
    }),
    says: (text: string) =>
      Effect.promise(() =>
        page.waitForFunction(
          (text) => document.body.innerText.includes(text),
          {
            polling: "raf",
          },
          text,
        ),
      ),
    /** The browser's popup blocker: the page's window opens nothing. */
    blocksPopups: Effect.promise(() =>
      page.evaluate(() => {
        window.open = () => null;
      }),
    ),
  };
}

/** Every address this tab's history holds, oldest first: what Back and Forward would open again. */
export const historyAddresses = (page: Page) =>
  Effect.promise(async () => {
    const session = await page.createCDPSession();
    try {
      const { entries } = await session.send("Page.getNavigationHistory");
      return entries.map((entry) => entry.url);
    } finally {
      await session.detach();
    }
  });

/** A Mate's vault, from its conversation's right panel. */
export function vault(page: Page) {
  return {
    opens: Effect.promise(async () => {
      await page.locator("::-p-aria(Toggle right panel)").click();
      await page.locator('[aria-label="Open a page"] ::-p-text(Vault)').click();
    }),
    /** Opens the value's row and asks Zerops to show it. */
    shows: (key: string) =>
      Effect.promise(async () => {
        await page.locator(`[data-vault-row="${key}"] > button`).click();
        await page.locator(`[data-vault-row="${key}"] ::-p-aria(Show[role="button"])`).click();
      }),
    /** The value as the row shows it, once shown in the clear. */
    showsValue: (key: string, value: string) =>
      Effect.promise(() =>
        page.waitForFunction(
          (key, value) =>
            [
              ...document.querySelectorAll<HTMLInputElement>(`[data-vault-row="${key}"] input`),
            ].some((input) => input.type === "text" && input.value === value),
          { polling: "raf" },
          key,
          value,
        ),
      ),
  };
}
