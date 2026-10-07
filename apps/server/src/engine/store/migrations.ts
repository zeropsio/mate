/**
 * The engine's own migration track, recorded in `engine_migrations`, never in V1's
 * `effect_sql_migrations`: it runs in mate mode only, and the two chains never interleave.
 *
 * @module engine/store/migrations
 */
import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";

import Migration0001 from "./Migrations/0001_EngineCore.ts";
import Migration0002 from "./Migrations/0002_EngineWakeArming.ts";
import Migration0003 from "./Migrations/0003_EngineEffectSettling.ts";

export const ENGINE_MIGRATIONS_TABLE = "engine_migrations";

const migrations = {
  "1_EngineCore": Migration0001,
  "2_EngineWakeArming": Migration0002,
  "3_EngineEffectSettling": Migration0003,
} as const;

const run = Migrator.make({});

/** Runs the engine's pending migrations; returns the ones it ran as `[id, name]`. */
export const runEngineMigrations = Effect.fn("runEngineMigrations")(function* () {
  return yield* run({
    loader: Migrator.fromRecord(migrations),
    table: ENGINE_MIGRATIONS_TABLE,
  });
});
