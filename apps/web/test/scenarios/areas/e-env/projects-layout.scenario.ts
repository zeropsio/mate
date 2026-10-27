import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { environmentFixtureWith } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

describe("Projects layout", () => {
  scenarioSuite((it) => {
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
        yield* f.change(
          "Explain the delivery schedule and confirmation details for every storefront checkout",
        );
        yield* f.s.given.signedIn;
        yield* Effect.promise(async () => {
          const page = f.s.page;
          await page.goto(`${f.s.web.origin}/zerops`);
          const cardSelector = `[data-zerops-surface="project-cards"] [data-zerops-group="${f.appId}"]`;
          const card = await page.waitForSelector(cardSelector);
          expect(card).not.toBeNull();
          const placeSelector = `${cardSelector} [data-zerops-place="production"]`;
          for (const width of [1786, 390]) {
            await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
            await page.waitForFunction(
              (selector) => document.querySelector(selector)?.textContent?.includes("v0.2.0"),
              {},
              placeSelector,
            );
            const geometry = await page.evaluate(
              (cardAt, placeAt) => {
                const rect = document.querySelector(cardAt)!.getBoundingClientRect();
                const line = document.querySelector(placeAt)!.getBoundingClientRect();
                return {
                  card: { left: rect.left, right: rect.right },
                  line: { left: line.left, right: line.right, height: line.height },
                  overflow: document.documentElement.scrollWidth > innerWidth,
                };
              },
              cardSelector,
              placeSelector,
            );
            // Production's line stands inside its card, and the page never scrolls sideways:
            // only the row of cards does.
            expect(geometry.line.height).toBeGreaterThan(0);
            expect(geometry.line.left).toBeGreaterThanOrEqual(geometry.card.left);
            expect(geometry.line.right).toBeLessThanOrEqual(geometry.card.right);
            expect(geometry.overflow).toBe(false);
            const controls = await page.$eval("[data-zerops-project-scope]", (element) => {
              const create = [...element.querySelectorAll("button")]
                .find((button) => button.textContent?.includes("New project"))!
                .getBoundingClientRect();
              const title = element.querySelector("h1")!.getBoundingClientRect();
              return { titleRight: title.right, newLeft: create.left };
            });
            expect(controls.titleRight).toBeLessThanOrEqual(controls.newLeft);
            if (process.env.PROJECTS_EVIDENCE) {
              await page.screenshot({
                path: `${process.env.PROJECTS_EVIDENCE}-${width}.png`,
                fullPage: true,
              });
              await card!.screenshot({
                path: `${process.env.PROJECTS_EVIDENCE}-${width}-card.png`,
              });
            }
          }
          // Production keeps its release history in reach on the card itself: the way back, and
          // History — no click to find them (the owner, 2026-10-11).
          await page.setViewport({ width: 1786, height: 1000 });
          const panelSelector = `${placeSelector} [data-zerops-surface="place-panel"]`;
          const panel = await page.waitForSelector(panelSelector, { visible: true });
          await page.waitForFunction(
            (selector) =>
              document.querySelector(selector)?.textContent?.includes("Roll back to v0.1.0") ===
              true,
            {},
            panelSelector,
          );
          expect(await panel!.evaluate((element) => element.textContent)).toContain("History");
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
