/**
 * Whether HQ is still bringing each environment up (`EnvironmentBirth`, streamed beside it by
 * `structure.ts`), derived from its rollouts and their jobs, never stored.
 *
 * An environment's birth begins with the rollout its attach asked for (`env_added`) and runs to its
 * first deploy that ran — a job that went live, or whose build failed — counting every rollout that
 * brings it up meanwhile: a deploy key kept (`key_kept`) and a person's Run again (`run_again`). The
 * client attaches first and keeps the key after, so the attach's own jobs are refused for want of
 * one; the key kept is what deploys it. It ends once every one of those rollouts was planned and
 * every job they asked for there ended — and every job of a commit they left out as under way there
 * — and either a deploy ran or the environment holds a working key: one with none is still waiting
 * for its key. A Git environment instead ends on its connected repositories' verified remotes;
 * its attach never needs a Zerops deploy token. An environment HQ did not bring up has no birth.
 *
 * @module births
 */
import type { EnvironmentBirth } from "@t3tools/shared/hqDeploys";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

/** Each environment HQ brought up, by its identity, and whether its birth ended. */
export const environmentBirths = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const [targets] = yield* sql<{ readonly git: boolean }>`
      SELECT EXISTS (SELECT 1 FROM hq_environment WHERE target='git') AS git`;
    // Zerops-only snapshots (including identity expansion) have no Git remote data to read.
    const gitReady = targets!.git
      ? sql`EXISTS (
      SELECT 1 FROM hq_environment e WHERE e.id=b.environment_id AND e.target='git'
        AND EXISTS (SELECT 1 FROM hq_repo_remote m WHERE m.app_id=e.app_id AND m.sealed IS NOT NULL
          AND m.invalid_since IS NULL AND (m.expires_at IS NULL OR m.expires_at>now()))
        AND NOT EXISTS (SELECT 1 FROM hq_repo_remote m WHERE m.app_id=e.app_id AND
          (m.sealed IS NULL OR m.invalid_since IS NOT NULL OR m.expires_at<=now())))`
      : sql`false`;
    const rows = yield* sql<{ readonly environment_id: string; readonly ended: boolean }>`
      WITH born AS (
        SELECT DISTINCT ON (r.environment_id) r.id, r.environment_id
        FROM hq_rollout r WHERE r.cause = 'env_added' AND r.environment_id IS NOT NULL
        ORDER BY r.environment_id, r.id DESC
      ),
      asked AS (
        SELECT b.environment_id, r.id, r.planned_at, r.left_out
        FROM born b JOIN hq_rollout r
          ON r.environment_id = b.environment_id AND r.id >= b.id
         AND r.cause IN ('env_added', 'key_kept', 'run_again')
      ),
      jobs AS (
        SELECT a.environment_id, a.id AS rollout_id, j.state, j.ended_at
        FROM asked a JOIN hq_deploy_job j ON j.rollout_id = a.id AND j.environment_id = a.environment_id
        UNION ALL
        SELECT a.environment_id, a.id, j.state, j.ended_at
        FROM asked a
        CROSS JOIN LATERAL jsonb_to_recordset(a.left_out) AS out(environment_id text, job text)
        JOIN hq_deploy_job j ON j.id = out.job::bigint
        WHERE out.environment_id = a.environment_id
      ),
      ran AS (
        SELECT environment_id, min(rollout_id) AS upto
        FROM jobs WHERE state IN ('live', 'failed', 'pushed') GROUP BY environment_id
      )
      SELECT b.environment_id,
             NOT EXISTS (
               SELECT 1 FROM asked a
               WHERE a.environment_id = b.environment_id AND a.planned_at IS NULL
                 AND (ran.upto IS NULL OR a.id <= ran.upto))
             AND NOT EXISTS (
               SELECT 1 FROM jobs x
               WHERE x.environment_id = b.environment_id AND x.ended_at IS NULL
                 AND (ran.upto IS NULL OR x.rollout_id <= ran.upto))
             AND (ran.upto IS NOT NULL OR EXISTS (
               SELECT 1 FROM hq_environment e JOIN hq_deploy_token t USING (project_id)
               WHERE e.id = b.environment_id AND e.target='zerops' AND t.invalid_since IS NULL)
               OR ${gitReady}) AS ended
      FROM born b LEFT JOIN ran USING (environment_id)`;
    return new Map<string, EnvironmentBirth>(
      rows.map((row) => [row.environment_id, { ended: row.ended }]),
    );
  });
