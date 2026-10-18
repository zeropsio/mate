import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { resizeMenu } from "../../harness/browser.ts";
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

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // The owner, 2026-10-19: "the scroll should 'take' on the whole height of the page", and
    // "there should be inner scroll inside the card when they need to go above window height".
    it.effect(
      "the overview scrolls as one page, and a card taller than the window scrolls inside itself under the app bar",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixtureWith({}, { stage: true });
          const a = environmentActions(f);
          yield* f.merge();
          yield* f.release("v0.1.0");
          yield* a.when.finish("production");
          yield* f.s.given.signedIn;
          const cardAt = `[data-zerops-surface="project-cards"] [data-zerops-group="${f.appId}"]`;
          const page = f.s.page;
          const read = () =>
            page.evaluate((at) => {
              const card = document.querySelector<HTMLElement>(at)!;
              const head = card.querySelector("header")!.getBoundingClientRect();
              const body = card.querySelector<HTMLElement>("[data-zerops-card-body]")!;
              const mates = card.querySelector('[aria-label="Project Mates"]')!;
              // The page's scroller: the nearest ancestor of the card that scrolls up and down.
              let scroller = card.parentElement;
              while (
                scroller !== null &&
                !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
              )
                scroller = scroller.parentElement;
              const frame = scroller!.getBoundingClientRect();
              return {
                viewport: { width: innerWidth, height: innerHeight },
                scroller: {
                  top: Math.round(frame.top),
                  bottom: Math.round(frame.bottom),
                  right: Math.round(frame.right),
                  scrollTop: Math.round(scroller!.scrollTop),
                  scrolls: scroller!.scrollHeight > scroller!.clientHeight,
                },
                card: Math.round(card.getBoundingClientRect().height),
                headTop: Math.round(head.top),
                body: { scrolls: body.scrollHeight > body.clientHeight, top: body.scrollTop },
                matesTop: Math.round(mates.getBoundingClientRect().top),
              };
            }, cardAt);
          yield* Effect.promise(async () => {
            await page.setViewport({ width: 1786, height: 1000 });
            await page.goto(`${f.s.web.origin}/zerops`);
            await page.waitForSelector(cardAt);
            await resizeMenu(page, 435);
            await page.waitForFunction(
              (at) => document.querySelector(at)?.textContent?.includes("v0.1.0") === true,
              { timeout: 20_000 },
              cardAt,
            );
            const tall = await read();
            // One scroller from the page's top to its foot, its bar at the window's edge.
            expect(tall.scroller.top).toBeLessThanOrEqual(0);
            expect(tall.scroller.bottom).toBe(tall.viewport.height);
            expect(tall.scroller.right).toBe(tall.viewport.width);
            expect(tall.body.scrolls, "A card that fits scrolls nothing").toBe(false);

            // A window shorter than the card: the card stops at it, less the page's gutters, and
            // its head stands where it stood.
            await page.setViewport({ width: 1786, height: 560 });
            await page.waitForFunction(
              (at) => {
                const body = document.querySelector<HTMLElement>(`${at} [data-zerops-card-body]`);
                return body !== null && body.scrollHeight > body.clientHeight;
              },
              { timeout: 10_000 },
              cardAt,
            );
            const short = await read();
            expect(short.card).toBeLessThanOrEqual(short.viewport.height - 48);
            expect(short.headTop, "Its head never moves as it crosses the cap").toBe(tall.headTop);
            expect(short.scroller.bottom).toBe(short.viewport.height);

            // Its body scrolls under its head, which stands still.
            await page.$eval(`${cardAt} [data-zerops-card-body]`, (body) => {
              body.scrollTop = 120;
            });
            const scrolled = await read();
            expect(scrolled.headTop).toBe(short.headTop);
            expect(scrolled.matesTop).toBeLessThan(short.matesTop);

            // A wheel anywhere else on the page scrolls the page, from its top.
            expect(short.scroller.scrolls, "The page is taller than this window").toBe(true);
            await page.mouse.move(1700, 500);
            await page.mouse.wheel({ deltaY: 200 });
            await page.waitForFunction(
              (at) => {
                let scroller = document.querySelector(at)?.parentElement ?? null;
                while (
                  scroller !== null &&
                  !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
                )
                  scroller = scroller.parentElement;
                return (scroller?.scrollTop ?? 0) > 0;
              },
              { timeout: 5_000 },
              cardAt,
            );
          });
        }),
      90_000,
    );
  });
});
