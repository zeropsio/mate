import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migrateCrew from "./055_Crew.ts";

const CREW_TABLES: Record<string, ReadonlyArray<string>> = {
  crew_definition: [
    "crew",
    "home_host",
    "spec_json",
    "brief_hash",
    "brief_version",
    "applied_at",
    "applied_by",
    "seq",
    "flushed_seq",
    "state",
  ],
  crew_member: [
    "crew",
    "handle",
    "display_name",
    "kind",
    "tint",
    "host",
    "lane",
    "read_only",
    "login",
    "model",
    "effort",
    "job_version",
    "run_command",
    "restart_after_merge",
    "crew_port",
    "config_json",
  ],
  crew_lane: [
    "crew",
    "lane",
    "host",
    "branch",
    "dispatch_commit",
    "recorded_tip",
    "last_landing",
    "ref_snapshot_json",
    "lockfile_hash",
    "frozen_since",
    "state",
  ],
  crew_run: [
    "run",
    "crew",
    "started_by",
    "credential",
    "budget_usd",
    "spent_usd",
    "options_json",
    "state",
    "reason",
    "started_at",
    "wall_ms",
    "waiting_ms",
    "finished_at",
  ],
  crew_assignment: [
    "assignment",
    "run",
    "crew",
    "member",
    "number",
    "title",
    "source",
    "created_by",
    "card_json",
    "pending_json",
    "depends_on_json",
    "fresh",
    "state",
    "attempt",
    "reworks",
    "remerges",
    "merged_head",
    "check_json",
    "review_json",
    "report_json",
    "waiting_json",
    "landed_commit",
    "created_at",
    "updated_at",
  ],
  crew_attempt: [
    "assignment",
    "attempt",
    "thread_id",
    "dispatch_commit",
    "tip_ref",
    "rotations",
    "ending",
    "ending_detail",
    "cost_usd",
    "started_at",
    "ended_at",
  ],
  crew_stint: [
    "crew",
    "member",
    "stint",
    "thread_id",
    "session_id",
    "transcript_path",
    "compactions",
    "last_compact_summary",
    "rotate_pending",
    "reason",
    "seeded_from_json",
    "brief_version",
    "job_version",
    "started_at",
    "retired_at",
  ],
  crew_memory: [
    "crew",
    "member",
    "id",
    "kind",
    "topic",
    "text",
    "paths_json",
    "verified_at",
    "from_assignment",
    "updated_at",
  ],
  crew_claim: [
    "host",
    "crew",
    "member",
    "lane",
    "state",
    "requested_at",
    "granted_by",
    "granted_at",
    "expires_at",
    "released_at",
  ],
  crew_log: ["seq", "crew", "run", "at", "kind", "payload_json"],
  crew_host: ["host", "crew_ports_json"],
};

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("055_Crew", (it) => {
  it.effect("creates every crew table with the architecture's and the PRD's columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      const columnsOf = (table: string) =>
        sql<{ readonly name: string }>`SELECT name FROM pragma_table_info(${table})`.pipe(
          Effect.map((rows) => rows.map((row) => row.name)),
        );
      const found: Record<string, ReadonlyArray<string>> = {};
      for (const table of Object.keys(CREW_TABLES)) {
        found[table] = yield* columnsOf(table);
      }
      assert.deepStrictEqual(found, CREW_TABLES);

      // Re-running against a database that already has the tables changes nothing.
      yield* migrateCrew;
      assert.deepStrictEqual(yield* columnsOf("crew_lane"), CREW_TABLES.crew_lane);
    }),
  );

  it.effect("keeps a task number unique per crew", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      const task = (assignment: string, crew: string) => sql`
        INSERT INTO crew_assignment (
          assignment, crew, member, number, title, source, created_by, state,
          created_at, updated_at
        ) VALUES (
          ${assignment}, ${crew}, 'backend', 1, 'A task', 'you', 'user-1', 'queued',
          '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z'
        )
      `;
      yield* task("a-1", "game");
      yield* task("a-2", "shop");
      const duplicate = yield* task("a-3", "game").pipe(Effect.exit);
      const rows = yield* sql<{ readonly n: number }>`SELECT count(*) AS n FROM crew_assignment`;
      assert.deepStrictEqual(
        { refused: duplicate._tag === "Failure", rows: rows[0]?.n },
        {
          refused: true,
          rows: 2,
        },
      );
    }),
  );
});
