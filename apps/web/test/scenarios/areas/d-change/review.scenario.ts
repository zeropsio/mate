import type { Page } from "puppeteer-core";
import { resizeMenu } from "../../harness/browser.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { CHUNKS_WARMED, SETTLE_MS } from "../../../../src/lib/appChunks.ts";
import { installArea, mergeFor } from "./fake.ts";
import { changeFixture, review } from "./dsl.ts";
import { changeFixture as sourceChange } from "../../fakes/d-change/changes.ts";

/** The sheet's entrance has finished: nothing it measures still slides. */
const sheetSettled = (s: { readonly page: Page }) =>
  Effect.promise(() =>
    s.page.waitForFunction(
      () => {
        const sheet = document.querySelector(".rv");
        return sheet !== null && sheet.getAnimations().length === 0;
      },
      { polling: "raf", timeout: 5_000 },
    ),
  );

const setup = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  const area = { merge: mergeFor(s.drivers) };
  const change = yield* changeFixture(s);
  return { s, change, area, r: review(s) };
});

describe("D: change review, comments and merge", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "opens the menu change with its description and files",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea], { mate: "real" });
          const change = yield* sourceChange(s, {
            title: `Order summary ${"checkout".repeat(12)}`,
            summary: `Order total: ${"1234567890".repeat(80)}\n`,
          });
          const r = review(s);
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
          });
          yield* s.given.signedIn;
          yield* Effect.promise(() => resizeMenu(s.page, 435));
          yield* r.open;
          yield* r.text(change.title);
          yield* r.text(change.description);
          yield* r.file("summary.txt");
          yield* r.mergeEnabled;
          yield* Effect.promise(async () => {
            await s.page.locator(".rv-file").click();
            await s.page.waitForSelector(".rv-dl");
            await s.page.evaluate(() => document.fonts.ready);
            for (const width of [1786, 390]) {
              await s.page.setViewport({ width, height: 1000 });
              const overflow = await s.page.evaluate(() => {
                const review = document.querySelector('[data-zerops-surface="review"]')!;
                const regions = [".rv-title", ".rv-diff"].map((selector) =>
                  review.querySelector<HTMLElement>(selector),
                );
                return {
                  visible: regions.every((node) => {
                    if (!node?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
                      return false;
                    const box = node.getBoundingClientRect();
                    return box.width > 32 && box.height > 8;
                  }),
                  excess: regions.map((node) =>
                    node === null
                      ? 0
                      : Math.max(
                          node.scrollWidth - node.clientWidth,
                          node.getBoundingClientRect().right - review.getBoundingClientRect().right,
                        ),
                  ),
                };
              });
              expect(
                overflow.visible,
                "ASSERTION: review title and expanded diff are visible with nonzero geometry",
              ).toBe(true);
              expect(
                Math.max(...overflow.excess),
                "ASSERTION: long review headings and diffs have no horizontal overflow",
              ).toBeLessThanOrEqual(4);
            }
          });
          yield* s.then.noExternalNetwork;
        }),
      10_000,
    );

    // Catches a bookmarked change URL losing the review after reload.
    it.effect("a direct change URL survives reload", () =>
      Effect.gen(function* () {
        const { s, change, r } = yield* setup;
        yield* s.given.signedIn;
        yield* r.direct(change.direct);
        yield* r.text(change.description);
        yield* Effect.promise(() => s.page.reload());
        yield* r.text(change.title);
        yield* r.file("summary.txt");
        yield* r.mergeEnabled;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a comment that looks sent but disappears when the review is reloaded.
    it.effect("a comment is shared and retained after reload", () =>
      Effect.gen(function* () {
        const { s, change, r } = yield* setup;
        yield* s.given.signedIn;
        yield* r.direct(change.direct);
        yield* r.mergeEnabled;
        yield* r.comment("Please keep the total visible on mobile.");
        yield* r.text("Please keep the total visible on mobile.");
        yield* r.draftIs("");
        yield* Effect.promise(() => s.page.reload());
        yield* r.text("Please keep the total visible on mobile.");
        yield* r.mergeEnabled;
        const reader = yield* s.given.browserActor({ person: "reader" });
        yield* reader.given.signedIn;
        const colleagueReview = review({ ...s, ...reader });
        yield* colleagueReview.direct(change.direct);
        yield* colleagueReview.text("Please keep the total visible on mobile.");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Merge hiding progress or continuing to offer the completed change for merging.
    it.effect("merge shows progress and the real result", () =>
      Effect.gen(function* () {
        const { s, r, area } = yield* setup;
        yield* s.given.signedIn;
        yield* r.open;
        yield* r.mergeEnabled;
        area.merge.hold();
        yield* r.merge;
        yield* Effect.promise(() => area.merge.received());
        yield* r.text("Merging into main");
        yield* r.cannotMerge;
        area.merge.resume();
        yield* r.text("Merged into main");
        yield* r.cannotMerge;
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // 2026-10-20, the owner on a narrow window: "these buttons are bit unfortunately positioned".
    // The row wrapped where it ran out of room, leaving Merge alone under the other two.
    it.effect(
      "on a narrow sheet the ask and the one button stay side by side, the quiet word under them",
      () =>
        Effect.gen(function* () {
          const { s, r } = yield* setup;
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.signedIn;
          yield* r.open;
          yield* r.mergeEnabled;
          yield* Effect.promise(() => s.page.setViewport({ width: 400, height: 900 }));
          yield* sheetSettled(s);
          const at = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const box = (selector: string) => {
                const node = [...document.querySelectorAll<HTMLElement>(selector)].find(
                  (candidate) => candidate.getBoundingClientRect().height > 0,
                );
                const rect = node?.getBoundingClientRect();
                return rect === undefined
                  ? null
                  : { top: rect.top, left: rect.left, right: rect.right };
              };
              return {
                quiet: box("[data-review-secondary]"),
                ask: box("[data-review-ask]"),
                primary: box("[data-review-primary]"),
              };
            }),
          );
          expect(at.quiet, "ASSERTION: the quiet word shows").not.toBeNull();
          expect(at.ask, "ASSERTION: the ask shows").not.toBeNull();
          expect(at.primary, "ASSERTION: the one button shows").not.toBeNull();
          expect(
            Math.abs(at.ask!.top - at.primary!.top),
            "ASSERTION: the ask and the one button share a row",
          ).toBeLessThan(1);
          expect(at.ask!.right, "ASSERTION: the one button comes last").toBeLessThanOrEqual(
            at.primary!.left,
          );
          expect(
            at.quiet!.top,
            "ASSERTION: the quiet word never stands above the one button",
          ).toBeGreaterThanOrEqual(at.primary!.top - 1);
        }),
    );

    // A run 2 follow-up: Merge's press put words under the title's line and the body under the
    // person's eye dropped 24 px, then the question after a first merge came in above it.
    it.effect("merge leaves the review's body where the person's eye is", () =>
      Effect.gen(function* () {
        const { s, r, area } = yield* setup;
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* s.given.signedIn;
        yield* r.open;
        yield* r.mergeEnabled;
        yield* sheetSettled(s);
        const bodyTop = Effect.promise(() =>
          s.page.evaluate(
            () =>
              [...document.querySelectorAll<HTMLElement>(".rv-body")]
                .find((body) => body.getBoundingClientRect().height > 0)
                ?.getBoundingClientRect().top ?? null,
          ),
        );
        const before = yield* bodyTop;
        area.merge.hold();
        yield* r.merge;
        yield* Effect.promise(() => area.merge.received());
        yield* r.text("Merging into main");
        const merging = yield* bodyTop;
        area.merge.resume();
        yield* r.text("Merged into main");
        const merged = yield* bodyTop;
        expect(before).not.toBeNull();
        // Within half a pixel: the dialog's entrance may still settle its last fraction.
        for (const top of [merging, merged]) expect(Math.abs(top! - before!)).toBeLessThan(0.5);
      }),
    );

    // A run 2 follow-up: Merge took the composer's review strip and the header's Review tag away at
    // once, so the composer shrank 61 px under the conversation and the goal slid 143 px left.
    it.effect(
      "merge moves nothing behind the review: the composer and the header's goal stay",
      () =>
        Effect.gen(function* () {
          const { s, r, area } = yield* setup;
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.signedIn;
          yield* r.open;
          yield* r.mergeEnabled;
          yield* sheetSettled(s);
          const behind = Effect.promise(() =>
            s.page.evaluate(() => {
              const shown = (selector: string) =>
                [...document.querySelectorAll<HTMLElement>(selector)].find(
                  (node) => node.getBoundingClientRect().height > 0,
                );
              return {
                strip: shown('[data-composer-top="review"]') !== undefined,
                composer:
                  shown('[data-slot="composer-shell"]')?.getBoundingClientRect().top ?? null,
                // The Review tag's room: what follows it in the header starts where it ends.
                tag:
                  document.querySelector(".chat-header-review")?.getBoundingClientRect().right ??
                  null,
              };
            }),
          );
          const before = yield* behind;
          // What the press could move: the strip in the composer and the goal after the Review tag.
          expect(before.strip).toBe(true);
          expect(before.composer).not.toBeNull();
          expect(before.tag).not.toBeNull();
          area.merge.hold();
          yield* r.merge;
          yield* Effect.promise(() => area.merge.received());
          yield* r.text("Merging into main");
          const merging = yield* behind;
          area.merge.resume();
          yield* r.text("Merged into main");
          yield* r.text("Not now");
          const merged = yield* behind;
          for (const after of [merging, merged]) {
            expect(Math.abs(after.composer! - before.composer!)).toBeLessThan(0.5);
            expect(after.tag).not.toBeNull();
            expect(Math.abs(after.tag! - before.tag!)).toBeLessThan(0.5);
          }
        }),
    );

    // A run 2 follow-up: the review painted in three pieces — an empty sheet, then Merge greyed with
    // "Merging waits until its files are read.", then the counts and Merge.
    it.effect("the review shows whole: Merge is ready in its first painted frame", () =>
      Effect.gen(function* () {
        const { s, r } = yield* setup;
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        // The page settles and the app's warmer fetches the review's code: its receipt is the
        // warmer's own, once every surface it loaded has settled.
        yield* Effect.promise(async () => {
          const warmed = s.page.evaluate(
            (name) =>
              new Promise<void>((resolve) => {
                addEventListener(name, () => resolve(), { once: true });
              }),
            CHUNKS_WARMED,
          );
          await s.clock.advance(SETTLE_MS);
          await warmed;
        });
        // Each frame from the press: whether the sheet is painted, and whether Merge can be pressed.
        yield* Effect.promise(() =>
          s.page.evaluate(() => {
            const frames: Array<{ painted: boolean; merge: boolean }> = [];
            (window as unknown as { reviewFrames: typeof frames }).reviewFrames = frames;
            const sample = () => {
              const sheet = document.querySelector<HTMLElement>('[data-zerops-surface="review"]');
              const primary = sheet?.querySelector<HTMLButtonElement>("[data-review-primary]");
              frames.push({
                painted:
                  sheet !== null &&
                  sheet !== undefined &&
                  Number(getComputedStyle(sheet).opacity) > 0,
                merge: primary !== null && primary !== undefined && !primary.disabled,
              });
              if (frames.length < 1800) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          }),
        );
        yield* r.open;
        // The review's own waits run on the page's clock.
        yield* Effect.promise(() => s.clock.advanceStepped(2_000));
        yield* r.mergeEnabled;
        yield* sheetSettled(s);
        const frames = yield* Effect.promise(() =>
          s.page.evaluate(
            () =>
              (window as unknown as { reviewFrames: Array<{ painted: boolean; merge: boolean }> })
                .reviewFrames,
          ),
        );
        const painted = frames.filter((frame) => frame.painted);
        expect(painted.length).toBeGreaterThan(0);
        expect(painted.every((frame) => frame.merge)).toBe(true);
      }),
    );
  });
});
