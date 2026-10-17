/**
 * Whether the setup's wait for the stand-up ended — it went out, failed, was skipped, nobody asked
 * for it, or this Mate has none to run. `ZeropsSetup` settles it once; `ZeropsTasks` reads it, so a
 * new automated Mate takes no task before its stand-up has gone out (what runs after shows on the
 * engine). A service of its own: the setup reads the link to HQ, and the link works the tasks.
 *
 * @module ZeropsStandUpReceipt
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class ZeropsStandUpReceipt extends Context.Service<
  ZeropsStandUpReceipt,
  {
    /** Whether the wait ended, now. */
    readonly settled: Effect.Effect<boolean>;
    /** Completes once the wait ended. */
    readonly await: Effect.Effect<void>;
    /** The wait ended; said again, it changes nothing. */
    readonly settle: Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsStandUpReceipt") {}

export const layer = Layer.effect(
  ZeropsStandUpReceipt,
  Effect.map(Deferred.make<void>(), (ended) =>
    ZeropsStandUpReceipt.of({
      settled: Deferred.isDone(ended),
      await: Deferred.await(ended),
      settle: Effect.asVoid(Deferred.succeed(ended, undefined)),
    }),
  ),
);
