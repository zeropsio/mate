// @effect-diagnostics nodeBuiltinImport:off -- opaque sender fences are scoped to this HQ process.
import * as NodeCrypto from "node:crypto";
import {
  AGENT_USAGE_BATCH_BYTES,
  AGENT_USAGE_CAPTURE_PROTOCOL,
  type UsageFact,
  type UsageOrigin,
  type UsageCoverage,
} from "@t3tools/contracts";
import {
  usageDigest,
  usageEntryDigest,
  usageSnapshotDigest,
  USAGE_GENESIS_DIGEST,
  type UsageLinkUp,
  type UsageLinkDown,
} from "@t3tools/shared/agentUsage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { Leader, type NotLeader } from "./leader.ts";
import { Roles } from "./roles.ts";
import { type ZeropsError } from "./zerops/api.ts";
import { lockProject } from "./held.ts";
import { contributionOf, type UsageContribution } from "./usageAccounting.ts";

export class UsageRefused extends Schema.TaggedError<UsageRefused>()("UsageRefused", {
  code: Schema.String,
}) {}
export type UsageWriteError = UsageRefused | SqlError | NotLeader | ZeropsError;
export interface UsageSender {
  readonly projectId: string;
  readonly credential: string;
  readonly channel: string;
  readonly mateId: string;
}
export interface UsageLedgerService {
  readonly open: (
    projectId: string,
    credential: string,
  ) => Effect.Effect<UsageSender, UsageWriteError>;
  readonly receive: (
    sender: UsageSender,
    message: UsageLinkUp,
  ) => Effect.Effect<UsageLinkDown, UsageWriteError>;
  readonly changes: Stream.Stream<void>;
  readonly notify: Effect.Effect<void>;
}
/** Optional only for isolated old-link tests. Core always installs the durable lane. */
export const UsageLane = Context.Reference<{ readonly ledger?: UsageLedgerService }>(
  "@t3tools/hq/usageLane",
  { defaultValue: () => ({}) },
);
interface Producer {
  readonly org_id: string;
  readonly project_id: string;
  readonly mate_id: string;
  readonly cursor: string;
  readonly digest: string;
  readonly snapshot: SnapshotProgress | null;
}
interface SnapshotProgress {
  readonly id: string;
  readonly highWater: string;
  readonly highDigest: string;
  readonly pages: number;
  readonly page: number;
  readonly digest: string;
  readonly manifest: string;
  readonly totalFacts: string;
  readonly receivedFacts: string;
}
interface OriginRow {
  readonly org_id: string;
  readonly project_id: string;
  readonly mate_id: string;
  readonly writer_id: string;
  readonly ledger_id: string;
  readonly provider: string;
}
interface ReceiptRow {
  readonly native_id: string;
  readonly revision: string;
  readonly digest: string;
  readonly contribution: UsageContribution | null;
}
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const withoutDigest = <T extends { readonly digest: string }>(value: T) => {
  const { digest: _, ...body } = value;
  return body;
};
export const makeUsageLedger = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  leader: Leader["Service"],
  readOrg: Effect.Effect<string, ZeropsError>,
) {
  const processId = NodeCrypto.randomUUID();
  const changed = yield* PubSub.unbounded<void>();
  const fail = (code: string) => new UsageRefused({ code });
  const credentialHash = (credential: string) =>
    NodeCrypto.createHash("sha256").update(credential).digest("hex");
  const authorize = Effect.fnUntraced(function* (sender: UsageSender) {
    yield* lockProject(sql, sender.projectId);
    yield* sql`SELECT id FROM hq_usage_state WHERE id=1 FOR UPDATE`;
    const currentMate =
      yield* sql`SELECT 1 FROM hq_mate WHERE project_id=${sender.projectId} AND usage_id=${sender.mateId}::uuid`;
    if (currentMate.length !== 1) return yield* fail("mate_retired");
    const rows =
      yield* sql`SELECT 1 FROM hq_mate_credential WHERE project_id=${sender.projectId} AND credential_hash=${credentialHash(sender.credential)} AND revoked_at IS NULL FOR SHARE`;
    if (rows.length !== 1) return yield* fail("credential_revoked");
    const active =
      yield* sql`SELECT 1 FROM hq_usage_sender WHERE project_id=${sender.projectId} AND channel=${sender.channel} AND process_id=${processId}`;
    if (active.length !== 1) return yield* fail("channel_replaced");
  });
  const register = Effect.fnUntraced(function* (
    sender: UsageSender,
    ledgerId: string,
    origin: UsageOrigin,
    orgId: string,
  ) {
    if (
      origin.orgId !== orgId ||
      origin.projectId !== sender.projectId ||
      origin.mateId !== sender.mateId
    )
      return yield* fail("origin_binding");
    const [old] =
      yield* sql<OriginRow>`SELECT * FROM hq_usage_origin WHERE origin_id=${origin.originId}`;
    if (old !== undefined) {
      if (
        old.org_id !== orgId ||
        old.project_id !== sender.projectId ||
        old.mate_id !== sender.mateId ||
        old.writer_id !== origin.writerId ||
        old.ledger_id !== ledgerId ||
        old.provider !== origin.provider
      )
        return yield* fail("origin_lineage_conflict");
      // A repeated hello cannot replace a coverage barrier already committed in the journal.
      return false;
    }
    yield* sql`INSERT INTO hq_usage_origin(origin_id,org_id,project_id,mate_id,ledger_id,writer_id,provider,label,coverage,last_app_id)
      VALUES(${origin.originId},${orgId},${sender.projectId},${sender.mateId}::uuid,${ledgerId},${origin.writerId},${origin.provider},${origin.label},${json(origin.coverage)}::jsonb,(SELECT app_id::text FROM hq_app_project WHERE project_id=${sender.projectId}))`;
    return true;
  });
  const delta = Effect.fnUntraced(function* (
    originId: string,
    contribution: UsageContribution,
    sign: number,
  ) {
    const { day, model, pricingBand, meterVersion, knownComponents, statistics, nativeCost } =
      contribution;
    if (sign === 1)
      yield* sql`INSERT INTO hq_usage_daily(origin_id,day,model,pricing_band,meter_version,known_components,statistics,native_cost)
      VALUES(${originId},${day},${model},${pricingBand},${meterVersion},${knownComponents},${json(statistics)}::jsonb,${json(nativeCost)}::jsonb)
      ON CONFLICT(origin_id,day,model,pricing_band,meter_version,known_components) DO UPDATE SET statistics=hq_usage_add(hq_usage_daily.statistics,EXCLUDED.statistics,1), native_cost=hq_usage_add(hq_usage_daily.native_cost,EXCLUDED.native_cost,1)`;
    else {
      const rows =
        yield* sql`UPDATE hq_usage_daily SET statistics=hq_usage_add(statistics,${json(statistics)}::jsonb,-1),native_cost=hq_usage_add(native_cost,${json(nativeCost)}::jsonb,-1)
        WHERE origin_id=${originId} AND day=${day} AND model=${model} AND pricing_band=${pricingBand} AND meter_version=${meterVersion} AND known_components=${knownComponents} RETURNING 1`;
      if (rows.length !== 1) return yield* fail("missing_daily_contribution");
    }
  });
  const apply = Effect.fnUntraced(function* (
    sender: UsageSender,
    ledgerId: string,
    fact: UsageFact,
    orgId: string,
  ) {
    const [origin] =
      yield* sql<OriginRow>`SELECT * FROM hq_usage_origin WHERE origin_id=${fact.originId}`;
    if (
      origin === undefined ||
      origin.org_id !== orgId ||
      origin.project_id !== sender.projectId ||
      origin.mate_id !== sender.mateId ||
      origin.ledger_id !== ledgerId ||
      origin.provider !== fact.provider
    )
      return yield* fail("unregistered_origin");
    const aliases = [...new Set([fact.nativeId, ...fact.aliases])];
    const rows = yield* sql<{
      readonly native_id: string;
    }>`SELECT DISTINCT native_id FROM hq_usage_alias WHERE origin_id=${fact.originId} AND ${sql.in("alias", aliases)}`;
    if (rows.length > 1) return yield* fail("alias_conflict");
    const nativeId = rows[0]?.native_id ?? fact.nativeId;
    const [old] =
      yield* sql<ReceiptRow>`SELECT native_id,revision::text,digest,contribution FROM hq_usage_receipt WHERE origin_id=${fact.originId} AND native_id=${nativeId}`;
    const digest = usageDigest(fact);
    // Another native identity holding this fact id would violate the receipt's uniqueness: the
    // Mate sent different content under the same ids, so no retry can ever commit it.
    const holders = yield* sql<{
      readonly native_id: string;
    }>`SELECT native_id FROM hq_usage_receipt WHERE origin_id=${fact.originId} AND fact_id=${fact.factId} AND native_id<>${nativeId}`;
    if (holders.length > 0) return yield* fail("fact_identity_conflict");
    if (old !== undefined) {
      if (BigInt(fact.revision) < BigInt(old.revision)) return false;
      if (fact.revision === old.revision) {
        if (old.digest !== digest) return yield* fail("fact_revision_conflict");
        return false;
      }
    }
    const contribution = yield* Effect.try({
      try: () => contributionOf(fact),
      catch: () => fail("invalid_contribution"),
    });
    if (old?.contribution !== null && old?.contribution !== undefined)
      yield* delta(fact.originId, old.contribution, -1);
    if (contribution !== null) yield* delta(fact.originId, contribution, 1);
    yield* sql`INSERT INTO hq_usage_receipt(origin_id,native_id,fact_id,revision,digest,contribution)
      VALUES(${fact.originId},${nativeId},${fact.factId},${fact.revision}::numeric,${digest},${json(contribution)}::jsonb)
      ON CONFLICT(origin_id,native_id) DO UPDATE SET revision=EXCLUDED.revision,digest=EXCLUDED.digest,contribution=EXCLUDED.contribution`;
    for (const alias of aliases)
      yield* sql`INSERT INTO hq_usage_alias(origin_id,alias,native_id) VALUES(${fact.originId},${alias},${nativeId}) ON CONFLICT DO NOTHING`;
    yield* sql`INSERT INTO hq_usage_fact(origin_id,native_id,occurrence,day,model,value)
      VALUES(${fact.originId},${nativeId},${fact.time.kind === "instant" ? fact.time.at : null}::timestamptz,${fact.time.kind === "instant" ? fact.time.at.slice(0, 10) : "unallocated"},${fact.model ?? ""},${json(fact)}::jsonb)
      ON CONFLICT(origin_id,native_id) DO UPDATE SET ingested_at=now(),occurrence=EXCLUDED.occurrence,day=EXCLUDED.day,model=EXCLUDED.model,value=EXCLUDED.value`;
    return true;
  });
  const coverage = Effect.fnUntraced(function* (
    sender: UsageSender,
    ledgerId: string,
    values: ReadonlyArray<{
      originId: string;
      value: UsageCoverage;
    }>,
    staging = false,
  ) {
    for (const item of values) {
      const rows = staging
        ? yield* sql`UPDATE hq_usage_origin SET snapshot_coverage=${json(item.value)}::jsonb WHERE origin_id=${item.originId} AND ledger_id=${ledgerId} AND mate_id=${sender.mateId}::uuid RETURNING 1`
        : yield* sql`UPDATE hq_usage_origin SET coverage=${json(item.value)}::jsonb WHERE origin_id=${item.originId} AND ledger_id=${ledgerId} AND mate_id=${sender.mateId}::uuid RETURNING 1`;
      if (rows.length !== 1) return yield* fail("unregistered_coverage");
    }
  });
  const receive = Effect.fnUntraced(function* (sender: UsageSender, message: UsageLinkUp) {
    if (new TextEncoder().encode(json(message)).byteLength > AGENT_USAGE_BATCH_BYTES)
      return yield* fail("usage_frame_too_big");
    const orgId = yield* readOrg;
    const answer = yield* leader.write(
      Effect.gen(function* () {
        yield* authorize(sender);
        const ledgerId = message.ledgerId;
        let [producer] =
          yield* sql<Producer>`SELECT org_id,project_id,mate_id::text,cursor::text,digest,snapshot FROM hq_usage_producer WHERE ledger_id=${ledgerId} FOR UPDATE`;
        if (message.type === "usage-hello") {
          if (message.protocol !== AGENT_USAGE_CAPTURE_PROTOCOL)
            return yield* fail("unsupported_protocol");
          const newProducer = producer === undefined;
          if (producer === undefined) {
            yield* sql`INSERT INTO hq_usage_producer(ledger_id,org_id,project_id,mate_id,channel,process_id,digest) VALUES(${ledgerId},${orgId},${sender.projectId},${sender.mateId}::uuid,${sender.channel},${processId},${USAGE_GENESIS_DIGEST})`;
            producer = {
              org_id: orgId,
              project_id: sender.projectId,
              mate_id: sender.mateId,
              cursor: "0",
              digest: USAGE_GENESIS_DIGEST,
              snapshot: null,
            };
          }
          if (
            producer.org_id !== orgId ||
            producer.project_id !== sender.projectId ||
            producer.mate_id !== sender.mateId
          )
            return yield* fail("ledger_binding_conflict");
          if (
            BigInt(producer.cursor) > BigInt(message.highWater) ||
            (producer.cursor === message.highWater && producer.digest !== message.highDigest)
          )
            return yield* fail("ledger_rollback_conflict");
          let registered = false;
          for (const origin of message.origins)
            registered = (yield* register(sender, ledgerId, origin, orgId)) || registered;
          yield* sql`UPDATE hq_usage_producer SET channel=${sender.channel},process_id=${processId} WHERE ledger_id=${ledgerId}`;
          if (registered || newProducer)
            yield* sql`UPDATE hq_usage_state SET revision=revision+1 WHERE id=1`;
          return {
            type: "usage-resume",
            ledgerId,
            channel: sender.channel,
            cursor: producer.cursor,
            digest: producer.digest,
            action:
              BigInt(message.replayFloor) > BigInt(producer.cursor) + 1n ? "snapshot" : "replay",
          } as const;
        }
        if (
          message.channel !== sender.channel ||
          producer === undefined ||
          producer.org_id !== orgId ||
          producer.project_id !== sender.projectId ||
          producer.mate_id !== sender.mateId
        )
          return yield* fail("channel_or_binding");
        const bound =
          yield* sql`SELECT 1 FROM hq_usage_producer WHERE ledger_id=${ledgerId} AND channel=${sender.channel} AND process_id=${processId}`;
        if (bound.length !== 1) return yield* fail("hello_required");
        let cursor = producer.cursor;
        let digest = producer.digest;
        let moved = false;
        if (message.type === "usage-batch") {
          if (producer.snapshot !== null && producer.snapshot.page < producer.snapshot.pages)
            return yield* fail("snapshot_in_progress");
          let checkedCursor = cursor;
          let checkedDigest = digest;
          const checked = new Map<string, string>();
          for (const entry of message.entries) {
            if (usageEntryDigest(withoutDigest(entry)) !== entry.digest)
              return yield* fail("entry_digest");
            if (BigInt(entry.sequence) <= BigInt(checkedCursor)) {
              const previous =
                checked.get(entry.sequence) ??
                (yield* sql<{
                  readonly digest: string;
                }>`SELECT digest FROM hq_usage_prefix WHERE ledger_id=${ledgerId} AND sequence=${entry.sequence}::numeric`)[0]
                  ?.digest;
              if (previous !== entry.digest) return yield* fail("prefix_conflict");
            } else {
              if (BigInt(entry.sequence) !== BigInt(checkedCursor) + 1n)
                return {
                  type: "usage-resume",
                  ledgerId,
                  channel: sender.channel,
                  cursor,
                  digest,
                  action: "replay",
                } as const;
              if (entry.previousDigest !== checkedDigest) return yield* fail("prefix_conflict");
              checkedCursor = entry.sequence;
              checkedDigest = entry.digest;
              checked.set(entry.sequence, entry.digest);
            }
          }
          for (const entry of message.entries) {
            if (BigInt(entry.sequence) <= BigInt(cursor)) continue;
            for (const fact of entry.facts)
              moved = (yield* apply(sender, ledgerId, fact, orgId)) || moved;
            yield* coverage(sender, ledgerId, entry.coverage);
            moved = moved || entry.coverage.length > 0;
            cursor = entry.sequence;
            digest = entry.digest;
            yield* sql`INSERT INTO hq_usage_prefix(ledger_id,sequence,digest) VALUES(${ledgerId},${cursor}::numeric,${digest})`;
          }
        } else if (message.type === "usage-snapshot-abandon") {
          if (
            producer.snapshot?.id !== message.snapshotId ||
            producer.snapshot.page === producer.snapshot.pages
          )
            return yield* fail("snapshot_not_in_progress");
          // Already accepted pages remain canonical; abandonment never subtracts by absence.
          yield* sql`UPDATE hq_usage_producer SET snapshot=NULL WHERE ledger_id=${ledgerId}`;
          yield* sql`UPDATE hq_usage_origin SET snapshot_coverage=NULL WHERE ledger_id=${ledgerId}`;
          yield* sql`UPDATE hq_usage_state SET revision=revision+1 WHERE id=1`;
          return {
            type: "usage-resume",
            ledgerId,
            channel: sender.channel,
            cursor,
            digest,
            action: "snapshot",
          } as const;
        } else {
          const { type: _, channel: __, manifestDigest: ___, digest: ____, ...body } = message;
          if (usageSnapshotDigest(body) !== message.digest) return yield* fail("snapshot_digest");
          const progress =
            producer.snapshot?.page === producer.snapshot?.pages &&
            producer.snapshot?.id !== message.snapshotId
              ? null
              : producer.snapshot;
          if (BigInt(message.highWater) < BigInt(cursor)) return yield* fail("snapshot_rollback");
          if (message.page === 0 && progress === null) {
            if (message.previousDigest !== USAGE_GENESIS_DIGEST)
              return yield* fail("snapshot_prefix");
          } else if (
            progress === null ||
            progress.id !== message.snapshotId ||
            progress.highWater !== message.highWater ||
            progress.highDigest !== message.highDigest ||
            progress.pages !== message.pages ||
            progress.manifest !== message.manifestDigest ||
            progress.totalFacts !== message.totalFacts
          )
            return yield* fail("snapshot_conflict");
          if (
            progress !== null &&
            message.page === progress.page - 1 &&
            message.digest === progress.digest
          )
            return {
              type: "usage-snapshot-ack",
              ledgerId,
              channel: sender.channel,
              snapshotId: message.snapshotId,
              nextPage: progress.page,
              cursor,
              digest,
            } as const;
          if (
            message.page !== (progress?.page ?? 0) ||
            message.previousDigest !== (progress?.digest ?? USAGE_GENESIS_DIGEST)
          )
            return yield* fail("snapshot_page_gap");
          for (const fact of message.facts)
            moved = (yield* apply(sender, ledgerId, fact, orgId)) || moved;
          yield* coverage(sender, ledgerId, message.coverage, true);
          // Published pages stay partial until the pinned manifest is complete.
          yield* sql`UPDATE hq_usage_origin SET coverage=jsonb_set(coverage,'{state}','"recovering"') WHERE ledger_id=${ledgerId}`;
          const complete = message.page + 1 === message.pages;
          if (
            complete &&
            (message.digest !== message.manifestDigest ||
              BigInt(progress?.receivedFacts ?? "0") + BigInt(message.facts.length) !==
                BigInt(message.totalFacts))
          )
            return yield* fail("snapshot_manifest");
          const next: SnapshotProgress = {
            id: message.snapshotId,
            highWater: message.highWater,
            highDigest: message.highDigest,
            pages: message.pages,
            page: message.page + 1,
            digest: message.digest,
            manifest: message.manifestDigest,
            totalFacts: message.totalFacts,
            receivedFacts: String(
              BigInt(progress?.receivedFacts ?? "0") + BigInt(message.facts.length),
            ),
          };
          yield* sql`UPDATE hq_usage_producer SET snapshot=${json(next)}::jsonb WHERE ledger_id=${ledgerId}`;
          if (complete) {
            cursor = message.highWater;
            digest = message.highDigest;
            yield* sql`UPDATE hq_usage_origin SET coverage=coalesce(snapshot_coverage,coverage),snapshot_coverage=NULL WHERE ledger_id=${ledgerId}`;
            yield* sql`INSERT INTO hq_usage_prefix(ledger_id,sequence,digest) VALUES(${ledgerId},${cursor}::numeric,${digest}) ON CONFLICT DO NOTHING`;
          }
          yield* sql`UPDATE hq_usage_producer SET cursor=${cursor}::numeric,digest=${digest} WHERE ledger_id=${ledgerId}`;
          yield* sql`UPDATE hq_usage_state SET revision=revision+1 WHERE id=1`;
          return {
            type: "usage-snapshot-ack",
            ledgerId,
            channel: sender.channel,
            snapshotId: message.snapshotId,
            nextPage: message.page + 1,
            cursor,
            digest,
          } as const;
        }
        yield* sql`UPDATE hq_usage_producer SET cursor=${cursor}::numeric,digest=${digest} WHERE ledger_id=${ledgerId}`;
        if (moved || cursor !== producer.cursor)
          yield* sql`UPDATE hq_usage_state SET revision=revision+1 WHERE id=1`;
        return { type: "usage-ack", ledgerId, channel: sender.channel, cursor, digest } as const;
      }),
    );
    yield* PubSub.publish(changed, undefined);
    return answer;
  });
  return {
    open: (projectId: string, credential: string) =>
      leader.write(
        Effect.gen(function* () {
          yield* lockProject(sql, projectId);
          const rows =
            yield* sql`SELECT 1 FROM hq_mate_credential WHERE project_id=${projectId} AND credential_hash=${credentialHash(credential)} AND revoked_at IS NULL FOR SHARE`;
          if (rows.length !== 1) return yield* fail("credential_revoked");
          const [mate] = yield* sql<{
            readonly id: string;
          }>`SELECT usage_id::text AS id FROM hq_mate WHERE project_id=${projectId}`;
          if (mate === undefined) return yield* fail("mate_gone");
          const channel = NodeCrypto.randomUUID();
          yield* sql`INSERT INTO hq_usage_sender(project_id,channel,process_id) VALUES(${projectId},${channel},${processId}) ON CONFLICT(project_id) DO UPDATE SET channel=EXCLUDED.channel,process_id=EXCLUDED.process_id`;
          return { projectId, credential, channel, mateId: mate.id };
        }),
      ),
    receive,
    changes: Stream.fromPubSub(changed),
    notify: PubSub.publish(changed, undefined).pipe(Effect.asVoid),
  } satisfies UsageLedgerService;
});
export const usageLedgerLayer = Layer.effect(
  UsageLane,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const roles = yield* Roles;
    return {
      ledger: yield* makeUsageLedger(
        sql,
        leader,
        Effect.map(roles.recent, (view) => view.orgId),
      ),
    };
  }),
);
