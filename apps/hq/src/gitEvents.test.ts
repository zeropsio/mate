import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { releaseRevisions } from "./gitEvents.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { migrate } from "./migrations.ts";

const SHOP = "00000000-0000-4000-8000-000000000001";
const TEAM = "00000000-0000-4000-8000-000000000002";

/** The git log of a fresh, migrated database. */
const withLog = <A, E>(use: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    return yield* Effect.andThen(migrate(treeMigrations()), use).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(url) })),
    );
  });

const recorded = (kind: string, appId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT INTO hq_git_event (kind, app_id, repo, number)
      VALUES (${kind}, ${appId}::uuid, 'app', NULL)`,
  );

describe("releaseRevisions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Audit R4: every open tab read every application's releases and repositories each minute.
    // The log says where they last moved instead, so a reader reads them only when they do.
    it.effect(
      "an application's release revision is its log's last release, merge or move of main",
      () =>
        withLog(
          Effect.gen(function* () {
            assert.deepStrictEqual(yield* releaseRevisions, new Map());

            yield* recorded("main_moved", SHOP);
            const moved = (yield* releaseRevisions).get(SHOP);
            assert.isString(moved);
            // A push to a branch, a change opened, closed or talked about: nothing a release reads.
            yield* recorded("pushed", SHOP);
            yield* recorded("opened", SHOP);
            yield* recorded("commented", SHOP);
            yield* recorded("closed", SHOP);
            assert.deepStrictEqual(yield* releaseRevisions, new Map([[SHOP, moved]]));

            yield* recorded("released", SHOP);
            const released = (yield* releaseRevisions).get(SHOP);
            assert.notStrictEqual(released, moved);
            // Another application's merge moves only its own.
            yield* recorded("merged", TEAM);
            const both = yield* releaseRevisions;
            assert.strictEqual(both.get(SHOP), released);
            assert.isString(both.get(TEAM));
          }),
        ),
    );
  });
});
