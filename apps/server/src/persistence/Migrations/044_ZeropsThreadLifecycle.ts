import * as SqlClient from "effect/sql/SqlClient";
import * as Effect from "effect/Effect";

/**
 * Per-thread Zerops lifecycle state — the latest `workflow.StateEnvelope` the
 * thread's agent reported, plus the recent `zerops_*` tool calls the lifecycle
 * strip renders.
 *
 * Written directly from the live provider event stream rather than by the
 * projection pipeline: these events are not part of T3's own event log, so
 * there is nothing to replay them from. Same pattern as
 * `provider_session_runtime`.
 *
 * No foreign key to `projection_threads`: the projection lags the live stream,
 * so a constraint would reject the first write of a brand-new thread.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS zerops_thread_lifecycle (
      thread_id TEXT PRIMARY KEY,
      envelope_json TEXT,
      recent_tools_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
