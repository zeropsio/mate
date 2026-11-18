/**
 * ZeropsToldToStop — whether this process was told to stop: false until it receives `SIGTERM`,
 * true from then on.
 *
 * zcp restarts and stops the Mate's unit by `SIGTERM` (an update's restart, `zcp self restart`, an
 * operator's restart or stop), so the sockets the stop closes read this to say the Mate is
 * restarting (`1012` `restart`) rather than dropping. `SIGINT` (a developer's Ctrl-C) says nothing.
 *
 * The listener is prepended so the flag is set before `NodeRuntime.runMain`'s own `SIGTERM`
 * handler interrupts the program and the finalizers that close the sockets run. It only sets the
 * flag: ending the process stays with `runMain`.
 *
 * @module ZeropsToldToStop
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class ZeropsToldToStop extends Context.Service<
  ZeropsToldToStop,
  {
    /** Whether the process has received `SIGTERM`. */
    readonly told: Effect.Effect<boolean>;
  }
>()("t3/zerops/ZeropsToldToStop") {}

export const layer = Layer.effect(
  ZeropsToldToStop,
  Effect.gen(function* () {
    let told = false;
    const onSignal = () => {
      told = true;
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => process.prependListener("SIGTERM", onSignal)),
      () => Effect.sync(() => process.off("SIGTERM", onSignal)),
    );
    return ZeropsToldToStop.of({ told: Effect.sync(() => told) });
  }),
);
