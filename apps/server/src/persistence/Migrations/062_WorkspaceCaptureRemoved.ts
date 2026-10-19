import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Git is the record of what a turn changed: nothing per turn is captured or reverted any more.
 * The events only capture and revert wrote no longer decode, so they leave the log; their
 * projection columns, their projector's cursor and the capture journal go with them. The
 * checkpoint refs it left in a service's Git go at the server's start (`vcs/checkpointRefsSweep.ts`).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    DELETE FROM orchestration_events
    WHERE event_type IN (
      'thread.turn-diff-completed',
      'thread.reverted',
      'thread.checkpoint-revert-requested'
    )
  `;
  yield* sql`DROP TABLE IF EXISTS workspace_capture_runs`;
  yield* sql`DELETE FROM projection_state WHERE projector = 'projection.checkpoints'`;
  yield* sql`
    CREATE TABLE projection_turns_next (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      pending_message_id TEXT,
      source_proposed_plan_thread_id TEXT,
      source_proposed_plan_id TEXT,
      assistant_message_id TEXT,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE (thread_id, turn_id)
    )
  `;
  yield* sql`
    INSERT INTO projection_turns_next (
      row_id, thread_id, turn_id, pending_message_id, source_proposed_plan_thread_id,
      source_proposed_plan_id, assistant_message_id, state, requested_at, started_at, completed_at
    )
    SELECT
      row_id, thread_id, turn_id, pending_message_id, source_proposed_plan_thread_id,
      source_proposed_plan_id, assistant_message_id, state, requested_at, started_at, completed_at
    FROM projection_turns
  `;
  yield* sql`DROP TABLE projection_turns`;
  yield* sql`ALTER TABLE projection_turns_next RENAME TO projection_turns`;
  yield* sql`
    CREATE INDEX idx_projection_turns_thread_requested
    ON projection_turns(thread_id, requested_at)
  `;
  yield* sql`
    CREATE INDEX idx_projection_turns_thread_keyset
    ON projection_turns(thread_id, requested_at, turn_id)
  `;
});
