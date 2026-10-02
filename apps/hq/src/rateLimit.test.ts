import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { DoorRateLimit, doorRateLimitLayer } from "./rateLimit.ts";

describe("doorRateLimitLayer", () => {
  it.effect("lets ten through per address at once, then one more every six seconds", () =>
    Effect.gen(function* () {
      const limit = Context.get(yield* Layer.build(doorRateLimitLayer), DoorRateLimit);
      const takes = (key: string, times: number) =>
        Effect.forEach(Array.from({ length: times }), () => limit.take(key));
      assert.deepStrictEqual(yield* takes("a", 11), [...Array(10).fill(true), false]);
      assert.deepStrictEqual(yield* takes("b", 1), [true]);
      yield* TestClock.adjust("6 seconds");
      assert.deepStrictEqual(yield* takes("a", 2), [true, false]);
    }),
  );
});
