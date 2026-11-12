/**
 * A server never migrates, reads or writes state a newer version wrote: switching a Mate back
 * to an older version is safe only because the older server refuses to start on it.
 *
 * Each migration chain calls `refuseNewerState` before its migrator runs. The check reads the
 * chain's tracking table without creating it: a database without the table is a first start.
 *
 * @module persistence/NewerState
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class NewerStateError extends Schema.TaggedError<NewerStateError>()("NewerStateError", {
  table: Schema.String,
  appliedId: Schema.Number,
  knownId: Schema.Number,
}) {
  override get message(): string {
    return (
      `This Mate's state was written by a newer version: ${this.table} has migration ` +
      `${this.appliedId} applied, but this version knows migrations only up to ${this.knownId}.`
    );
  }
}

/** Fails with `NewerStateError` when `table` records a migration above `knownId`. */
export const refuseNewerState = Effect.fn("refuseNewerState")(function* (
  table: string,
  knownId: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{
    readonly name: string;
  }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`;
  if (tables.length === 0) return;
  const [row] = yield* sql<{
    readonly appliedId: number | null;
  }>`SELECT MAX(migration_id) AS "appliedId" FROM ${sql(table)}`.withoutTransform;
  const appliedId = row?.appliedId ?? null;
  if (appliedId !== null && appliedId > knownId) {
    return yield* new NewerStateError({ table, appliedId, knownId });
  }
});
