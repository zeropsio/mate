/**
 * The `MateEngine` layer: its store and migrations on the server's SQLite, its actors, outbox,
 * live plane and pump.
 *
 * @module engine/layer
 */
import { liveEngineLayer } from "./live.ts";

export const engineLayer = liveEngineLayer();
