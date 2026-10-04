import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import {
  DoorRateLimit,
  PERSON_ADDRESS_LIMIT,
  PERSON_LIMIT,
  doorRateLimitLayer,
} from "./rateLimit.ts";

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

  // t12, 2026-10-03: an office behind one NAT is one address. A person's door takes from the
  // address's bucket of 120, then from the person's own of 20.
  it.effect.each([
    {
      name: "an address at a person's door",
      limit: PERSON_ADDRESS_LIMIT,
      burst: 120,
      refill: "1 second",
    },
    { name: "a person", limit: PERSON_LIMIT, burst: 20, refill: "3 seconds" },
  ] as const)(
    "lets $name take its bucket at once, then one more a step",
    ({ limit, burst, refill }) =>
      Effect.gen(function* () {
        const doors = Context.get(yield* Layer.build(doorRateLimitLayer), DoorRateLimit);
        const takes = (times: number) =>
          Effect.forEach(Array.from({ length: times }), () => doors.take("k", limit));
        assert.deepStrictEqual(yield* takes(burst + 1), [...Array(burst).fill(true), false]);
        yield* TestClock.adjust(refill);
        assert.deepStrictEqual(yield* takes(2), [true, false]);
      }),
  );
});
