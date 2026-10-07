import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The engine's tables: the event log and its receipts, the projections the clients read, the
 * effect outbox and the wakes. Never interleaved with V1's chain; dropping them is a fresh start.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE engine_conversation (
      conversation_id TEXT PRIMARY KEY,
      head_seq INTEGER NOT NULL,
      snapshot_json TEXT,
      snapshot_seq INTEGER,
      updated_at INTEGER NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE engine_event (
      gseq INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      v INTEGER NOT NULL,
      at INTEGER NOT NULL,
      command_id TEXT NOT NULL,
      run_id TEXT,
      payload_json TEXT NOT NULL,
      UNIQUE (conversation_id, seq)
    )
  `;
  yield* sql`
    CREATE TABLE engine_receipt (
      conversation_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      result_seq INTEGER,
      at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, command_id)
    )
  `;
  yield* sql`
    CREATE TABLE engine_run (
      run_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      trigger_json TEXT NOT NULL,
      joins TEXT,
      principal_json TEXT NOT NULL,
      state TEXT NOT NULL,
      maintenance INTEGER NOT NULL,
      waiting_on TEXT,
      stop_asked_json TEXT,
      end_json TEXT,
      end_source TEXT,
      session_id TEXT,
      provider_turn_id TEXT,
      queued_at INTEGER NOT NULL,
      admitted_at INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      unresponsive_since INTEGER,
      UNIQUE (conversation_id, ordinal)
    )
  `;
  yield* sql`
    CREATE TABLE engine_item (
      item_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      run_id TEXT,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      by_json TEXT NOT NULL,
      body_json TEXT NOT NULL,
      opened_seq INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      at INTEGER NOT NULL,
      closed_seq INTEGER
    )
  `;
  yield* sql`CREATE INDEX engine_item_by_order ON engine_item (conversation_id, opened_seq)`;
  yield* sql`
    CREATE TABLE engine_item_detail (
      item_id TEXT PRIMARY KEY,
      body TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE engine_request (
      request_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ask_json TEXT NOT NULL,
      answerable INTEGER NOT NULL,
      state TEXT NOT NULL,
      principal_json TEXT NOT NULL,
      answer_json TEXT
    )
  `;
  yield* sql`
    CREATE TABLE engine_session (
      session_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      driver TEXT NOT NULL,
      model TEXT,
      native_ref TEXT,
      capabilities_json TEXT NOT NULL,
      state TEXT NOT NULL,
      rotated_from TEXT,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      close_reason TEXT
    )
  `;
  yield* sql`
    CREATE TABLE engine_effect (
      effect_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      lane TEXT NOT NULL,
      kind TEXT NOT NULL,
      class TEXT NOT NULL,
      run_id TEXT,
      payload_json TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      claimed_boot TEXT,
      claimed_at INTEGER,
      last_error TEXT,
      outcome_json TEXT,
      cause_id TEXT NOT NULL,
      created_seq INTEGER NOT NULL
    )
  `;
  yield* sql`CREATE INDEX engine_effect_by_lane ON engine_effect (conversation_id, lane, state)`;
  yield* sql`CREATE INDEX engine_effect_by_state ON engine_effect (state, available_at)`;
  yield* sql`
    CREATE TABLE engine_wake (
      wake_id TEXT PRIMARY KEY,
      owner_conversation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      cron TEXT,
      state TEXT NOT NULL,
      principal_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      fired_at INTEGER
    )
  `;
  yield* sql`CREATE INDEX engine_wake_by_due ON engine_wake (state, due_at)`;
});
