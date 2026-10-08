import {
  AGENT_USAGE_EXACT_DAYS,
  type AgentUsageScope,
  type UsageCoverage,
  type UsageStatistics,
  type UsageReport,
  UsageReport as UsageReportSchema,
} from "@t3tools/contracts";
import { usageDigest } from "@t3tools/shared/agentUsage";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type { StructureRead } from "./structure.ts";
import type { OrgView } from "./roles.ts";
export interface UsageReportAccess {
  readonly facts: OrgView;
  readonly forPerson: (userId: string) => Pick<StructureRead, "apps">;
}
import type { MateOverviewEntry } from "./mateOverviews.ts";
import { UsageRefused } from "./usageLedger.ts";
import { mayReadUsage, usageOwner } from "./usageAccess.ts";
import { zeroUsage } from "./usageAccounting.ts";
export const USAGE_REPORT_LIMITS = {
  groups: 200,
  coverage: 200,
  page: 100,
  bytes: 256 * 1024,
  scopesPerPerson: 8,
  exactDays: AGENT_USAGE_EXACT_DAYS + 2,
  statementMs: 10000,
} as const;
const decodeAfter = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(Schema.String).check(Schema.isMinLength(3), Schema.isMaxLength(6)),
  ),
);
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const readReport = Schema.decodeUnknownEffect(UsageReportSchema);
interface Source {
  readonly origin_id: string | null;
  readonly org_id: string;
  readonly project_id: string;
  readonly mate_id: string;
  readonly coverage: UsageCoverage | null;
  readonly provider: string | null;
  readonly deleted: boolean;
  readonly label: string;
  readonly current_mate: string | null;
  readonly app_id: string | null;
  readonly last_app_id: string | null;
  readonly made_by: string | null;
  readonly standup_requested_by: string | null;
  readonly signers: Readonly<Record<string, string>> | null;
}
/** Only the scope hub reads reports; cached scope deliveries are permission-fenced by that hub. */
export const HqUsageReader = Context.Reference<{
  readonly changes?: Stream.Stream<void>;
  readonly read?: (
    userId: string,
    scope: AgentUsageScope,
    current: UsageReportAccess,
    overviews: ReadonlyMap<string, MateOverviewEntry>,
  ) => Effect.Effect<UsageReport, SqlError | UsageRefused>;
}>("@t3tools/hq/usageReader", { defaultValue: () => ({}) });
const sums = (expression: string) =>
  `jsonb_build_object(${Object.keys(zeroUsage())
    .map((key) => `'${key}',coalesce(sum((${expression}->>'${key}')::numeric),0)::text`)
    .join(",")})`;
export const readUsageReport = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  userId: string,
  scope: AgentUsageScope,
  current: UsageReportAccess,
  overviews: ReadonlyMap<string, MateOverviewEntry>,
) {
  const member = current.facts.members.find(
    (person) => person.kind === "person" && person.userId === userId && person.status === "ACTIVE",
  );
  if (member === undefined) return yield* new UsageRefused({ code: "forbidden" });
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      // A query deadline yields a transient refusal, never an empty accounting answer.
      yield* sql.unsafe(`SET LOCAL statement_timeout=${USAGE_REPORT_LIMITS.statementMs}`);
      const [state] = yield* sql<{
        readonly revision: string;
        readonly exact_since: string | null;
        readonly recovery: string;
        readonly pricing: string;
        readonly protected_revision: string | null;
        readonly protected_set: string | null;
        readonly protection_verified: boolean;
      }>`
      SELECT revision::text,protected_revision::text,protected_set,protection_verified,to_char(exact_since AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS exact_since,recovery,(SELECT revision FROM hq_usage_price_policy WHERE id=1) AS pricing FROM hq_usage_state WHERE id=1`;
      if (state === undefined) return yield* new UsageRefused({ code: "usage_state_missing" });
      const sources =
        yield* sql<Source>`SELECT o.origin_id,o.org_id,coalesce(o.project_id,m.project_id) AS project_id,
      coalesce(o.mate_id,m.usage_id)::text AS mate_id,o.coverage,o.provider,coalesce(o.deleted,false) AS deleted,
      coalesce(o.label,m.project_id) AS label,o.last_app_id,m.usage_id::text AS current_mate,p.app_id::text,m.made_by,m.standup_requested_by,m.signers
      FROM hq_usage_origin o FULL JOIN hq_mate m ON m.usage_id=o.mate_id LEFT JOIN hq_app_project p ON p.project_id=coalesce(o.project_id,m.project_id)
      WHERE o.org_id=${current.facts.orgId} OR o.origin_id IS NULL`;
      const q = scope.query;
      if (
        q.mode === "exact" &&
        q.since !== null &&
        Date.parse(q.until) - Date.parse(q.since) >
          USAGE_REPORT_LIMITS.exactDays * 24 * 60 * 60 * 1000
      )
        return yield* new UsageRefused({ code: "usage_exact_window_too_large" });
      const admitted = sources.filter((source) =>
        mayReadUsage(current.facts, userId, source.project_id, source.deleted),
      );
      const scoped = admitted.flatMap((source) => {
        const live = source.current_mate === source.mate_id && !source.deleted;
        const overview = live ? overviews.get(source.project_id)?.overview : undefined;
        const everSignedIn = Object.fromEntries(
          Object.entries(overview?.logins ?? {}).flatMap(([login, digest]) => {
            const user = digest.lastSignedInBy ?? digest.signedInBy ?? source.signers?.[login];
            return user == null ? [] : [[login, user]];
          }),
        );
        const owner = live
          ? usageOwner({
              facts: current.facts,
              projectId: source.project_id,
              everSignedIn: { ...source.signers, ...everSignedIn },
              runsWithoutSignIn: overview?.identity.runsWithoutSignIn === true,
              madeBy: source.made_by,
              standupRequestedBy: source.standup_requested_by,
            })
          : null;
        const app = live ? source.app_id : source.last_app_id;
        if (
          (q.projectId !== null && q.projectId !== source.project_id) ||
          (q.mateId !== null && q.mateId !== source.mate_id) ||
          (q.appId !== null && q.appId !== app) ||
          (q.ownerUserId !== null && q.ownerUserId !== owner) ||
          (source.origin_id !== null && q.provider !== null && q.provider !== source.provider)
        )
          return [];
        return [
          {
            originId: source.origin_id,
            projectId: source.project_id,
            mateId: source.mate_id,
            appId: app,
            ownerUserId: owner,
            label: source.label,
            deleted: source.deleted,
            coverage: source.coverage,
            live,
          },
        ];
      });
      const captureGaps = scoped
        .filter((source) => source.originId === null)
        .map((source) => ({
          projectId: source.projectId,
          mateId: source.mateId,
          appId: source.appId,
          ownerUserId: source.ownerUserId,
          label: source.label,
          reason: "unregistered" as const,
        }));
      const counted = scoped.flatMap((source) =>
        source.originId !== null && source.coverage !== null
          ? [{ ...source, originId: source.originId, coverage: source.coverage }]
          : [],
      );
      counted.sort((a, b) => a.originId.localeCompare(b.originId));
      // A narrowed inaccessible selector is a refusal, not an authorized empty zero.
      if (q.projectId !== null && !admitted.some((source) => source.project_id === q.projectId))
        return yield* new UsageRefused({ code: "forbidden" });
      if (q.mateId !== null && !admitted.some((source) => source.mate_id === q.mateId))
        return yield* new UsageRefused({ code: "forbidden" });
      if (
        q.appId !== null &&
        !admitted.some((source) => source.deleted && source.last_app_id === q.appId) &&
        !current.forPerson(userId).apps.some((app) => app.id === q.appId)
      )
        return yield* new UsageRefused({ code: "forbidden" });
      if (
        q.ownerUserId !== null &&
        !current.facts.members.some(
          (member) => member.kind === "person" && member.userId === q.ownerUserId,
        )
      )
        return yield* new UsageRefused({ code: "unresolved_owner_scope" });
      const generation = {
        accounting: state.revision,
        access: usageDigest({
          userId,
          scoped: scoped.map(({ coverage: _coverage, ...item }) => item),
          query: q,
          detailTier: scope.detail?.tier ?? null,
        }),
        pricing: state.pricing,
      };
      if (
        scope.detail?.cursor !== undefined &&
        usageDigest(scope.detail.cursor.generation) !== usageDigest(generation)
      )
        return yield* new UsageRefused({ code: "usage_page_invalidated" });
      const unsupported =
        q.mode === "exact" &&
        (q.since === null ||
          state.exact_since === null ||
          Date.parse(q.since) < Date.parse(state.exact_since));
      const incomplete =
        state.recovery !== "verified" ||
        counted.length === 0 ||
        captureGaps.length > 0 ||
        counted.some(
          (source) =>
            source.coverage.state !== "complete" ||
            source.coverage.since === null ||
            q.since === null ||
            Date.parse(source.coverage.since) > Date.parse(q.since) ||
            source.coverage.through === null ||
            Date.parse(source.coverage.through) < Date.parse(q.until) ||
            source.coverage.gaps.length > 0 ||
            (q.groupBy === "owner" && source.ownerUserId === null),
        );
      const base = {
        query: q,
        generation,
        exactSince: state.exact_since,
        basis: "recorded-provider-usage-current-owner-and-app" as const,
        state: unsupported
          ? ("unsupported-exact-boundary" as const)
          : incomplete
            ? ("partial" as const)
            : ("complete" as const),
        coverage: counted.slice(0, 200).map((source) => ({
          originId: source.originId,
          value: source.coverage,
          deleted: source.deleted,
          projectId: source.projectId,
          mateId: source.mateId,
          appId: source.appId,
          ownerUserId: source.ownerUserId,
          label: source.label,
          placement: source.live ? ("current" as const) : ("last-known" as const),
        })),
        coverageMore: counted.length > 200,
        captureGaps: captureGaps.slice(0, 200),
        captureGapsMore: captureGaps.length > 200,
        retention: {
          targetDays: AGENT_USAGE_EXACT_DAYS,
          protectedRevision: state.protected_revision,
          protectedSet: state.protected_set,
          pinned: !state.protection_verified || state.protected_revision !== state.revision,
        } satisfies NonNullable<UsageReport["retention"]>,
      };
      if (unsupported)
        return {
          ...base,
          totals: zeroUsage(),
          pricing: {
            basis: "automatic-api-equivalent-estimate" as const,
            revision: state.pricing,
            costUsdNanos: null,
            pricedRecords: "0",
            unpricedRecords: "0",
          },
          groups: [],
          groupsMore: false,
          detail: [],
          next: null,
        };
      // Whole UTC days always use rollups. Only exact subday edges replace their intersected cells.
      const params = [json(counted), q.since, q.until, q.mode, q.model, state.pricing];
      const cellCte = `WITH source AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS s("originId" text,"projectId" text,"mateId" text,"appId" text,"ownerUserId" text, deleted boolean)),
    cells AS (
      SELECT d.origin_id,d.day,d.model,d.pricing_band,d.statistics,d.native_cost,s.* FROM hq_usage_daily d JOIN source s ON s."originId"=d.origin_id
      WHERE ((d.day='unallocated' AND $2::timestamptz IS NULL) OR (d.day<>'unallocated' AND ($2::timestamptz IS NULL OR d.day>=to_char($2::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD')) AND d.day<to_char(($3::timestamptz AT TIME ZONE 'UTC')::date + CASE WHEN $4='exact' AND ($3::timestamptz AT TIME ZONE 'UTC')::time<>'00:00'::time THEN 1 ELSE 0 END,'YYYY-MM-DD')
      )) AND ($5::text IS NULL OR d.model=$5)
      AND NOT ($4='exact' AND (($2::timestamptz IS NOT NULL AND ($2::timestamptz AT TIME ZONE 'UTC')::time<>'00:00'::time AND d.day=to_char($2::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD')) OR (($3::timestamptz AT TIME ZONE 'UTC')::time<>'00:00'::time AND d.day=to_char($3::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD'))))
      UNION ALL
      SELECT f.origin_id,f.day,f.model,r.contribution->>'pricingBand',r.contribution->'statistics',r.contribution->'nativeCost',s.* FROM hq_usage_fact f JOIN source s ON s."originId"=f.origin_id JOIN hq_usage_receipt r USING(origin_id,native_id)
      WHERE $4='exact' AND f.occurrence >= $2::timestamptz AND f.occurrence < $3::timestamptz AND r.contribution IS NOT NULL AND r.contribution<>'null'::jsonb
      AND ($5::text IS NULL OR f.model=$5) AND ((($2::timestamptz AT TIME ZONE 'UTC')::time<>'00:00'::time AND f.day=to_char($2::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD')) OR (($3::timestamptz AT TIME ZONE 'UTC')::time<>'00:00'::time AND f.day=to_char($3::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD')))
    ), priced AS (SELECT c.*,p.rates,
      CASE WHEN p.rates IS NOT NULL AND (c.statistics->>'unknownComponents')::numeric=0 AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(c.statistics) component WHERE component.key IN ('uncachedInput','cachedInput','cacheCreation','output') AND component.value::numeric>0 AND p.rates->>component.key IS NULL) THEN
      (c.statistics->>'uncachedInput')::numeric*coalesce((p.rates->>'uncachedInput')::numeric,0)+(c.statistics->>'cachedInput')::numeric*coalesce((p.rates->>'cachedInput')::numeric,0)+(c.statistics->>'cacheCreation')::numeric*coalesce((p.rates->>'cacheCreation')::numeric,0)+(c.statistics->>'output')::numeric*coalesce((p.rates->>'output')::numeric,0) END AS cost
      FROM cells c LEFT JOIN hq_usage_price p ON p.revision=$6 AND p.model=c.model AND p.pricing_band=c.pricing_band)`;
      const group = {
        month: "CASE WHEN day='unallocated' THEN 'unallocated' ELSE substring(day,1,7) END",
        year: "CASE WHEN day='unallocated' THEN 'unallocated' ELSE substring(day,1,4) END",
        model: "nullif(model,'')",
        mate: '"mateId"',
        project: '"projectId"',
        app: "coalesce(\"appId\",'ungrouped')",
        owner:
          "coalesce(\"ownerUserId\",CASE WHEN deleted THEN 'deleted-retired' ELSE 'unresolved' END)",
      }[q.groupBy];
      const [summary] = yield* sql.unsafe<{
        readonly totals: UsageStatistics;
        readonly cost: string | null;
        readonly priced: string;
        readonly unpriced: string;
        readonly groups: UsageReport["groups"];
        readonly more: boolean;
        readonly unallocated: boolean;
        readonly native: Readonly<Record<string, string>>;
      }>(
        `${cellCte}, grouped AS (SELECT coalesce(${group},'unresolved') AS key,${sums("statistics")} AS totals,CASE WHEN count(cost)>0 THEN trunc(sum(cost))::text ELSE NULL END AS "costUsdNanos" FROM priced GROUP BY 1), limited AS (SELECT * FROM grouped ORDER BY key LIMIT 201)
      SELECT ${sums("statistics")} AS totals,CASE WHEN count(cost)>0 THEN trunc(sum(cost))::text ELSE NULL END AS cost,
      coalesce(sum(CASE WHEN cost IS NOT NULL THEN (statistics->>'records')::numeric ELSE 0 END),0)::text AS priced,
      coalesce(sum(CASE WHEN cost IS NULL THEN (statistics->>'records')::numeric ELSE 0 END),0)::text AS unpriced,
      (SELECT coalesce(jsonb_agg(x ORDER BY key),'[]') FROM (SELECT * FROM limited ORDER BY key LIMIT 200)x) AS groups,
      (SELECT count(*)>200 FROM limited) AS more,
      (SELECT hq_usage_sum(native_cost) FROM priced) AS native,
      EXISTS(SELECT 1 FROM hq_usage_daily d JOIN source s ON s."originId"=d.origin_id WHERE d.day='unallocated' AND (d.statistics->>'records')::numeric>0) AS unallocated
      FROM priced`,
        params,
      );
      if (summary === undefined) return yield* new UsageRefused({ code: "usage_summary_missing" });
      let detail: ReadonlyArray<unknown> = [];
      let next: UsageReport["next"] = null;
      let detailRows: ReadonlyArray<{ readonly key: string; readonly value: unknown }> = [];
      if (scope.detail !== undefined) {
        if (
          scope.detail.tier === "exact" &&
          (q.since === null ||
            state.exact_since === null ||
            Date.parse(q.since) < Date.parse(state.exact_since))
        )
          return yield* new UsageRefused({ code: "unsupported_exact_boundary" });
        const after =
          scope.detail.cursor === undefined
            ? undefined
            : yield* decodeAfter(scope.detail.cursor.after).pipe(
                Effect.mapError(() => new UsageRefused({ code: "usage_page_cursor_invalid" })),
              );
        const tier = scope.detail.tier;
        const rows = yield* sql.unsafe<{ readonly key: string; readonly value: unknown }>(
          tier === "daily"
            ? `WITH source AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS s("originId" text)) SELECT jsonb_build_array(d.day,d.origin_id,d.model,d.pricing_band,d.meter_version,d.known_components)::text AS key,jsonb_build_object('originId',d.origin_id,'day',d.day,'model',nullif(d.model,''),'pricingBand',d.pricing_band,'meterVersion',d.meter_version,'knownComponents',d.known_components,'statistics',d.statistics,'nativeCost',d.native_cost) AS value FROM hq_usage_daily d JOIN source s ON s."originId"=d.origin_id WHERE d.day<>'unallocated' AND ($2::timestamptz IS NULL OR d.day>=to_char($2::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD')) AND d.day<to_char($3::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD') AND ($4::text IS NULL OR d.model=$4) AND ($5::text IS NULL OR (d.day,d.origin_id,d.model,d.pricing_band,d.meter_version,d.known_components)>($5,$6,$7,$8,$9,$10)) ORDER BY d.day,d.origin_id,d.model,d.pricing_band,d.meter_version,d.known_components LIMIT 101`
            : `WITH source AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS s("originId" text)) SELECT jsonb_build_array(f.occurrence,f.origin_id,f.native_id)::text AS key,f.value FROM hq_usage_fact f JOIN source s ON s."originId"=f.origin_id WHERE f.occurrence >= $2::timestamptz AND f.occurrence < $3::timestamptz AND ($4::text IS NULL OR f.model=$4) AND ($5::text IS NULL OR (f.occurrence,f.origin_id,f.native_id)>($5::timestamptz,$6,$7)) ORDER BY f.occurrence,f.origin_id,f.native_id LIMIT 101`,
          [
            json(counted),
            q.since,
            q.until,
            q.model,
            ...(tier === "daily"
              ? [
                  after?.[0] ?? null,
                  after?.[1] ?? "",
                  after?.[2] ?? "",
                  after?.[3] ?? "",
                  after?.[4] ?? "",
                  after?.[5] ?? "",
                ]
              : [after?.[0] ?? null, after?.[1] ?? "", after?.[2] ?? ""]),
          ],
        );
        detailRows = rows;
        detail = rows.slice(0, USAGE_REPORT_LIMITS.page).map((row) => row.value);
        if (rows.length > 100) next = { generation, after: rows[99]!.key };
      }
      const report = {
        ...base,
        state: summary.unallocated ? "partial" : base.state,
        totals: summary.totals,
        pricing: {
          basis: "automatic-api-equivalent-estimate",
          revision: state.pricing,
          costUsdNanos: summary.cost,
          pricedRecords: summary.priced,
          unpricedRecords: summary.unpriced,
        },
        nativeCosts: summary.native ?? {},
        groups: summary.groups,
        groupsMore: summary.more,
        detail,
        next,
      };
      while (
        new TextEncoder().encode(json({ ...report, detail, next })).byteLength >
          USAGE_REPORT_LIMITS.bytes &&
        detail.length > 0
      ) {
        detail = detail.slice(0, -1);
        if (detail.length > 0) next = { generation, after: detailRows[detail.length - 1]!.key };
      }
      if (
        new TextEncoder().encode(json({ ...report, detail, next })).byteLength >
          USAGE_REPORT_LIMITS.bytes ||
        (detailRows.length > 0 && detail.length === 0)
      )
        return yield* new UsageRefused({ code: "usage_report_too_large" });
      return yield* readReport({ ...report, detail, next }).pipe(
        Effect.mapError(() => new UsageRefused({ code: "usage_report_corrupt_or_overflow" })),
      );
    }),
  );
});
