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
              { polling: 100 },
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

    // The run, the owner's first release: 6 s after Release the card's History came and pushed
    // what stood beside it, and the release's block went and pulled Project Mates 125 px up. A
    // release on its way is production's line alone now (the owner, 2026-10-16): the ready block
    // gives way at the press, once, and from there nothing moves until production runs it, nor as
    // it lands.
    it.effect(
      "a project's card holds still while its release goes out: nothing on it moves from the press until production runs it",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixtureWith({}, { stage: false });
          const a = environmentActions(f);
          yield* f.merge();
          yield* f.s.given.signedIn;
          const cardAt = `[data-zerops-surface="project-cards"] [data-zerops-group="${f.appId}"]`;
          const page = f.s.page;
          yield* Effect.promise(async () => {
            await page.setViewport({ width: 1786, height: 1000 });
            await page.goto(`${f.s.web.origin}/zerops`);
            await page.waitForSelector(`${cardAt} [data-zerops-card-ready]`);
            await resizeMenu(page, 435);
          });
          yield* Effect.promise(() => page.evaluate(recordHeldCard, cardAt));
          yield* a.when.releaseFromReview;
          yield* a.then.text("Releasing v0.1.0", `${cardAt} [data-zerops-place="production"]`);
          yield* a.when.finish("production");
          yield* a.then.text("Running", `${cardAt} [data-zerops-place="production"]`);
          // What a landed card might still move shows within a beat.
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1_500)));
          const frames = yield* Effect.promise(() =>
            page.evaluate(() => (window as unknown as { heldFrames: HeldFrame[] }).heldFrames),
          );
          // From the press's own frame: the ready block gives way there, in the frame production's
          // line says the release, never a frame apart.
          const pressed = frames.findIndex((frame) => frame.releasing || frame.running);
          const after = pressed === -1 ? [] : frames.slice(pressed);
          const going = after.filter((frame) => !frame.running);
          const trace = frames.map((frame) => JSON.stringify(frame)).join("\n");
          expect(going.length, `The card is watched while it releases:\n${trace}`).toBeGreaterThan(
            0,
          );
          expect(
            frames.slice(0, Math.max(pressed, 0)).every((frame) => frame.ready),
            `The ready block stands until production's line says the release:\n${trace}`,
          ).toBe(true);
          expect(
            new Set(going.map((frame) => JSON.stringify([frame.mates, frame.buttons]))).size,
            `Nothing on it moves while the release goes out:\n${trace}`,
          ).toBe(1);
          expect(
            new Set(after.map((frame) => frame.mates)).size,
            `Its Mates stay where they stood as it lands:\n${trace}`,
          ).toBe(1);
          // Production's line opens the release on its way, as the block's door did: the words
          // become a door where they stand, and stand there before, during and after.
          expect(
            going.every((frame) => frame.door),
            `Production's line opens the release while it goes out:\n${trace}`,
          ).toBe(true);
          expect(
            new Set(frames.map((frame) => frame.line)).size,
            `Production's line keeps its place as it becomes a door and back:\n${trace}`,
          ).toBe(1);
          const lefts = (frame: HeldFrame) =>
            new Map(
              frame.buttons
                .split(" | ")
                .filter((button) => button !== "")
                .map((button) => button.split("@") as [string, string]),
            );
          expect(
            after.every((frame, index) => {
              const before = index === 0 ? undefined : after[index - 1];
              if (before === undefined) return true;
              const now = lefts(frame);
              return [...lefts(before)].every(
                ([words, left]) => !now.has(words) || now.get(words) === left,
              );
            }),
            `No button of production's moves as it lands; what the release brings comes beside them:\n${trace}`,
          ).toBe(true);
        }),
      90_000,
    );
  });
});

/** What a releasing card showed, each time it changed: where its Mates and its buttons stand, from the card's corner. */
interface HeldFrame {
  readonly mates: number;
  /** Production's buttons, each by its words and left edge. */
  readonly buttons: string;
  /** Production's line says it runs the release. */
  readonly running: boolean;
  /** Production's line says the release is on its way. */
  readonly releasing: boolean;
  /** The ready release's block stands. */
  readonly ready: boolean;
  /** Production's line is a door, opening the release on its way. */
  readonly door: boolean;
  /** Production's line's top, left and height, from the card's corner. */
  readonly line: string;
}

function recordHeldCard(cardAt: string) {
  const frames: HeldFrame[] = [];
  (window as unknown as { heldFrames: HeldFrame[] }).heldFrames = frames;
  const sample = () => {
    const card = document.querySelector(cardAt);
    const mates = card?.querySelector('[aria-label="Project Mates"]');
    const production = card?.querySelector('[data-zerops-place="production"]');
    const line = production?.querySelector(".ov-panel-state");
    if (
      card instanceof HTMLElement &&
      mates instanceof HTMLElement &&
      line instanceof HTMLElement
    ) {
      const { top, left } = card.getBoundingClientRect();
      const at = line.getBoundingClientRect();
      const frame: HeldFrame = {
        mates: Math.round(mates.getBoundingClientRect().top - top),
        buttons: [
          ...(production?.querySelectorAll<HTMLButtonElement>(
            "button:not([data-zerops-place-door])",
          ) ?? []),
        ]
          .map(
            (button) =>
              `${button.innerText}@${Math.round(button.getBoundingClientRect().left - left)}`,
          )
          .join(" | "),
        running: production?.textContent?.includes("Running") === true,
        releasing: production?.textContent?.includes("Releasing") === true,
        ready: card.querySelector("[data-zerops-card-ready]") !== null,
        door: line instanceof HTMLButtonElement,
        line: [at.top - top, at.left - left, at.height].map(Math.round).join(":"),
      };
      if (JSON.stringify(frames.at(-1)) !== JSON.stringify(frame)) frames.push(frame);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}
