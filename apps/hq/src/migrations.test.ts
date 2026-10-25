import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { MIGRATIONS_TABLE, migrate } from "./migrations.ts";

/** A pool on a fresh database of the file's cluster. */
const withSql = <A, E>(use: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    return yield* use.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
  });

const recorded = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM ${sql(MIGRATIONS_TABLE)} ORDER BY name`;
  return rows.map((row) => row.name);
});

const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'm_%' ORDER BY 1`;
  return rows.map((row) => row.name);
});

describe("migrate", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "existing Chief registrations retain their application's identity after the schema expands",
      () =>
        withSql(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const files = treeMigrations();
            yield* migrate(files.filter((file) => file.name < "0056_"));
            const [app] =
              yield* sql`INSERT INTO hq_app (name, created_by) VALUES ('Chief', 'person') RETURNING id::text`;
            yield* sql`INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
          VALUES ('chief-project', ${app!.id}::uuid, 'mate', 'person')`;
            yield* sql`INSERT INTO hq_chief (credential_hash, org_id, user_id, project_id)
          VALUES ('migration-chief-hash', 'org', 'person', 'chief-project')`;
            yield* migrate(files);
            yield* sql`DELETE FROM hq_app_project WHERE project_id = 'chief-project'`;
            assert.deepStrictEqual(yield* sql`SELECT app_id::text FROM hq_chief`, [
              { app_id: app!.id },
            ]);
          }),
        ),
    );
    it.effect(
      "a Mate signed in by somebody other than its maker before makers kept their Mates stays the signer's",
      () =>
        withSql(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const files = treeMigrations();
            yield* migrate(files.filter((file) => file.name < "0061_"));
            const [app] =
              yield* sql`INSERT INTO hq_app (name, created_by) VALUES ('Shop Front', 'maker') RETURNING id::text`;
            for (const projectId of [
              "signed-by-other",
              "signed-by-maker",
              "never-signed",
              "legacy",
            ])
              yield* sql`INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
            VALUES (${projectId}, ${app!.id}::uuid, 'mate', 'maker')`;
            yield* sql`INSERT INTO hq_mate (project_id, face, made_by, signers) VALUES
              ('signed-by-other', '', 'maker', '{"codex":"colleague"}'::jsonb),
              ('signed-by-maker', '', 'maker', '{"claude-code":"maker","codex":"colleague"}'::jsonb),
              ('never-signed', '', 'maker', '{}'::jsonb),
              ('legacy', '', NULL, '{"claude-code":"colleague"}'::jsonb)`;
            yield* migrate(files);
            assert.deepStrictEqual(
              yield* sql`SELECT project_id, made_by FROM hq_mate ORDER BY project_id`,
              [
                { project_id: "legacy", made_by: "colleague" },
                { project_id: "never-signed", made_by: "maker" },
                { project_id: "signed-by-maker", made_by: "maker" },
                { project_id: "signed-by-other", made_by: "colleague" },
              ],
            );
          }),
        ),
    );
    it.effect(
      "applies the files in name order, several statements each, and records every one",
      () =>
        withSql(
          Effect.gen(function* () {
            const applied = yield* migrate([
              {
                name: "0002_b.sql",
                sql: "CREATE TABLE m_b (id int REFERENCES m_a);\nINSERT INTO m_a VALUES (1);",
              },
              { name: "0001_a.sql", sql: "CREATE TABLE m_a (id int PRIMARY KEY);" },
            ]);
            assert.deepStrictEqual(applied, ["0001_a.sql", "0002_b.sql"]);
            assert.deepStrictEqual(yield* recorded, ["0001_a.sql", "0002_b.sql"]);
            assert.deepStrictEqual(yield* tables, ["m_a", "m_b"]);
          }),
        ),
    );

    it.effect("applies only the files it has not recorded", () =>
      withSql(
        Effect.gen(function* () {
          const first = { name: "0001_a.sql", sql: "CREATE TABLE m_a (id int);" };
          yield* migrate([first]);
          const applied = yield* migrate([
            first,
            { name: "0002_b.sql", sql: "CREATE TABLE m_b (id int);" },
          ]);
          assert.deepStrictEqual(applied, ["0002_b.sql"]);
          assert.deepStrictEqual(yield* migrate([first]), []);
          assert.deepStrictEqual(yield* recorded, ["0001_a.sql", "0002_b.sql"]);
        }),
      ),
    );

    it.effect("rolls a failing file back whole, keeps the files before it, and names it", () =>
      withSql(
        Effect.gen(function* () {
          const error = yield* migrate([
            { name: "0001_a.sql", sql: "CREATE TABLE m_a (id int);" },
            { name: "0002_b.sql", sql: "CREATE TABLE m_b (id int);\nSELECT * FROM m_missing;" },
            { name: "0003_c.sql", sql: "CREATE TABLE m_c (id int);" },
          ]).pipe(Effect.flip);
          assert.strictEqual(error._tag, "MigrationError");
          assert.strictEqual(error.migration, "0002_b.sql");
          assert.deepStrictEqual(yield* recorded, ["0001_a.sql"]);
          assert.deepStrictEqual(yield* tables, ["m_a"]);
        }),
      ),
    );

    // The migration from main ran once, before the switch; its tables go with its code.
    it.effect(
      "keeps a change described before drafts existed asking, and an undescribed one a draft",
      () =>
        withSql(
          Effect.gen(function* () {
            const all = treeMigrations();
            const at = all.findIndex((file) => file.name.startsWith("0043_"));
            yield* migrate(all.slice(0, at));
            const sql = yield* SqlClient.SqlClient;
            const head = "a".repeat(40);
            yield* sql`INSERT INTO hq_app (id, name, created_by)
            VALUES ('00000000-0000-0000-0000-000000000001', 'Shop', 'owner')`;
            yield* sql`INSERT INTO hq_repo (app_id, name, created_by)
            VALUES ('00000000-0000-0000-0000-000000000001', 'appdev', 'owner')`;
            for (const [number, body] of [
              [1, "It adds a login page."],
              [2, ""],
              [3, "  "],
            ] as const) {
              yield* sql`INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, body, state, head)
              VALUES ('00000000-0000-0000-0000-000000000001', 'appdev', ${number}, 'P_MATE',
                'The task', ${body}, 'closed', ${head})`;
            }
            yield* migrate(all);
            const rows = yield* sql<{ readonly number: number; readonly ready: boolean }>`
            SELECT number, COALESCE(ready_head = head, false) AS ready FROM hq_change ORDER BY number`;
            assert.deepStrictEqual(
              rows.map((row) => [row.number, row.ready]),
              [
                [1, true],
                [2, false],
                [3, false],
              ],
            );
          }),
        ),
    );

    it.effect(
      "a change GitHub merged before HQ recorded what a person merged in Mate reads merged outside Mate, and one merged in Mate does not",
      () =>
        withSql(
          Effect.gen(function* () {
            const all = treeMigrations();
            const before = (prefix: string) =>
              all.findIndex((file) => file.name.startsWith(prefix));
            yield* migrate(all.slice(0, before("0076_")));
            const sql = yield* SqlClient.SqlClient;
            const app = "00000000-0000-0000-0000-000000000001";
            yield* sql`INSERT INTO hq_app (id, name, created_by) VALUES (${app}, 'Shop', 'owner')`;
            yield* sql`INSERT INTO hq_repo (app_id, name, created_by)
              VALUES (${app}, 'appdev', 'owner')`;
            const change = (number: number, state: string, by: Record<string, string> | null) =>
              Effect.gen(function* () {
                const head = String(number).repeat(40);
                yield* sql`INSERT INTO hq_change (app_id, repo, number, mate_project_id, title,
                    state, head, landed_head)
                  VALUES (${app}, 'appdev', ${number}, 'P_MATE', 'The task', ${state}, ${head},
                    ${state === "merged" ? head : null})`;
                if (by !== null)
                  yield* sql`INSERT INTO hq_git_event (kind, app_id, repo, number, data)
                    VALUES ('merged', ${app}, 'appdev', ${number},
                      ${JSON.stringify({ mergedSha: head, landedHead: head, ...by })}::jsonb)`;
              });
            // Merged on GitHub, merged in Mate, and still open — all before 0076.
            yield* change(1, "merged", { by: "github" });
            yield* change(2, "merged", { userId: "owner" });
            yield* change(3, "open", null);
            yield* migrate(all.slice(0, before("0078_")));
            // Merged on GitHub after 0076, of a head a person merged in Mate.
            yield* change(4, "merged", { by: "github" });
            yield* sql`INSERT INTO hq_gate (app_id, repo, sha, by)
              VALUES (${app}, 'appdev', ${"4".repeat(40)}, 'owner')`;
            yield* migrate(all);
            const rows = yield* sql<{ readonly number: number; readonly outside: boolean }>`
              SELECT number, landed_outside AS outside FROM hq_change ORDER BY number`;
            assert.deepStrictEqual(
              rows.map((row) => [row.number, row.outside]),
              [
                [1, true],
                [2, false],
                [3, false],
                [4, false],
              ],
            );
          }),
        ),
    );

    it.effect(
      "a change opened before changes named their branch is on mate/<Mate>/<number>, and one open change at a time holds a branch",
      () =>
        withSql(
          Effect.gen(function* () {
            const all = treeMigrations();
            yield* migrate(all.filter((file) => file.name < "0081_"));
            const sql = yield* SqlClient.SqlClient;
            const app = "00000000-0000-0000-0000-000000000001";
            yield* sql`INSERT INTO hq_app (id, name, created_by) VALUES (${app}, 'Shop', 'owner')`;
            yield* sql`INSERT INTO hq_repo (app_id, name, created_by)
              VALUES (${app}, 'appdev', 'owner')`;
            for (const [number, mate, state] of [
              [1, "P_MATE", "merged"],
              [2, "P_MATE", "open"],
              [3, "P_BEA", "open"],
            ] as const)
              yield* sql`INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, state)
                VALUES (${app}, 'appdev', ${number}, ${mate}, 'The task', ${state})`;
            yield* migrate(all);
            const rows = yield* sql<{ readonly number: number; readonly branch: string }>`
              SELECT number, branch FROM hq_change ORDER BY number`;
            assert.deepStrictEqual(
              rows.map((row) => [row.number, row.branch]),
              [
                [1, "mate/P_MATE/1"],
                [2, "mate/P_MATE/2"],
                [3, "mate/P_BEA/3"],
              ],
            );
            const open = (number: number, branch: string) =>
              Effect.exit(sql`INSERT INTO hq_change (app_id, repo, number, mate_project_id, title,
                  branch) VALUES (${app}, 'appdev', ${number}, 'P_CY', 'Another', ${branch})`);
            // A merged change's branch is free again; an open change's is not.
            assert.strictEqual((yield* open(4, "mate/P_MATE/1"))._tag, "Success");
            yield* sql`UPDATE hq_change SET state = 'closed' WHERE number = 4`;
            assert.strictEqual((yield* open(5, "mate/P_MATE/2"))._tag, "Failure");
          }),
        ),
    );

    it.effect(
      "a person's own Mate keeps one default change per repository beside any on a branch it named or was handed, the open changes before it kept as they were",
      () =>
        withSql(
          Effect.gen(function* () {
            const all = treeMigrations();
            yield* migrate(all.filter((file) => file.name < "0084_"));
            const sql = yield* SqlClient.SqlClient;
            const app = "00000000-0000-0000-0000-000000000001";
            yield* sql`INSERT INTO hq_app (id, name, created_by) VALUES (${app}, 'Shop', 'owner')`;
            yield* sql`INSERT INTO hq_repo (app_id, name, created_by)
              VALUES (${app}, 'appdev', 'owner')`;
            const insert = (number: number, mate: string, branch: string, state = "open") =>
              Effect.exit(sql`INSERT INTO hq_change (app_id, repo, number, mate_project_id, title,
                  state, branch) VALUES (${app}, 'appdev', ${number}, ${mate}, 'The task', ${state},
                  ${branch})`);
            for (const [number, mate, state] of [
              [1, "P_MATE", "merged"],
              [2, "P_MATE", "open"],
              [3, "P_BEA", "open"],
            ] as const)
              assert.isTrue(
                Exit.isSuccess(yield* insert(number, mate, `mate/${mate}/${number}`, state)),
              );
            yield* migrate(all);
            const rows = yield* sql<{ readonly number: number; readonly state: string }>`
              SELECT number, state FROM hq_change ORDER BY number`;
            assert.deepStrictEqual(
              rows.map((row) => [row.number, row.state]),
              [
                [1, "merged"],
                [2, "open"],
                [3, "open"],
              ],
            );
            // Beside its default change: one on a branch it named, one handed to it on another
            // Mate's default branch; a second default change is refused.
            assert.isTrue(Exit.isSuccess(yield* insert(4, "P_MATE", "fix-login")));
            assert.isTrue(Exit.isSuccess(yield* insert(5, "P_MATE", "mate/P_GONE/5")));
            assert.isTrue(Exit.isFailure(yield* insert(6, "P_MATE", "mate/P_MATE/6")));
            const indexes = yield* sql<{ readonly name: string }>`
              SELECT indexname AS name FROM pg_indexes
              WHERE tablename = 'hq_change' AND indexname LIKE 'hq\\_change\\_%open%'
                OR indexname = 'hq_change_one_default' ORDER BY 1`;
            assert.deepStrictEqual(
              indexes.map((index) => index.name),
              [
                "hq_change_mate_open",
                "hq_change_one_default",
                "hq_change_open_branch",
                "hq_change_task_open",
              ],
            );
            // Once its default change is no longer open, the next one may be.
            yield* sql`UPDATE hq_change SET state = 'closed' WHERE number = 2`;
            assert.isTrue(Exit.isSuccess(yield* insert(7, "P_MATE", "mate/P_MATE/7")));
          }),
        ),
    );

    it.effect("leaves none of the migration from main's tables", () =>
      withSql(
        Effect.gen(function* () {
          yield* migrate(treeMigrations());
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{ readonly name: string }>`
            SELECT table_name AS name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name LIKE 'hq\\_import%' ORDER BY 1`;
          assert.deepStrictEqual(
            rows.map((row) => row.name),
            [],
          );
        }),
      ),
    );
    it.effect(
      "A mirrored repository's row keeps no record of GitHub's other branches and tags",
      () =>
        withSql(
          Effect.gen(function* () {
            yield* migrate(treeMigrations());
            const sql = yield* SqlClient.SqlClient;
            const rows = yield* sql<{ readonly name: string }>`
            SELECT column_name AS name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'hq_repo_mirror'
              AND column_name = 'followed_refs'`;
            assert.deepStrictEqual(rows, []);
          }),
        ),
    );
    it.effect(
      "Git target expansion preserves Zerops records, project bindings and legacy storage.",
      () =>
        withSql(
          Effect.gen(function* () {
            const all = treeMigrations();
            const name = "0054_git_targets_expand.sql";
            assert.strictEqual(all.filter((file) => file.name === name).length, 1);
            yield* migrate(all.filter((file) => file.name < name));
            const sql = yield* SqlClient.SqlClient;
            const app = "11111111-1111-4111-8111-111111111111";
            yield* sql`INSERT INTO hq_app(id,name,created_by) VALUES (${app}::uuid,'migration','owner')`;
            yield* sql`INSERT INTO hq_repo(app_id,name,created_by) VALUES (${app}::uuid,'web','owner')`;
            yield* sql`INSERT INTO hq_app_project(project_id,app_id,kind,created_by) VALUES ('stage',${app}::uuid,'stage','owner')`;
            yield* sql`INSERT INTO hq_environment(id,project_id,app_id,tier,name,sources,created_by,release_floor)
        VALUES ('stage','stage',${app}::uuid,'stage','stage',ARRAY['main'],'owner','2026-09-01T00:00:00Z')`;
            yield* sql`INSERT INTO hq_deploy_token(project_id,sealed,key_id,kept_by) VALUES ('stage',decode('012345','hex'),'old-key','owner')`;
            yield* sql`INSERT INTO hq_subdomain_intent(project_id,service) VALUES ('stage','web')`;
            const [rollout] = yield* sql<{
              id: string;
            }>`INSERT INTO hq_rollout(app_id,cause,project_id,environment_id,left_out)
        VALUES (${app}::uuid,'env_added','stage','stage','[{"project_id":"stage","environment_id":"stage","reason":"kept"}]') RETURNING id::text AS id`;
            for (const [state, ended] of [
              ["queued", false],
              ["building", false],
              ["live", true],
              ["unresolved", true],
            ] as const)
              yield* sql`INSERT INTO hq_deploy_job(rollout_id,kind,project_id,environment_id,service,repo,sha,state,ended_at,evidence)
          VALUES (${rollout!.id}::bigint,'deploy','stage','stage','web','web',${"a".repeat(40)},${state},${ended ? sql`now()` : null},'{"receipt":"kept"}')`;
            yield* sql`INSERT INTO hq_release(app_id,tag,sha,entries,released_by,state,snapshot)
        VALUES (${app}::uuid,'v1.0.0',${"a".repeat(40)},'[]','owner','approved',true)`;
            const tables = [
              "hq_environment",
              "hq_app_project",
              "hq_rollout",
              "hq_deploy_job",
              "hq_deploy_token",
              "hq_subdomain_intent",
              "hq_release",
            ];
            const before: Record<string, ReadonlyArray<{ value: Record<string, unknown> }>> = {};
            for (const table of tables)
              before[table] = yield* sql<{
                value: Record<string, unknown>;
              }>`SELECT to_jsonb(t) AS value FROM ${sql(table)} t ORDER BY to_jsonb(t)::text`;
            yield* migrate(all);
            for (const table of tables) {
              const after = yield* sql<{
                value: Record<string, unknown>;
              }>`SELECT to_jsonb(t) AS value FROM ${sql(table)} t ORDER BY to_jsonb(t)::text`;
              assert.strictEqual(after.length, before[table]!.length);
              for (let i = 0; i < after.length; i++)
                for (const [key, value] of Object.entries(before[table]![i]!.value))
                  assert.deepStrictEqual(after[i]!.value[key], value, `${table}.${key}`);
            }
            yield* sql`UPDATE hq_environment SET name='still-writable' WHERE project_id='stage'`;
            yield* sql`UPDATE hq_deploy_token SET key_id='legacy-updated' WHERE project_id='stage'`;
            assert.deepStrictEqual(yield* sql`SELECT id,project_id FROM hq_environment`, [
              { id: "stage", project_id: "stage" },
            ]);
            yield* sql`INSERT INTO hq_environment(id,app_id,target,tier,name,sources,branch,delivery,created_by)
        VALUES ('git-prod',${app}::uuid,'git','production','git-prod',ARRAY['release'],'release','direct','owner')`;
            assert.deepStrictEqual(
              yield* sql`SELECT id,project_id,target FROM hq_environment WHERE id='git-prod'`,
              [{ id: "git-prod", project_id: null, target: "git" }],
            );
            yield* sql`INSERT INTO hq_deploy_job(rollout_id,kind,environment_id,repo,sha,state,ended_at)
        VALUES (${rollout!.id}::bigint,'push','git-prod','web',${"a".repeat(40)},'pushed',now())`;
            // Legacy project-bound storage still cascades only when its Zerops attachment leaves.
            yield* sql`DELETE FROM hq_environment WHERE project_id='stage'`;
            for (const table of ["hq_deploy_token", "hq_subdomain_intent"])
              assert.strictEqual((yield* sql`SELECT 1 FROM ${sql(table)}`).length, 0);
            assert.strictEqual(
              (yield* sql`SELECT 1 FROM hq_deploy_job WHERE environment_id='git-prod'`).length,
              1,
            );
            assert.strictEqual((yield* sql`SELECT 1 FROM hq_release`).length, 1);
          }),
        ),
    );

    it.effect(
      "Git targets cannot steal Zerops project bindings, branch slots or another application's remote.",
      () =>
        withSql(
          Effect.gen(function* () {
            yield* migrate(treeMigrations());
            const sql = yield* SqlClient.SqlClient;
            const app = "11111111-1111-4111-8111-111111111111";
            yield* sql`INSERT INTO hq_app(id,name,created_by) VALUES (${app}::uuid,'constraints','owner')`;
            yield* sql`INSERT INTO hq_repo(app_id,name,created_by) VALUES (${app}::uuid,'web','owner')`;
            yield* sql`INSERT INTO hq_app_project(project_id,app_id,kind,created_by) VALUES ('stage',${app}::uuid,'stage','owner')`;
            yield* sql`INSERT INTO hq_environment(id,project_id,app_id,tier,name,sources,created_by)
        VALUES ('stage','stage',${app}::uuid,'stage','stage',ARRAY['main'],'owner')`;
            const rejected = [
              sql`INSERT INTO hq_environment(id,project_id,app_id,tier,name,sources,created_by) VALUES ('duplicate','stage',${app}::uuid,'stage','duplicate',ARRAY['main'],'owner')`,
              sql`INSERT INTO hq_environment(id,app_id,target,tier,name,sources,created_by) VALUES ('bad-git',${app}::uuid,'git','stage','bad-git',ARRAY['main'],'owner')`,
              sql`INSERT INTO hq_environment(id,project_id,app_id,target,tier,name,sources,branch,delivery,created_by) VALUES ('git-project','stage',${app}::uuid,'git','stage','git-project',ARRAY['main'],'main','direct','owner')`,
              sql`INSERT INTO hq_repo_remote(app_id,repo,url,url_key,host) VALUES (${app}::uuid,'absent','https://github.com/a/b.git','github.com/a/b','github.com')`,
            ];
            for (const operation of rejected)
              assert.strictEqual((yield* operation.pipe(Effect.flip))._tag, "SqlError");
            yield* sql`INSERT INTO hq_environment(id,app_id,target,tier,name,sources,branch,delivery,created_by) VALUES ('git-one',${app}::uuid,'git','stage','git-one',ARRAY['main'],'main','direct','owner')`;
            assert.strictEqual(
              (yield* sql`INSERT INTO hq_environment(id,app_id,target,tier,name,sources,branch,delivery,created_by) VALUES ('git-two',${app}::uuid,'git','stage','git-two',ARRAY['main'],'main','direct','owner')`.pipe(
                Effect.flip,
              ))._tag,
              "SqlError",
            );
          }),
        ),
    );
  });
});
