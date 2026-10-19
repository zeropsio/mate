import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migration from "./062_WorkspaceCaptureRemoved.ts";

it.effect("an upgrade keeps every turn and conversation event and forgets workspace capture", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE orchestration_events (sequence INTEGER, event_type TEXT)`;
    yield* sql`
      CREATE TABLE projection_turns (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        pending_message_id TEXT,
        assistant_message_id TEXT,
        state TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        checkpoint_turn_count INTEGER,
        checkpoint_ref TEXT,
        checkpoint_status TEXT,
        checkpoint_files_json TEXT NOT NULL,
        source_proposed_plan_thread_id TEXT,
        source_proposed_plan_id TEXT,
        checkpoint_history_json TEXT,
        UNIQUE (thread_id, turn_id),
        UNIQUE (thread_id, checkpoint_turn_count)
      )
    `;
    yield* sql`CREATE TABLE workspace_capture_runs (thread_id TEXT, run_id TEXT)`;
    yield* sql`CREATE TABLE projection_state (projector TEXT PRIMARY KEY, last_applied_sequence INTEGER)`;
    yield* sql`INSERT INTO projection_state VALUES ('projection.checkpoints', 3), ('projection.thread-turns', 5)`;
    yield* sql`INSERT INTO orchestration_events VALUES
      (1, 'thread.message-sent'),
      (2, 'thread.turn-diff-completed'),
      (3, 'thread.checkpoint-revert-requested'),
      (4, 'thread.reverted'),
      (5, 'thread.session-set')`;
    yield* sql`INSERT INTO projection_turns VALUES
      (7, 'thread', 'turn-1', 'message-1', 'answer-1', 'completed', '2026-10-19T10:00:00Z',
       '2026-10-19T10:00:01Z', '2026-10-19T10:01:00Z', 1, 'refs/t3/checkpoints/x/turn/1', 'ready',
       '[]', 'plan-thread', 'plan-1', NULL),
      (8, 'thread', NULL, 'message-2', NULL, 'pending', '2026-10-19T10:02:00Z',
       NULL, NULL, NULL, NULL, NULL, '[]', NULL, NULL, NULL)`;
    yield* migration;

    const events = yield* sql<{
      readonly type: string;
    }>`SELECT event_type AS type FROM orchestration_events ORDER BY sequence`;
    assert.deepStrictEqual(
      events.map((event) => event.type),
      ["thread.message-sent", "thread.session-set"],
    );
    const turns = yield* sql`SELECT * FROM projection_turns ORDER BY row_id`;
    assert.deepStrictEqual(turns, [
      {
        row_id: 7,
        thread_id: "thread",
        turn_id: "turn-1",
        pending_message_id: "message-1",
        source_proposed_plan_thread_id: "plan-thread",
        source_proposed_plan_id: "plan-1",
        assistant_message_id: "answer-1",
        state: "completed",
        requested_at: "2026-10-19T10:00:00Z",
        started_at: "2026-10-19T10:00:01Z",
        completed_at: "2026-10-19T10:01:00Z",
      },
      {
        row_id: 8,
        thread_id: "thread",
        turn_id: null,
        pending_message_id: "message-2",
        source_proposed_plan_thread_id: null,
        source_proposed_plan_id: null,
        assistant_message_id: null,
        state: "pending",
        requested_at: "2026-10-19T10:02:00Z",
        started_at: null,
        completed_at: null,
      },
    ]);
    const journal = yield* sql`
      SELECT name FROM sqlite_master WHERE name = 'workspace_capture_runs'
    `;
    assert.deepStrictEqual(journal, []);
    const cursors = yield* sql<{
      readonly projector: string;
    }>`SELECT projector FROM projection_state ORDER BY projector`;
    assert.deepStrictEqual(
      cursors.map((cursor) => cursor.projector),
      ["projection.thread-turns"],
    );
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
