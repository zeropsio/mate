import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("046_ProjectionThreadsLatestUserMessagePreview", (it) => {
  it.effect("adds the column and fills it from each thread's newest user message", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 45 });

      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at,
          latest_user_message_at, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, deleted_at
        )
        VALUES (
          'thread-1', 'project-1', 'create todo app', '{"provider":"codex","model":"gpt-5-codex"}',
          'approval-required', 'default', NULL, NULL, NULL, '2026-09-06T00:00:00.000Z',
          '2026-09-06T00:00:00.000Z', NULL, NULL, 0, 0, 0, NULL
        )
      `;
      const messages = [
        ["message-1", "user", "create a todo app", "2026-09-06T00:00:01.000Z"],
        ["message-2", "assistant", "Done.", "2026-09-06T00:00:02.000Z"],
        ["message-3", "user", "give it **optimistic** updates", "2026-09-06T00:00:03.000Z"],
        ["message-4", "assistant", "Deploying and verifying now.", "2026-09-06T00:00:04.000Z"],
      ] as const;
      for (const [messageId, role, text, createdAt] of messages) {
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
          )
          VALUES (${messageId}, 'thread-1', NULL, ${role}, ${text}, 0, ${createdAt}, ${createdAt})
        `;
      }

      yield* runMigrations({ toMigrationInclusive: 46 });

      const rows = yield* sql<{ readonly latestUserMessagePreview: string | null }>`
        SELECT latest_user_message_preview_json AS "latestUserMessagePreview"
        FROM projection_threads
        WHERE thread_id = 'thread-1'
      `;
      assert.deepEqual(
        rows.map((row) =>
          row.latestUserMessagePreview === null ? null : JSON.parse(row.latestUserMessagePreview),
        ),
        [
          {
            role: "user",
            text: "give it optimistic updates",
            createdAt: "2026-09-06T00:00:03.000Z",
          },
        ],
      );
    }),
  );
});
