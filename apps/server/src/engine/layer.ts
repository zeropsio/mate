/**
 * The `MateEngine` layer, chosen by the switch when it is built: the live
 * engine when `T3CODE_MATE_ENGINE` is `mate`, else the inert one. Both
 * provide the same service, so the composition is the same in both modes.
 *
 * @module engine/layer
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { liveEngineLayer } from "./live.ts";
import { inertMateEngine, MateEngine } from "./MateEngine.ts";

/** The switch on `v1`: for the harnesses and the fixture feeds too. */
export const engineLayerInert = Layer.succeed(MateEngine, MateEngine.of(inertMateEngine));

/**
 * The switch on `mate`: V1 is parked around it and the engine runs the conversation — its store
 * and migrations on the server's SQLite, its actors, outbox, live plane and pump.
 */
export const engineLayerLive = liveEngineLayer();

export const engineLayer = Layer.unwrap(
  Effect.gen(function* () {
    return (yield* ServerConfig).mateEngine === "mate" ? engineLayerLive : engineLayerInert;
  }),
);
