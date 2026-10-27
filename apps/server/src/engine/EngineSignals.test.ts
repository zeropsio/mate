import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeDoorbells } from "./EngineSignals.ts";

describe("the effect worker's doorbells", () => {
  it.effect("a ring reaches each pool: another pool's arm never hides it", () =>
    Effect.gen(function* () {
      const bells = yield* makeDoorbells;
      const conversations = yield* bells.consumer;
      const owners = yield* bells.consumer;
      yield* conversations.arm;
      yield* owners.arm;
      // An owner's fiber looks for work again right after the ring, before the conversations' waits.
      yield* bells.ring;
      yield* owners.arm;
      const woke = yield* conversations.wait.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.isDefined(woke.pollUnsafe(), "the conversations' fiber slept through the ring");
      yield* Fiber.join(woke);
    }),
  );
});
