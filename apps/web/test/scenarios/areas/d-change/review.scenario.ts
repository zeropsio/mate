import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea, mergeFor } from "./fake.ts";
import { changeFixture, review } from "./dsl.ts";

const setup = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  const area = { merge: mergeFor(s.drivers) };
  const change = yield* changeFixture(s);
  return { s, change, area, r: review(s) };
});

describe("D: change review, comments and merge", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
