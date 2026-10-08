// @effect-diagnostics nodeBuiltinImport:off -- opaque sender fences are scoped to this HQ process.
import * as NodeCrypto from "node:crypto";
import {
  AGENT_USAGE_BATCH_BYTES,
  AGENT_USAGE_CAPTURE_PROTOCOL,
  type UsageFact,
  type UsageOrigin,
} from "@t3tools/contracts";
import {
  usageOriginId,
  usageFactId,
  usageFactDigest,
  type UsageLinkUp,
  type UsageLinkDown,
} from "@t3tools/shared/agentUsage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { Leader, type NotLeader } from "./leader.ts";
import { Roles } from "./roles.ts";
import { type ZeropsError } from "./zerops/api.ts";
import { lockProject } from "./held.ts";
import { contributionOf } from "./usageAccounting.ts";
import { runUsageRetention } from "./usageRetention.ts";

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
interface OriginRow {
  readonly org_id: string;
  readonly project_id: string;
  readonly mate_id: string;
  readonly provider: string;
}
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
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
    origin: UsageOrigin,
    orgId: string,
  ) {
    if (
      origin.orgId !== orgId ||
      origin.projectId !== sender.projectId ||
      origin.mateId !== sender.mateId
    )
      return yield* fail("origin_binding");
    if (
      origin.originId !==
      usageOriginId({ orgId, projectId: sender.projectId, mateId: sender.mateId }, origin.provider)
    )
      return yield* fail("origin_identity_conflict");
    const [old] =
      yield* sql<OriginRow>`SELECT org_id,project_id,mate_id::text,provider FROM hq_usage_origin WHERE origin_id=${origin.originId}`;
    if (old !== undefined) {
      if (
        old.org_id !== orgId ||
        old.project_id !== sender.projectId ||
        old.mate_id !== sender.mateId ||
        old.provider !== origin.provider
      )
        return yield* fail("origin_binding_conflict");
      return false;
    }
    yield* sql`INSERT INTO hq_usage_origin(origin_id,org_id,project_id,mate_id,provider,label,coverage,last_app_id)
      VALUES(${origin.originId},${orgId},${sender.projectId},${sender.mateId}::uuid,${origin.provider},${origin.label},${json(origin.coverage)}::jsonb,(SELECT app_id::text FROM hq_app_project WHERE project_id=${sender.projectId}))`;
    return true;
  });
  const apply = Effect.fnUntraced(function* (sender: UsageSender, fact: UsageFact, orgId: string) {
    const [origin] =
      yield* sql<OriginRow>`SELECT org_id,project_id,mate_id::text,provider FROM hq_usage_origin WHERE origin_id=${fact.originId}`;
    if (
      origin === undefined ||
      origin.org_id !== orgId ||
      origin.project_id !== sender.projectId ||
      origin.mate_id !== sender.mateId ||
      origin.provider !== fact.provider
    )
      return yield* fail("unregistered_origin");
    if (fact.factId !== usageFactId(fact.sessionId, fact.nativeId))
      return yield* fail("fact_identity_key");
    if (
      fact.originId !==
      usageOriginId({ orgId, projectId: sender.projectId, mateId: sender.mateId }, fact.provider)
    )
      return yield* fail("origin_identity_conflict");
    const digest = usageFactDigest(fact);
    const [old] = yield* sql<{
      readonly digest: string;
    }>`SELECT digest FROM hq_usage_receipt WHERE origin_id=${fact.originId} AND fact_id=${fact.factId}`;
    if (old !== undefined) {
      if (old.digest !== digest) return yield* fail("fact_identity_conflict");
      return false;
    }
    const contribution = yield* Effect.try({
      try: () => contributionOf(fact),
      catch: () => fail("invalid_contribution"),
    });
    const { headline, models } = contribution;
    yield* sql`INSERT INTO hq_usage_receipt(origin_id,fact_id,digest)
      VALUES(${fact.originId},${fact.factId},${digest})`;
    yield* sql`INSERT INTO hq_usage_daily(origin_id,day,meter_version,statistics,native_cost)
      VALUES(${fact.originId},${headline.day},${headline.meterVersion},${json(headline.statistics)}::jsonb,${json(headline.nativeCost)}::jsonb)
      ON CONFLICT(origin_id,day,meter_version) DO UPDATE SET statistics=hq_usage_add(hq_usage_daily.statistics,EXCLUDED.statistics,1),native_cost=hq_usage_add(hq_usage_daily.native_cost,EXCLUDED.native_cost,1)`;
    for (const line of models) {
      yield* sql`INSERT INTO hq_usage_model_daily(origin_id,day,model,pricing_band,meter_version,known_components,statistics,native_cost)
      VALUES(${fact.originId},${line.day},${line.model},${line.pricingBand},${line.meterVersion},${line.knownComponents},${json(line.statistics)}::jsonb,${json(line.nativeCost)}::jsonb)
      ON CONFLICT(origin_id,day,model,pricing_band,meter_version,known_components) DO UPDATE SET statistics=hq_usage_add(hq_usage_model_daily.statistics,EXCLUDED.statistics,1),native_cost=hq_usage_add(hq_usage_model_daily.native_cost,EXCLUDED.native_cost,1)`;
    }
    yield* sql`INSERT INTO hq_usage_fact(origin_id,fact_id,occurrence,day,value,contribution)
      VALUES(${fact.originId},${fact.factId},${fact.time.at}::timestamptz,${headline.day},${json(fact)}::jsonb,${json(contribution)}::jsonb)`;
    yield* sql`UPDATE hq_usage_origin SET recorded_since=least(recorded_since,${fact.time.at}::timestamptz) WHERE origin_id=${fact.originId}`;
    return true;
  });
  const receive = Effect.fnUntraced(function* (sender: UsageSender, message: UsageLinkUp) {
    if (message.protocol !== AGENT_USAGE_CAPTURE_PROTOCOL)
      return yield* fail("unsupported_protocol");
    if (new TextEncoder().encode(json(message)).byteLength > AGENT_USAGE_BATCH_BYTES)
      return yield* fail("usage_frame_too_big");
    const orgId = yield* readOrg;
    const answer = yield* leader.write(
      Effect.gen(function* () {
        yield* authorize(sender);
        let moved = false;
        for (const origin of message.origins)
          moved = (yield* register(sender, origin, orgId)) || moved;
        for (const fact of message.facts) moved = (yield* apply(sender, fact, orgId)) || moved;
        if (moved) yield* sql`UPDATE hq_usage_state SET revision=revision+1 WHERE id=1`;
        return {
          type: "usage-ack",
          batchId: message.batchId,
          accepted: message.facts.map(({ originId, factId }) => ({ originId, factId })),
        } as const;
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
    const ledger = yield* makeUsageLedger(
      sql,
      leader,
      Effect.map(roles.recent, (view) => view.orgId),
    );
    yield* runUsageRetention(sql, leader, ledger.notify);
    return { ledger };
  }),
);
