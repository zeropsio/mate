/**
 * The migration runner: plain SQL files applied in name order, each recorded in
 * {@link MIGRATIONS_TABLE} in the same transaction as its own statements, so a failing file leaves
 * the files before it applied and itself not at all. Only the leader runs it (`leader.ts`).
 *
 * @module migrations
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS_TABLE = "hq_migration";

export class MigrationError extends Schema.TaggedError<MigrationError>()("MigrationError", {
  /** The file that failed; null when the ledger itself could not be read or made. */
  migration: Schema.NullOr(Schema.String),
  message: Schema.String,
}) {}

const failed = (migration: string | null) => (error: SqlError) =>
  new MigrationError({ migration, message: `${error.message}: ${String(error.reason.cause)}` });

/**
 * The driver speaks only the extended protocol, one statement per query; a file holds several. A
 * `DO` block is one statement whose `EXECUTE` runs the whole file in the caller's transaction. The
 * dollar-quote tags grow until the file contains neither.
 */
const asOneStatement = (script: string): string => {
  let suffix = "";
  while (script.includes(`$hq_do${suffix}$`) || script.includes(`$hq_sql${suffix}$`)) {
    suffix += "_";
  }
  const outer = `$hq_do${suffix}$`;
  const inner = `$hq_sql${suffix}$`;
  return `DO ${outer} BEGIN EXECUTE ${inner}${script}${inner}; END ${outer}`;
};

/** Applies the files the ledger does not hold yet, in name order; answers their names. */
export const migrate = (
  files: ReadonlyArray<Migration>,
): Effect.Effect<ReadonlyArray<string>, MigrationError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const table = sql(MIGRATIONS_TABLE);
    const done = yield* Effect.andThen(
      sql`
        CREATE TABLE IF NOT EXISTS ${table} (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`,
      sql<{ readonly name: string }>`SELECT name FROM ${table}`,
    ).pipe(
      Effect.map((rows) => new Set(rows.map((row) => row.name))),
      Effect.mapError(failed(null)),
    );
    const pending = files
      .filter((file) => !done.has(file.name))
      .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const file of pending) {
      yield* sql
        .withTransaction(
          Effect.andThen(
            sql.unsafe(asOneStatement(file.sql)),
            sql`INSERT INTO ${table} (name) VALUES (${file.name})`,
          ),
        )
        .pipe(Effect.mapError(failed(file.name)));
    }
    return pending.map((file) => file.name);
  });
