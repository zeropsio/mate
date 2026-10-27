import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { resizeMenu } from "../../harness/browser.ts";
import { environmentFixture } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

/** Where the release sheet's parts stand: its last section's end, its buttons, its own end. */
const sheetGeometry = `(() => {
  const sheet = [...document.querySelectorAll(".rv")].find((node) => node.getBoundingClientRect().height > 0);
  if (sheet === undefined) return null;
  const sections = [...sheet.querySelectorAll(".rv-body > section")].filter((node) => node.getBoundingClientRect().height > 0);
  const buttons = sheet.querySelector(".rv-btns");
  return {
    lastSection: sections.at(-1)?.getBoundingClientRect().bottom ?? null,
    buttons: buttons?.getBoundingClientRect().top ?? null,
    sheet: sheet.getBoundingClientRect().bottom,
  };
})()`;

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
    // 2026-10-20, the owner on a one-change release: "can we improve design of this?" — the sheet
    // stood the window's full height, its buttons 1 400 px under its last line.
    it.effect(
      "a release's sheet ends at its buttons, and from the press they never rise under the pointer",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          yield* f.merge();
          yield* a.when.finish("stage");
          yield* f.release("v0.1.0");
          yield* a.when.finish("production");
          yield* f.merge("Improve the storefront");
          yield* a.when.finish("stage");
          yield* f.s.given.signedIn;
          yield* Effect.promise(() => f.s.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() => resizeMenu(f.s.page, 435));
          yield* a.when.open("production");
          yield* a.when.click("Review release");
          yield* a.then.text("Version");
          yield* Effect.promise(() =>
            f.s.page.waitForFunction(
              () => {
                const sheet = document.querySelector(".rv");
                return (
                  sheet !== null &&
                  !sheet.hasAttribute("data-holding") &&
                  sheet.getAnimations().length === 0
                );
              },
              { polling: "raf" },
            ),
          );
          const measure = Effect.promise(
            () =>
              f.s.page.evaluate(sheetGeometry) as Promise<{
                lastSection: number | null;
                buttons: number | null;
                sheet: number;
              } | null>,
          );
          const offered = yield* measure;
          expect(offered, "ASSERTION: the sheet shows").not.toBeNull();
          expect(
            offered!.buttons! - offered!.lastSection!,
            "ASSERTION: the buttons follow what it says, no empty band between",
          ).toBeLessThan(48);
          expect(
            offered!.sheet,
            "ASSERTION: the sheet ends well above the window's bottom",
          ).toBeLessThan(900);
          yield* a.when.click("Release v0.1.1 to production");
          const pressed = yield* measure;
          yield* a.when.finish("production");
          yield* a.then.text("v0.1.1 is live");
          const landed = yield* measure;
          for (const [when, at] of [
            ["at the press", pressed],
            ["once it landed", landed],
          ] as const)
            expect(
              at!.buttons!,
              `ASSERTION: the buttons never rise under the pointer ${when}`,
            ).toBeGreaterThanOrEqual(offered!.buttons! - 0.5);
          yield* f.s.then.noExternalNetwork;
        }),
    );
  });
});
