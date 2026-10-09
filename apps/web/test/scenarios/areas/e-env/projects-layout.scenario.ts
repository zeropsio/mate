import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixtureWith } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

describe("Projects layout", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("Projects keeps production and release history readable on desktop and phone", () =>
      Effect.gen(function* () {
        const f = yield* environmentFixtureWith({}, { stage: false });
        const a = environmentActions(f);
        yield* f.merge();
        yield* f.release("v0.1.0");
        yield* a.when.finish("production");
        yield* f.merge(
          "Improve the storefront checkout with a readable confirmation and delivery summary",
        );
        yield* f.release("v0.2.0");
        yield* a.when.finish("production");
        const changeTitle =
          "Explain the delivery schedule and confirmation details for every storefront checkout";
        yield* f.change(changeTitle);
        yield* f.s.given.signedIn;
        yield* Effect.promise(async () => {
          const page = f.s.page;
          await page.goto(`${f.s.web.origin}/zerops`);
          const rowSelector = `[data-zerops-surface="project-rows"] [data-zerops-group="${f.appId}"]`;
          const row = await page.waitForSelector(rowSelector);
          expect(row).not.toBeNull();
          await page.locator(`${rowSelector} [data-zerops-row-toggle]`).click();
          await page.waitForSelector(`${rowSelector} [data-zerops-release-history]`);
          await page.waitForSelector(`${rowSelector} [data-zerops-surface="pull-request-title"]`);
          for (const width of [1786, 390]) {
            await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
            await page.waitForSelector(`${rowSelector} [aria-label="Production runs v0.2.0"]`, {
              visible: true,
            });
            const geometry = await page.evaluate((selector) => {
              const row = document.querySelector(selector)!;
              const version = row.querySelector('[aria-label="Production runs v0.2.0"]')!;
              const history = row.querySelector<HTMLDetailsElement>(
                "details[data-zerops-release-history]",
              )!;
              const rect = row.getBoundingClientRect();
              const mark = version.getBoundingClientRect();
              return {
                row: { left: rect.left, right: rect.right },
                version: { left: mark.left, right: mark.right, height: mark.height },
                historyOpen: history.open,
                overflow: document.documentElement.scrollWidth > innerWidth,
              };
            }, rowSelector);
            expect(geometry.version.height).toBeGreaterThan(0);
            expect(geometry.version.left).toBeGreaterThanOrEqual(geometry.row.left);
            expect(geometry.version.right).toBeLessThanOrEqual(geometry.row.right);
            expect(geometry.historyOpen).toBe(false);
            expect(geometry.overflow).toBe(false);
            const title = await page.$eval(
              `${rowSelector} [data-zerops-surface="pull-request-title"]`,
              (element) => ({
                text: element.textContent,
                width: element.clientWidth,
                scroll: element.scrollWidth,
                height: element.getBoundingClientRect().height,
                line: Number.parseFloat(getComputedStyle(element).lineHeight),
              }),
            );
            expect(title.text).toBe(changeTitle);
            expect(title.scroll).toBeLessThanOrEqual(title.width);
            if (width === 390) expect(title.height).toBeGreaterThan(title.line);
            const controls = await page.$eval("[data-zerops-project-scope]", (element) => {
              const buttons = [...element.querySelectorAll("button")];
              const find = buttons
                .find((button) => button.textContent === "Find")!
                .getBoundingClientRect();
              const create = buttons
                .find((button) => button.textContent === "New project")!
                .getBoundingClientRect();
              return {
                findRight: find.right,
                newLeft: create.left,
                findTop: find.top,
                newTop: create.top,
              };
            });
            expect(controls.findRight).toBeLessThanOrEqual(controls.newLeft);
            expect(controls.findTop).toBe(controls.newTop);
            if (process.env.PROJECTS_EVIDENCE) {
              await page.screenshot({
                path: `${process.env.PROJECTS_EVIDENCE}-${width}.png`,
                fullPage: true,
              });
              await row!.screenshot({ path: `${process.env.PROJECTS_EVIDENCE}-${width}-row.png` });
              const header = await page.$("[data-zerops-project-scope]");
              await header!.screenshot({
                path: `${process.env.PROJECTS_EVIDENCE}-${width}-header.png`,
              });
            }
          }
          await page.locator(`${rowSelector} details summary`).click();
          await page.waitForFunction(
            (selector) =>
              document.querySelector<HTMLDetailsElement>(`${selector} details`)?.open === true,
            {},
            rowSelector,
          );
          expect(
            await page.$eval(`${rowSelector} details`, (element) => element.textContent),
          ).toContain("v0.1.0");
          await page.locator("[data-zerops-project-scope] ::-p-aria(Find)").click();
          await page.waitForSelector('[role="dialog"]', { visible: true });
          await page.keyboard.press("Escape");
          await page.locator("[data-zerops-project-scope] ::-p-aria(New project)").click();
          await page.waitForSelector('[role="dialog"]', { visible: true });
          expect(await page.$eval('[role="dialog"]', (element) => element.textContent)).toContain(
            "Project name",
          );
        });
        yield* f.s.then.noExternalNetwork;
      }),
    );
  });
});
