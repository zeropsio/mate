import { resizeMenu } from "../../harness/browser.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea, mergeFor } from "./fake.ts";
import { changeFixture, review } from "./dsl.ts";
import { changeFixture as sourceChange } from "../../fakes/d-change/changes.ts";

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
    // A run 2 follow-up: Merge's press put words under the title's line and the body under the
    // person's eye dropped 24 px, then the question after a first merge came in above it.
    it.effect("merge leaves the review's body where the person's eye is", () =>
      Effect.gen(function* () {
        const { s, r, area } = yield* setup;
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* s.given.signedIn;
        yield* r.open;
        yield* r.mergeEnabled;
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
  });
});
