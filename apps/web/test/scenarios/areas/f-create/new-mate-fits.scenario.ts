import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { ElementHandle } from "puppeteer-core";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { definePerson } from "../../fakes/zeropsWorld.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installCreation } from "./fake.ts";
import { environmentRecipe } from "./recipe.ts";

/** Where Add a Mate's own Add stood, against its dialog and the window. */
interface AddPlace {
  readonly top: number;
  readonly bottom: number;
  readonly dialogBottom: number;
  readonly windowHeight: number;
  /** What a press at the button's centre lands on is the button. */
  readonly pressLandsOnIt: boolean;
}

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // The owner's org listed fourteen people under "Who can work with this Mate": the form could
    // not shrink, its panel never scrolled, and Add stood below the window — a press there landed
    // outside the dialog and closed it, so no Mate was ever added.
    it.effect(
      "Add a Mate's Add stays inside its dialog and the window however many people it lists",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([
            installCreation,
            (drivers) => {
              for (const name of [
                "Ada",
                "Bo",
                "Cy",
                "Di",
                "Ed",
                "Fay",
                "Gus",
                "Hal",
                "Ivy",
                "Jo",
                "Kit",
                "Lu",
                "Mo",
                "Ned",
              ])
                definePerson(drivers.zerops.world, name, { role: "ADMIN" });
            },
          ]);
          // Shop's recipe holds its Mates' tier: it takes new Mates.
          yield* environmentRecipe(s, "mate");
          yield* s.given.signedIn;
          yield* Effect.promise(() => s.page.setViewport({ width: 1280, height: 633 }));
          // Shop's card's own Add a Mate, as the owner pressed it.
          yield* Effect.promise(async () => {
            await s.page.goto(`${s.web.origin}/zerops`);
            const add = await s.page.waitForFunction(
              () =>
                [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-zerops-surface="project-cards"] article[aria-label="Shop"] button',
                  ),
                ].find((button) => button.textContent?.trim().startsWith("Add a Mate")),
              { timeout: 15_000, polling: "raf" },
            );
            await (add.asElement() as ElementHandle<Element>).click();
          });
          const place = yield* Effect.promise(() =>
            s.page.waitForFunction(
              () => {
                const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
                const add = [...(dialog?.querySelectorAll<HTMLElement>("button") ?? [])].find(
                  (button) => /^Add .+ to Shop$/u.test(button.textContent?.trim() ?? ""),
                );
                if (dialog === null || add === undefined) return null;
                const box = add.getBoundingClientRect();
                const under = document.elementFromPoint(
                  box.left + box.width / 2,
                  box.top + box.height / 2,
                );
                return {
                  top: Math.round(box.top),
                  bottom: Math.round(box.bottom),
                  dialogBottom: Math.round(dialog.getBoundingClientRect().bottom),
                  windowHeight: window.innerHeight,
                  pressLandsOnIt: under !== null && add.contains(under),
                } satisfies AddPlace;
              },
              { timeout: 15_000, polling: "raf" },
            ),
          );
          const at = (yield* Effect.promise(() => place.jsonValue())) as AddPlace;
          const trace = `Add at ${String(at.top)}–${String(at.bottom)}, dialog ends at ${String(at.dialogBottom)}, window ${String(at.windowHeight)}, press lands on it: ${String(at.pressLandsOnIt)}`;
          expect(at.bottom, `Add is inside the window: ${trace}`).toBeLessThanOrEqual(
            at.windowHeight,
          );
          expect(at.bottom, `Add is inside its dialog: ${trace}`).toBeLessThanOrEqual(
            at.dialogBottom,
          );
          expect(at.pressLandsOnIt, `A press on Add lands on it: ${trace}`).toBe(true);
        }),
    );
  });
});
