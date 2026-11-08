/**
 * ServerCommandReadiness — the server's command gate, carried below the
 * startup layer, and the boot's own account of its way there.
 *
 * `ServerRuntimeStartup` signals command readiness only once startup has
 * finished, and it sits above the layers that need to wait for that moment
 * (the crew engine's boot sweep and dispatch loop), so they cannot yield it.
 * This zero-dependency service is provided at the bottom of the server
 * layer; startup completes it right where it signals its own gate.
 *
 * While the gate is closed the boot reports its progress here: every unit of
 * boot work done advances one counter, and a failed startup records why. zcp
 * reads both on the loopback updater readiness to tell a candidate that is
 * still booting from one that stopped (zcp `docs/spec-mate.md` §2.1d).
 *
 * @module serverCommandReadiness
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface ServerBootStatus {
  /** The server accepts commands. */
  readonly ready: boolean;
  /** Units of boot work done so far; it only grows within a boot. */
  readonly progress: number;
  /** Why startup failed, once it has. */
  readonly error?: string;
}

export interface ServerCommandReadinessShape {
  /** Resolves once the server accepts commands; at once after that. */
  readonly await: Effect.Effect<void>;
  /** Called by startup; idempotent. */
  readonly complete: Effect.Effect<void>;
  /** One more unit of boot work is done. */
  readonly advance: Effect.Effect<void>;
  /** Startup failed for this reason; the first reason stays. */
  readonly fail: (reason: string) => Effect.Effect<void>;
  /** The boot as it stands now, never waiting for it. */
  readonly boot: Effect.Effect<ServerBootStatus>;
}

export class ServerCommandReadiness extends Context.Service<
  ServerCommandReadiness,
  ServerCommandReadinessShape
>()("t3/spi/serverCommandReadiness") {
  static readonly layer = Layer.effect(
    ServerCommandReadiness,
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>();
      const progress = yield* Ref.make(0);
      const failure = yield* Ref.make<string | undefined>(undefined);
      return {
        await: Deferred.await(ready),
        complete: Deferred.succeed(ready, undefined).pipe(Effect.asVoid),
        advance: Ref.update(progress, (done) => done + 1),
        fail: (reason: string) => Ref.update(failure, (first) => first ?? reason),
        boot: Effect.gen(function* () {
          const error = yield* Ref.get(failure);
          return {
            ready: yield* Deferred.isDone(ready),
            progress: yield* Ref.get(progress),
            ...(error === undefined ? {} : { error }),
          };
        }),
      };
    }),
  );
}
