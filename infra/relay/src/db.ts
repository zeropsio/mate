import { PgClient, layerConfig as pgClientLayerConfig } from "@effect/sql-pg/PgClient";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class RelayDb extends Context.Service<
  RelayDb,
  EffectPgDatabase & {
    readonly $client: PgClient;
  }
>()("t3code-relay/db/RelayDb") {}

export class RelayTransactions extends Context.Service<
  RelayTransactions,
  {
    readonly withTransaction: RelayDb["Service"]["$client"]["withTransaction"];
  }
>()("t3code-relay/db/RelayTransactions") {
  static readonly layer = Layer.effect(
    RelayTransactions,
    Effect.gen(function* () {
      const db = yield* RelayDb;
      return RelayTransactions.of({
        withTransaction: db.$client.withTransaction,
      });
    }),
  );
}

/**
 * A pooled `pg` connection built directly from `DATABASE_URL` — the Postgres
 * connection string a Zerops PostgreSQL service (or a local instance) hands
 * out. Replaces the Alchemy `Cloudflare.Hyperdrive` binding that used to sit
 * between the relay and PlanetScale.
 */
export const pgClientLayer = pgClientLayerConfig({
  url: Config.Redacted("DATABASE_URL"),
  applicationName: Config.succeed("t3code-relay"),
});

/**
 * The Drizzle handle other services `yield*`. `makeWithDefaults` only needs a
 * `PgClient` in context (it bakes in Effect's no-op logger/cache), so the
 * whole database layer is just that client plus the Drizzle wrapper — no
 * migration bookkeeping, region routing, or branch resolution left over from
 * the PlanetScale/Alchemy stack.
 */
export const layer = Layer.effect(RelayDb, PgDrizzle.makeWithDefaults()).pipe(
  Layer.provide(pgClientLayer),
);
