/**
 * Writes that outlive their client (F22, 2026-10-03). Node's HTTP server interrupts a request's
 * fiber when its client closes the connection (`ClientAbort`): a release whose client gave up at
 * 20 s, while HQ waited on Zerops, was dropped half-way and never made. A write's work runs in this
 * layer's scope instead — Core's — and the request only waits for it: a client that leaves stops
 * waiting, the write goes on to its end, and its result is there to read. A failure nobody is left
 * to hear is logged.
 *
 * @module writes
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

export class Writes extends Context.Service<
  Writes,
  {
    /** Runs `write` to its end whatever happens to the fiber that asked for it; waits for it. */
    readonly outliving: <A, E, R>(write: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("@t3tools/hq/writes") {}

export const writesLayer = Layer.effect(
  Writes,
  Effect.map(Effect.scope, (scope) =>
    Writes.of({
      outliving: (write) =>
        Effect.gen(function* () {
          /** Whether the asker stopped waiting: then nobody hears how the write ended. */
          let left = false;
          const working = yield* Effect.forkIn(
            write.pipe(
              Effect.tapCause((cause) =>
                left && !Cause.hasInterruptsOnly(cause)
                  ? Effect.logWarning("a write failed after its client left", cause)
                  : Effect.void,
              ),
            ),
            scope,
          );
          return yield* Fiber.join(working).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                left = true;
              }),
            ),
          );
        }),
    }),
  ),
);
