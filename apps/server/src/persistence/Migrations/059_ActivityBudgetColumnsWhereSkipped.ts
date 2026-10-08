import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import Migration0057 from "./057_ProjectionThreadActivityBudgetColumns.ts";

const BUDGET_COLUMNS = ["agent_id", "call_id", "task_id", "used_tokens"];

/**
 * Upstream's 57 again, for a database whose 57 was the crew operations table (dev builds before
 * upstream took that id): the migrator skipped upstream's 57 there. A database that ran it has the
 * columns, filled the moment they were added and written at ingestion since, so none of its rows
 * is read again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_activities)
  `;
  const existing = new Set(columns.map((column) => column.name));
  if (BUDGET_COLUMNS.every((name) => existing.has(name))) return;
  yield* Migration0057;
});
