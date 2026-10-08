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
 * for its key. An environment HQ did not bring up has no birth.
 *
 * @module births
 */
import type { EnvironmentBirth } from "@t3tools/shared/hqDeploys";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

/** Each environment HQ brought up, by its project, and whether its birth ended. */
export const environmentBirths = (sql: SqlClient.SqlClient) =>
  Effect.map(
    sql<{ readonly project_id: string; readonly ended: boolean }>`
      WITH born AS (
        SELECT DISTINCT ON (r.project_id) r.id, r.project_id
        FROM hq_rollout r WHERE r.cause = 'env_added' AND r.project_id IS NOT NULL
        ORDER BY r.project_id, r.id DESC
      ),
      asked AS (
        SELECT b.project_id, r.id, r.planned_at, r.left_out
        FROM born b JOIN hq_rollout r
          ON r.project_id = b.project_id AND r.id >= b.id
         AND r.cause IN ('env_added', 'key_kept', 'run_again')
      ),
      jobs AS (
        SELECT a.project_id, a.id AS rollout_id, j.state, j.ended_at
        FROM asked a JOIN hq_deploy_job j ON j.rollout_id = a.id AND j.project_id = a.project_id
        UNION ALL
        SELECT a.project_id, a.id, j.state, j.ended_at
        FROM asked a
        CROSS JOIN LATERAL jsonb_to_recordset(a.left_out) AS out(project_id text, job text)
        JOIN hq_deploy_job j ON j.id = out.job::bigint
        WHERE out.project_id = a.project_id
      ),
      ran AS (
        SELECT project_id, min(rollout_id) AS upto
        FROM jobs WHERE state IN ('live', 'failed') GROUP BY project_id
      )
      SELECT b.project_id,
             NOT EXISTS (
               SELECT 1 FROM asked a
               WHERE a.project_id = b.project_id AND a.planned_at IS NULL
                 AND (ran.upto IS NULL OR a.id <= ran.upto))
             AND NOT EXISTS (
               SELECT 1 FROM jobs x
               WHERE x.project_id = b.project_id AND x.ended_at IS NULL
                 AND (ran.upto IS NULL OR x.rollout_id <= ran.upto))
             AND (ran.upto IS NOT NULL OR EXISTS (
               SELECT 1 FROM hq_deploy_token t
               WHERE t.project_id = b.project_id AND t.invalid_since IS NULL)) AS ended
      FROM born b LEFT JOIN ran USING (project_id)`,
    (rows) =>
      new Map<string, EnvironmentBirth>(rows.map((row) => [row.project_id, { ended: row.ended }])),
  );
