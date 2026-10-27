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
});
