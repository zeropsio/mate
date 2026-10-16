import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { resizeMenu } from "../../harness/browser.ts";
import { environmentFixtureWith } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

/** What the project's card showed, each time it changed, from the loaded document's first frame. */
interface CardFrame {
  /** The card's Mates' heading top, px, relative to the card's top. */
  readonly mates: number;
  /** Its changes say there are none. */
  readonly noChanges: boolean;
}

// Runs in every new document: records each change of where the card's sections stand.
function recordCardFrames(cardAt: string) {
  const frames: CardFrame[] = [];
  (window as unknown as { cardFrames: CardFrame[] }).cardFrames = frames;
  const sample = () => {
    const card = document.querySelector(cardAt);
    const mates = card?.querySelector('[aria-label="Project Mates"]');
    if (card instanceof HTMLElement && mates instanceof HTMLElement) {
      const frame: CardFrame = {
        mates: Math.round(mates.getBoundingClientRect().top - card.getBoundingClientRect().top),
        noChanges: card.textContent?.includes("No changes yet") === true,
      };
      if (JSON.stringify(frames.at(-1)) !== JSON.stringify(frame)) frames.push(frame);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // The onboarding run, every role: a card's first frame said "No changes yet" and had no
    // History; 40 ms later its released change came and Project Mates moved 56 to 106 px down.
    it.effect(
      "a released project's card paints once, whole: its Mates never move and it never says it has no changes",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixtureWith({}, { stage: false });
          const a = environmentActions(f);
          yield* f.merge();
          yield* f.release("v0.1.0");
          yield* a.when.finish("production");
          yield* f.s.given.signedIn;
          const cardAt = `[data-zerops-surface="project-cards"] [data-zerops-group="${f.appId}"]`;
          const frames = yield* Effect.promise(async () => {
            const page = f.s.page;
            await page.setViewport({ width: 1786, height: 1000 });
            await page.goto(`${f.s.web.origin}/zerops`);
            await page.waitForSelector(cardAt);
            await resizeMenu(page, 435);
            await page.evaluateOnNewDocument(recordCardFrames, cardAt);
            await page.reload({ waitUntil: "domcontentloaded" });
            await page.waitForFunction(
              (at) => document.querySelector(at)?.textContent?.includes("v0.1.0") === true,
              { timeout: 20_000, polling: 100 },
              cardAt,
            );
            // What a settled card might still move shows within a beat.
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            return page.evaluate(
              () => (window as unknown as { cardFrames: CardFrame[] }).cardFrames,
            );
          });
          const trace = frames.map((frame) => JSON.stringify(frame)).join("\n");
          expect(frames.length, `The card is painted:\n${trace}`).toBeGreaterThan(0);
          expect(
            frames.every((frame) => !frame.noChanges),
            `It never says it has no changes:\n${trace}`,
          ).toBe(true);
          expect(
            new Set(frames.map((frame) => frame.mates)).size,
            `Its Mates stand where they were first painted:\n${trace}`,
          ).toBe(1);
        }),
      90_000,
    );
  });
});
