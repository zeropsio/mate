import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { createScenario } from "../../harness/scenario.ts";
export { changeFixture } from "../../fakes/d-change/changes.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export function review(s: Pick<Scenario, "page" | "web">) {
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
          { timeout: 15_000, polling: "raf" },
          words,
        );
      } catch (error) {
        throw new Error(
          `Review missing: ${words}\n${await s.page.evaluate(() => document.body.innerText)}`,
          { cause: error },
        );
      }
    });
  const mergeEnabled = Effect.promise(async () => {
    try {
      await s.page.waitForFunction(
        () =>
          [...document.querySelectorAll<HTMLButtonElement>("button")].some(
            (button) =>
              button.innerText.trim().startsWith("Merge") &&
              !button.disabled &&
              button.getBoundingClientRect().height > 0,
          ),
        { timeout: 15_000, polling: "raf" },
      );
    } catch (error) {
      throw new Error(
        `Merge unavailable\n${await s.page.evaluate(() => document.body.innerText)}`,
        { cause: error },
      );
    }
  });
  return {
    text,
    mergeEnabled,
    open: Effect.promise(async () => {
      await s.page
        .locator('[data-zerops-surface="sidebar-pull-request-review"]')
        .setTimeout(15_000)
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
          { timeout: 15_000 },
          body,
        );
      }),
    close: Effect.promise(async () => {
      await s.page.keyboard.press("Escape");
      await s.page.waitForSelector('[data-zerops-surface="review"]', {
        hidden: true,
        timeout: 15_000,
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
