import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { ServerCommandReadiness } from "./serverCommandReadiness.ts";

describe("ServerCommandReadiness", () => {
  it.effect("holds a waiter until startup completes it, then releases every waiter", () =>
    Effect.gen(function* () {
      const readiness = yield* ServerCommandReadiness;
      const early = yield* Effect.forkChild(readiness.await);
      yield* Effect.yieldNow;
      assert.isUndefined(early.pollUnsafe(), "a waiter ran before completion");

      yield* readiness.complete;
      yield* readiness.complete;
      yield* Fiber.join(early);
      yield* readiness.await;
    }).pipe(Effect.provide(ServerCommandReadiness.layer)),
  );
});
