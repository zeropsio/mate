import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
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
      const acquired = yield* Deferred.make<void>();
      yield* lock
        .withPermits(1)(Deferred.succeed(acquired, undefined).pipe(Effect.andThen(Effect.never)))
        .pipe(Effect.forkChild);
      yield* Deferred.await(acquired).pipe(Effect.timeout("5 seconds"), Effect.orDie);
      let ran = false;
      const done = yield* withPermitWithin(lock, "50 millis")(Effect.sync(() => (ran = true)));
      assert.deepStrictEqual([done, ran], [Option.none(), false]);
    }),
  );
});
