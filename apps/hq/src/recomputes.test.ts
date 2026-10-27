import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { makeRecomputes } from "./recomputes.ts";

describe("the structure's recomputes", () => {
  it.effect("counts them over the last minute", () =>
    Effect.gen(function* () {
      const recomputes = yield* makeRecomputes;
      yield* Effect.repeat(recomputes.count, { times: 2 });
      yield* TestClock.adjust("30 seconds");
      yield* Effect.repeat(recomputes.count, { times: 1 });
      assert.strictEqual(yield* recomputes.lastMinute, 5);

      // A minute on from the first three, only the last two are within it; then none.
      yield* TestClock.adjust("31 seconds");
      assert.strictEqual(yield* recomputes.lastMinute, 2);
      yield* TestClock.adjust("30 seconds");
      assert.strictEqual(yield* recomputes.lastMinute, 0);
    }),
  );
});
