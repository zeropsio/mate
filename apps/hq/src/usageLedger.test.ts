// @effect-diagnostics nodeBuiltinImport:off -- disposable database credentials and dump paths, never live data.
import * as NodeCrypto from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Redacted from "effect/Redacted";
import { migrate } from "./migrations.ts";
import { treeMigrations } from "./migrationFiles.ts";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { UsageFact, UsageReport, type UsageReportQuery } from "@t3tools/contracts";
import { usageOriginId, usageFactId, type UsageLinkUp } from "@t3tools/shared/agentUsage";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { activeCoreLayer } from "../test/harness/activeCore.ts";
import { Leader } from "./leader.ts";
import { makeUsageLedger } from "./usageLedger.ts";
import { zeroUsage, contributionOf } from "./usageAccounting.ts";
import { pruneUsageDetail } from "./usageRetention.ts";
import { readUsageReport, type UsageReportAccess } from "./usageReport.ts";
import { installAutomaticUsageRates } from "./usagePrices.ts";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeFact = Schema.decodeUnknownEffect(UsageFact);
const decodeReport = Schema.decodeUnknownEffect(UsageReport);
const binding = { orgId: "ORG", projectId: "P", mateId: "00000000-0000-0000-0000-000000000001" };
const originId = usageOriginId(binding, "claude");
const fact = (
  id: string,
  tokens: string,
  at = "2020-01-01T12:00:00.000Z",
  model = "model-a",
): UsageFact => ({
  originId,
  factId: usageFactId("native-thread", id),
  nativeId: id,
  provider: "claude",
  models: [
    {
      model,
      components: {
        uncachedInput: tokens,
        cachedInput: "0",
        cacheCreation: "0",
        output: "0",
        reasoning: "0",
        inclusiveTotal: tokens,
      },
      nativeCost: null,
    },
  ],
  nativeCost: null,
  time: { kind: "instant", at, provenance: "native" },
  evidence: "live-provider-turn",
  meterVersion: "native-turn-v1",
  sessionId: "native-thread",
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
  yield* sql`INSERT INTO hq_mate(project_id,face,usage_id) VALUES('P','',${binding.mateId}::uuid)`;
  const credential = "test-credential";
  yield* sql`INSERT INTO hq_mate_credential(credential_hash,project_id) VALUES(${NodeCrypto.createHash("sha256").update(credential).digest("hex")},'P')`;
  const ledger = yield* makeUsageLedger(sql, leader, Effect.succeed("ORG"));
  const sender = yield* ledger.open("P", credential);
  const origin = {
    originId,
    orgId: "ORG",
    projectId: "P",
    mateId: sender.mateId,
    provider: "claude" as const,
    label: "Rig",
    coverage: {
      state: "complete" as const,
      since: "2019-01-01T00:00:00.000Z",
      through: "2027-01-01T00:00:00.000Z",
      gaps: [],
    },
  };
  let seq = 0;
  const batch = (facts: ReadonlyArray<UsageFact>): UsageLinkUp => ({
    type: "usage-facts",
    protocol: 2,
    batchId: `batch-${++seq}`,
    origins: [origin],
    facts,
  });
  yield* ledger.receive(sender, batch([]));
  const total = Effect.map(
    sql<{
      readonly tokens: string;
    }>`SELECT coalesce(sum((statistics->>'tokens')::numeric),0)::text AS tokens FROM hq_usage_daily`,
    (rows) => rows[0]!.tokens,
  );
  return { sql, leader, ledger, sender, origin, batch, total };
});
const database = <E>(run: Effect.Effect<void, E, SqlClient.SqlClient | Leader>) =>
  Effect.gen(function* () {
    const pg = yield* TempPostgres;
    const url = yield* pg.createDatabase;
    yield* run.pipe(Effect.provide(activeCoreLayer(url)));
  });
describe("HQ immutable usage", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "one multi-model turn counts once while native header and model charges stay separate",
      () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, sql, leader, total } = yield* setup;
            const charge = (amount: string) => ({
              amount,
              scale: 9,
              currency: "USD",
              basis: "provider-reported",
            });
            const a = fact("turn", "30");
            const b = fact("turn", "120", "2020-01-01T12:00:00.000Z", "model-b");
            const turn = {
              ...a,
              nativeCost: charge("900"),
              models: [
                {
                  model: "model-a",
                  components: a.models[0]!.components,
                  nativeCost: charge("300"),
                },
                {
                  model: "model-b",
                  components: b.models[0]!.components,
                  nativeCost: charge("600"),
                },
              ],
            };
            const sent = batch([turn]);
            yield* ledger.receive(sender, sent);
            yield* ledger.receive(sender, sent);
            yield* ledger.receive(sender, batch([{ ...turn, models: turn.models.toReversed() }]));
            assert.strictEqual(yield* total, "150");
            yield* installAutomaticUsageRates(sql, leader, {
              "model-a": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
              "model-b": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
            });
            for (const groupBy of ["model", "provider", "day", "mate"] as const) {
              const report = yield* readUsageReport(
                sql,
                "owner",
                { kind: "agentUsage", query: { ...baseQuery, groupBy } },
                access,
                new Map(),
              );
              assert.strictEqual(report.totals.tokens, "150");
              assert.strictEqual(report.totals.records, "1");
              assert.strictEqual(report.pricing.costUsdNanos, "150000");
              assert.deepStrictEqual(Object.values(report.nativeCosts ?? {}), ["900"]);
              if (groupBy === "model") {
                assert.deepStrictEqual(
                  report.groups.map((row) => row.totals.records),
                  ["1", "1"],
                );
                assert.deepStrictEqual(
                  report.groups.map((row) => row.totals.tokens),
                  ["30", "120"],
                );
                assert.deepStrictEqual(
                  report.groups.map((row) => Object.values(row.nativeCosts ?? {})),
                  [["300"], ["600"]],
                );
                assert.strictEqual(report.pricing.pricedModelEntries, "2");
              } else assert.strictEqual(report.groups[0]!.totals.records, "1");
            }
            yield* sql`UPDATE hq_usage_state SET exact_since='2020-01-01T00:00:00Z'`;
            for (const groupBy of ["hour", "model", "mate"] as const) {
              const exact = yield* readUsageReport(
                sql,
                "owner",
                {
                  kind: "agentUsage",
                  query: {
                    ...baseQuery,
                    mode: "exact",
                    since: "2020-01-01T11:00:00.000Z",
                    until: "2020-01-01T13:00:00.000Z",
                    groupBy,
                  },
                  detail: { tier: "exact" },
                },
                access,
                new Map(),
              );
              assert.strictEqual(exact.totals.tokens, "150");
              assert.strictEqual(exact.totals.records, "1");
              assert.lengthOf(exact.detail, 1);
            }
            const selected = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: { ...baseQuery, model: "model-b" } },
              access,
              new Map(),
            );
            assert.strictEqual(selected.totals.tokens, "120");
            assert.strictEqual(selected.totals.records, "1");
            assert.deepStrictEqual(Object.values(selected.nativeCosts ?? {}), ["600"]);
            const [boundary] = yield* sql<{
              readonly day: string;
            }>`SELECT to_char((now() AT TIME ZONE 'UTC')::date-30,'YYYY-MM-DD') AS day`;
            assert.strictEqual(yield* pruneUsageDetail(sql, leader, boundary!.day), 1);
            yield* ledger.receive(sender, batch([turn]));
            const retained = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              access,
              new Map(),
            );
            assert.strictEqual(retained.totals.tokens, "150");
            assert.strictEqual(retained.totals.records, "1");
            assert.deepStrictEqual(
              retained.groups.map((row) => row.totals.records),
              ["1", "1"],
            );
            assert.deepStrictEqual(Object.values(retained.nativeCosts ?? {}), ["900"]);
          }),
        ),
    );
    for (const mode of [
      "duplicate batch",
      "lost ACK",
      "clone resend",
      "new observation timestamp",
    ]) {
      it.effect(`${mode} acknowledges one permanent response contribution`, () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, total, sql } = yield* setup;
            const completed = {
              ...fact("response", "150"),
              time: {
                kind: "instant" as const,
                at: "2020-01-01T12:00:00.000Z",
                provenance: "server-completion",
              },
            };
            const first = batch([completed]);
            const ack = yield* ledger.receive(sender, first);
            assert.deepStrictEqual(ack, {
              type: "usage-ack",
              batchId: first.batchId,
              accepted: [{ originId, factId: usageFactId("native-thread", "response") }],
            });
            const active =
              mode === "clone resend" ? yield* ledger.open("P", sender.credential) : sender;
            const repeat =
              mode === "new observation timestamp"
                ? { ...completed, time: { ...completed.time, at: "2020-01-01T13:00:00.000Z" } }
                : completed;
            yield* ledger.receive(active, mode === "duplicate batch" ? first : batch([repeat]));
            assert.strictEqual(yield* total, "150");
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_receipt`, 1);
            const [stored] = yield* sql<{
              readonly value: UsageFact;
            }>`SELECT value FROM hq_usage_fact`;
            assert.deepStrictEqual(stored!.value.time, completed.time);
          }),
        ),
      );
    }
    it.effect(
      "parents and child responses remain distinct even when their reported counts match",
      () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, total } = yield* setup;
            yield* ledger.receive(
              sender,
              batch([
                fact("parent", "30"),
                {
                  ...fact("child", "30"),
                  parentId: "native-thread",
                  sessionId: "child-thread",
                  factId: usageFactId("child-thread", "child"),
                },
              ]),
            );
            assert.strictEqual(yield* total, "60");
          }),
        ),
    );
    it.effect(
      "equal native response IDs in different child threads remain separate completions",
      () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, total } = yield* setup;
            const parent = fact("native-response", "30");
            const child = {
              ...parent,
              sessionId: "child-thread",
              parentId: "native-thread",
              factId: usageFactId("child-thread", "native-response"),
            };
            yield* ledger.receive(sender, batch([parent, child]));
            yield* ledger.receive(sender, batch([parent, child]));
            assert.strictEqual(yield* total, "60");
          }),
        ),
    );
    for (const damage of [
      "tokens",
      "native-time",
      "provider",
      "origin",
      "channel",
      "protocol",
      "fact-key",
      "origin-key",
    ]) {
      it.effect(`${damage} conflict refuses the whole batch and preserves accepted usage`, () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, origin, batch, total, sql } = yield* setup;
            yield* ledger.receive(sender, batch([fact("same", "30")]));
            const current = sender;
            let changed = fact("same", "30");
            if (damage === "tokens") changed = fact("same", "50");
            if (damage === "native-time")
              changed = {
                ...changed,
                time: { kind: "instant", at: "2020-01-01T13:00:00.000Z", provenance: "native" },
              };
            if (damage === "provider") changed = { ...changed, provider: "codex" };
            if (damage === "fact-key") changed = { ...changed, factId: "reminted-response" };
            if (damage === "channel") {
              yield* ledger.open("P", sender.credential);
            }
            const message = batch([fact("new", "100"), changed]);
            const refused = yield* Effect.result(
              ledger.receive(current, {
                ...message,
                ...(damage === "protocol" ? { protocol: 1 } : {}),
                ...(damage === "origin-key"
                  ? {
                      origins: [{ ...origin, originId: "reminted-origin" }],
                      facts: [{ ...fact("same", "30"), originId: "reminted-origin" }],
                    }
                  : {}),
                ...(damage === "origin"
                  ? { origins: [{ ...origin, mateId: "00000000-0000-0000-0000-000000000000" }] }
                  : {}),
              }),
            );
            assert.strictEqual(refused._tag, "Failure");
            assert.strictEqual(yield* total, "30");
            assert.lengthOf(
              yield* sql`SELECT 1 FROM hq_usage_receipt WHERE fact_id=${usageFactId("native-thread", "new")}`,
              0,
            );
          }),
        ),
      );
    }
    it.effect(
      "a known zero turn does not infer participation from Haiku 10 and Opus 100 history",
      () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, sql } = yield* setup;
            const zero = yield* decodeFact({
              ...fact("zero", "0"),
              models: [],
              nativeCost: { amount: "0", scale: 9, currency: "USD", basis: "reported-turn" },
            });
            yield* ledger.receive(
              sender,
              batch([
                fact("haiku", "10", undefined, "haiku"),
                fact("opus", "100", undefined, "opus"),
                zero,
              ]),
            );
            yield* ledger.receive(sender, batch([zero]));
            for (const groupBy of ["model", "provider", "mate"] as const) {
              const report = yield* readUsageReport(
                sql,
                "owner",
                {
                  kind: "agentUsage",
                  query: { ...baseQuery, groupBy },
                },
                access,
                new Map(),
              );
              assert.strictEqual(report.totals.records, "3");
              assert.strictEqual(report.totals.tokens, "110");
              assert.strictEqual(report.pricing.unpricedModelEntries, "2");
              if (groupBy === "model") {
                assert.deepStrictEqual(
                  report.groups.map((group) => [
                    group.model,
                    group.totals.records,
                    group.totals.tokens,
                  ]),
                  [
                    ["haiku", "1", "10"],
                    ["opus", "1", "100"],
                  ],
                );
              } else assert.strictEqual(report.groups[0]!.totals.records, "3");
              yield* decodeReport(report);
            }
            yield* sql`UPDATE hq_usage_state SET exact_since='2020-01-01T00:00:00Z'`;
            const exact = yield* readUsageReport(
              sql,
              "owner",
              {
                kind: "agentUsage",
                query: {
                  ...baseQuery,
                  mode: "exact",
                  groupBy: "hour",
                  since: "2020-01-01T11:00:00.000Z",
                  until: "2020-01-01T13:00:00.000Z",
                },
                detail: { tier: "exact" },
              },
              access,
              new Map(),
            );
            assert.strictEqual(exact.totals.records, "3");
            assert.strictEqual(exact.totals.tokens, "110");
            assert.lengthOf(exact.detail, 3);
            const recordedZero = exact.detail.find(
              (detail) => "nativeId" in detail && detail.nativeId === "zero",
            );
            assert.deepStrictEqual(recordedZero, zero);
          }),
        ),
    );
    it.effect(
      "summary groupings share access binding while filters, access and detail groupings stay fenced",
      () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, sql } = yield* setup;
            yield* ledger.receive(sender, batch([fact("binding", "10")]));
            yield* sql`UPDATE hq_usage_state SET exact_since='2020-01-01T00:00:00Z'`;
            const query = {
              ...baseQuery,
              mode: "exact" as const,
              since: "2020-01-01T11:00:00.000Z",
              until: "2020-01-01T13:00:00.000Z",
            };
            const read = (
              groupBy: UsageReportQuery["groupBy"],
              model: string | null = null,
              admitted = access,
              detail = false,
            ) =>
              readUsageReport(
                sql,
                "owner",
                {
                  kind: "agentUsage",
                  query: { ...query, groupBy, model },
                  ...(detail ? { detail: { tier: "exact" as const } } : {}),
                },
                admitted,
                new Map(),
              );
            const model = yield* read("model");
            for (const groupBy of ["provider", "hour", "day", "mate"] as const) {
              const grouped = yield* read(groupBy);
              assert.deepStrictEqual(grouped.generation, model.generation);
            }
            const filtered = yield* read("model", "model-a");
            assert.notStrictEqual(filtered.generation.access, model.generation.access);
            const changedAccess: UsageReportAccess = {
              ...access,
              facts: {
                ...access.facts,
                projects: [
                  {
                    ...access.facts.projects[0]!,
                    userRoles: [{ clientUserId: "C-owner", roleCode: "ADMIN" }],
                  },
                ],
              },
            };
            const changed = yield* read("model", null, changedAccess);
            assert.notStrictEqual(changed.generation.access, model.generation.access);
            const modelDetail = yield* read("model", null, access, true);
            const providerDetail = yield* read("provider", null, access, true);
            assert.notStrictEqual(modelDetail.generation.access, providerDetail.generation.access);
          }),
        ),
    );
    it.effect("exact expiry preserves permanent daily facts and clone deduplication", () =>
      database(
        Effect.gen(function* () {
          const { ledger, sender, batch, total, sql, leader } = yield* setup;
          const completed = fact("old", "150");
          yield* ledger.receive(sender, batch([completed]));
          const [clock] = yield* sql<{
            readonly boundary: string;
          }>`SELECT to_char((now() AT TIME ZONE 'UTC')::date-30,'YYYY-MM-DD') AS boundary`;
          assert.strictEqual(yield* pruneUsageDetail(sql, leader, clock!.boundary), 1);
          assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_fact`, 0);
          const clone = yield* ledger.open("P", sender.credential);
          yield* ledger.receive(clone, batch([completed]));
          assert.strictEqual(yield* total, "150");
          assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_fact`, 0);
          assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_receipt`, 1);
          const [retainedReceipt] = yield* sql<{
            readonly detail: unknown;
          }>`SELECT to_jsonb(r)-'origin_id'-'fact_id'-'digest' AS detail FROM hq_usage_receipt r`;
          assert.deepStrictEqual(retainedReceipt!.detail, {});
        }),
      ),
    );
    it.effect(
      "exact subday edges, hours, providers and models use reported responses and independent pricing",
      () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, sql, leader } = yield* setup;
            yield* sql`UPDATE hq_usage_state SET exact_since='2020-01-01T00:00:00Z'`;
            yield* ledger.receive(
              sender,
              batch([
                fact("before", "100", "2020-01-01T01:00:00.000Z"),
                fact("inside", "200", "2020-01-01T13:00:00.000Z"),
                fact("next", "300", "2020-01-02T03:00:00.000Z"),
              ]),
            );
            const query = {
              ...baseQuery,
              mode: "exact" as const,
              since: "2020-01-01T12:00:00.000Z",
              until: "2020-01-02T12:00:00.000Z",
            };
            yield* installAutomaticUsageRates(sql, leader, {
              "model-a": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
            });
            for (const groupBy of ["hour", "day", "provider", "model"] as const) {
              const report = yield* readUsageReport(
                sql,
                "owner",
                { kind: "agentUsage", query: { ...query, groupBy } },
                access,
                new Map(),
              );
              assert.strictEqual(report.totals.tokens, "500");
              assert.strictEqual(report.pricing.costUsdNanos, "500000");
              assert.strictEqual(report.recordedSince, "2020-01-01T01:00:00.000Z");
              if (groupBy === "hour")
                assert.deepStrictEqual(
                  report.groups.map((group) => group.period),
                  ["2020-01-01T13:00:00.000Z", "2020-01-02T03:00:00.000Z"],
                );
              if (groupBy === "model") assert.strictEqual(report.groups[0]!.provider, "claude");
            }
          }),
        ),
    );
    it.effect(
      "new completed responses invalidate pages while current owner and application regroup retained history",
      () =>
        database(
          Effect.gen(function* () {
            const { ledger, sender, batch, sql } = yield* setup;
            yield* ledger.receive(sender, batch([fact("first", "100")]));
            const query = { ...baseQuery, groupBy: "owner" as const };
            const before = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query },
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
              { kind: "agentUsage", query },
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
            yield* ledger.receive(sender, batch([fact("second", "50")]));
            const stale = yield* Effect.result(
              readUsageReport(
                sql,
                "owner",
                {
                  kind: "agentUsage",
                  query,
                  detail: { tier: "daily", cursor: { generation: before.generation, after: "" } },
                },
                access,
                new Map(),
              ),
            );
            assert.strictEqual(stale._tag, "Failure");
          }),
        ),
    );
    it.effect("coverage names each current Mate from Zerops, even before its first turn", () =>
      database(
        Effect.gen(function* () {
          const { sql } = yield* setup;
          const named = {
            ...access,
            facts: {
              ...access.facts,
              projects: access.facts.projects.map((project) => ({ ...project, name: "Fern" })),
            },
          };
          const report = () =>
            readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              named,
              new Map(),
            );
          yield* sql`UPDATE hq_usage_origin SET label='claude'`;
          assert.strictEqual((yield* report()).coverage[0]!.label, "Fern");
          yield* sql`DELETE FROM hq_usage_origin`;
          assert.strictEqual((yield* report()).coverage[0]!.label, "Fern");
        }),
      ),
    );
    it.effect(
      "authorized Mates that have not reported remain explicit coverage, never invented usage",
      () =>
        database(
          Effect.gen(function* () {
            const { sql } = yield* setup;
            yield* sql`DELETE FROM hq_usage_origin`;
            const report = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              access,
              new Map(),
            );
            assert.lengthOf(report.coverage, 1);
            assert.strictEqual(report.coverage[0]!.mateId, binding.mateId);
            assert.isUndefined(report.coverage[0]!.originId);
            assert.deepStrictEqual(report.coverage[0]!.value, {
              state: "unknown",
              since: null,
              through: null,
              gaps: [],
            });
            assert.isNull(report.recordedSince);
            assert.strictEqual(report.totals.tokens, "0");
            const denied = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              {
                ...access,
                facts: {
                  ...access.facts,
                  members: [{ ...access.facts.members[0]!, roleCode: "NO_ACCESS" }],
                  projects: [],
                },
              },
              new Map(),
            );
            assert.lengthOf(denied.coverage, 0);
          }),
        ),
    );
    it.effect("only admitted origins establish the first recorded date", () =>
      database(
        Effect.gen(function* () {
          const { ledger, sender, batch, sql } = yield* setup;
          yield* ledger.receive(sender, batch([fact("visible", "100")]));
          yield* sql`INSERT INTO hq_usage_origin(origin_id,org_id,project_id,mate_id,provider,label,coverage,recorded_since) VALUES('hidden','ORG','P-hidden','00000000-0000-0000-0000-000000000001','claude','Hidden',${json({ state: "partial", since: null, through: null, gaps: [] })}::jsonb,'2019-01-01')`;
          const projectOnly: UsageReportAccess = {
            ...access,
            facts: {
              ...access.facts,
              members: [{ ...access.facts.members[0]!, roleCode: "NO_ACCESS" }],
              projects: [
                ...access.facts.projects,
                {
                  ...access.facts.projects[0]!,
                  id: "P-hidden",
                  userRoles: [{ clientUserId: "C-owner", roleCode: "NO_ACCESS" }],
                },
              ],
            },
          };
          const report = yield* readUsageReport(
            sql,
            "owner",
            { kind: "agentUsage", query: baseQuery },
            projectOnly,
            new Map(),
          );
          assert.strictEqual(report.recordedSince, "2020-01-01T12:00:00.000Z");
          assert.deepStrictEqual(
            report.coverage.map((row) => row.originId),
            [originId],
          );
        }),
      ),
    );
    it.effect(
      "forward migration preserves old provenance and 32 original gaps without adding scanner accounting to live totals",
      () =>
        Effect.gen(function* () {
          const pg = yield* TempPostgres;
          const url = yield* pg.createDatabase;
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const old = treeMigrations().filter((file) => file.name < "0050_usage_turns.sql");
            yield* migrate(old);
            const originalGaps = Array.from({ length: 32 }, (_, index) => `source-gap-${index}`);
            yield* sql`INSERT INTO hq_usage_producer(ledger_id,org_id,project_id,mate_id,channel,process_id,digest) VALUES('old','ORG','P','00000000-0000-0000-0000-000000000001','old','old',repeat('0',64))`;
            yield* sql`INSERT INTO hq_usage_origin(origin_id,org_id,project_id,mate_id,ledger_id,writer_id,provider,label,coverage) VALUES('old','ORG','P','00000000-0000-0000-0000-000000000001','old','old','claude','Old Mate',${json({ state: "partial", since: "2020-01-01T00:00:00.000Z", through: "2020-01-02T00:00:00.000Z", gaps: originalGaps })}::jsonb)`;
            const historicalTurn = fact("old", "150");
            const { models, ...historicalIdentity } = historicalTurn;
            const original = {
              ...historicalIdentity,
              originId: "old",
              model: models[0]!.model,
              components: models[0]!.components,
              pricingBand: "standard",
              aliases: ["request"],
              revision: "1",
              state: "settled",
            };
            const oldContribution = {
              ...contributionOf(historicalTurn).models[0]!,
              pricingBand: "standard",
            };
            yield* sql`INSERT INTO hq_usage_receipt(origin_id,native_id,fact_id,revision,digest,contribution) VALUES('old','old','old',1,repeat('0',64),${json(oldContribution)}::jsonb)`;
            yield* sql`INSERT INTO hq_usage_fact(origin_id,native_id,day,model,value) VALUES('old','old','2020-01-01','model-a',${json(original)}::jsonb)`;
            yield* sql`INSERT INTO hq_usage_daily(origin_id,day,model,pricing_band,meter_version,known_components,statistics) VALUES('old','2020-01-01','model-a','standard','claude-1','1111',${json(oldContribution.statistics)}::jsonb)`;
            yield* migrate(treeMigrations());
            const [historical] = yield* sql<{
              readonly value: unknown;
            }>`SELECT value FROM hq_usage_history_fact`;
            assert.deepStrictEqual(historical!.value, original);
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_history_receipt`, 1);
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_history_daily`, 1);
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_fact`, 0);
            assert.lengthOf(yield* sql`SELECT 1 FROM hq_usage_daily`, 0);
            for (const name of ["hq_usage_alias", "hq_usage_producer", "hq_usage_prefix"]) {
              const [table] = yield* sql<{
                readonly present: boolean;
              }>`SELECT to_regclass(${name}) IS NOT NULL AS present`;
              assert.isFalse(table!.present);
            }
            const historic = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: { ...baseQuery, provenance: "legacy-scanner" } },
              access,
              new Map(),
            );
            assert.strictEqual(historic.provenance, "legacy-scanner");
            assert.strictEqual(historic.totals.tokens, "150");
            assert.deepStrictEqual(historic.coverage[0]!.value.gaps, originalGaps);
            assert.strictEqual(historic.state, "partial");
            yield* decodeReport(historic);
            const exactLegacy = yield* Effect.result(
              readUsageReport(
                sql,
                "owner",
                {
                  kind: "agentUsage",
                  query: { ...baseQuery, mode: "exact", provenance: "legacy-scanner" },
                },
                access,
                new Map(),
              ),
            );
            assert.strictEqual(exactLegacy._tag, "Failure");
            const live = yield* readUsageReport(
              sql,
              "owner",
              { kind: "agentUsage", query: baseQuery },
              access,
              new Map(),
            );
            assert.strictEqual(live.totals.tokens, "0");
            assert.strictEqual(live.provenance, "live-responses");
          }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
        }),
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
                models: [
                  {
                    ...fact("unknown", "200").models[0]!,
                    components: { ...fact("unknown", "200").models[0]!.components, output: null },
                  },
                ],
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
          assert.strictEqual(report.pricing.pricedModelEntries, "1");
          assert.strictEqual(report.pricing.unpricedModelEntries, "1");
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
            assert.strictEqual(hidden.state, "unknown");
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
    it.effect("39,000 real-schema facts keep summary and keyset detail bounded", () =>
      database(
        Effect.gen(function* () {
          const { sql } = yield* setup;
          yield* sql`UPDATE hq_usage_state SET exact_since='2020-01-01T00:00:00Z'`;
          // Fast fixture loading uses the same canonical full facts and contribution shape as ingest.
          const sample = fact("sample", "100");
          yield* sql`INSERT INTO hq_usage_receipt(origin_id,fact_id,digest)
          SELECT ${originId},'request-'||i,repeat('0',64) FROM generate_series(1,39000)i`;
          yield* sql`WITH fixture AS (
          SELECT ('request-'||i)::text AS id,to_char('2020-01-01'::date+((i-1)/1000)::int,'YYYY-MM-DD') AS day,('model-'||(i%4))::text AS model FROM generate_series(1,39000)i)
          INSERT INTO hq_usage_fact(origin_id,fact_id,occurrence,day,value,contribution)
          SELECT ${originId},id,day::timestamptz+interval '12 hours',day,
          ${json(sample)}::jsonb||jsonb_build_object('factId',id,'nativeId',id,'models',jsonb_build_array(${json(sample.models[0])}::jsonb||jsonb_build_object('model',model)),'time',jsonb_build_object('kind','instant','at',day||'T12:00:00.000Z','provenance','native')),
          jsonb_build_object('headline',${json(contributionOf(sample).headline)}::jsonb||jsonb_build_object('day',day),'models',jsonb_build_array(${json(contributionOf(sample).models[0])}::jsonb||jsonb_build_object('day',day,'model',model))) FROM fixture`;
          yield* sql`INSERT INTO hq_usage_daily SELECT origin_id,contribution->'headline'->>'day',contribution->'headline'->>'meterVersion',hq_usage_sum(contribution->'headline'->'statistics'),hq_usage_sum(contribution->'headline'->'nativeCost') FROM hq_usage_fact GROUP BY 1,2,3`;
          yield* sql`INSERT INTO hq_usage_model_daily SELECT origin_id,line.value->>'day',line.value->>'model',line.value->>'pricingBand',line.value->>'meterVersion',line.value->>'knownComponents',hq_usage_sum(line.value->'statistics'),hq_usage_sum(line.value->'nativeCost') FROM hq_usage_fact CROSS JOIN LATERAL jsonb_array_elements(contribution->'models') line(value) GROUP BY 1,2,3,4,5,6`;
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
          }>`SELECT name AS tier,pg_total_relation_size(name::regclass)::text AS bytes FROM unnest(ARRAY['hq_usage_fact','hq_usage_receipt','hq_usage_daily','hq_usage_model_daily']) name`;
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
  });
});
