import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as TestClock from "effect/testing/TestClock";

import { Writes, writesLayer } from "./writes.ts";

// F22 (2026-10-03): Node's server interrupts a request's fiber when its client closes; a release
// waiting on Zerops went with it. A write outlives the fiber that asked for it, and a failure
// nobody is left to hear is logged, never lost.
describe("Writes.outliving", () => {
  it.effect("finishes a write whose asker was interrupted, and logs its failure then", () =>
    Effect.gen(function* () {
      const logged: Array<string> = [];
      const writes = Context.get(yield* Layer.build(writesLayer), Writes);
      let landed = false;
      const asking = yield* Effect.forkChild(
        writes.outliving(
          Effect.andThen(
            Effect.sleep("10 seconds"),
            Effect.sync(() => {
              landed = true;
            }),
          ),
        ),
      );
      yield* TestClock.adjust("1 second");
      yield* Fiber.interrupt(asking);
      yield* TestClock.adjust("10 seconds");
      assert.isTrue(landed, "the write landed though its asker left");

      const failing = yield* Effect.forkChild(
        writes.outliving(Effect.andThen(Effect.sleep("10 seconds"), Effect.fail("refused"))).pipe(
          Effect.provide(
            Logger.layer([
              Logger.make(({ message }) => {
                logged.push(String(message));
              }),
            ]),
          ),
        ),
      );
      yield* TestClock.adjust("1 second");
      yield* Fiber.interrupt(failing);
      yield* TestClock.adjust("10 seconds");
      assert.isTrue(
        logged.some((line) => line.includes("a write failed after its client left")),
        logged.join(" | "),
      );
    }),
  );
});
