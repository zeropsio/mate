import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { preExpandCore } from "../test/harness/preExpandCore.ts";
import { tempDir } from "../test/harness/tempDir.ts";
import { startCore, untilHealth, sessionFor } from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { migrate } from "./migrations.ts";
import { readEnvironmentSource } from "./environmentNavigation.ts";
// Old-Core compatibility belongs to 0052's supported schema. 0054 requires the identity-writer
// floor; its full-current-schema controls live in migrations.test.ts.
vi.mock("./migrationFiles.ts", async (original) => {
  const module = await original<typeof import("./migrationFiles.ts")>();
  return {
    ...module,
    treeMigrations: () => module.treeMigrations().filter((file) => file.name < "0054_"),
  };
});
const NAME = "0052_environment_identity.sql";
const APP = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(40);
const expansion = () => treeMigrations().filter((file) => file.name === NAME);
const withSql = <A, E>(use: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    return yield* use.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
  });
const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* migrate(treeMigrations().filter((file) => file.name < NAME));
  yield* sql`INSERT INTO hq_app (id, name, created_by) VALUES (${APP}::uuid, 'identity', 'owner')`;
  for (const tier of ["stage", "production"] as const) {
    yield* sql`INSERT INTO hq_app_project (project_id, app_id, kind, created_by) VALUES (${tier}, ${APP}::uuid, ${tier}, 'owner')`;
    yield* sql`INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
      VALUES (${tier}, ${APP}::uuid, ${tier}, ${tier},
        ${tier === "production" ? sql`ARRAY['release']` : sql`ARRAY['main']`}, 'owner')`;
  }
  yield* sql`UPDATE hq_environment SET declared_seq = 4, release_floor = '2026-09-01T10:00:00Z' WHERE project_id = 'production'`;
  yield* sql`INSERT INTO hq_deploy_token (project_id, sealed, key_id, kept_by) VALUES ('stage', decode('012345', 'hex'), 'test-key', 'owner')`;
  yield* sql`INSERT INTO hq_subdomain_intent (project_id, service) VALUES ('stage', 'web')`;
  const [r] = yield* sql<{
    id: string;
  }>`INSERT INTO hq_rollout (app_id, cause, project_id, left_out)
    VALUES (${APP}::uuid, 'env_added', 'stage', '[{"project_id":"stage","service":"web","job":null,"reason":"kept","extra":{"keep":true}}]'::jsonb) RETURNING id::text AS id`;
  for (const [service, state, terminal] of [
    ["web", "queued", false],
    ["worker", "building", false],
    ["web", "failed", true],
    ["worker", "unresolved", true],
    ["web", "live", true],
  ] as const)
    yield* sql`INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state, ended_at)
      VALUES (${r!.id}::bigint, 'deploy', 'stage', ${service}, 'monorepo', ${SHA}, ${state},
        ${terminal ? sql`'2026-09-02T10:00:00Z'::timestamptz` : null})`;
  yield* sql`INSERT INTO hq_rollout (app_id, cause, project_id) VALUES (${APP}::uuid, 'migrated', NULL), (${APP}::uuid, 'env_added', 'removed-history')`;
  yield* sql`INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state, snapshot)
    VALUES (${APP}::uuid, 'v1.0.0', ${SHA}, '[]', 'owner', 'approved', true),
      (${APP}::uuid, 'v1.1.0', ${SHA}, '[]', 'owner', 'approved', false)`;
});
const records = (expanded: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const result: Record<string, ReadonlyArray<unknown>> = {};
    for (const table of [
      "hq_app_project",
      "hq_environment",
      "hq_deploy_job",
      "hq_rollout",
      "hq_deploy_token",
      "hq_subdomain_intent",
      "hq_release",
    ]) {
      const strip =
        expanded && table === "hq_environment"
          ? " - 'id' - 'target'"
          : expanded && (table === "hq_deploy_job" || table === "hq_rollout")
            ? " - 'environment_id'"
            : "";
      const rows = yield* sql<{
        value: Record<string, unknown>;
      }>`SELECT to_jsonb(t)${sql.literal(strip)} AS value FROM ${sql(table)} t ORDER BY to_jsonb(t)::text`;
      result[table] = rows.map(({ value }) =>
        expanded && table === "hq_rollout"
          ? {
              ...value,
              left_out: (value.left_out as ReadonlyArray<Record<string, unknown>>).map(
                ({ environment_id: _identity, ...entry }) => entry,
              ),
            }
          : value,
      );
    }
    return result;
  });
const constraints = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    name: string;
    definition: string;
  }>`SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid IN ('hq_environment'::regclass, 'hq_deploy_job'::regclass, 'hq_rollout'::regclass,
      'hq_deploy_token'::regclass, 'hq_subdomain_intent'::regclass, 'hq_release'::regclass, 'hq_app_project'::regclass) ORDER BY conname`;
});
describe("environment identity expansion", () => {
  it.layer(Layer.merge(tempPostgresLayer, NodeServices.layer), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "A new Zerops attachment persists its environment identity and project target.",
        () =>
          Effect.gen(function* () {
            const core = yield* startCore(true);
            yield* untilHealth(core.call, "active");
            const owner = yield* sessionFor(core.call, "door-owner");
            const made = yield* core.call("POST", "/api/apps", {
              session: owner,
              body: { name: "New identity" },
            });
            assert.strictEqual(made.status, 201);
            const appId = (made.body as { id: string }).id;
            const attached = yield* core.call("POST", `/api/apps/${appId}/projects`, {
              session: owner,
              body: { projectId: "P_MATE", kind: "stage", environment: { name: "stage" } },
            });
            assert.strictEqual(attached.status, 201);
            assert.deepStrictEqual(
              yield* core.sql`SELECT id, project_id, target FROM hq_environment`,
              [{ id: "P_MATE", project_id: "P_MATE", target: "zerops" }],
            );
            const detail = (yield* core.call("GET", "/api/structure", { session: owner })).body as {
              apps: Array<{
                id: string;
                environments: Array<{ id: string; projectId: string; target: unknown }>;
              }>;
            };
            assert.deepStrictEqual(
              detail.apps
                .find((app) => app.id === appId)!
                .environments.map(({ id, projectId, target }) => ({ id, projectId, target })),
              [
                {
                  id: "P_MATE",
                  projectId: "P_MATE",
                  target: { kind: "zerops", projectId: "P_MATE" },
                },
              ],
            );
            yield* core.stop;
          }),
      );
      it.effect(
        "Identity backfill preserves every environment, job, rollout and project-bound key and creates no jobs.",
        () =>
          withSql(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* seed;
              const before = yield* records(false);
              const oldReceipts =
                yield* sql`SELECT name, applied_at FROM hq_migration ORDER BY name`;
              const oldConstraints = yield* constraints;
              const routines = sql`SELECT p.oid::regprocedure::text AS signature FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                ORDER BY signature`;
              const oldRoutines = yield* routines;
              const oldIndexes =
                yield* sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`;
              assert.deepStrictEqual(yield* migrate(expansion()), [NAME]);
              assert.deepStrictEqual(yield* records(true), before);
              assert.deepStrictEqual(
                yield* sql`SELECT name, applied_at FROM hq_migration WHERE name <> ${NAME} ORDER BY name`,
                oldReceipts,
              );
              const receipt =
                yield* sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`;
              assert.strictEqual(receipt.length, 1);
              assert.deepStrictEqual(yield* migrate(expansion()), []);
              assert.deepStrictEqual(
                yield* sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`,
                receipt,
              );
              assert.deepStrictEqual(yield* routines, oldRoutines);
              const afterConstraints = yield* constraints;
              for (const row of oldConstraints) assert.deepInclude(afterConstraints, row);
              const afterIndexes =
                yield* sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`;
              for (const row of oldIndexes) assert.deepInclude(afterIndexes, row);
              assert.deepStrictEqual(
                yield* sql`SELECT id, project_id, target FROM hq_environment ORDER BY id`,
                [
                  { id: "production", project_id: "production", target: "zerops" },
                  { id: "stage", project_id: "stage", target: "zerops" },
                ],
              );
              assert.deepStrictEqual(
                yield* sql`SELECT environment_id FROM hq_deploy_job ORDER BY id`,
                Array.from({ length: 5 }, () => ({ environment_id: "stage" })),
              );
              assert.deepStrictEqual(
                yield* sql`SELECT environment_id FROM hq_rollout ORDER BY id`,
                [
                  { environment_id: "stage" },
                  { environment_id: null },
                  { environment_id: "removed-history" },
                ],
              );
              const source = yield* readEnvironmentSource(sql);
              const viewed = source.forApp(
                "owner",
                APP,
                { orgId: "ORG", freshness: "cached", members: [], projects: [] },
                { allow: true },
              );
              if (!Array.isArray(viewed)) throw new Error("Expected environments");
              assert.deepStrictEqual(
                viewed.map(({ id, target, projectId }) => ({ id, target, projectId })),
                [
                  {
                    id: "stage",
                    target: { kind: "zerops", projectId: "stage" },
                    projectId: "stage",
                  },
                  {
                    id: "production",
                    target: { kind: "zerops", projectId: "production" },
                    projectId: "production",
                  },
                ],
              );
            }),
          ),
      );
      it.effect(
        "Old Core reads and writes the expanded environment schema without an upgrade.",
        () =>
          withSql(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* seed;
              yield* migrate(expansion());
              yield* sql`INSERT INTO hq_app_project (project_id, app_id, kind, created_by) VALUES ('later', ${APP}::uuid, 'stage', 'owner')`;
              yield* sql`INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by) VALUES ('later', ${APP}::uuid, 'stage', 'later', ARRAY['main'], 'owner')`;
              yield* sql`UPDATE hq_environment SET sources = ARRAY['next'] WHERE project_id = 'later'`;
              const [r] = yield* sql<{
                id: string;
              }>`INSERT INTO hq_rollout (app_id, cause, project_id) VALUES (${APP}::uuid, 'env_added', 'later') RETURNING id::text AS id`;
              yield* sql`INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state) VALUES (${r!.id}::bigint, 'deploy', 'later', 'web', 'web', ${SHA}, 'queued')`;
              yield* sql`UPDATE hq_rollout SET project_id = 'production', left_out = '[{"project_id":"production","service":"web","job":null,"reason":"legacy replacement"}]'::jsonb WHERE id = ${r!.id}::bigint`;
              yield* sql`UPDATE hq_deploy_job SET project_id = 'production' WHERE project_id = 'later'`;
              assert.deepStrictEqual(
                yield* sql`SELECT id, project_id, target, sources FROM hq_environment WHERE project_id = 'later'`,
                [{ id: null, project_id: "later", target: "zerops", sources: ["next"] }],
              );
              assert.deepStrictEqual(
                yield* sql`SELECT project_id, environment_id, left_out FROM hq_rollout WHERE id = ${r!.id}::bigint`,
                [
                  {
                    project_id: "production",
                    environment_id: null,
                    left_out: [
                      {
                        project_id: "production",
                        service: "web",
                        job: null,
                        reason: "legacy replacement",
                      },
                    ],
                  },
                ],
              );
              assert.deepStrictEqual(
                yield* sql`SELECT project_id, environment_id FROM hq_deploy_job ORDER BY id`,
                [
                  ...Array.from({ length: 5 }, () => ({
                    project_id: "stage",
                    environment_id: "stage",
                  })),
                  { project_id: "production", environment_id: null },
                ],
              );
              for (const write of [
                sql`UPDATE hq_environment SET id = 'wrong' WHERE project_id = 'later'`,
                sql`UPDATE hq_deploy_job SET environment_id = 'stage' WHERE project_id = 'production'`,
                sql`UPDATE hq_rollout SET environment_id = 'stage' WHERE id = ${r!.id}::bigint`,
                sql`UPDATE hq_rollout SET left_out = '[{"project_id":"stage","environment_id":"wrong"}]'::jsonb WHERE id = ${r!.id}::bigint`,
              ])
                assert.strictEqual((yield* Effect.exit(write))._tag, "Failure");
            }),
          ),
      );
      it.effect("A failed identity expansion rolls back its schema and migration receipt.", () =>
        withSql(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* seed;
            const files = expansion();
            assert.strictEqual(files.length, 1);
            const failure = yield* migrate(
              files.map((file) => ({
                ...file,
                sql: `${file.sql}\nSELECT * FROM identity_missing;`,
              })),
            ).pipe(Effect.flip);
            assert.strictEqual(failure.migration, NAME);
            assert.deepStrictEqual(
              yield* sql`SELECT name FROM hq_migration WHERE name = ${NAME}`,
              [],
            );
            assert.deepStrictEqual(
              yield* sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'hq_environment' AND column_name IN ('id', 'target')`,
              [],
            );
          }),
        ),
      );
      it.effect(
        "A legacy-only write made by old Core shows under its environment identity after new Core takes leadership.",
        () =>
          Effect.gen(function* () {
            const oldModule = yield* preExpandCore;
            const url = yield* (yield* TempPostgres).createDatabase;
            const gitRoot = yield* tempDir("hq-identity-backout-");
            const initial = yield* startCore(true, { url, gitRoot });
            yield* untilHealth(initial.call, "active");
            const receipt =
              yield* initial.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`;
            assert.strictEqual(receipt.length, 1);
            yield* initial.stop;
            const old = yield* oldModule.startCore(true, { url, gitRoot });
            yield* untilHealth(old.call, "active");
            assert.deepStrictEqual(
              yield* old.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`,
              receipt,
            );
            const owner = yield* sessionFor(old.call, "door-owner");
            const app = yield* old.call("POST", "/api/apps", {
              session: owner,
              body: { name: "Backout" },
            });
            assert.strictEqual(app.status, 201);
            const appId = (app.body as { id: string }).id;
            const attached = yield* old.call("POST", `/api/apps/${appId}/projects`, {
              session: owner,
              body: { projectId: "P_MATE", kind: "stage", environment: { name: "backout" } },
            });
            assert.strictEqual(attached.status, 201);
            const [rollout] = yield* old.sql<{
              id: string;
            }>`SELECT id::text AS id FROM hq_rollout WHERE project_id = 'P_MATE'`;
            yield* old.sql`INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, 'web', 'owner')`;
            const git = yield* old.gitHost.git;
            const repo = { appId, id: "web" };
            yield* git.create(repo);
            // Retain the historical job's commit without moving main and planning ordinary work.
            const commit = yield* git.commitFiles(repo, "refs/heads/backout-fixture", {
              files: { "index.js": 'console.log("backout");\n' },
              expectedHead: null,
              message: "Identity backout fixture",
              author: { name: "Identity test", email: "identity@mate.test" },
            });
            if (!("sha" in commit)) throw new Error("Expected a new repository commit");
            const [nullHistory] = yield* old.sql.withTransaction(
              Effect.gen(function* () {
                yield* old.sql`INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state, ended_at)
                VALUES (${rollout!.id}::bigint, 'deploy', 'P_MATE', 'web', 'web', ${commit.sha}, 'failed', now())`;
                yield* old.sql`UPDATE hq_rollout SET left_out = '[{"project_id":"P_MATE","service":"web","job":null,"reason":"legacy replacement","extra":{"keep":true}}]'::jsonb WHERE id = ${rollout!.id}::bigint`;
                return yield* old.sql<{
                  id: string;
                }>`INSERT INTO hq_rollout (app_id, cause, project_id, planned_at) VALUES (${appId}::uuid, 'migrated', NULL, now()), (${appId}::uuid, 'env_added', 'removed-history', now()) RETURNING id::text AS id`;
              }),
            );
            const jobs = yield* old.sql<{ readonly sha: string }>`SELECT sha FROM hq_deploy_job`;
            assert.deepStrictEqual(
              yield* git.missingCommits(
                repo,
                jobs.map((job) => job.sha),
              ),
              [],
            );
            assert.deepStrictEqual(yield* old.sql`SELECT id, project_id FROM hq_environment`, [
              { id: null, project_id: "P_MATE" },
            ]);
            assert.deepStrictEqual(
              yield* old.sql`SELECT environment_id, project_id FROM hq_deploy_job`,
              [{ environment_id: null, project_id: "P_MATE" }],
            );
            const [before] = yield* old.sql`SELECT
              (SELECT jsonb_agg(to_jsonb(e)-'id'-'target') FROM hq_environment e) AS environment,
              (SELECT jsonb_agg(to_jsonb(j)-'environment_id' ORDER BY j.id) FROM hq_deploy_job j) AS jobs,
              (SELECT jsonb_agg(to_jsonb(r)-'environment_id'-'left_out' ORDER BY r.id) FROM hq_rollout r) AS rollouts`;
            assert.deepStrictEqual(
              yield* old.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`,
              receipt,
            );
            const next = yield* startCore(true, { url, gitRoot });
            yield* untilHealth(next.call, "standby");
            assert.deepStrictEqual(yield* next.sql`SELECT id FROM hq_environment`, [{ id: null }]);
            yield* old.stop;
            yield* untilHealth(next.call, "active");
            const session = yield* sessionFor(next.call, "door-owner-2");
            const detail = yield* next.call("GET", "/api/structure", { session });
            assert.strictEqual(detail.status, 200);
            const apps = (
              detail.body as {
                apps: Array<{
                  id: string;
                  environments: Array<{ id: string; projectId: string; target: unknown }>;
                }>;
              }
            ).apps;
            const environment = apps.find((item) => item.id === appId)!.environments[0]!;
            assert.deepStrictEqual(
              { id: environment.id, projectId: environment.projectId, target: environment.target },
              {
                id: "P_MATE",
                projectId: "P_MATE",
                target: { kind: "zerops", projectId: "P_MATE" },
              },
            );
            assert.deepStrictEqual(
              yield* next.sql`SELECT environment_id, project_id, state FROM hq_deploy_job`,
              [{ environment_id: "P_MATE", project_id: "P_MATE", state: "failed" }],
            );
            assert.deepStrictEqual(
              yield* next.sql`SELECT environment_id, project_id FROM hq_rollout WHERE app_id = ${appId}::uuid AND (project_id IS NOT NULL OR id = ${nullHistory!.id}::bigint) ORDER BY id`,
              [
                { environment_id: "P_MATE", project_id: "P_MATE" },
                { environment_id: null, project_id: null },
                { environment_id: "removed-history", project_id: "removed-history" },
              ],
            );
            assert.deepStrictEqual(
              yield* next.sql`SELECT left_out FROM hq_rollout WHERE id = ${rollout!.id}::bigint`,
              [
                {
                  left_out: [
                    {
                      project_id: "P_MATE",
                      environment_id: "P_MATE",
                      service: "web",
                      job: null,
                      reason: "legacy replacement",
                      extra: { keep: true },
                    },
                  ],
                },
              ],
            );
            assert.deepStrictEqual(
              (yield* next.sql`SELECT
                (SELECT jsonb_agg(to_jsonb(e)-'id'-'target') FROM hq_environment e) AS environment,
                (SELECT jsonb_agg(to_jsonb(j)-'environment_id' ORDER BY j.id) FROM hq_deploy_job j) AS jobs,
                (SELECT jsonb_agg(to_jsonb(r)-'environment_id'-'left_out' ORDER BY r.id) FROM hq_rollout r) AS rollouts`)[0],
              before,
            );
            const reconciled =
              yield* next.sql`SELECT to_jsonb(r) AS record FROM hq_rollout r ORDER BY id`;
            assert.deepStrictEqual(
              yield* next.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`,
              receipt,
            );
            yield* next.stop;
            const again = yield* startCore(true, { url, gitRoot });
            yield* untilHealth(again.call, "active");
            assert.deepStrictEqual(
              yield* again.sql`SELECT to_jsonb(r) AS record FROM hq_rollout r ORDER BY id`,
              reconciled,
            );
            assert.deepStrictEqual(
              yield* again.sql`SELECT environment_id, project_id, state FROM hq_deploy_job`,
              [{ environment_id: "P_MATE", project_id: "P_MATE", state: "failed" }],
            );
            yield* again.stop;
          }),
        60_000,
      );
      it.effect(
        "Old and new Core share leadership and ordinary code rollback keeps environment reads and writes working.",
        () =>
          Effect.gen(function* () {
            const oldModule = yield* preExpandCore;
            const url = yield* (yield* TempPostgres).createDatabase;
            const gitRoot = yield* tempDir("hq-identity-shared-");
            const initial = yield* startCore(true, { url, gitRoot });
            yield* untilHealth(initial.call, "active");
            const receipt =
              yield* initial.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`;
            assert.strictEqual(receipt.length, 1);
            yield* initial.stop;
            const old = yield* oldModule.startCore(true, { url, gitRoot });
            yield* untilHealth(old.call, "active");
            assert.deepStrictEqual(
              yield* old.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`,
              receipt,
            );
            const next = yield* startCore(true, { url, gitRoot });
            yield* untilHealth(next.call, "standby");
            const oldOwner = yield* sessionFor(old.call, "door-owner");
            const made = yield* old.call("POST", "/api/apps", {
              session: oldOwner,
              body: { name: "Identity" },
            });
            assert.strictEqual(made.status, 201);
            const appId = (made.body as { id: string }).id;
            const attach = (core: typeof old, session: string, projectId: string, kind: string) =>
              core.call("POST", `/api/apps/${appId}/projects`, {
                session,
                body: { projectId, kind, environment: { name: kind } },
              });
            assert.strictEqual((yield* attach(old, oldOwner, "P_MATE", "stage")).status, 201);
            const saved =
              yield* old.sql`SELECT id, project_id, target, name, sources, created_by, created_at FROM hq_environment ORDER BY id`;
            assert.deepStrictEqual(
              saved.map(({ id, project_id, target }) => ({ id, project_id, target })),
              [{ id: null, project_id: "P_MATE", target: "zerops" }],
            );
            const gitTakeover = yield* next.gitHost.nextAttempt.pipe(
              Effect.timeout("5 seconds"),
              Effect.orDie,
              Effect.forkChild,
            );
            yield* old.stop;
            yield* untilHealth(next.call, "active");
            yield* Fiber.join(gitTakeover);
            const newOwner = yield* sessionFor(next.call, "door-owner-2");
            const newRead = (yield* next.call("GET", "/api/structure", { session: newOwner }))
              .body as {
              apps: Array<{
                id: string;
                environments: Array<{ id: string; projectId: string; target: unknown }>;
              }>;
            };
            const stage = newRead.apps
              .find((app) => app.id === appId)!
              .environments.find((env) => env.id === "P_MATE")!;
            assert.deepStrictEqual(
              { id: stage.id, projectId: stage.projectId, target: stage.target },
              {
                id: "P_MATE",
                projectId: "P_MATE",
                target: { kind: "zerops", projectId: "P_MATE" },
              },
            );
            const detached = yield* next.call("PUT", "/api/projects/P_MATE/app", {
              session: newOwner,
              body: { appId: null, kind: "stage" },
            });
            assert.strictEqual(detached.status, 200);
            assert.strictEqual((yield* attach(next, newOwner, "P_MATE", "production")).status, 201);
            const expanded =
              yield* next.sql`SELECT id, project_id, target, name, sources, created_by, created_at FROM hq_environment ORDER BY id`;
            assert.deepStrictEqual(
              expanded.map(({ id, project_id, target }) => ({ id, project_id, target })),
              [{ id: "P_MATE", project_id: "P_MATE", target: "zerops" }],
            );
            const migrationReceipt =
              yield* next.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`;
            assert.deepStrictEqual(migrationReceipt, receipt);
            // Ordinary accepted work is separate from the migration's no-new-jobs assertion.
            yield* next.sql`INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, 'web', 'owner')`;
            const git = yield* next.gitHost.git;
            const repo = { appId, id: "web" };
            yield* git.create(repo);
            const commit = yield* git.commitFiles(repo, "refs/heads/main", {
              files: { "index.js": 'console.log("identity");\n' },
              expectedHead: null,
              message: "Identity compatibility fixture",
              author: { name: "Identity test", email: "identity@mate.test" },
            });
            if (!("sha" in commit)) throw new Error("Expected a new repository commit");
            const actualSha = commit.sha;
            yield* next.sql`INSERT INTO hq_deploy_job (rollout_id, kind, environment_id, project_id, service, repo, sha, state, reason, ended_at)
              SELECT id, 'deploy', 'P_MATE', 'P_MATE', 'web', 'web', ${actualSha}, 'failed', 'Build failed', now()
              FROM hq_rollout WHERE cause = 'env_added' AND project_id = 'P_MATE' ORDER BY id DESC LIMIT 1`;
            const retry = (core: typeof old, session: string) =>
              core.call("POST", `/api/apps/${appId}/environments/production/redeploy`, {
                session,
                body: { service: "web", sha: actualSha },
              });
            assert.strictEqual((yield* retry(next, newOwner)).status, 200);
            yield* next.deploys.drain;
            const jobs =
              yield* next.sql`SELECT project_id, environment_id, sha, state FROM hq_deploy_job ORDER BY id`;
            assert.deepStrictEqual(jobs, [
              { project_id: "P_MATE", environment_id: "P_MATE", sha: actualSha, state: "failed" },
              { project_id: "P_MATE", environment_id: "P_MATE", sha: actualSha, state: "refused" },
            ]);
            const oldStandby = yield* oldModule.startCore(true, { url, gitRoot });
            yield* untilHealth(oldStandby.call, "standby");
            const oldNavigation = oldModule.oldNavigation;
            const oldSource = yield* oldNavigation.readEnvironmentSource(oldStandby.sql);
            const oldView = oldSource.forApp(
              "owner",
              appId,
              { orgId: "ORG", freshness: "cached", members: [], projects: [] },
              { allow: true },
            );
            if (!Array.isArray(oldView)) throw new Error("Expected old Core environment rows");
            assert.deepStrictEqual(
              oldView.map(({ projectId, name }) => ({ projectId, name })),
              [{ projectId: "P_MATE", name: "production" }],
            );
            assert.notProperty(oldView[0], "id");
            yield* oldStandby.stop;
            yield* next.stop;
            const rollback = yield* oldModule.startCore(true, { url, gitRoot });
            yield* untilHealth(rollback.call, "active");
            const rollbackDoor = rollback.fake.tokens.get("door-owner")!;
            rollback.fake.tokens.set("door-rollback", { ...rollbackDoor, id: "door-rollback" });
            const owner = yield* sessionFor(rollback.call, "door-rollback");
            assert.deepStrictEqual(
              yield* rollback.sql`SELECT id, project_id, target, name, sources, created_by, created_at FROM hq_environment ORDER BY id`,
              expanded,
            );
            assert.deepStrictEqual(
              yield* rollback.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`,
              migrationReceipt,
            );
            const read = (yield* rollback.call("GET", "/api/structure", { session: owner }))
              .body as {
              apps: Array<{ id: string; environments: Array<{ projectId: string }> }>;
            };
            assert.deepStrictEqual(
              read.apps.find((app) => app.id === appId)!.environments.map((env) => env.projectId),
              ["P_MATE"],
            );
            assert.deepStrictEqual(
              yield* rollback.sql`SELECT project_id, environment_id, sha, state FROM hq_deploy_job ORDER BY id`,
              jobs,
            );
            assert.strictEqual((yield* retry(rollback, owner)).status, 200);
            yield* rollback.deploys.drain;
            assert.deepStrictEqual(
              yield* rollback.sql`SELECT project_id, environment_id, sha, state FROM hq_deploy_job ORDER BY id`,
              [
                ...jobs,
                {
                  project_id: "P_MATE",
                  environment_id: null,
                  sha: actualSha,
                  state: "refused",
                },
              ],
            );
            const renamed = yield* rollback.call("PATCH", `/api/apps/${appId}`, {
              session: owner,
              body: { name: "After rollback" },
            });
            assert.strictEqual(renamed.status, 200);
            yield* rollback.sql`UPDATE hq_rollout SET left_out = '[{"project_id":"P_MATE","service":"web","sha":"original","job":null,"reason":"old Core after rollback"}]'::jsonb WHERE cause = 'env_added' AND project_id = 'P_MATE'`;
            assert.deepStrictEqual(
              yield* rollback.sql`SELECT left_out FROM hq_rollout WHERE cause = 'env_added' AND project_id = 'P_MATE'`,
              Array.from({ length: 2 }, () => ({
                left_out: [
                  {
                    project_id: "P_MATE",
                    service: "web",
                    sha: "original",
                    job: null,
                    reason: "old Core after rollback",
                  },
                ],
              })),
            );
            assert.deepStrictEqual(
              yield* rollback.sql`SELECT name, applied_at FROM hq_migration WHERE name = ${NAME}`,
              receipt,
            );
            yield* rollback.stop;
          }),
        60_000,
      );
    },
  );
});
