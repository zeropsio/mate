import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { ElementHandle } from "puppeteer-core";
import { definePerson } from "../../fakes/zeropsWorld.ts";
import { createScenario } from "../../harness/scenario.ts";
import { creation } from "./dsl.ts";
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

/** The New project dialog against the window, as it opens. */
interface NewProjectPlace {
  readonly top: number;
  readonly bottom: number;
  readonly windowHeight: number;
  /** How far its body scrolls: 0 when everything it asks is in view. */
  readonly bodyOverflow: number;
  readonly line: string;
}

/** The New project dialog measured once it says who can open the project. */
const newProjectPlace = (page: Parameters<typeof creation>[0]["page"]) =>
  Effect.promise(async () => {
    const handle = await page.waitForFunction(
      () => {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        const line = dialog?.querySelector<HTMLElement>('[data-zerops-access="line"]');
        const body = dialog?.querySelector<HTMLElement>(
          '[data-slot="dialog-panel"]',
        )?.parentElement;
        if (!dialog || !line || !body) return null;
        // Its laid-out place in the window-sized viewport, not the drawn one: an opening scale
        // and slide are not where it stands.
        return {
          top: dialog.offsetTop,
          bottom: dialog.offsetTop + dialog.offsetHeight,
          windowHeight: window.innerHeight,
          bodyOverflow: body.scrollHeight - body.clientHeight,
          line: line.textContent ?? "",
        } satisfies NewProjectPlace;
      },
      { polling: "raf" },
    );
    return (await handle.jsonValue()) as NewProjectPlace;
  });

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
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
              { polling: "raf" },
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
              { polling: "raf" },
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

    // The owner's New project stood 157 px from the top of the window and nearly touched its
    // bottom, scrolling a grid of eighteen people's access; its Add access tile towered over
    // Create.
    it.effect(
      "the new project dialog fits the window without scrolling with eighteen people in the organization",
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
              ])
                definePerson(drivers.zerops.world, name, { role: "ADMIN" });
              // With the world's own four — you, an owner, a reader and someone the project
              // would not reach, whom Add access offers — eighteen people.
              definePerson(drivers.zerops.world, "Karlos", { role: "BASIC_USER" });
            },
          ]);
          const flow = creation(s);
          yield* s.given.signedIn;
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() => s.page.goto(`${s.web.origin}/zerops`));
          yield* flow.click("New project");
          for (const size of [
            { width: 1786, height: 1000 },
            { width: 1280, height: 800 },
          ]) {
            yield* Effect.promise(() => s.page.setViewport(size));
            const at = yield* newProjectPlace(s.page);
            const below = at.windowHeight - at.bottom;
            const trace = `${String(size.width)} × ${String(size.height)}: dialog ${String(at.top)}–${String(at.bottom)}, body scrolls ${String(at.bodyOverflow)} px, access says "${at.line}"`;
            expect(at.line, `Access is one line of words: ${trace}`).toMatch(
              /^17 of 18 people in .+ can open it: 15 with Full access, Karlos with Edit access, reader with Read access\.$/u,
            );
            expect(at.bodyOverflow, `Nothing scrolls: ${trace}`).toBeLessThanOrEqual(0);
            expect(at.top, `It keeps off the window's top: ${trace}`).toBeGreaterThanOrEqual(16);
            expect(below, `It keeps off the window's bottom: ${trace}`).toBeGreaterThanOrEqual(16);
            expect(
              Math.abs(at.top - below),
              `It stands in the middle: ${trace}`,
            ).toBeLessThanOrEqual(1);
          }
          // Opened to change it, Add access is a quiet button: never taller than Create.
          yield* flow.click("Change who can open it");
          const heights = yield* Effect.promise(async () => {
            const handle = await s.page.waitForFunction(
              () => {
                const add = document.querySelector(
                  '[role="dialog"] [data-zerops-surface="add-access"]',
                );
                const create = document.querySelector('[data-zerops-new-project="create"]');
                if (!add || !create) return null;
                return {
                  add: add.getBoundingClientRect().height,
                  create: create.getBoundingClientRect().height,
                };
              },
              { polling: "raf" },
            );
            return (await handle.jsonValue()) as { add: number; create: number };
          });
          expect(
            heights.add,
            `Add access ${String(heights.add)} px against Create ${String(heights.create)} px`,
          ).toBeLessThanOrEqual(heights.create);
        }),
    );
  });
});
