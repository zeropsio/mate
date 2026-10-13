import { describe, expect, it } from "@effect/vitest";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { addRollout, rolloutOf } from "./rollouts.ts";

const APP = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(40);
const withSql = <A, E>(use: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createMigratedDatabase;
    return yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO hq_app(id,name,created_by) VALUES (${APP}::uuid,'Rollouts','owner')`;
      return yield* use;
    }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
  });
const addGit = (id: string, tier: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO hq_environment(id,app_id,target,tier,name,sources,branch,delivery,created_by)
    VALUES (${id},${APP}::uuid,'git',${tier},${id},${tier === "stage" ? "{main}" : "{release}"}::text[],${id},'direct','owner')`;
  });

describe("rollout provenance", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "remote credential maintenance records every Git environment's exact attachment",
      () =>
        withSql(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* addGit("stage", "stage");
            yield* addGit("production", "production");
            const event = { cause: "key_kept" as const, appId: APP, repo: "code", by: "owner" };
            yield* addRollout(sql, event);
            const rows = yield* sql<{
              readonly environment_id: string;
              readonly same: boolean;
              readonly project_id: null;
              readonly repo: string;
            }>`
        SELECT r.environment_id,r.project_id,r.repo,r.environment_created_at=e.created_at AS same
        FROM hq_rollout r JOIN hq_environment e ON e.id=r.environment_id ORDER BY r.environment_id`;
            expect(rows).toEqual([
              { environment_id: "production", project_id: null, repo: "code", same: true },
              { environment_id: "stage", project_id: null, repo: "code", same: true },
            ]);
            const newest = yield* rolloutOf(sql, event);
            const [last] = yield* sql<{
              readonly id: string;
            }>`SELECT id::text FROM hq_rollout ORDER BY id DESC LIMIT 1`;
            expect(newest).toBe(last!.id);
          }),
        ),
    );
    it.effect(
      "a release rollout retains its accepted destination after that attachment is removed",
      () =>
        withSql(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* addGit("original", "production");
            yield* sql`INSERT INTO hq_release(app_id,tag,sha,entries,released_by,state,target,environment_id,environment_created_at)
        SELECT ${APP}::uuid,'v1.0.0',${SHA},'[]'::jsonb,'owner','approved','git',id,created_at FROM hq_environment WHERE id='original'`;
            const [accepted] = yield* sql<{
              readonly stamp: string;
            }>`SELECT environment_created_at::text AS stamp FROM hq_release`;
            yield* sql`DELETE FROM hq_environment WHERE id='original'`;
            yield* addGit("replacement", "production");
            yield* addRollout(sql, { cause: "release", appId: APP, tag: "v1.0.0", by: "owner" });
            const [rollout] = yield* sql<{
              readonly environment_id: string;
              readonly stamp: string;
            }>`SELECT environment_id,environment_created_at::text AS stamp FROM hq_rollout`;
            expect(rollout).toEqual({ environment_id: "original", stamp: accepted!.stamp });
          }),
        ),
    );
    it.effect("Zerops environment events keep their project identity and attachment stamp", () =>
      withSql(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO hq_app_project(project_id,app_id,kind,created_by) VALUES ('P',${APP}::uuid,'stage','owner')`;
          yield* sql`INSERT INTO hq_environment(id,project_id,app_id,tier,name,sources,created_by) VALUES ('P','P',${APP}::uuid,'stage','stage','{main}','owner')`;
          for (const cause of ["env_added", "key_kept"] as const)
            yield* addRollout(sql, { cause, projectId: "P", by: "owner" });
          const rows = yield* sql<{
            readonly cause: string;
            readonly project_id: string;
            readonly environment_id: string;
            readonly same: boolean;
          }>`
        SELECT cause,r.project_id,environment_id,environment_created_at=e.created_at AS same
        FROM hq_rollout r JOIN hq_environment e ON e.id=r.environment_id ORDER BY r.id`;
          expect(rows).toEqual(
            ["env_added", "key_kept"].map((cause) => ({
              cause,
              project_id: "P",
              environment_id: "P",
              same: true,
            })),
          );
        }),
      ),
    );
    it.effect("a main move has one durable rollout even when both owners report it", () =>
      withSql(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const event = { cause: "merge" as const, appId: APP, repo: "code", sha: SHA };
          yield* addRollout(sql, event);
          yield* addRollout(sql, event);
          const rows = yield* sql<{
            readonly id: string;
            readonly sha: string;
          }>`SELECT id::text,sha FROM hq_rollout`;
          expect(rows.length).toBe(1);
          expect(rows[0]!.sha).toBe(SHA);
          expect(yield* rolloutOf(sql, event)).toBe(rows[0]!.id);
        }),
      ),
    );
  });
});
