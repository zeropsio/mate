// @effect-diagnostics nodeBuiltinImport:off -- host-only test database fixture.
/**
 * Every fixture owns databases on the host's shared, supervised test PostgreSQL server.
 * Releasing the fixture drops its databases; a killed worker loses its connection and does the
 * same. The run-level lease keeps the server alive between files, without serializing runs.
 */
import * as NodeNet from "node:net";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { treeMigrations } from "../../src/migrationFiles.ts";
import { migrate } from "../../src/migrations.ts";
import { acquireTestPostgres } from "../../../../scripts/test-postgres.ts";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No dead database TCP address"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

export class TempPostgres extends Context.Service<
  TempPostgres,
  {
    /** The connection string of a fresh, empty database of the cluster. */
    readonly createDatabase: Effect.Effect<string>;
    /** Fresh isolated tree-migrated database, cloned from an owned template when supported. */
    readonly createMigratedDatabase: Effect.Effect<string>;
    /** A database that refuses connections: a port with nothing listening behind it. */
    readonly deadUrl: Effect.Effect<string>;
  }
>()("@t3tools/hq/test/harness/tempPostgres") {}

export const tempPostgresLayer = Layer.effect(
  TempPostgres,
  Effect.gen(function* () {
    const owner = yield* Effect.acquireRelease(Effect.promise(acquireTestPostgres), (owner) =>
      Effect.promise(owner.close),
    );
    const migrated = Effect.gen(function* () {
      const url = yield* Effect.promise(owner.createDatabase);
      // Providing the pool here closes it before publication or fixture startup.
      yield* migrate(treeMigrations()).pipe(
        Effect.provide(PgClient.layer({ url: Redacted.make(url) })),
        Effect.orDie,
      );
      return url;
    });
    const template = yield* Effect.cached(
      migrated.pipe(Effect.tap((url) => Effect.promise(() => owner.freezeDatabase(url)))),
    );
    return TempPostgres.of({
      createMigratedDatabase: owner.supportsTemplates
        ? template.pipe(Effect.flatMap((url) => Effect.promise(() => owner.cloneDatabase(url))))
        : // Legacy supervisors retain per-database migrations until their next idle restart.
          migrated,
      createDatabase: Effect.promise(owner.createDatabase),
      deadUrl: Effect.promise(freePort).pipe(
        Effect.map((port) => `postgres://postgres@127.0.0.1:${port}/postgres`),
      ),
    });
  }),
);
