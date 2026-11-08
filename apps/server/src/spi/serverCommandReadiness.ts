/**
 * ServerCommandReadiness — the server's command gate, carried below the
 * startup layer, and the boot's own account of its way there.
 *
 * `ServerRuntimeStartup` signals command readiness only once startup has
 * finished, and it sits above the layers that need to wait for that moment
 * (the crew engine's boot sweep and dispatch loop), so they cannot yield it.
 * This service is provided at the bottom of the server layer; startup
 * completes it right where it signals its own gate.
 *
 * Until the gate opens the boot reports its way there: every unit of boot
 * work done advances one counter, and a failed startup records why. Each
 * change is written to the boot file zcp names, so zcp can tell a candidate
 * that is still booting from one that stopped (zcp `docs/spec-mate.md` §2.1d).
 *
 * @module serverCommandReadiness
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import { type MateBootReceipt, writeMateBootFile } from "../zerops/mateBootFile.ts";

export interface ServerCommandReadinessShape {
  /** Resolves once the server accepts commands; at once after that. */
  readonly await: Effect.Effect<void>;
  /** Called by startup; idempotent. */
  readonly complete: Effect.Effect<void>;
  /** One more unit of boot work is done; after readiness it reports nothing. */
  readonly advance: Effect.Effect<void>;
  /** Startup failed for this reason; the first reason stays. */
  readonly fail: (reason: string) => Effect.Effect<void>;
}

export class ServerCommandReadiness extends Context.Service<
  ServerCommandReadiness,
  ServerCommandReadinessShape
>()("t3/spi/serverCommandReadiness") {
  static readonly layer = Layer.effect(
    ServerCommandReadiness,
    Effect.gen(function* () {
      const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
      const bootFile = Option.isSome(config) ? config.value.zerops?.mateBootFile : undefined;
      const ready = yield* Deferred.make<void>();
      const receipt = yield* Ref.make<MateBootReceipt>({ progress: 0 });
      const report = (change: (current: MateBootReceipt) => MateBootReceipt) =>
        Effect.gen(function* () {
          if (yield* Deferred.isDone(ready)) return;
          const next = yield* Ref.updateAndGet(receipt, change);
          if (bootFile !== undefined) writeMateBootFile(bootFile, next);
        });
      return {
        await: Deferred.await(ready),
        complete: Deferred.succeed(ready, undefined).pipe(Effect.asVoid),
        advance: report((current) => ({ ...current, progress: current.progress + 1 })),
        fail: (reason: string) =>
          report((current) =>
            current.error === undefined ? { ...current, error: reason } : current,
          ),
      };
    }),
  );
}
