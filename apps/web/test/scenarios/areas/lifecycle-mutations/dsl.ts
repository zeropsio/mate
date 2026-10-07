import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import { expect } from "@effect/vitest";
import type { ScenarioDrivers } from "../../harness/scenario.ts";

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
        await page.locator(`::-p-aria(More for ${name})`).setTimeout(8000).click();
        await page.locator('[data-zerops-mate-menu="move"]').setTimeout(8000).click();
        await page
          .locator(`[data-zerops-surface="move-to-group-form"] label ::-p-text(${destination})`)
          .setTimeout(8000)
          .click();
        await page.waitForFunction(
          (name, destination) => {
            const review = document.querySelector<HTMLElement>(
              '[data-zerops-surface="move-review"]',
            );
            return review?.innerText.includes(name) && review.innerText.includes(destination);
          },
          { timeout: 8000, polling: "raf" },
          name,
          destination,
        );
        await page
          .locator('[data-zerops-surface="move-to-group-form"] button[type="submit"]')
          .setTimeout(8000)
          .click();
        await page.waitForSelector('[data-zerops-surface="move-to-group-form"]', {
          hidden: true,
          timeout: 8000,
        });
      }),
    placement: (name: string, app: string) =>
      Effect.promise(async () => {
        await page.bringToFront();
        await page.waitForFunction(
          (name, app) => {
            const headings = [
              ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-project"]'),
            ].filter((node) => node.getBoundingClientRect().height > 0);
            const rows = [
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-mate-name"]',
              ),
            ].filter(
              (row) => row.getBoundingClientRect().height > 0 && row.innerText.trim() === name,
            );
            if (rows.length !== 1) return false;
            const heading = headings.findLast(
              (heading) =>
                (heading.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING) !==
                0,
            );
            return heading?.innerText.split("\n")[0]?.trim() === app;
          },
          { timeout: 8000, polling: "raf" },
          name,
          app,
        );
      }),
  };
}
