import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { resizeMenu } from "../../harness/browser.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installCreation } from "./fake.ts";
import { creation } from "./dsl.ts";
import { environmentRecipe } from "./recipe.ts";

/** What a stage's adding showed, each time it changed. */
interface AddingFrame {
  /** Where the card's Mates stood, from the card's top. */
  readonly mates: number;
  /** Its Stage section said how far the adding had got. */
  readonly inSection: boolean;
  /** A card of its own at the page's foot said it. */
  readonly atFoot: boolean;
}

function recordMatesTop(cardAt: string) {
  const frames: AddingFrame[] = [];
  (window as unknown as { addingFrames: AddingFrame[] }).addingFrames = frames;
  const sample = () => {
    const card = document.querySelector(cardAt);
    const mates = card?.querySelector('[aria-label="Project Mates"]');
    if (card instanceof HTMLElement && mates instanceof HTMLElement) {
      const frame: AddingFrame = {
        mates: Math.round(mates.getBoundingClientRect().top - card.getBoundingClientRect().top),
        inSection:
          card.querySelector('[data-zerops-place="stage"][data-zerops-setting-up]') !== null,
        atFoot: document.querySelector('[data-zerops-surface="environment-creation"]') !== null,
      };
      if (JSON.stringify(frames.at(-1)) !== JSON.stringify(frame)) frames.push(frame);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
    // The run's Add stage: the Stage section came, was re-titled, grew its Manage addresses and,
    // a minute in, its app and db dots — Project Mates moved down three times while it was set up.
    it.effect(
      "a stage being added takes its room once, at the press: the card's Mates never move while it is set up",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* environmentRecipe(s, "stage");
          yield* s.given.signedIn;
          const c = creation(s);
          const cardAt = '[data-zerops-surface="project-cards"] article[aria-label="Shop"]';
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await s.page.goto(`${s.web.origin}/zerops`);
            await s.page.waitForSelector(cardAt);
            await resizeMenu(s.page, 435);
          });
          yield* c.openAdd("stage");
          yield* Effect.promise(() => s.page.evaluate(recordMatesTop, cardAt));
          yield* c.chooseDestination("zerops");
          yield* c.fill("Environment", "Shop-b");
          yield* c.click("Add stage to Shop");
          yield* c.environmentAppears("Shop-b", "stage");
          yield* c.stageAdded;
          yield* Effect.promise(() => waitForStillFrames(s.page));
          const frames = yield* Effect.promise(() =>
            s.page.evaluate(
              () => (window as unknown as { addingFrames: AddingFrame[] }).addingFrames,
            ),
          );
          const tops = frames.map((frame) => frame.mates);
          const trace = frames.map((frame) => JSON.stringify(frame)).join("\n");
          // Its first top is before the press; the press may give the stage its room, once.
          expect(tops.length, `The card is watched:\n${trace}`).toBeGreaterThan(0);
          expect(
            new Set(tops.slice(1)).size,
            `Its Mates stand where the press put them:\n${trace}`,
          ).toBeLessThanOrEqual(1);
          // The run's progress stood in a card of its own at the page's foot, below the fold.
          expect(
            frames.some((frame) => frame.inSection) && frames.every((frame) => !frame.atFoot),
            `How far the adding got is said in the card's Stage section, never at the page's foot:\n${trace}`,
          ).toBe(true);
        }),
      90_000,
    );
  });
});
