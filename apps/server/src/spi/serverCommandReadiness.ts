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
 * Until the gate opens the boot reports its steps with their times. Every unit of boot
 * work done advances one counter, and a failed startup records why. Each
 * change is written to the boot file zcp names, so zcp can tell a candidate
 * that is still booting from one that stopped (zcp `docs/spec-mate.md` §2.1d).
 *
 * @module serverCommandReadiness
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import { type MateBootReceipt, writeMateBootFile } from "../zerops/mateBootFile.ts";

export interface ServerCommandReadinessShape {
  /** Resolves once the server accepts commands; at once after that. */
  readonly await: Effect.Effect<void>;
  /** Called by startup; idempotent. */
  readonly complete: Effect.Effect<void>;
  /** One more unit of boot work is done; after readiness it reports nothing. */
  readonly advance: Effect.Effect<void>;
  /** Records an effect through its exit. Effect.void marks an instant with a single timestamp. */
  readonly step: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
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
      let receipt: MateBootReceipt = {
        startedAt: DateTime.formatIso(DateTime.makeUnsafe(performance.timeOrigin)),
        progress: 0,
        steps: [],
      };
      const report = (change: (current: MateBootReceipt) => MateBootReceipt) => {
        if (receipt.readyAt !== undefined) return;
        receipt = change(receipt);
        if (bootFile !== undefined) writeMateBootFile(bootFile, receipt);
        return receipt;
      };
      const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
      return ServerCommandReadiness.of({
        await: Deferred.await(ready),
        complete: Effect.gen(function* () {
          const readyAt = yield* nowIso;
          const final = report((current) => ({ ...current, readyAt }));
          if (final) {
            yield* Effect.logInfo("server boot steps", {
              startedAt: final.startedAt,
              readyAt,
              steps: final.steps,
            });
          }
          yield* Deferred.succeed(ready, undefined);
        }).pipe(Effect.uninterruptible),
        advance: Effect.sync(() => {
          report((current) => ({ ...current, progress: current.progress + 1 }));
        }),
        step: (name, effect) =>
          Effect.suspend(() => {
            if (receipt.readyAt !== undefined) return effect;
            return Effect.acquireUseRelease(
              Effect.map(nowIso, (startedAt) => {
                const step = { name, startedAt };
                report((current) => ({ ...current, steps: [...current.steps, step] }));
                return step;
              }),
              () => effect,
              (step) =>
                Effect.map(
                  Object.is(effect, Effect.void) ? Effect.succeed(step.startedAt) : nowIso,
                  (endedAt) => {
                    report((current) => ({
                      ...current,
                      steps: current.steps.map((entry) =>
                        entry === step ? { ...entry, endedAt } : entry,
                      ),
                    }));
                  },
                ),
            );
          }),
        fail: (reason) =>
          Effect.sync(() => {
            report((current) =>
              current.error === undefined ? { ...current, error: reason } : current,
            );
          }),
      });
    }),
  );
}

/**
 * One more unit of boot work is done, wherever it is: a step whose duration depends on this
 * Mate's stored data reports each bounded unit of it, so zcp sees the boot move however large the
 * state is. Outside a server, nothing.
 */
export const advanceBoot: Effect.Effect<void> = Effect.serviceOption(ServerCommandReadiness).pipe(
  Effect.flatMap((readiness) => (Option.isSome(readiness) ? readiness.value.advance : Effect.void)),
);

/** Records a boot step when running inside the server. */
export const bootStep: ServerCommandReadinessShape["step"] = (name, effect) =>
  Effect.serviceOption(ServerCommandReadiness).pipe(
    Effect.flatMap((readiness) =>
      Option.isSome(readiness) ? readiness.value.step(name, effect) : effect,
    ),
  );

/**
 * One schema migration about to run is one unit of boot work: a release that migrates a large
 * Mate's database keeps its receipt moving from one migration to the next. A single migration
 * reports nothing while it runs (its statements hold the event loop).
 */
export const withMigrationProgress = <E, R>(
  migration: Effect.Effect<void, E, R>,
): Effect.Effect<void, E, R> => advanceBoot.pipe(Effect.andThen(migration));
