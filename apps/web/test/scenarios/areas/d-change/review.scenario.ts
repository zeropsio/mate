import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea, mergeFor, hqFramesFor } from "./fake.ts";
import { changeFixture, anotherOrganization, review } from "./dsl.ts";
import { changeFixture as sourceChange } from "../../fakes/d-change/changes.ts";

const setup = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  const area = { merge: mergeFor(s.drivers), hqFrames: hqFramesFor(s.drivers) };
  const change = yield* changeFixture(s);
  return { s, change, area, r: review(s) };
});

describe("D: change review, comments and merge", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a menu review opening the wrong change or losing its description and changed files.
    it.effect("opens the menu change with its description and files", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        const change = yield* sourceChange(s, {
          title: `Order summary ${"checkout".repeat(12)}`,
          summary: `Order total: ${"1234567890".repeat(80)}\n`,
        });
        const r = review(s);
        yield* s.given.signedIn;
        yield* r.open;
        yield* r.text(change.title);
        yield* r.text(change.description);
        yield* r.text("summary.txt");
        yield* r.mergeEnabled;
        yield* Effect.promise(async () => {
          await s.page.locator(".rv-file").click();
          await s.page.waitForSelector(".rv-dl");
          await s.page.evaluate(() => document.fonts.ready);
          for (const width of [1786, 390]) {
            await s.page.setViewport({ width, height: 1000 });
            const overflow = await s.page.evaluate(() => {
              const review = document.querySelector('[data-zerops-surface="review"]')!;
              const regions = [...review.querySelectorAll<HTMLElement>(".rv-title, .rv-diff")];
              return {
                count: regions.length,
                excess: regions.map((node) =>
                  Math.max(
                    node.scrollWidth - node.clientWidth,
                    node.getBoundingClientRect().right - review.getBoundingClientRect().right,
                  ),
                ),
              };
            });
            expect(
              overflow.count,
              "ASSERTION: review title and expanded diff supply geometry",
            ).toBeGreaterThanOrEqual(2);
            expect(
              Math.max(...overflow.excess),
              "ASSERTION: long review headings and diffs have no horizontal overflow",
            ).toBeLessThanOrEqual(4);
          }
        });
        yield* s.then.noExternalNetwork;
      }),
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
        yield* r.text("summary.txt");
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

    // Catches closing a review discarding an unfinished comment in the same tab.
    it.effect("an unfinished comment survives closing and reopening", () =>
      Effect.gen(function* () {
        const { s, r } = yield* setup;
        yield* s.given.signedIn;
        yield* r.open;
        yield* r.mergeEnabled;
        yield* r.writeDraft("Can we also show tax?");
        yield* r.close;
        yield* r.open;
        yield* r.draftIs("Can we also show tax?");
        yield* r.mergeEnabled;
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

    // Catches a colleague's merge leaving an already-open review offering a duplicate merge.
    it.effect("a colleague merges while the review is open", () =>
      Effect.gen(function* () {
        const { s, change, r } = yield* setup;
        yield* s.given.signedIn;
        yield* r.open;
        yield* r.mergeEnabled;
        yield* change.colleagueMerges;
        yield* r.text("Merged into main");
        yield* r.cannotMerge;
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // A confirmation is overtaken by a colleague's merge: its authoritative result must win.
    it.effect(
      "a colleague merge ends an open Close confirmation without claiming a local close",
      () =>
        Effect.gen(function* () {
          const { s, change, r } = yield* setup;
          yield* s.given.signedIn;
          yield* r.open;
          yield* r.mergeEnabled;
          yield* r.askClose;
          yield* r.text("Close #1 without merging?");
          yield* change.colleagueMerges;
          yield* r.text("Merged into main");
          yield* r.cannotClose;
          yield* r.cannotMerge;
          yield* s.then.noReload;
          yield* s.then.noExternalNetwork;
        }),
    );

    // New work pushed after the question needs a new confirmation before it may be closed.
    it.effect(
      "a newer push cancels Close confirmation; closing the reviewed head keeps its branch",
      () =>
        Effect.gen(function* () {
          const { s, change, r } = yield* setup;
          yield* s.given.signedIn;
          yield* r.open;
          yield* r.mergeEnabled;
          yield* r.askClose;
          yield* r.text("Close #1 without merging?");
          yield* change.pushAgain;
          yield* r.text("tax.txt");
          yield* r.text("Draft");
          yield* r.askClose;
          yield* r.text("Close #1 without merging?");
          yield* r.confirmClose;
          yield* r.text("Closed without merging");
          yield* r.cannotMerge;
          yield* r.cannotClose;
          yield* change.closedWithBranch;
          yield* s.then.noReload;
          yield* s.then.noExternalNetwork;
        }),
    );

    // Catches a read-only colleague being offered Merge despite HQ denying development rights.
    it.effect("a reader can review but cannot merge", () =>
      Effect.gen(function* () {
        const { s, change, r } = yield* setup;
        s.given.asPerson("reader");
        yield* s.given.signedIn;
        yield* r.direct(change.direct);
        yield* r.text("summary.txt");
        yield* r.text("You need at least Basic user access");
        yield* r.cannotMerge;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches switching organizations and back erasing an offered Merge ('HQ has not said yet').
    it.effect("a same-tab organization round trip preserves the known Merge offer", () =>
      Effect.gen(function* () {
        const { s, change, r, area } = yield* setup;
        const organizations = anotherOrganization(s);
        yield* Effect.all([s.given.signedIn, r.chooseInitialOrganization(organizations.original)], {
          concurrency: "unbounded",
        });
        // Freeze the review document after the initial organization choice has settled.
        yield* Effect.promise(() => s.clock.install());
        yield* r.direct(change.direct);
        yield* r.mergeEnabled;
        yield* Effect.promise(() =>
          s.clock.advanceStepped(1000, { settle: r.waitUntilMergeEnabled }),
        );
        yield* r.rememberUnknownPermission;
        area.hqFrames.hold();
        yield* r.switchOrganization(organizations.other);
        yield* r.switchOrganization(organizations.original);
        yield* r.text("summary.txt");
        yield* Effect.promise(() => area.hqFrames.received());
        area.hqFrames.resume();
        yield* r.mergeEnabled;
        yield* r.sameDocument;
        yield* s.then.noExternalNetwork;
        const guard = yield* r.unknownPermissionHistory;
        expect(guard).toEqual([]);
      }),
    );
  });
});
