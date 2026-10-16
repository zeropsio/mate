import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { resizeMenu } from "../../harness/browser.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installCreation } from "./fake.ts";
import { creation } from "./dsl.ts";
import { environmentRecipe } from "./recipe.ts";

/** Where the card's Mates stood, each time it changed, from the card's top. */
function recordMatesTop(cardAt: string) {
  const tops: number[] = [];
  (window as unknown as { matesTops: number[] }).matesTops = tops;
  const sample = () => {
    const card = document.querySelector(cardAt);
    const mates = card?.querySelector('[aria-label="Project Mates"]');
    if (card instanceof HTMLElement && mates instanceof HTMLElement) {
      const top = Math.round(mates.getBoundingClientRect().top - card.getBoundingClientRect().top);
      if (tops.at(-1) !== top) tops.push(top);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
          yield* c.text("Shop-b is set up");
          // What a settled card might still move shows within a beat.
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1_500)));
          const tops = yield* Effect.promise(() =>
            s.page.evaluate(() => (window as unknown as { matesTops: number[] }).matesTops),
          );
          // Its first top is before the press; the press may give the stage its room, once.
          expect(tops.length, `The card is watched: ${tops.join(", ")}`).toBeGreaterThan(0);
          expect(
            new Set(tops.slice(1)).size,
            `Its Mates stand where the press put them: ${tops.join(", ")}`,
          ).toBeLessThanOrEqual(1);
        }),
      90_000,
    );
  });
});
