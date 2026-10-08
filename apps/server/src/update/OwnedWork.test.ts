import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { makeOwnedWork } from "./OwnedWork.ts";

describe("owned work", () => {
  it.effect(
    "reserves detached work before returning and clears only on its actual completion",
    () =>
      Effect.gen(function* () {
        const work = yield* makeOwnedWork;
        const done = yield* Deferred.make<void>();
        const fiber = yield* work.fork(Deferred.await(done));
        assert.strictEqual(yield* work.active, 1);
        yield* Deferred.succeed(done, void 0);
        yield* Fiber.join(fiber);
        assert.strictEqual(yield* work.active, 0);
      }).pipe(Effect.scoped),
  );
  it.effect("drains a detached child even after its parent has returned", () =>
    Effect.gen(function* () {
      const work = yield* makeOwnedWork;
      const release = yield* Deferred.make<void>();
      const completed: string[] = [];
      const parent = yield* work.fork(
        Effect.gen(function* () {
          yield* work.fork(
            Deferred.await(release).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  completed.push("child");
                }),
              ),
            ),
          );
          completed.push("parent");
        }),
      );
      yield* Fiber.join(parent);
      const draining = yield* work.drain.pipe(Effect.forkChild({ startImmediately: true }));
      assert.deepStrictEqual(completed, ["parent"]);
      assert.isUndefined(draining.pollUnsafe());
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(draining).pipe(Effect.timeout("5 seconds"), Effect.orDie);
      assert.deepStrictEqual(completed, ["parent", "child"]);
    }).pipe(Effect.scoped),
  );
});
