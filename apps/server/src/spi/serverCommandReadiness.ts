/**
 * ServerCommandReadiness — the server's command gate, carried below the
 * startup layer.
 *
 * `ServerRuntimeStartup` signals command readiness only once startup has
 * finished, and it sits above the layers that need to wait for that moment
 * (the crew engine's boot sweep and dispatch loop), so they cannot yield it.
 * This zero-dependency service is provided at the bottom of the server
 * layer; startup completes it right where it signals its own gate.
 *
 * @module serverCommandReadiness
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface ServerCommandReadinessShape {
  /** Resolves once the server accepts commands; at once after that. */
  readonly await: Effect.Effect<void>;
  /** Called by startup; idempotent. */
  readonly complete: Effect.Effect<void>;
}

export class ServerCommandReadiness extends Context.Service<
  ServerCommandReadiness,
  ServerCommandReadinessShape
>()("t3/spi/serverCommandReadiness") {
  static readonly layer = Layer.effect(
    ServerCommandReadiness,
    Effect.map(Deferred.make<void>(), (ready) => ({
      await: Deferred.await(ready),
      complete: Deferred.succeed(ready, undefined).pipe(Effect.asVoid),
    })),
  );
}
