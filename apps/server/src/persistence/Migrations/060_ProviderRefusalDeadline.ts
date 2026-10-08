import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** The scheduling pause may clear while the refusal's provider deadline remains readable. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_thread_sessions ADD COLUMN usage_limit_reset_at TEXT`;
  // Existing sessions can recover the exact deadline from their own persisted pause event.
  // Never attach a previous turn's deadline to a newer refusal.
  yield* sql`
    UPDATE projection_thread_sessions AS session
    SET usage_limit_reset_at = (
      SELECT json_extract(event.payload_json, '$.usagePause.resetsAt')
      FROM orchestration_events AS event
      WHERE event.event_type = 'thread.usage-pause-set'
        AND json_extract(event.payload_json, '$.threadId') = session.thread_id
        AND json_extract(event.payload_json, '$.usagePause.resetsAt') IS NOT NULL
        AND event.occurred_at >= (
          SELECT turn.started_at FROM projection_turns AS turn
          JOIN projection_threads AS thread ON thread.latest_turn_id = turn.turn_id
          WHERE thread.thread_id = session.thread_id AND turn.thread_id = session.thread_id
        )
      ORDER BY event.sequence DESC LIMIT 1
    )
    WHERE session.last_error LIKE '% usage limit reached%'
  `;
});
