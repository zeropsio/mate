import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { createScenario } from "../../harness/scenario.ts";
export { changeFixture, anotherOrganization } from "../../fakes/d-change/changes.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export function review(s: Pick<Scenario, "page" | "web">) {
  let guardedDocument: number | undefined;
  const text = (words: string) =>
    Effect.promise(async () => {
      try {
        await s.page.waitForFunction(
          (words) =>
            [
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="review"], [role="dialog"]',
              ),
            ].some(
              (node) => node.getBoundingClientRect().height > 0 && node.innerText.includes(words),
            ),
          { timeout: s.page.getDefaultTimeout(), polling: "raf" },
          words,
        );
      } catch (error) {
        throw new Error(
          `Review missing: ${words}\n${await s.page.evaluate(() => document.body.innerText)}`,
          { cause: error },
        );
      }
    });
  const waitUntilMergeEnabled = async () => {
    try {
      await s.page.waitForFunction(
        () =>
          [...document.querySelectorAll<HTMLButtonElement>("button")].some(
            (button) =>
              button.innerText.trim().startsWith("Merge") &&
              !button.disabled &&
              button.getBoundingClientRect().height > 0,
          ),
        { timeout: s.page.getDefaultTimeout(), polling: "raf" },
      );
    } catch (error) {
      throw new Error(
        `Merge unavailable\n${await s.page.evaluate(() => document.body.innerText)}`,
        { cause: error },
      );
    }
  };
  const mergeEnabled = Effect.promise(waitUntilMergeEnabled);
  return {
    text,
    mergeEnabled,
    waitUntilMergeEnabled,
    chooseInitialOrganization: (name: string) =>
      Effect.promise(async () => {
        await s.page.locator("::-p-text(Choose an organization)").wait();
        await s.page.locator(`::-p-text(${name})`).click();
      }),
    switchOrganization: (name: string) =>
      Effect.promise(async () => {
        await s.page.locator('[data-zerops-surface="sidebar-account"]').click();
        await s.page.locator(`::-p-aria(${name}[role="menuitemradio"])`).click();
        await s.page.waitForFunction(
          (name) =>
            [
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-account-organization"]',
              ),
            ].some(
              (node) => node.getBoundingClientRect().height > 0 && node.innerText.trim() === name,
            ),
          { timeout: s.page.getDefaultTimeout(), polling: "raf" },
          name,
        );
      }),
    rememberUnknownPermission: Effect.promise(async () => {
      guardedDocument = await s.page.evaluate(() => {
        const history: string[] = [];
        Object.assign(window, { dChangeUnknownOffers: history });
        let visible = false;
        const check = () => {
          const shown = [
            ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="review"]'),
          ].some(
            (node) =>
              node.getBoundingClientRect().height > 0 &&
              node.innerText.includes("HQ has not said yet"),
          );
          if (shown && !visible) history.push("HQ has not said yet");
          visible = shown;
        };
        new MutationObserver(check).observe(document, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        check();
        return performance.timeOrigin;
      });
    }),
    sameDocument: Effect.promise(async () => {
      expect(await s.page.evaluate(() => performance.timeOrigin)).toBe(guardedDocument);
    }),
    unknownPermissionHistory: Effect.promise(() =>
      s.page.evaluate(
        () => (window as unknown as { dChangeUnknownOffers: string[] }).dChangeUnknownOffers,
      ),
    ),
    open: Effect.promise(async () => {
      await s.page
        .locator('[data-zerops-surface="sidebar-pull-request-review"]')

        .click();
    }),
    direct: (path: string) =>
      Effect.promise(async () => {
        await s.page.goto(s.web.origin + path);
      }),
    comment: (body: string) =>
      Effect.promise(async () => {
        await s.page.locator("::-p-aria(Say something on this change)").fill(body);
        await s.page.locator('::-p-aria(Comment[role="button"])').click();
      }),
    writeDraft: (body: string) =>
      Effect.promise(async () => {
        await s.page.locator("::-p-aria(Say something on this change)").fill(body);
      }),
    draftIs: (body: string) =>
      Effect.promise(async () => {
        await s.page.waitForFunction(
          (body) =>
            [
              ...document.querySelectorAll<HTMLTextAreaElement>(
                '[aria-label="Say something on this change"]',
              ),
            ].some((box) => box.value === body),
          { timeout: s.page.getDefaultTimeout() },
          body,
        );
      }),
    close: Effect.promise(async () => {
      await s.page.keyboard.press("Escape");
      await s.page.waitForSelector('[data-zerops-surface="review"]', {
        hidden: true,
        timeout: s.page.getDefaultTimeout(),
      });
    }),
    merge: Effect.promise(async () => {
      await s.page.locator('::-p-aria(Merge[role="button"])').click();
    }),
    cannotMerge: Effect.promise(async () => {
      expect(
        await s.page.evaluate(() =>
          [...document.querySelectorAll<HTMLButtonElement>("button")].some(
            (button) =>
              button.innerText.trim().startsWith("Merge") &&
              !button.disabled &&
              button.getBoundingClientRect().height > 0,
          ),
        ),
      ).toBe(false);
    }),
  };
}
