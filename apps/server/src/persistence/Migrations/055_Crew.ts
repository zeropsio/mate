import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Crew mode's own tables: the applied crew, its crewmates and lanes, runs,
 * tasks (`crew_assignment`) and their attempts, stints, memory, the Show-on-dev
 * claim per dev service, the crew log, and each dev service's crew ports.
 *
 * Written by the crew engine directly, never by the projection pipeline: crew
 * adds no orchestration event type, and lane truth is git, re-derived at
 * boot. No foreign keys to projections, for the reason 044 gives.
 *
 * A crewmate is keyed by its fixed `handle` (branch `crew/<handle>`,
 * directory `.crew/<handle>`) and shown by its `display_name`; `lane` is NULL
 * for a lead or a reader, which change no files. A task's `run` is NULL when
 * the person started it (no run needed for attended work).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_definition (
      crew TEXT PRIMARY KEY,
      home_host TEXT,
      spec_json TEXT NOT NULL,
      brief_hash TEXT,
      brief_version INTEGER NOT NULL DEFAULT 1,
      applied_at TEXT,
      applied_by TEXT,
      seq INTEGER NOT NULL DEFAULT 0,
      flushed_seq INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_member (
      crew TEXT NOT NULL,
      handle TEXT NOT NULL,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      tint TEXT,
      host TEXT,
      lane TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      login TEXT,
      model TEXT,
      effort TEXT,
      job_version INTEGER NOT NULL DEFAULT 1,
      run_command TEXT,
      restart_after_merge INTEGER NOT NULL DEFAULT 0,
      crew_port INTEGER,
      config_json TEXT NOT NULL,
      PRIMARY KEY (crew, handle)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_lane (
      crew TEXT NOT NULL,
      lane TEXT NOT NULL,
      host TEXT NOT NULL,
      branch TEXT NOT NULL,
      dispatch_commit TEXT,
      recorded_tip TEXT,
      last_landing TEXT,
      ref_snapshot_json TEXT,
      lockfile_hash TEXT,
      frozen_since TEXT,
      state TEXT NOT NULL,
      PRIMARY KEY (crew, lane)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_crew_lane_host ON crew_lane (host)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_run (
      run TEXT PRIMARY KEY,
      crew TEXT NOT NULL,
      started_by TEXT NOT NULL,
      credential TEXT,
      budget_usd REAL,
      spent_usd REAL NOT NULL DEFAULT 0,
      options_json TEXT NOT NULL,
      state TEXT NOT NULL,
      reason TEXT,
      started_at TEXT NOT NULL,
      wall_ms INTEGER NOT NULL DEFAULT 0,
      waiting_ms INTEGER NOT NULL DEFAULT 0,
      finished_at TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_assignment (
      assignment TEXT PRIMARY KEY,
      run TEXT,
      crew TEXT NOT NULL,
      member TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      created_by TEXT NOT NULL,
      card_json TEXT,
      pending_json TEXT,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      fresh INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      reworks INTEGER NOT NULL DEFAULT 0,
      remerges INTEGER NOT NULL DEFAULT 0,
      merged_head TEXT,
      check_json TEXT,
      review_json TEXT,
      report_json TEXT,
      waiting_json TEXT,
      landed_commit TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (crew, number)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_crew_assignment_crew_state
    ON crew_assignment (crew, state)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_attempt (
      assignment TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      thread_id TEXT,
      dispatch_commit TEXT,
      tip_ref TEXT,
      rotations INTEGER NOT NULL DEFAULT 0,
      ending TEXT,
      ending_detail TEXT,
      cost_usd REAL NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      PRIMARY KEY (assignment, attempt)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_stint (
      crew TEXT NOT NULL,
      member TEXT NOT NULL,
      stint INTEGER NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      session_id TEXT,
      transcript_path TEXT,
      compactions INTEGER NOT NULL DEFAULT 0,
      last_compact_summary TEXT,
      rotate_pending INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      seeded_from_json TEXT,
      brief_version INTEGER NOT NULL,
      job_version INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      retired_at TEXT,
      PRIMARY KEY (crew, member, stint)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_memory (
      crew TEXT NOT NULL,
      member TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      topic TEXT,
      text TEXT NOT NULL,
      paths_json TEXT NOT NULL DEFAULT '[]',
      verified_at TEXT,
      from_assignment TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (crew, member, id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_claim (
      host TEXT PRIMARY KEY,
      crew TEXT NOT NULL,
      member TEXT NOT NULL,
      lane TEXT NOT NULL,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      granted_by TEXT,
      granted_at TEXT,
      expires_at TEXT,
      released_at TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      crew TEXT NOT NULL,
      run TEXT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS crew_host (
      host TEXT PRIMARY KEY,
      crew_ports_json TEXT NOT NULL DEFAULT '[]'
    )
  `;
});
