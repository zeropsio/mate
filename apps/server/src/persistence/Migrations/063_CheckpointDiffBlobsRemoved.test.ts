import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migration from "./063_CheckpointDiffBlobsRemoved.ts";

it.effect("an upgrade forgets the turns' stored diffs", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE checkpoint_diff_blobs (thread_id TEXT, diff TEXT)`;
    yield* sql`INSERT INTO checkpoint_diff_blobs VALUES ('thread', 'diff --git a/x b/x')`;

    yield* migration;

    assert.deepStrictEqual(
      yield* sql`SELECT name FROM sqlite_master WHERE name LIKE 'checkpoint_diff_blobs%'`,
      [],
    );
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
