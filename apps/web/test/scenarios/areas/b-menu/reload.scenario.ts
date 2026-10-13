import { resizeMenu } from "../../harness/browser.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { menuScenario } from "./dsl.ts";

/** The menu column's width, each time it changes, from the reloaded document's first frame. */
function recordMenuWidths() {
  const widths: number[] = [];
  (window as unknown as { menuWidths: number[] }).menuWidths = widths;
  const drawn = (element: Element | null): element is HTMLElement =>
    element instanceof HTMLElement &&
    element.getBoundingClientRect().width > 0 &&
    getComputedStyle(element).display !== "none" &&
    getComputedStyle(element).visibility !== "hidden";
  const sample = () => {
    const app = document.querySelector("[data-app-sidebar]");
    const boot = document.getElementById("boot-shell-menu");
    const column = drawn(app) ? app : drawn(boot) ? boot : null;
    if (column !== null) {
      const width = Math.round(column.getBoundingClientRect().width);
      if (widths.at(-1) !== width) widths.push(width);
    }
    if (document.querySelector('[data-zerops-surface="sidebar-rail-mate"]') === null) {
      requestAnimationFrame(sample);
    }
  };
  requestAnimationFrame(sample);
}

describe("B: menu reload", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a menu closed to the rail comes back as the rail after a reload, from its first frame",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
          });
          yield* s.given.signedIn;
          yield* Effect.promise(() => resizeMenu(s.page, 435));
          yield* s.then.menu.row("Shop").appears({ within: 15_000 });
          const widths = yield* Effect.promise(async () => {
            await s.page.waitForFunction(
              () =>
                document.querySelector('[data-sidebar="sidebar"]')?.getBoundingClientRect()
                  .width === 435,
              { timeout: 5_000, polling: "raf" },
            );
            await s.page.click('button[aria-label="Collapse sidebar"]');
            await s.page.waitForFunction(() => document.cookie.includes("sidebar_state=false"));
            await s.page.evaluateOnNewDocument(recordMenuWidths);
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page.waitForFunction(
              () => document.querySelector('[data-zerops-surface="sidebar-rail-mate"]') !== null,
              { timeout: 15_000 },
            );
            return s.page.evaluate(
              () => (window as unknown as { menuWidths: number[] }).menuWidths,
            );
          });
          expect(widths, `The menu column after the reload: ${widths.join(" → ")}`).toEqual([88]);
        }),
      10_000,
    );
  });
});
