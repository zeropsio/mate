import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { menuScenario } from "./dsl.ts";

describe("B: list end spacing", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Decision: restore the expected end of the list; no other menu changes.
    it.effect("the last project ends one regular row gap above the New project divider", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        for (let index = 0; index < 24; index++) {
          const name = `Project${String(index).padStart(2, "0")}`;
          yield* s.given.project(name, {
            app: name,
            kind: index === 0 ? "mate" : "stage",
            environmentName: "stage",
          });
        }
        yield* s.given.signedIn;
        yield* Effect.promise(async () => {
          await s.page.waitForFunction(
            () => document.querySelectorAll("section[data-zerops-group]").length === 24,
          );
          for (const toggle of await s.page.$$('[data-zerops-surface="sidebar-project-toggle"]')) {
            await toggle.click();
          }
          await s.page.waitForFunction(
            () => document.querySelector('[data-zerops-surface="sidebar-project-rows"]') === null,
          );
          await s.page.waitForSelector('[data-zerops-surface="sidebar-new-project"]');
          const rail = (await s.page.$('[data-sidebar="rail"]'))!;
          const box = (await rail.boundingBox())!;
          const width = await s.page.$eval(
            '[data-sidebar="sidebar"]',
            (element) => element.getBoundingClientRect().width,
          );
          await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await s.page.mouse.down();
          await s.page.mouse.move(box.x + box.width / 2 + 435 - width, box.y + box.height / 2);
          await s.page.mouse.up();
          await s.page.waitForFunction(
            () =>
              document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect().width ===
              435,
          );
          await s.page.$eval('[data-sidebar="content"]', (content) => {
            content.closest('[data-slot="scroll-area-viewport"]')!.scrollTop = 0;
          });
          await s.page.waitForFunction(
            () => document.querySelector('[data-zerops-surface="sidebar-fold-slack"]') === null,
          );
          await s.page.$eval('[data-sidebar="content"]', (content) => {
            const viewport = content.closest('[data-slot="scroll-area-viewport"]')!;
            viewport.scrollTop = viewport.scrollHeight;
          });
          await s.page.waitForFunction(() => {
            const viewport = document
              .querySelector('[data-sidebar="content"]')!
              .closest('[data-slot="scroll-area-viewport"]')!;
            return (
              Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) <= 1
            );
          });
          const geometry = await s.page.evaluate(() => {
            const rows = [
              ...document.querySelectorAll('[data-zerops-surface="sidebar-project"]'),
            ].map((row) => row.getBoundingClientRect());
            const last = rows.at(-1)!;
            const previous = rows.at(-2)!;
            const divider = document
              .querySelector('[data-zerops-surface="sidebar-new-project"]')!
              .parentElement!.getBoundingClientRect().top;
            const viewport = document
              .querySelector('[data-sidebar="content"]')!
              .closest('[data-slot="scroll-area-viewport"]')!;
            return {
              regularGap: last.top - previous.bottom,
              endGap: divider - last.bottom,
              overflow: viewport.scrollHeight - viewport.clientHeight,
            };
          });
          expect(geometry.overflow).toBeGreaterThan(0);
          if (process.env.MENU_SCROLL_EVIDENCE) {
            await s.page.screenshot({
              path: process.env.MENU_SCROLL_EVIDENCE,
              clip: { x: 0, y: 0, width: 435, height: 1000 },
            });
          }
          expect(
            Math.abs(geometry.endGap - geometry.regularGap),
            `ASSERTION: list end gap equals regular row gap (±2 px): regular ${geometry.regularGap}px, end ${geometry.endGap}px`,
          ).toBeLessThanOrEqual(2);
        });
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
