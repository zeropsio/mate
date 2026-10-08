import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as Schema from "effect/Schema";
import { UsageUtcDay, UsageIdentity, UsageFact, AGENT_USAGE_EXACT_DAYS } from "@t3tools/contracts";
import { usageCanonical, usageDigest } from "@t3tools/shared/agentUsage";
import { Leader } from "./leader.ts";
import { UsageRefused } from "./usageLedger.ts";
import { contributionOf } from "./usageAccounting.ts";
const decodeFact = Schema.decodeUnknownEffect(UsageFact);
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeIdentity = Schema.decodeUnknownEffect(UsageIdentity);
const decodeDay = Schema.decodeUnknownEffect(UsageUtcDay);
export const USAGE_PRUNE_BATCH_ROWS = 1000;

export interface UsageCheckpoint {
  readonly revision: string;
  readonly digest: string;
  readonly rows: string;
}
/** Called on both the protected restored database and the live database, in consistent cuts. */
export const usageCheckpoint = Effect.fnUntraced(function* (sql: SqlClient.SqlClient) {
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      yield* sql`SET LOCAL TIME ZONE 'UTC'`;
      const [row] = yield* sql<{
        readonly revision: string;
        readonly digest: string;
        readonly rows: string;
      }>`
      WITH records AS (
        SELECT 'daily' AS kind,to_jsonb(d)::text AS value FROM hq_usage_daily d
        UNION ALL SELECT 'receipt',to_jsonb(r)::text FROM hq_usage_receipt r
        UNION ALL SELECT 'alias',to_jsonb(a)::text FROM hq_usage_alias a
        UNION ALL SELECT 'origin',to_jsonb(o)::text FROM hq_usage_origin o
        UNION ALL SELECT 'producer',(to_jsonb(p)-'channel'-'process_id')::text FROM hq_usage_producer p
        UNION ALL SELECT 'state',jsonb_build_object('exact_since',exact_since,'recovery',recovery)::text FROM hq_usage_state
        UNION ALL SELECT 'prefix',to_jsonb(p)::text FROM hq_usage_prefix p
        UNION ALL SELECT 'price',to_jsonb(p)::text FROM hq_usage_price p
        UNION ALL SELECT 'policy',to_jsonb(p)::text FROM hq_usage_price_policy p
      ), numbered AS (SELECT kind,value,(row_number() OVER(ORDER BY kind COLLATE "C",value COLLATE "C")-1)/1000 AS chunk FROM records), chunks AS (SELECT chunk,encode(sha256(convert_to(string_agg(encode(sha256(convert_to(kind||value,'UTF8')),'hex'),'' ORDER BY kind COLLATE "C",value COLLATE "C"),'UTF8')),'hex') AS digest,count(*) AS rows FROM numbered GROUP BY chunk) SELECT (SELECT revision::text FROM hq_usage_state WHERE id=1) AS revision,
        encode(sha256(convert_to(coalesce(string_agg(digest,'' ORDER BY chunk),''),'UTF8')),'hex') AS digest,coalesce(sum(rows),0)::text AS rows FROM chunks`;
      if (row === undefined) return yield* new UsageRefused({ code: "usage_checkpoint_missing" });
      return row;
    }),
  );
});
/** An operator verifies an independently stored set by restoring it and comparing this cut.
 * Protect only an unchanged live cut. No ACK or mere successful pg_dump grants prune authority.
 * New writes pin their retiring evidence until another independently restored cut is verified.
 */
export const protectUsageCut = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  leader: Pick<Leader["Service"], "write">,
  proof: {
    readonly setId: string;
    readonly independent: boolean;
    readonly expected: UsageCheckpoint;
    readonly restored: UsageCheckpoint;
  },
) {
  yield* decodeIdentity(proof.setId).pipe(
    Effect.mapError(() => new UsageRefused({ code: "usage_backup_not_verified" })),
  );
  if (
    !proof.independent ||
    proof.setId.length === 0 ||
    usageCanonical(proof.expected) !== usageCanonical(proof.restored)
  )
    return yield* new UsageRefused({ code: "usage_backup_not_verified" });
  const current = yield* usageCheckpoint(sql);
  if (usageCanonical(current) !== usageCanonical(proof.expected))
    return yield* new UsageRefused({ code: "usage_protection_cut_moved" });
  yield* leader.write(
    Effect.gen(function* () {
      const [row] = yield* sql<{
        readonly revision: string;
      }>`SELECT revision::text FROM hq_usage_state WHERE id=1 FOR UPDATE`;
      if (row?.revision !== proof.expected.revision)
        return yield* new UsageRefused({ code: "usage_protection_cut_moved" });
      yield* sql`UPDATE hq_usage_state SET protected_revision=${row.revision}::numeric,protected_set=${proof.setId},protection_verified=true WHERE id=1`;
    }),
  );
});
/** Reconciliation only compares complete permanent receipts to daily cells; never shrinks a day
 * using an incomplete raw rebuild. Expiry changes no accounting quantities.
 */
export const pruneUsageDetail = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  leader: Pick<Leader["Service"], "write">,
  sinceDay: string,
) {
  yield* decodeDay(sinceDay).pipe(
    Effect.mapError(() => new UsageRefused({ code: "invalid_prune_boundary" })),
  );
  return yield* leader.write(
    Effect.gen(function* () {
      const [state] = yield* sql<{
        readonly revision: string;
        readonly protected_revision: string | null;
        readonly protection_verified: boolean;
        readonly exact_since: string | null;
        readonly target: string;
      }>`
      SELECT revision::text,protected_revision::text,protection_verified,exact_since::text,
        to_char((now() AT TIME ZONE 'UTC')::date-${AGENT_USAGE_EXACT_DAYS},'YYYY-MM-DD') AS target FROM hq_usage_state WHERE id=1 FOR UPDATE`;
      if (
        state === undefined ||
        !state.protection_verified ||
        state.revision !== state.protected_revision
      )
        return yield* new UsageRefused({ code: "usage_retention_pinned_unprotected" });
      if (sinceDay > state.target)
        return yield* new UsageRefused({ code: "usage_exact_window_too_short" });
      if (
        state.exact_since !== null &&
        Date.parse(`${sinceDay}T00:00:00Z`) < Date.parse(state.exact_since)
      )
        return yield* new UsageRefused({ code: "usage_prune_boundary_regressed" });
      const missing =
        yield* sql`SELECT 1 FROM hq_usage_fact f LEFT JOIN hq_usage_receipt r USING(origin_id,native_id) WHERE r.native_id IS NULL LIMIT 1`;
      if (missing.length > 0) return yield* new UsageRefused({ code: "usage_receipt_missing" });
      const retiring = yield* sql<{
        readonly origin_id: string;
        readonly native_id: string;
        readonly value: unknown;
        readonly revision: string | null;
        readonly digest: string | null;
        readonly contribution: unknown;
      }>`SELECT f.origin_id,f.native_id,f.value,r.revision::text,r.digest,r.contribution
        FROM hq_usage_fact f LEFT JOIN hq_usage_receipt r USING(origin_id,native_id)
        WHERE f.occurrence<${`${sinceDay}T00:00:00.000Z`}::timestamptz
        OR ((f.occurrence IS NULL OR f.occurrence>now()) AND f.ingested_at<${`${sinceDay}T00:00:00.000Z`}::timestamptz)
        LIMIT ${USAGE_PRUNE_BATCH_ROWS}`;
      for (const row of retiring) {
        const fact = yield* decodeFact(row.value).pipe(
          Effect.mapError(() => new UsageRefused({ code: "usage_retention_detail_corrupt" })),
        );
        const contribution = yield* Effect.try({
          try: () => contributionOf(fact),
          catch: () => new UsageRefused({ code: "usage_retention_detail_corrupt" }),
        });
        if (
          row.origin_id !== fact.originId ||
          row.revision !== fact.revision ||
          row.digest !== usageDigest(fact) ||
          usageCanonical(row.contribution) !== usageCanonical(contribution)
        )
          return yield* new UsageRefused({ code: "usage_retention_detail_mismatch" });
      }
      const mismatch = yield* sql`
      WITH rebuilt AS (SELECT origin_id,contribution->>'day' AS day,contribution->>'model' AS model,contribution->>'pricingBand' AS pricing_band,contribution->>'meterVersion' AS meter_version,contribution->>'knownComponents' AS known_components,
        hq_usage_sum(contribution->'statistics') AS statistics,hq_usage_sum(contribution->'nativeCost') AS native_cost
        FROM hq_usage_receipt WHERE contribution IS NOT NULL AND contribution<>'null'::jsonb GROUP BY 1,2,3,4,5,6),
      compared AS (SELECT coalesce(d.statistics,'{}') AS daily,coalesce(r.statistics,'{}') AS receipts,
        coalesce(d.native_cost,'{}') AS native_daily,coalesce(r.native_cost,'{}') AS native_receipts
        FROM hq_usage_daily d FULL JOIN rebuilt r USING(origin_id,day,model,pricing_band,meter_version,known_components))
      SELECT 1 FROM compared c WHERE EXISTS(SELECT 1 FROM jsonb_each_text(hq_usage_add(c.daily,c.receipts,-1)) s WHERE s.value::numeric<>0)
      OR EXISTS(SELECT 1 FROM jsonb_each_text(hq_usage_add(c.native_daily,c.native_receipts,-1)) s WHERE s.value::numeric<>0) LIMIT 1`;
      if (mismatch.length > 0)
        return yield* new UsageRefused({ code: "usage_rollup_reconciliation_failed" });
      // The materialization boundary and deletion commit together under ingestion's state lock.
      yield* sql`UPDATE hq_usage_state SET exact_since=${`${sinceDay}T00:00:00.000Z`}::timestamptz,revision=revision+1,protected_revision=revision+1 WHERE id=1`;
      const [retired] = yield* sql<{
        readonly count: string;
      }>`WITH keys AS (SELECT * FROM jsonb_to_recordset(${json(retiring.map((row) => ({ originId: row.origin_id, nativeId: row.native_id })))}::jsonb) AS k("originId" text,"nativeId" text)), removed AS (DELETE FROM hq_usage_fact f USING keys k WHERE f.origin_id=k."originId" AND f.native_id=k."nativeId" RETURNING 1) SELECT count(*)::text AS count FROM removed`;
      return Number(retired?.count ?? "0");
    }),
  );
});
