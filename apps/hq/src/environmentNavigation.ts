/** Environment navigation facts, computed once and filtered only when delivered. */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { EnvironmentBirth, HqDeployEvidence } from "@t3tools/shared/hqDeploys";
import type { ReleaseRollout } from "@t3tools/shared/hqRelease";
import { environmentBirths } from "./births.ts";
import { environmentOffers } from "./offers.ts";
import type { OrgView } from "./roles.ts";
import type { EnvironmentView, JobView, StructureRead } from "./structure.ts";

/** How many of an environment's newest jobs its view carries. */
export const JOBS_SHOWN = 20;
export interface EnvironmentSource {
  readonly fingerprints: ReadonlyMap<string, string>;
  readonly forApp: (
    userId: string,
    appId: string,
    facts: OrgView,
    access: StructureRead["apps"][number]["can"]["read_change"],
  ) => StructureRead["apps"][number]["environments"];
}
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export const readEnvironmentSource = Effect.fnUntraced(function* (sql: SqlClient.SqlClient) {
  const environments = yield* sql<{
    readonly project_id: string;
    readonly app_id: string;
    readonly tier: "stage" | "production";
    readonly name: string;
    readonly sources: ReadonlyArray<string>;
    readonly order: number;
    readonly key_held: boolean;
    readonly key_invalid: boolean;
  }>`
SELECT e.project_id, e.app_id::text AS app_id, e.tier, e.name, e.sources,
       (rank() OVER (PARTITION BY e.app_id ORDER BY e.declared_seq))::int AS "order",
       t.project_id IS NOT NULL AS key_held,
       t.invalid_since IS NOT NULL AS key_invalid
FROM hq_environment e LEFT JOIN hq_deploy_token t USING (project_id)
ORDER BY e.declared_seq`;
  const iso = (column: string) =>
    `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const jobs = yield* sql<{
    readonly project_id: string;
    readonly id: string;
    readonly kind: JobView["kind"];
    readonly service: string | null;
    readonly sha: string | null;
    readonly state: JobView["state"];
    readonly cause: JobView["cause"];
    readonly ref: string | null;
    readonly reason: string | null;
    readonly app_version_id: string | null;
    readonly process_id: string | null;
    readonly evidence: HqDeployEvidence | null;
    readonly steps: ReadonlyArray<unknown>;
    readonly verified_version_id: string | null;
    readonly requested_by: string | null;
    readonly at: string;
    readonly ended_at: string | null;
    readonly superseded_by: string | null;
  }>`
WITH ranked AS (
  SELECT j.*,
         row_number() OVER (PARTITION BY j.project_id ORDER BY j.id DESC) AS place,
         row_number() OVER (
           PARTITION BY j.project_id, j.service, j.state = 'live'
           ORDER BY j.ended_at DESC NULLS LAST, j.id DESC
         ) AS live_place
  FROM hq_deploy_job j
)
SELECT j.project_id, j.id::text AS id, j.kind, j.service, j.sha, j.state, r.cause,
       CASE r.cause WHEN 'merge' THEN r.sha WHEN 'release' THEN r.tag END AS ref,
       j.reason,
       j.app_version_id, j.process_id, j.evidence, j.steps, j.verified_version_id, j.requested_by,
       ${sql.literal(iso("j.created_at"))} AS at,
       ${sql.literal(iso("j.ended_at"))} AS ended_at,
       j.superseded_by::text AS superseded_by
FROM ranked j JOIN hq_rollout r ON r.id = j.rollout_id
WHERE j.place <= ${JOBS_SHOWN}
   OR (j.kind = 'deploy' AND j.state = 'live' AND j.live_place = 1)
ORDER BY j.project_id, j.id DESC`;
  // Each production's newest release, as its rollout stands there: ended once every job
  // it asked for there ended, and every job of a commit it left out as under way there.
  // Each production's newest release by version made since its release floor, as its rollout stands there: ended once
  // every job it asked for there ended, and every job of a commit it left out as under way
  // there; landed where each of those went live and its plan said nothing it could not do.
  // A release with no rollout of its own — made before rollouts were, recorded from git,
  // or a snapshot — deploys nothing more: ended as it was made.
  const rollouts = yield* sql<{
    readonly project_id: string;
    readonly id: string | null;
    readonly tag: string;
    readonly planned: boolean;
    readonly ended: boolean;
    readonly ended_at: string | null;
    readonly landed: boolean;
    readonly left_out: ReleaseRollout["leftOut"];
  }>`
WITH newest AS (
  SELECT DISTINCT ON (e.project_id) e.project_id, h.app_id, h.tag, h.released_at
  FROM hq_environment e
  JOIN hq_release h ON h.app_id = e.app_id AND h.state = 'approved'
    AND (e.release_floor IS NULL OR h.released_at >= e.release_floor)
  WHERE e.tier = 'production'
  ORDER BY e.project_id,
    string_to_array(substr(h.tag, 2), '.')::numeric[] DESC
),
rollout AS (
  SELECT DISTINCT ON (r.app_id, r.tag)
    r.app_id, r.tag, r.id, r.planned_at, r.note, r.left_out
  FROM hq_rollout r
  WHERE r.cause = 'release' AND EXISTS (
    SELECT 1 FROM newest n WHERE n.app_id = r.app_id AND n.tag = r.tag)
  ORDER BY r.app_id, r.tag, r.id DESC
),
left_out AS (
  SELECT r.id AS rollout_id, l.project_id, l.service, l.sha, l.job, l.reason
  FROM rollout r,
       jsonb_to_recordset(r.left_out)
         AS l(project_id text, service text, sha text, job text, reason text)
),
ends AS (
  SELECT j.rollout_id, j.project_id, j.state, j.ended_at
  FROM hq_deploy_job j JOIN rollout r ON r.id = j.rollout_id
  UNION ALL
  SELECT l.rollout_id, l.project_id, j.state, j.ended_at
  FROM left_out l JOIN hq_deploy_job j ON j.id = l.job::bigint
),
standing AS (
  SELECT e.project_id, n.tag, n.released_at, r.id, r.planned_at, r.note,
         r.id IS NULL OR (r.planned_at IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM ends x
           WHERE x.rollout_id = r.id AND x.project_id = e.project_id
             AND x.ended_at IS NULL)) AS ended,
         r.id IS NOT NULL AND r.planned_at IS NOT NULL AND r.note IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM ends x
             WHERE x.rollout_id = r.id AND x.project_id = e.project_id
               AND x.state <> 'live') AS landed,
         (SELECT max(x.ended_at) FROM ends x
          WHERE x.rollout_id = r.id AND x.project_id = e.project_id) AS last_ended
  FROM newest n
  JOIN hq_environment e ON e.project_id = n.project_id
  LEFT JOIN rollout r ON r.app_id = n.app_id AND r.tag = n.tag
)
SELECT s.project_id, s.id::text AS id, s.tag,
       s.id IS NULL OR s.planned_at IS NOT NULL AS planned,
       s.ended, s.landed,
       CASE WHEN s.ended
         THEN ${sql.literal(
           iso("COALESCE(GREATEST(s.planned_at, s.last_ended), s.released_at)"),
         )} END
         AS ended_at,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('service', l.service, 'sha', l.sha,
                  'job', l.job, 'reason', l.reason))
         FROM left_out l
         WHERE l.rollout_id = s.id AND l.project_id = s.project_id
       ), '[]'::jsonb) AS left_out
FROM standing s`;
  const releaseOf = (projectId: string): ReleaseRollout | null => {
    const row = rollouts.find((rollout) => rollout.project_id === projectId);
    return row === undefined
      ? null
      : {
          id: row.id,
          tag: row.tag,
          planned: row.planned,
          ended: row.ended,
          endedAt: row.ended_at,
          landed: row.landed,
          leftOut: row.left_out,
        };
  };
  const born = yield* environmentBirths(sql);
  const birthOf = (projectId: string): EnvironmentBirth | null => born.get(projectId) ?? null;
  const environmentView = (row: (typeof environments)[number]): EnvironmentView => ({
    projectId: row.project_id,
    tier: row.tier,
    name: row.name,
    sources: row.sources,
    order: row.order,
    keyHeld: row.key_held,
    keyInvalid: row.key_invalid,
    jobs: jobs
      .filter((job) => job.project_id === row.project_id)
      .map((job): JobView => ({
        id: job.id,
        kind: job.kind,
        service: job.service,
        sha: job.sha,
        state: job.state,
        cause: job.cause,
        ref: job.ref,
        reason: job.reason,
        appVersionId: job.app_version_id,
        processId: job.process_id,
        evidence: job.evidence,
        steps: job.steps,
        verifiedVersionId: job.verified_version_id,
        requestedBy: job.requested_by,
        at: job.at,
        endedAt: job.ended_at,
        supersededBy: job.superseded_by,
      })),
    release: releaseOf(row.project_id),
    birth: birthOf(row.project_id),
  });
  const groups = new Map<string, Array<EnvironmentView>>();
  for (const row of environments) {
    const values = groups.get(row.app_id) ?? [];
    values.push(environmentView(row));
    groups.set(row.app_id, values);
  }
  return {
    fingerprints: new Map([...groups].map(([appId, values]) => [appId, json(values)])),
    forApp: (userId, appId, facts, access) =>
      access.allow
        ? (groups.get(appId) ?? []).map((value) => ({
            ...value,
            can: environmentOffers(userId, value.projectId, facts),
          }))
        : { refused: access.reason },
  } satisfies EnvironmentSource;
});
