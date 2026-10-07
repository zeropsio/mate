/**
 * The `MateEngine` layer, chosen by the switch when it is built: the live
 * engine when `T3CODE_MATE_ENGINE` is `mate`, else the inert one. Both
 * provide the same service, so the composition is the same in both modes.
 *
 * @module engine/layer
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { inertMateEngine, MateEngine, WakeRefused } from "./MateEngine.ts";
import { RestartEvidence, RunAdmission } from "./ports.ts";

/** The switch on `v1`: for the harnesses and the fixture feeds too. */
export const engineLayerInert = Layer.succeed(MateEngine, MateEngine.of(inertMateEngine));

/**
 * The switch on `mate`. V1 is parked around it; the engine's own runtime is
 * not built yet, so it starts nothing and serves no conversation.
 */
export const engineLayerLive = Layer.effect(
  MateEngine,
  Effect.gen(function* () {
    yield* RunAdmission;
    yield* RestartEvidence;
    return MateEngine.of({
      live: true,
      start: () => Effect.logInfo("Mate engine: on; it serves no conversation yet."),
      view: Effect.succeed(undefined),
      changes: Stream.empty,
      stopSessionsOn: () => Effect.void,
      wake: () =>
        Effect.fail(new WakeRefused({ message: "The Mate engine cannot take a wake yet." })),
      runOutcome: () => Effect.succeed(undefined),
    });
  }),
);

export const engineLayer = Layer.unwrap(
  Effect.gen(function* () {
    return (yield* ServerConfig).mateEngine === "mate" ? engineLayerLive : engineLayerInert;
  }),
);
