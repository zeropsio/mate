import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import { expect } from "@effect/vitest";
import type { ScenarioDrivers } from "../../harness/scenario.ts";
import { menuMateIn } from "../../harness/browser.ts";

export function originalMateRemains(drivers: ScenarioDrivers, projectId: string, name: string) {
  expect(drivers.zerops.requests.get(`PUT /project/${projectId}`)).toBe(1);
  expect(drivers.zerops.rows("project").find((row) => row.id === projectId)?.name).toBe(name);
}

export function mutations(page: Page) {
  return {
    focus: Effect.promise(() => page.bringToFront()),
    move: (name: string, destination: string) =>
      Effect.promise(async () => {
        await page.bringToFront();
        await page.locator(`::-p-aria(More for ${name})`).click();
        await page.locator('[data-zerops-mate-menu="move"]').click();
        await page
          .locator(`[data-zerops-surface="move-to-group-form"] label ::-p-text(${destination})`)
          .click();
        await page.waitForFunction(
          (name, destination) => {
            const review = document.querySelector<HTMLElement>(
              '[data-zerops-surface="move-review"]',
            );
            return review?.innerText.includes(name) && review.innerText.includes(destination);
          },
          { polling: "raf" },
          name,
          destination,
        );
        await page
          .locator('[data-zerops-surface="move-to-group-form"] button[type="submit"]')
          .click();
        await page.waitForSelector('[data-zerops-surface="move-to-group-form"]', {
          hidden: true,
        });
      }),
    placement: (name: string, app: string) =>
      Effect.promise(async () => {
        await page.bringToFront();
        await menuMateIn(page, name, app);
        const count = await page.evaluate(
          (name) =>
            [
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-mate-name"]',
              ),
            ].filter((row) => {
              const words = row.textContent?.replaceAll("\u00a0", " ").trim();
              return (
                row.getBoundingClientRect().height > 0 &&
                (words === name || words?.endsWith(` · ${name}`) === true)
              );
            }).length,
          name,
        );
        expect(count, `Mate ${name} must appear once in ${app}`).toBe(1);
      }),
  };
}
