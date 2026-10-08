/** Storage waits for recovery while its owning Mate scope remains alive. */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { SqlError } from "effect/sql/SqlError";

const isSqlError = Schema.is(SqlError);
const backoff = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.seconds(30))),
  ),
);

export const retryUsageStorage = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
  operation.pipe(
    Effect.tapError((error) =>
      isSqlError(error)
        ? Effect.logWarning("Usage storage unavailable; operation retained for retry", error)
        : Effect.void,
    ),
    Effect.retry({ schedule: backoff, while: isSqlError }),
  );
