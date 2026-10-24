import { readsChiefProject } from "./chiefOwnership.ts";
import {
  HqNavigationJob,
  HqPushNavigationJob,
  type HqDeliveryNavigationJob,
} from "@t3tools/shared/hqStream";
import { pushEvidenceForWire, type PushEvidence } from "./gitPush.ts";

/** Environment navigation facts, computed once and filtered only when delivered. */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import type { EnvironmentBirth, HqDeployEvidence } from "@t3tools/shared/hqDeploys";
import type { HqReleaseTarget, ReleaseRollout, TierStop } from "@t3tools/shared/hqRelease";
import { environmentBirths } from "./births.ts";
import { releaseTargetOf } from "./gitEvents.ts";
import {
  environmentOffers,
  gitEnvironmentOffers,
  environmentSlots,
  type EnvironmentSlots,
} from "./offers.ts";
import type { OrgView } from "./roles.ts";
import type { EnvironmentView, JobView, StructureRead } from "./structure.ts";

/** How many of an environment's newest jobs its view carries. */
export const JOBS_SHOWN = 20;
const decodePushJob = Schema.decodeUnknownSync(HqPushNavigationJob);
const decodeDeployJob = Schema.decodeUnknownSync(HqNavigationJob);
export interface EnvironmentSource {
  readonly slotsForApp: (appId: string) => EnvironmentSlots;
  readonly fingerprints: ReadonlyMap<string, string>;
  readonly forApp: (
    userId: string,
    appId: string,
    facts: OrgView,
    access: StructureRead["apps"][number]["can"]["read_change"],
  ) => StructureRead["apps"][number]["environments"];
}
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export const readEnvironmentSource = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  chiefs?: ReadonlyMap<string, string>,
  chiefMark?: string | null,
) {
  const owners =
    chiefs ??
    new Map(
      (yield* sql<{ readonly project_id: string; readonly user_id: string }>`
    SELECT project_id, user_id FROM hq_chief WHERE revoked_at IS NULL`).map(
        (row) => [row.project_id, row.user_id] as const,
      ),
    );
  const mark =
    chiefMark !== undefined
      ? chiefMark
      : ((yield* sql<{ readonly project_id: string }>`
    SELECT project_id FROM hq_chief_mark`)[0]?.project_id ?? null);
  const environments = yield* sql<{
    readonly environment_id: string;
    readonly project_id: string | null;
    readonly target: "zerops" | "git";
    readonly created_for_production: boolean;
    readonly branch: string | null;
    readonly delivery: "direct" | null;
    readonly app_id: string;
    readonly tier: "stage" | "production";
    readonly name: string;
    readonly sources: ReadonlyArray<string>;
    readonly order: number;
    readonly key_held: boolean;
    readonly key_invalid: boolean;
    readonly project_ids: ReadonlyArray<string>;
    readonly tier_stops: ReadonlyArray<TierStop>;
  }>`
SELECT e.id AS environment_id, e.project_id, e.target, e.created_for_production, e.branch, e.delivery, e.app_id::text AS app_id, e.tier, e.name, e.sources,
       (rank() OVER (PARTITION BY e.app_id ORDER BY e.declared_seq))::int AS "order",
       t.project_id IS NOT NULL AS key_held,
       t.invalid_since IS NOT NULL AS key_invalid,
       ARRAY(SELECT p.project_id FROM hq_app_project p WHERE p.app_id=e.app_id) AS project_ids,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('service', s.service, 'rollbackTo', s.rollback_to) ORDER BY s.service)
                 FROM hq_tier_stop s WHERE s.environment_id=e.id AND s.service <> ''), '[]'::jsonb) AS tier_stops
FROM hq_environment e LEFT JOIN hq_deploy_token t USING (project_id)
ORDER BY e.declared_seq`;
  const iso = (column: string) =>
    `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const jobs = yield* sql<{
    readonly environment_id: string;
    readonly id: string;
    readonly kind: HqDeliveryNavigationJob["kind"];
    readonly service: string | null;
    readonly sha: string | null;
    readonly state: HqDeliveryNavigationJob["state"];
    readonly cause: JobView["cause"];
    readonly ref: string | null;
    readonly reason: string | null;
    readonly app_version_id: string | null;
    readonly process_id: string | null;
    readonly evidence: HqDeployEvidence | PushEvidence | null;
    readonly steps: ReadonlyArray<HqDeployEvidence | PushEvidence>;
    readonly verified_version_id: string | null;
    readonly requested_by: string | null;
    readonly at: string;
    readonly ended_at: string | null;
    readonly superseded_by: string | null;
  }>`
WITH ranked AS (
  SELECT j.*,
         row_number() OVER (PARTITION BY j.environment_id ORDER BY j.id DESC) AS place,
         row_number() OVER (
           PARTITION BY j.environment_id, COALESCE(j.service,j.repo), j.state IN ('live','pushed')
           ORDER BY j.ended_at DESC NULLS LAST, j.id DESC
         ) AS live_place
  FROM hq_deploy_job j
)
SELECT j.environment_id, j.id::text AS id, j.kind, CASE j.kind WHEN 'push' THEN j.repo ELSE j.service END AS service, j.sha, j.state, r.cause,
       CASE r.cause WHEN 'merge' THEN r.sha WHEN 'release' THEN r.tag END AS ref,
       j.reason,
       j.app_version_id, j.process_id, j.evidence, j.steps, j.verified_version_id, j.requested_by,
       ${sql.literal(iso("j.created_at"))} AS at,
       ${sql.literal(iso("j.ended_at"))} AS ended_at,
       j.superseded_by::text AS superseded_by
FROM ranked j JOIN hq_rollout r ON r.id = j.rollout_id
WHERE j.place <= ${JOBS_SHOWN}
   OR (j.kind IN ('deploy','push') AND j.state IN ('live','pushed') AND j.live_place = 1)
ORDER BY j.environment_id, j.id DESC`;
  // Each production's newest release, as its rollout stands there: ended once every job
  // it asked for there ended, and every job of a commit it left out as under way there.
  // Each production's newest release by version made since its release floor, as its rollout stands there: ended once
  // every job it asked for there ended, and every job of a commit it left out as under way
  // there; landed where each of those went live and its plan said nothing it could not do.
  // A release with no rollout of its own — made before rollouts were, recorded from git,
  // or a snapshot — deploys nothing more: ended as it was made.
  const rollouts = yield* sql<{
    readonly environment_id: string;
    readonly id: string | null;
    readonly tag: string;
    readonly planned: boolean;
    readonly ended: boolean;
    readonly ended_at: string | null;
    readonly landed: boolean;
    readonly left_out: ReleaseRollout["leftOut"];
    readonly target: "zerops" | "git";
    readonly release_target: HqReleaseTarget | null;
  }>`
WITH newest AS (
  SELECT DISTINCT ON (e.id) e.id AS environment_id, h.app_id, h.tag, h.released_at, h.target,
    ${sql.literal(releaseTargetOf("h"))} AS release_target
  FROM hq_environment e
  JOIN hq_release h ON h.app_id = e.app_id AND h.state = 'approved'
    AND (e.release_floor IS NULL OR h.released_at >= e.release_floor)
  WHERE e.tier = 'production'
  ORDER BY e.id,
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
  SELECT r.id AS rollout_id, l.environment_id, l.service, l.sha, l.job, l.reason, l.stopped
  FROM rollout r,
       jsonb_to_recordset(r.left_out)
         AS l(environment_id text, service text, sha text, job text, reason text, stopped jsonb)
),
ends AS (
  SELECT j.rollout_id, j.environment_id, j.state, j.ended_at
  FROM hq_deploy_job j JOIN rollout r ON r.id = j.rollout_id
  UNION ALL
  SELECT l.rollout_id, l.environment_id, j.state, j.ended_at
  FROM left_out l JOIN hq_deploy_job j ON j.id = l.job::bigint
),
standing AS (
  SELECT e.id AS environment_id, n.tag, n.released_at, n.target, n.release_target,
         r.id, r.planned_at, r.note,
         r.id IS NULL OR (r.planned_at IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM ends x
           WHERE x.rollout_id = r.id AND x.environment_id = e.id
             AND (x.ended_at IS NULL OR x.state='unresolved'))) AS ended,
         r.id IS NOT NULL AND r.planned_at IS NOT NULL AND r.note IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM ends x
             WHERE x.rollout_id = r.id AND x.environment_id = e.id
               AND x.state NOT IN ('live','pushed')) AS landed,
         (SELECT max(x.ended_at) FROM ends x
          WHERE x.rollout_id = r.id AND x.environment_id = e.id) AS last_ended
  FROM newest n
  JOIN hq_environment e ON e.id = n.environment_id
  LEFT JOIN rollout r ON r.app_id = n.app_id AND r.tag = n.tag
)
SELECT s.environment_id, s.id::text AS id, s.tag,
       s.id IS NULL OR s.planned_at IS NOT NULL AS planned,
       s.ended, s.landed, s.target, s.release_target,
       CASE WHEN s.ended
         THEN ${sql.literal(
           iso("COALESCE(GREATEST(s.planned_at, s.last_ended), s.released_at)"),
         )} END
         AS ended_at,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('service', l.service, 'sha', l.sha,
                  'job', l.job, 'reason', l.reason)
                  || CASE WHEN l.stopped IS NULL THEN '{}'::jsonb
                     ELSE jsonb_build_object('stopped', l.stopped) END)
         FROM left_out l
         WHERE l.rollout_id = s.id AND l.environment_id = s.environment_id
       ), '[]'::jsonb) AS left_out
FROM standing s`;
  const releaseOf = (environmentId: string): ReleaseRollout | null => {
    const row = rollouts.find((rollout) => rollout.environment_id === environmentId);
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
          ...(row.release_target === null
            ? {}
            : { target: row.target, releaseTarget: row.release_target }),
        };
  };
  const born = yield* environmentBirths(sql);
  const birthOf = (environmentId: string): EnvironmentBirth | null =>
    born.get(environmentId) ?? null;
  const environmentView = (row: (typeof environments)[number]): EnvironmentView => {
    const common = {
      id: row.environment_id,
      tier: row.tier,
      name: row.name,
      sources: row.sources,
      order: row.order,
      keyHeld: row.key_held,
      keyInvalid: row.key_invalid,
      release: releaseOf(row.environment_id),
      birth: birthOf(row.environment_id),
      ...(row.tier_stops.length === 0 ? {} : { tierStops: row.tier_stops }),
    };
    const values = jobs
      .filter((job) => job.environment_id === row.environment_id)
      .map((job) => ({
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
        evidence:
          job.kind === "push" && job.evidence !== null && "remote" in job.evidence
            ? pushEvidenceForWire(job.evidence)
            : job.evidence,
        steps:
          job.kind === "push"
            ? job.steps.map((step) => ("remote" in step ? pushEvidenceForWire(step) : step))
            : job.steps,
        verifiedVersionId: job.verified_version_id,
        requestedBy: job.requested_by,
        at: job.at,
        endedAt: job.ended_at,
        supersededBy: job.superseded_by,
      }));
    if (row.target === "git" && row.branch !== null && row.delivery === "direct")
      return {
        ...common,
        target: { kind: "git", branch: row.branch, delivery: row.delivery },
        jobs: values.map((job) => decodePushJob(job)),
      };
    if (row.project_id === null) throw new Error("Zerops environment requires its project");
    return {
      ...common,
      target: { kind: "zerops", projectId: row.project_id },
      ...(row.tier === "production" ? { deleteProjectOnRemoval: row.created_for_production } : {}),
      jobs: values.map((job) => decodeDeployJob(job)),
    };
  };
  const groups = new Map<string, Array<EnvironmentView>>();
  for (const row of environments) {
    const values = groups.get(row.app_id) ?? [];
    values.push(environmentView(row));
    groups.set(row.app_id, values);
  }
  return {
    slotsForApp: (appId) => environmentSlots(environments.filter((row) => row.app_id === appId)),
    fingerprints: new Map([...groups].map(([appId, values]) => [appId, json(values)])),
    forApp: (userId, appId, facts, access) =>
      access.allow
        ? (groups.get(appId) ?? [])
            // A Zerops environment shows only where Zerops shows its project to the reader.
            .filter(
              (value) =>
                value.target.kind === "git" ||
                readsChiefProject(facts, userId, value.target.projectId, owners, mark),
            )
            .map((value) => ({
              ...value,
              can:
                value.target.kind === "git"
                  ? gitEnvironmentOffers(
                      userId,
                      (
                        environments.find((row) => row.environment_id === value.id)?.project_ids ??
                        []
                      ).map((project_id) => ({ project_id, kind: "" })),
                      facts,
                      value.tier,
                    )
                  : environmentOffers(
                      userId,
                      value.target.projectId,
                      facts,
                      value.tier === "production"
                        ? (
                            environments.find((row) => row.environment_id === value.id)
                              ?.project_ids ?? []
                          ).map((project_id) => ({ project_id, kind: "" }))
                        : undefined,
                    ),
            }))
        : { refused: access.reason },
  } satisfies EnvironmentSource;
});
