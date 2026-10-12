import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { rowsWhere } from "./mates.ts";
import { untilHealth } from "./runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "./tempPostgres.ts";

it.effect.each(["setup readiness", "rowsWhere projection"] as const)(
  "names %s when its unchanged ten-second wait expires",
  (stage) =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const waiting =
        stage === "setup readiness"
          ? untilHealth(
              () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
              "active",
            )
          : rowsWhere(yield* (yield* TempPostgres).createDatabase, "SELECT 1", () => {
              Deferred.doneUnsafe(entered, Effect.void);
              return false;
            });
      const fiber = yield* Effect.forkScoped(waiting);
      yield* Deferred.await(entered);
      yield* TestClock.adjust("9999 millis");
      assert.isUndefined(fiber.pollUnsafe());
      yield* TestClock.adjust("1 millis");
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit))
        assert.include(String(exit.cause), `TimeoutError: HQ ${stage} timed out after 10s`);
    }).pipe(Effect.provide(tempPostgresLayer)),
);
