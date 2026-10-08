// @effect-diagnostics nodeBuiltinImport:off -- disposable database credentials and dump paths, never live data.
import * as NodeCrypto from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Redacted from "effect/Redacted";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as SqlClient from "effect/sql/SqlClient";
import { type UsageCoverage, type UsageFact, type UsageReportQuery } from "@t3tools/contracts";
import {
  USAGE_GENESIS_DIGEST,
  usageEntryDigest,
  usageSnapshotDigest,
  type UsageLinkUp,
} from "@t3tools/shared/agentUsage";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { tempDir } from "../test/harness/tempDir.ts";
import { activeCoreLayer } from "../test/harness/activeCore.ts";
import { Leader } from "./leader.ts";
import { ZeropsUnavailable } from "./zerops/api.ts";
import { makeUsageLedger } from "./usageLedger.ts";
import { zeroUsage, contributionOf } from "./usageAccounting.ts";
import { usageCheckpoint, protectUsageCut, pruneUsageDetail } from "./usageRetention.ts";
import { readUsageReport, type UsageReportAccess } from "./usageReport.ts";
import { runTool, libpqEnv } from "./backup.ts";
import { installAutomaticUsageRates } from "./usagePrices.ts";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const fact = (
  id: string,
  tokens: string,
  revision = "1",
  at = "2020-01-01T12:00:00.000Z",
  model = "model-a",
): UsageFact => ({
  originId: "origin",
  factId: id,
  nativeId: id,
  aliases: [],
  revision,
  provider: "claude",
  model,
  pricingBand: "standard",
  components: {
    uncachedInput: tokens,
    cachedInput: "0",
    cacheCreation: "0",
    output: "0",
    reasoning: "0",
    inclusiveTotal: tokens,
  },
  nativeCost: null,
  time: { kind: "instant", at, provenance: "native" },
  evidence: "native-request",
  meterVersion: "claude-1",
  state: "settled",
  sessionId: null,
  runId: null,
  parentId: null,
});
const baseQuery: UsageReportQuery = {
  since: "2020-01-01T00:00:00.000Z",
  until: "2020-01-03T00:00:00.000Z",
  mode: "utc-days",
  timezone: "UTC",
  projectId: null,
  appId: null,
  mateId: null,
  ownerUserId: null,
  provider: null,
  model: null,
  groupBy: "model",
};
const access: UsageReportAccess = {
  facts: {
    orgId: "ORG",
    freshness: "fresh",
    members: [
      {
        userId: "owner",
        clientUserId: "C-owner",
        kind: "person",
        name: "Owner",
        status: "ACTIVE",
        roleCode: "OWNER",
        canCreateProjects: true,
      },
    ],
    projects: [
      {
        id: "P",
        orgId: "ORG",
        tags: [],
        name: "P",
        status: "ACTIVE",
        userRoles: [{ clientUserId: "C-owner", roleCode: "OWNER" }],
        publicZone: "p.zone",
      },
    ],
  },
  forPerson: () => ({ apps: [] }),
};
const setup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const leader = yield* Leader;
  yield* Stream.runHead(leader.changes.pipe(Stream.filter((status) => status.state === "active")));
  const [app] = yield* sql<{
    readonly id: string;
  }>`INSERT INTO hq_app(name,created_by) VALUES('Usage rig','owner') RETURNING id::text`;
  yield* sql`INSERT INTO hq_app_project(project_id,app_id,kind,created_by) VALUES('P',${app!.id}::uuid,'mate','owner')`;
  yield* sql`INSERT INTO hq_mate(project_id,face) VALUES('P','')`;
  const credential = "test-credential";
  yield* sql`INSERT INTO hq_mate_credential(credential_hash,project_id) VALUES(${NodeCrypto.createHash("sha256").update(credential).digest("hex")},'P')`;
  const ledger = yield* makeUsageLedger(sql, leader, Effect.succeed("ORG"));
  const sender = yield* ledger.open("P", credential);
  const origin = {
    originId: "origin",
    orgId: "ORG",
    projectId: "P",
    mateId: sender.mateId,
    provider: "claude" as const,
    writerId: "writer",
    label: "Rig",
    coverage: {
      state: "complete" as const,
      since: "2019-01-01T00:00:00.000Z",
      through: "2027-01-01T00:00:00.000Z",
      gaps: [],
    },
  };
  const hello: UsageLinkUp = {
    type: "usage-hello",
    protocol: 1,
    ledgerId: "ledger",
    highWater: "0",
    highDigest: USAGE_GENESIS_DIGEST,
    replayFloor: "1",
    origins: [origin],
  };
  yield* ledger.receive(sender, hello);
  let seq = 0;
  let digest = USAGE_GENESIS_DIGEST;
  const batch = (
    facts: ReadonlyArray<UsageFact>,
    coverage: ReadonlyArray<{ originId: string; value: UsageCoverage }> = [],
  ) => {
    seq++;
    const body = { sequence: String(seq), previousDigest: digest, facts, coverage };
    digest = usageEntryDigest(body);
    return {
      type: "usage-batch" as const,
      ledgerId: "ledger",
      channel: sender.channel,
      entries: [{ ...body, digest }],
    };
  };
  const total = Effect.map(
    sql<{
      readonly tokens: string;
    }>`SELECT coalesce(sum((statistics->>'tokens')::numeric),0)::text AS tokens FROM hq_usage_daily`,
    (rows) => rows[0]!.tokens,
  );
  return { sql, leader, ledger, sender, origin, hello, batch, total };
});
const database = <E>(run: Effect.Effect<void, E, SqlClient.SqlClient | Leader>) =>
  Effect.gen(function* () {
    const pg = yield* TempPostgres;
    const url = yield* pg.createDatabase;
    yield* run.pipe(Effect.provide(activeCoreLayer(url)));
  });
describe("HQ usage ledger boundaries", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "ACK loss, equal genuine requests, late correction, redating and tombstones survive raw expiry",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, leader, ledger, sender, batch, total } = yield* setup;
            const first = batch([fact("a", "1000")]);
            yield* ledger.receive(sender, first);
            yield* ledger.receive(sender, first);
            assert.strictEqual(yield* total, "1000");
            const equal = batch([fact("b", "200"), fact("c", "200")]);
            yield* ledger.receive(sender, equal);
            assert.strictEqual(yield* total, "1400");
            const checkpoint = yield* usageCheckpoint(sql);
            const pinned = yield* Effect.result(pruneUsageDetail(sql, leader, "2026-01-01"));
            assert.isTrue(pinned._tag === "Failure");
            yield* protectUsageCut(sql, leader, {
              setId: "verified-fixture",
              independent: true,
              expected: checkpoint,
              restored: checkpoint,
            });
            const [boundary] = yield* sql<{
              readonly day: string;
            }>`SELECT to_char((now() AT TIME ZONE 'UTC')::date-30,'YYYY-MM-DD') AS day`;
            assert.strictEqual(yield* pruneUsageDetail(sql, leader, boundary!.day), 3);
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_fact`, 0);
            yield* ledger.receive(sender, equal);
            assert.strictEqual(yield* total, "1400");
            const correction = batch([fact("b", "150", "2")]);
            yield* ledger.receive(sender, correction);
            yield* ledger.receive(sender, correction);
            assert.strictEqual(yield* total, "1350");
            yield* ledger.receive(
              sender,
              batch([fact("b", "150", "3", "2020-01-02T12:00:00.000Z", "model-b")]),
            );
            const day = yield* sql<{
              readonly day: string;
              readonly tokens: string;
            }>`SELECT day,(statistics->>'tokens') AS tokens FROM hq_usage_daily WHERE model='model-b'`;
            assert.deepStrictEqual(day, [{ day: "2020-01-02", tokens: "150" }]);
            const retraction = batch([{ ...fact("b", "150", "4"), state: "retracted" }]);
            yield* ledger.receive(sender, retraction);
            yield* ledger.receive(sender, retraction);
            assert.strictEqual(yield* total, "1200");
            yield* ledger.receive(sender, batch([fact("b", "200", "1")]));
            assert.strictEqual(yield* total, "1200");
            const late = batch([fact("year-old", "200")]);
            yield* ledger.receive(sender, late);
            yield* ledger.receive(sender, late);
            assert.strictEqual(yield* total, "1400");
          }),
        ),
    );
    it.effect(
      "expiry preserves recent redating and refuses detail that disagrees with permanent receipts",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, leader, ledger, sender, batch, total } = yield* setup;
            const [clock] = yield* sql<{
              readonly at: string;
              readonly boundary: string;
            }>`SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,to_char((now() AT TIME ZONE 'UTC')::date-30,'YYYY-MM-DD') AS boundary`;
            yield* ledger.receive(sender, batch([fact("recent", "100")]));
            yield* sql`UPDATE hq_usage_fact SET ingested_at='2019-01-01'`;
            yield* ledger.receive(sender, batch([fact("recent", "100", "2", clock!.at)]));
            // Even an old ingestion timestamp must not override a proved recent occurrence.
            yield* sql`UPDATE hq_usage_fact SET ingested_at='2019-01-01'`;
            let point = yield* usageCheckpoint(sql);
            yield* protectUsageCut(sql, leader, {
              setId: "verified",
              independent: true,
              expected: point,
              restored: point,
            });
            assert.strictEqual(yield* pruneUsageDetail(sql, leader, clock!.boundary), 0);
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_fact`, 1);
            yield* ledger.receive(
              sender,
              batch([
                { ...fact("undated", "100"), time: { kind: "undated" } },
                fact(
                  "future",
                  "100",
                  "1",
                  DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(clock!.at), { years: 1 })),
                ),
              ]),
            );
            yield* sql`UPDATE hq_usage_fact SET ingested_at='2019-01-01' WHERE native_id<>'recent'`;
            point = yield* usageCheckpoint(sql);
            yield* protectUsageCut(sql, leader, {
              setId: "bounded-clock",
              independent: true,
              expected: point,
              restored: point,
            });
            assert.strictEqual(yield* pruneUsageDetail(sql, leader, clock!.boundary), 2);
            const recent = yield* readUsageReport(
              sql,
              "owner",
              {
                kind: "agentUsage",
                query: {
                  ...baseQuery,
                  mode: "exact",
                  since: clock!.at,
                  until: DateTime.formatIso(
                    DateTime.add(DateTime.makeUnsafe(clock!.at), { milliseconds: 1 }),
                  ),
                },
              },
              access,
              new Map(),
            );
            assert.strictEqual(recent.totals.tokens, "100");
            yield* ledger.receive(sender, batch([fact("old", "200")]));
            point = yield* usageCheckpoint(sql);
            yield* protectUsageCut(sql, leader, {
              setId: "verified-new",
              independent: true,
              expected: point,
              restored: point,
            });
            yield* sql`UPDATE hq_usage_fact SET value=jsonb_set(jsonb_set(value,'{components,uncachedInput}','"199"'),'{components,inclusiveTotal}','"199"') WHERE native_id='old'`;
            const refused = yield* Effect.flip(pruneUsageDetail(sql, leader, clock!.boundary));
            assert.strictEqual(refused._tag, "UsageRefused");
            assert.strictEqual(yield* total, "500");
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_fact`, 2);
          }),
        ),
    );
    it.effect(
      "gaps, corrupt prefix, unregistered origins and replaced channels commit nothing",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, ledger, sender, batch, total } = yield* setup;
            yield* ledger.receive(sender, batch([fact("a", "100")]));
            const bad = batch([fact("b", "10"), { ...fact("c", "200"), originId: "elsewhere" }]);
            const failure = yield* Effect.result(ledger.receive(sender, bad));
            assert.isTrue(failure._tag === "Failure");
            assert.strictEqual(yield* total, "100");
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_receipt WHERE native_id='b'`, 0);
            const gap = {
              sequence: "3",
              previousDigest: USAGE_GENESIS_DIGEST,
              facts: [],
              coverage: [],
            };
            const replay = yield* ledger.receive(sender, {
              type: "usage-batch",
              ledgerId: "ledger",
              channel: sender.channel,
              entries: [{ ...gap, digest: usageEntryDigest(gap) }],
            });
            assert.strictEqual(replay.type, "usage-resume");
            assert.strictEqual("cursor" in replay ? replay.cursor : null, "1");
            assert.strictEqual(yield* total, "100");
            const replacement = yield* ledger.open("P", sender.credential);
            assert.isTrue((yield* Effect.result(ledger.receive(sender, bad)))._tag === "Failure");
            const hello = {
              type: "usage-hello" as const,
              protocol: 1,
              ledgerId: "ledger",
              highWater: "1",
              highDigest: (yield* sql<{
                readonly digest: string;
              }>`SELECT digest FROM hq_usage_producer`)[0]!.digest,
              replayFloor: "2",
              origins: [],
            };
            yield* ledger.receive(replacement, hello);
            yield* sql`UPDATE hq_mate_credential SET revoked_at=now() WHERE project_id='P'`;
            assert.isTrue(
              (yield* Effect.result(ledger.receive(replacement, hello)))._tag === "Failure",
            );
            assert.strictEqual(yield* total, "100");
          }),
        ),
    );
    it.effect(
      "snapshot pages upsert without absence deletion and cannot revive a newer retraction",
      () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, total } = yield* setup;
            yield* ledger.receive(sender, batch([fact("a", "100"), fact("b", "200")]));
            const body = {
              ledgerId: "ledger",
              snapshotId: "S",
              highWater: "5",
              highDigest: "1".repeat(64),
              page: 0,
              pages: 1,
              totalFacts: "1",
              previousDigest: USAGE_GENESIS_DIGEST,
              facts: [fact("a", "50", "2")],
              coverage: [],
            };
            const digest = usageSnapshotDigest(body);
            const page = {
              ...body,
              type: "usage-snapshot" as const,
              channel: sender.channel,
              digest,
              manifestDigest: digest,
            };
            yield* ledger.receive(sender, page);
            yield* ledger.receive(sender, page);
            assert.strictEqual(yield* total, "250");
            const retract = {
              sequence: "6",
              previousDigest: body.highDigest,
              facts: [{ ...fact("a", "0", "3"), state: "retracted" as const }],
              coverage: [],
            };
            yield* ledger.receive(sender, {
              type: "usage-batch",
              ledgerId: "ledger",
              channel: sender.channel,
              entries: [{ ...retract, digest: usageEntryDigest(retract) }],
            });
            assert.strictEqual(yield* total, "200");
          }),
        ),
    );
    it.effect(
      "interrupted snapshots resume exactly or are explicitly abandoned without losing accepted usage",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, ledger, sender, total } = yield* setup;
            const body = {
              ledgerId: "ledger",
              snapshotId: "interrupted",
              highWater: "5",
              highDigest: "1".repeat(64),
              page: 0,
              pages: 2,
              totalFacts: "2",
              previousDigest: USAGE_GENESIS_DIGEST,
              facts: [fact("a", "100")],
              coverage: [],
            };
            const page = {
              ...body,
              type: "usage-snapshot" as const,
              channel: sender.channel,
              digest: usageSnapshotDigest(body),
              manifestDigest: "2".repeat(64),
            };
            const ack = yield* ledger.receive(sender, page);
            assert.strictEqual(ack.type, "usage-snapshot-ack");
            assert.strictEqual(yield* total, "100");
            yield* ledger.receive(sender, page);
            assert.strictEqual(yield* total, "100");
            assert.strictEqual(
              (yield* sql<{
                readonly coverage: { state: string };
              }>`SELECT coverage FROM hq_usage_origin`)[0]!.coverage.state,
              "recovering",
            );
            const abandoned = yield* ledger.receive(sender, {
              type: "usage-snapshot-abandon",
              ledgerId: "ledger",
              channel: sender.channel,
              snapshotId: "interrupted",
            });
            assert.strictEqual(abandoned.type, "usage-resume");
            assert.strictEqual(yield* total, "100");
            assert.isNull(
              (yield* sql<{
                readonly snapshot: unknown;
              }>`SELECT snapshot FROM hq_usage_producer`)[0]!.snapshot,
            );
            const fresh = {
              ...body,
              snapshotId: "replacement",
              pages: 1,
              totalFacts: "1",
              facts: [fact("a", "100")],
            };
            const digest = usageSnapshotDigest(fresh);
            yield* ledger.receive(sender, {
              ...fresh,
              type: "usage-snapshot",
              channel: sender.channel,
              digest,
              manifestDigest: digest,
            });
            assert.strictEqual(yield* total, "100");
          }),
        ),
    );
    it.effect(
      "coverage from every pinned snapshot page becomes visible only at manifest completion",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, ledger, sender, origin, hello, total } = yield* setup;
            const second = { ...origin, originId: "second" };
            yield* ledger.receive(sender, { ...hello, origins: [second] });
            const first = {
              ledgerId: "ledger",
              snapshotId: "paged",
              highWater: "5",
              highDigest: "1".repeat(64),
              page: 0,
              pages: 2,
              totalFacts: "2",
              previousDigest: USAGE_GENESIS_DIGEST,
              facts: [fact("a", "100")],
              coverage: [{ originId: origin.originId, value: origin.coverage }],
            };
            const firstDigest = usageSnapshotDigest(first);
            const last = {
              ...first,
              page: 1,
              previousDigest: firstDigest,
              facts: [{ ...fact("b", "200"), originId: "second" }],
              coverage: [{ originId: "second", value: second.coverage }],
            };
            const manifestDigest = usageSnapshotDigest(last);
            yield* ledger.receive(sender, {
              ...first,
              type: "usage-snapshot",
              channel: sender.channel,
              digest: firstDigest,
              manifestDigest,
            });
            const partial = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              access,
              new Map(),
            );
            assert.isTrue(partial.coverage.every((source) => source.value.state === "recovering"));
            yield* ledger.receive(sender, {
              ...last,
              type: "usage-snapshot",
              channel: sender.channel,
              digest: manifestDigest,
              manifestDigest,
            });
            assert.strictEqual(yield* total, "300");
            const complete = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              access,
              new Map(),
            );
            assert.lengthOf(complete.coverage, 2);
            assert.isTrue(complete.coverage.every((source) => source.value.state === "complete"));
            assert.strictEqual(
              (yield* sql<{
                readonly cursor: string;
              }>`SELECT cursor::text FROM hq_usage_producer`)[0]!.cursor,
              "5",
            );
          }),
        ),
    );
    it.effect(
      "exact subday edges replace daily cells, prices remain independent, pages invalidate on corrections",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, leader, ledger, sender, batch } = yield* setup;
            yield* sql`UPDATE hq_usage_state SET exact_since='2020-01-01T00:00:00Z'`;
            yield* ledger.receive(
              sender,
              batch([
                fact("before", "100", "1", "2020-01-01T01:00:00.000Z"),
                fact("inside", "200", "1", "2020-01-01T13:00:00.000Z"),
                fact("next", "300", "1", "2020-01-02T03:00:00.000Z"),
              ]),
            );
            const query = {
              ...baseQuery,
              mode: "exact" as const,
              since: "2020-01-01T12:00:00.000Z",
              until: "2020-01-02T12:00:00.000Z",
            };
            let report = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query },
              access,
              new Map(),
            );
            assert.strictEqual(report.totals.tokens, "500");
            assert.isNull(report.pricing.costUsdNanos);
            assert.strictEqual(report.pricing.unpricedRecords, "2");
            yield* installAutomaticUsageRates(sql, leader, {
              "model-a": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
            });
            report = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query },
              access,
              new Map(),
            );
            assert.strictEqual(report.pricing.costUsdNanos, "500000");
            const cursor = { generation: report.generation, after: "" };
            yield* ledger.receive(
              sender,
              batch([fact("inside", "250", "2", "2020-01-01T13:00:00.000Z")]),
            );
            assert.isTrue(
              (yield* Effect.result(
                readUsageReport(
                  sql,
                  "owner",
                  { kind: "agentUsage", query, detail: { tier: "exact", cursor } },
                  access,
                  new Map(),
                ),
              ))._tag === "Failure",
            );
            yield* sql`UPDATE hq_usage_state SET exact_since='2020-01-02T00:00:00Z'`;
            report = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query },
              access,
              new Map(),
            );
            assert.strictEqual(report.state, "unsupported-exact-boundary");
          }),
        ),
    );
    it.effect(
      "current owner/application regroup retained history and only authorized unregistered Mates appear as gaps",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, ledger, sender, batch } = yield* setup;
            yield* ledger.receive(sender, batch([fact("a", "100")]));
            const before = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: { ...baseQuery, groupBy: "owner" } },
              access,
              new Map(),
            );
            assert.strictEqual(before.groups[0]!.key, "owner");
            const newOwner = {
              ...access.facts.members[0]!,
              userId: "new-owner",
              clientUserId: "C-new",
            };
            const handover: UsageReportAccess = {
              ...access,
              facts: {
                ...access.facts,
                members: [...access.facts.members, newOwner],
                projects: [
                  {
                    ...access.facts.projects[0]!,
                    userRoles: [{ clientUserId: "C-new", roleCode: "OWNER" }],
                  },
                ],
              },
            };
            const after = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: { ...baseQuery, groupBy: "owner" } },
              handover,
              new Map(),
            );
            assert.strictEqual(after.groups[0]!.key, "new-owner");
            assert.strictEqual(after.totals.tokens, "100");
            assert.notStrictEqual(after.generation.access, before.generation.access);
            yield* sql`DELETE FROM hq_app_project WHERE project_id='P'`;
            const detached = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: { ...baseQuery, groupBy: "app" } },
              access,
              new Map(),
            );
            assert.strictEqual(detached.groups[0]!.key, "ungrouped");
            yield* sql`INSERT INTO hq_mate(project_id,face) VALUES('old-Mate',''),('hidden-Mate','')`;
            const withMissing: UsageReportAccess = {
              ...access,
              facts: {
                ...access.facts,
                projects: [
                  ...access.facts.projects,
                  { ...access.facts.projects[0]!, id: "old-Mate" },
                  {
                    ...access.facts.projects[0]!,
                    id: "hidden-Mate",
                    userRoles: [{ clientUserId: "C-owner", roleCode: "NO_ACCESS" }],
                  },
                ],
              },
            };
            const gaps = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              withMissing,
              new Map(),
            );
            assert.strictEqual(gaps.totals.tokens, "100");
            assert.strictEqual(gaps.state, "partial");
            assert.deepStrictEqual(
              gaps.captureGaps?.map((gap) => gap.projectId),
              ["old-Mate"],
            );
          }),
        ),
    );
    it.effect("unknown components qualify their own price cells after exact detail expires", () =>
      database(
        Effect.gen(function* () {
          const { sql, leader, ledger, sender, batch } = yield* setup;
          yield* ledger.receive(
            sender,
            batch([
              fact("known", "100"),
              {
                ...fact("unknown", "200"),
                components: { ...fact("unknown", "200").components, output: null },
              },
            ]),
          );
          yield* installAutomaticUsageRates(sql, leader, {
            "model-a": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
          });
          yield* sql`DELETE FROM hq_usage_fact`;
          const report = yield* readUsageReport(
            sql,
            "owner",
            { kind: "agentUsage", query: baseQuery },
            access,
            new Map(),
          );
          assert.strictEqual(report.totals.tokens, "300");
          assert.strictEqual(report.pricing.costUsdNanos, "100000");
          assert.strictEqual(report.pricing.pricedRecords, "1");
          assert.strictEqual(report.pricing.unpricedRecords, "1");
        }),
      ),
    );
    it.effect(
      "deleted sources persist and only active org readers can see their totals and labels",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, ledger, sender, batch, total } = yield* setup;
            yield* ledger.receive(sender, batch([fact("a", "100")]));
            yield* sql`DELETE FROM hq_mate WHERE project_id='P'`;
            assert.strictEqual(yield* total, "100");
            const retired = yield* Effect.flip(
              ledger.receive(sender, batch([fact("late-after-retirement", "10")])),
            );
            assert.strictEqual(retired._tag, "UsageRefused");
            const reader = {
              ...access,
              facts: {
                ...access.facts,
                members: [{ ...access.facts.members[0]!, roleCode: "READ_ONLY" }],
                projects: [],
              },
            };
            const report = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery, detail: { tier: "daily" } },
              reader,
              new Map(),
            );
            assert.strictEqual(report.totals.tokens, "100");
            assert.isTrue(report.coverage[0]!.deleted);
            assert.lengthOf(report.detail, 1);
            const projectOnly = {
              ...access,
              facts: {
                ...access.facts,
                members: [{ ...access.facts.members[0]!, roleCode: "NO_ACCESS" }],
              },
            };
            const hidden = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              projectOnly,
              new Map(),
            );
            assert.deepStrictEqual(hidden.totals, zeroUsage());
            assert.lengthOf(hidden.coverage, 0);
            assert.strictEqual(hidden.state, "partial");
            assert.isTrue(
              (yield* Effect.result(
                readUsageReport(
                  sql,
                  "owner",
                  { kind: "agentUsage", query: baseQuery },
                  {
                    ...reader,
                    facts: {
                      ...reader.facts,
                      members: [{ ...reader.facts.members[0]!, status: "INVITED" }],
                    },
                  },
                  new Map(),
                ),
              ))._tag === "Failure",
            );
            yield* sql`INSERT INTO hq_mate(project_id,face) VALUES('P','')`;
            const [recreated] = yield* sql<{
              readonly mate_id: string;
            }>`SELECT usage_id::text AS mate_id FROM hq_mate WHERE project_id='P'`;
            assert.notStrictEqual(recreated!.mate_id, sender.mateId);
            assert.isTrue(
              (yield* Effect.result(ledger.receive(sender, batch([fact("stale-recreated", "20")]))))
                ._tag === "Failure",
            );
            const retained = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              reader,
              new Map(),
            );
            assert.strictEqual(retained.totals.tokens, "100");
            assert.isTrue(retained.coverage[0]!.deleted);
            assert.isNull(retained.coverage[0]!.ownerUserId);
          }),
        ),
    );
    it.effect("aliases, coarse replacement and uncertain dates remain disjoint", () =>
      database(
        Effect.gen(function* () {
          const { sql, ledger, sender, batch, total } = yield* setup;
          yield* ledger.receive(sender, batch([fact("coarse", "100")]));
          yield* ledger.receive(
            sender,
            batch([
              { ...fact("coarse", "0", "2"), state: "retracted" },
              { ...fact("detail", "100"), aliases: ["native-detail"] },
            ]),
          );
          yield* ledger.receive(
            sender,
            batch([
              { ...fact("detail", "80", "2"), nativeId: "native-detail", aliases: ["detail"] },
              { ...fact("undated", "20"), time: { kind: "undated" } },
            ]),
          );
          assert.strictEqual(yield* total, "100");
          const dated = yield* readUsageReport(
            sql,
            "owner",
            { kind: "agentUsage", query: baseQuery },
            access,
            new Map(),
          );
          assert.strictEqual(dated.totals.tokens, "80");
          assert.strictEqual(dated.state, "partial");
          const all = yield* readUsageReport(
            sql,
            "owner",
            { kind: "agentUsage", query: { ...baseQuery, since: null } },
            access,
            new Map(),
          );
          assert.strictEqual(all.totals.tokens, "100");
          assert.strictEqual(all.coverage[0]!.label, "Rig");
          const conflicting = { ...fact("another", "50"), aliases: ["detail", "coarse"] };
          // Refused alone, as a gap: the lane goes on.
          assert.strictEqual(
            (yield* ledger.receive(sender, batch([conflicting]))).type,
            "usage-ack",
          );
          assert.strictEqual(yield* total, "100");
        }),
      ),
    );
    it.effect(
      "same ids with different content are a permanent conflict, kept as a gap while the rest of the lane flows; an identical repeat is acknowledged",
      () =>
        database(
          Effect.gen(function* () {
            const { sql, ledger, sender, batch, total } = yield* setup;
            const first = batch([fact("a", "100")]);
            yield* ledger.receive(sender, first);
            const repeated = yield* ledger.receive(sender, first);
            assert.strictEqual(repeated.type, "usage-ack");
            const reused = { ...fact("b", "50"), factId: "a" };
            const changed = fact("a", "999");
            const answer = yield* ledger.receive(sender, batch([reused, changed, fact("c", "30")]));
            assert.strictEqual(answer.type, "usage-ack");
            assert.strictEqual(yield* total, "130");
            // A later coverage from the Mate keeps HQ's record of what it refused.
            yield* ledger.receive(
              sender,
              batch(
                [],
                [
                  {
                    originId: "origin",
                    value: { state: "partial", since: null, through: null, gaps: ["mate-gap"] },
                  },
                ],
              ),
            );
            const [origin] = yield* sql<{
              readonly gaps: ReadonlyArray<string>;
            }>`SELECT coverage->'gaps' AS gaps FROM hq_usage_origin WHERE origin_id='origin'`;
            assert.includeMembers(
              [...origin!.gaps],
              ["refused:fact_identity_conflict", "refused:fact_revision_conflict"],
            );
          }),
        ),
    );
    it.effect("a native record that gains an identity replaces its fact by a higher revision", () =>
      database(
        Effect.gen(function* () {
          const { ledger, sender, batch, total } = yield* setup;
          yield* ledger.receive(sender, batch([fact("x", "10")]));
          const answer = yield* ledger.receive(
            sender,
            batch([{ ...fact("x", "15", "2"), aliases: ["y"] }]),
          );
          assert.strictEqual(answer.type, "usage-ack");
          assert.strictEqual(yield* total, "15");
        }),
      ),
    );
    it.effect(
      "a Mate is offered capture with HQ's last known org while Zerops is slow or down",
      () =>
        database(
          Effect.gen(function* () {
            // `setup` registered a producer under ORG; a fresh process finds it there.
            const { sql, leader } = yield* setup;
            const down = Effect.fail(new ZeropsUnavailable({ operation: "org", message: "down" }));
            const fresh = yield* makeUsageLedger(sql, leader, down);
            assert.strictEqual((yield* fresh.open("P", "test-credential")).orgId, "ORG");
            const slow = yield* makeUsageLedger(sql, leader, Effect.never);
            const opened = yield* slow
              .open("P", "test-credential")
              .pipe(Effect.timeoutOption("2 seconds"));
            assert.strictEqual(opened._tag === "Some" ? opened.value.orgId : "", "ORG");
          }),
        ),
    );
    it.effect("39,000 real-schema facts keep summary and keyset detail bounded", () =>
      database(
        Effect.gen(function* () {
          const { sql } = yield* setup;
          yield* sql`UPDATE hq_usage_state SET exact_since='2020-01-01T00:00:00Z'`;
          // Fast fixture loading uses the same canonical full facts and contribution shape as ingest.
          const sample = fact("sample", "100");
          yield* sql`WITH fixture AS (
          SELECT ('request-'||i)::text AS id, to_char('2020-01-01'::date + ((i-1)/1000)::int,'YYYY-MM-DD') AS day, ('model-'||(i%4))::text AS model FROM generate_series(1,39000) i)
          INSERT INTO hq_usage_receipt(origin_id,native_id,fact_id,revision,digest,contribution)
          SELECT 'origin',id,id,1,repeat('0',64),${json(contributionOf(sample))}::jsonb||jsonb_build_object('day',day,'model',model) FROM fixture`;
          yield* sql`INSERT INTO hq_usage_alias SELECT origin_id,native_id,native_id FROM hq_usage_receipt`;
          yield* sql`INSERT INTO hq_usage_fact(origin_id,native_id,occurrence,day,model,value)
          SELECT origin_id,native_id,(contribution->>'day')::timestamptz+interval '12 hours',contribution->>'day',contribution->>'model',
          ${json(sample)}::jsonb||jsonb_build_object('factId',native_id,'nativeId',native_id,'model',contribution->>'model','time',jsonb_build_object('kind','instant','at',(contribution->>'day')||'T12:00:00.000Z','provenance','native')) FROM hq_usage_receipt`;
          yield* sql`INSERT INTO hq_usage_daily SELECT origin_id,contribution->>'day',contribution->>'model',contribution->>'pricingBand',contribution->>'meterVersion',contribution->>'knownComponents',hq_usage_sum(contribution->'statistics'),hq_usage_sum(contribution->'nativeCost') FROM hq_usage_receipt GROUP BY 1,2,3,4,5,6`;
          yield* sql`INSERT INTO hq_usage_prefix(ledger_id,sequence,digest) SELECT 'ledger',i,encode(sha256(convert_to('fixture-'||i,'UTF8')),'hex') FROM generate_series(1,39000)i`;
          yield* sql`UPDATE hq_usage_producer SET cursor=39000,digest=(SELECT digest FROM hq_usage_prefix WHERE ledger_id='ledger' AND sequence=39000)`;
          yield* sql`ANALYZE hq_usage_fact`;
          yield* sql`ANALYZE hq_usage_daily`;
          const query = { ...baseQuery, until: "2020-02-09T00:00:00.000Z" };
          const first = yield* readUsageReport(
            sql,
            "owner",
            { kind: "agentUsage", query, detail: { tier: "daily" } },
            access,
            new Map(),
          );
          assert.strictEqual(first.totals.tokens, "3900000");
          assert.lengthOf(first.groups, 4);
          assert.lengthOf(first.detail, 100);
          assert.isNotNull(first.next);
          const next = yield* readUsageReport(
            sql,
            "owner",
            { kind: "agentUsage", query, detail: { tier: "daily", cursor: first.next! } },
            access,
            new Map(),
          );
          assert.lengthOf(next.detail, 56);
          assert.isNull(next.next);
          assert.isBelow(new TextEncoder().encode(json(first)).byteLength, 256 * 1024);
          const sizes = yield* sql<{
            readonly tier: string;
            readonly bytes: string;
          }>`SELECT name AS tier,pg_total_relation_size(name::regclass)::text AS bytes FROM unnest(ARRAY['hq_usage_fact','hq_usage_receipt','hq_usage_alias','hq_usage_daily','hq_usage_prefix']) name`;
          const latency: number[] = [];
          for (let i = 0; i < 5; i++) {
            const started = yield* Clock.currentTimeMillis;
            yield* readUsageReport(sql, "owner", { kind: "agentUsage", query }, access, new Map());
            latency.push((yield* Clock.currentTimeMillis) - started);
          }
          yield* Effect.sync(() =>
            process.stdout.write(
              json({
                usageStorage: sizes,
                facts: 39000,
                cells: 156,
                reportBytes: new TextEncoder().encode(json(first)).byteLength,
                summaryP95Ms: latency.toSorted((a, b) => a - b)[4],
              }) + "\n",
            ),
          );
        }),
      ),
    );
    it.effect(
      "a real independently restored dump verifies a coherent permanent cut before expiry",
      () =>
        Effect.gen(function* () {
          const pg = yield* TempPostgres;
          const url = yield* pg.createDatabase;
          const restoredUrl = yield* pg.createDatabase;
          const dir = yield* tempDir("usage-protect-");
          yield* Effect.gen(function* () {
            const { sql, leader, ledger, sender, batch } = yield* setup;
            yield* ledger.receive(sender, batch([fact("a", "9007199254740993")]));
            const expected = yield* usageCheckpoint(sql);
            const dump = `${dir}/usage.dump`;
            yield* runTool("pg_dump", ["--format=custom", `--file=${dump}`], Redacted.make(url));
            yield* runTool(
              "pg_restore",
              [
                "--no-owner",
                "--no-acl",
                `--dbname=${libpqEnv(Redacted.make(restoredUrl))["PGDATABASE"]}`,
                dump,
              ],
              Redacted.make(restoredUrl),
            );
            const restored = yield* Effect.flatMap(SqlClient.SqlClient, usageCheckpoint).pipe(
              Effect.provide(PgClient.layer({ url: Redacted.make(restoredUrl) })),
            );
            assert.deepStrictEqual(restored, expected);
            yield* protectUsageCut(sql, leader, {
              setId: "independent-restored",
              independent: true,
              expected,
              restored,
            });
            const mixed = { ...restored, digest: "bad" };
            assert.isTrue(
              (yield* Effect.result(
                protectUsageCut(sql, leader, {
                  setId: "mixed",
                  independent: true,
                  expected,
                  restored: mixed,
                }),
              ))._tag === "Failure",
            );
          }).pipe(Effect.provide(activeCoreLayer(url)));
        }),
    );
  });
});
