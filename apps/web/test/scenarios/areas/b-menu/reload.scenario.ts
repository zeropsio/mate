import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { menuScenario } from "./dsl.ts";

/** What the menu column showed, frame by frame, from the reloaded document's first frame. */
interface MenuFrame {
  readonly where: "boot" | "app";
  readonly shows: "rows" | "loading" | "empty";
  /** The first loading row's mark and line, each as left, top, width and height. */
  readonly loadingAt: ReadonlyArray<number> | null;
}

// Runs in every new document: records each change of what the menu column shows.
function recordMenuFrames() {
  const frames: MenuFrame[] = [];
  (window as unknown as { menuFrames: MenuFrame[] }).menuFrames = frames;
  const shown = (element: Element | null): element is HTMLElement =>
    element !== null && element.getBoundingClientRect().width > 0;
  const sample = () => {
    const shell = document.getElementById("boot-shell");
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    const boot = document.getElementById("boot-shell-menu");
    const column =
      shell !== null && !shell.hidden && shown(boot)
        ? { where: "boot" as const, element: boot }
        : shown(sidebar)
          ? { where: "app" as const, element: sidebar }
          : null;
    if (column !== null) {
      const rows = [
        ...column.element.querySelectorAll('[data-zerops-surface="sidebar-mate"]'),
      ].filter(shown);
      const loading = [
        ...column.element.querySelectorAll(
          '[data-zerops-surface="sidebar-environments-skeleton"] > *',
        ),
      ].find(shown);
      const at =
        loading === undefined
          ? null
          : [...loading.children].flatMap((part) => {
              const box = part.getBoundingClientRect();
              return [box.left, box.top, box.width, box.height].map(Math.round);
            });
      const frame: MenuFrame = {
        where: column.where,
        shows: rows.length > 0 ? "rows" : loading !== undefined ? "loading" : "empty",
        loadingAt: at,
      };
      const last = frames.at(-1);
      const same =
        last !== undefined &&
        last.where === frame.where &&
        last.shows === frame.shows &&
        `${last.loadingAt}` === `${frame.loadingAt}`;
      if (!same) frames.push(frame);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

describe("B: menu reload", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a reload never empties the menu: it shows the loading rows from its first frame until the Mates' rows replace them",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.project("Cara", { mate: true, app: "Other" });
          yield* s.given.signedIn;
          yield* s.then.menu.row("Shop").appears({ within: 15_000 });
          const frames = yield* Effect.promise(async () => {
            await s.page.evaluateOnNewDocument(recordMenuFrames);
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page.waitForFunction(
              () =>
                (window as unknown as { menuFrames?: MenuFrame[] }).menuFrames?.at(-1)?.shows ===
                "rows",
              { timeout: 15_000 },
            );
            return s.page.evaluate(
              () => (window as unknown as { menuFrames: MenuFrame[] }).menuFrames,
            );
          });
          const trace = frames
            .map(({ where, shows, loadingAt }) =>
              loadingAt === null ? `${where} ${shows}` : `${where} ${shows} at ${loadingAt}`,
            )
            .join(" → ");
          expect(
            frames.map((frame) => frame.shows),
            `Each change of the menu column after the reload: ${trace}`,
          ).not.toContain("empty");
          const firstRows = frames.findIndex((frame) => frame.shows === "rows");
          expect(
            frames.slice(firstRows).every((frame) => frame.shows === "rows"),
            `Rows, once shown, are never taken back: ${trace}`,
          ).toBe(true);
          const loadingAt = new Set(
            frames.flatMap((frame) => (frame.loadingAt === null ? [] : [`${frame.loadingAt}`])),
          );
          expect(
            loadingAt.size,
            `The loading rows stand in one place, boot frame to menu: ${trace}`,
          ).toBeLessThanOrEqual(1);
        }),
    );
  });
});
