import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { withPermitWithin } from "./crewLockWait.ts";

describe("withPermitWithin", () => {
  it.live("bounds the wait for the lock, never the work it then runs", () =>
    Effect.gen(function* () {
      const lock = yield* Semaphore.make(1);
      const holder = yield* lock.withPermits(1)(Effect.sleep("50 millis")).pipe(Effect.forkChild);
      const done = yield* withPermitWithin(
        lock,
        "150 millis",
      )(Effect.sleep("300 millis").pipe(Effect.as("landed")));
      yield* Fiber.join(holder);
      assert.deepStrictEqual(done, Option.some("landed"));
    }),
  );

  it.live("gives up when the lock stays taken past the wait, having run nothing", () =>
    Effect.gen(function* () {
      const lock = yield* Semaphore.make(1);
      yield* lock.withPermits(1)(Effect.sleep("500 millis")).pipe(Effect.forkChild);
      yield* Effect.sleep("10 millis");
      let ran = false;
      const done = yield* withPermitWithin(lock, "50 millis")(Effect.sync(() => (ran = true)));
      assert.deepStrictEqual([done, ran], [Option.none(), false]);
    }),
  );
});
