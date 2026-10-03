import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeSendLanes } from "./sendLanes.ts";

describe("makeSendLanes", () => {
  it.effect.each([
    ["one key waits its turn", "thread-a", ["held", "next"]],
    ["another key goes on its own", "thread-b", ["next", "held"]],
  ] as const)("%s", ([_label, nextKey, order]) =>
    Effect.gen(function* () {
      const lanes = makeSendLanes();
      const done: string[] = [];
      const gate = yield* Deferred.make<void>();
      const held = yield* Effect.forkChild(
        lanes(
          "thread-a",
          Deferred.await(gate).pipe(Effect.andThen(Effect.sync(() => done.push("held")))),
        ),
      );
      yield* Effect.yieldNow;
      const next = yield* Effect.forkChild(
        lanes(
          nextKey,
          Effect.sync(() => done.push("next")),
        ),
      );
      yield* Effect.yieldNow;
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(held);
      yield* Fiber.join(next);
      assert.deepStrictEqual(done, [...order]);
    }),
  );
});
