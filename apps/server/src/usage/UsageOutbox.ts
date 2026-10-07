/** Completed native responses wait here until HQ commits and acknowledges their identities. */
import {
  UsageComponents,
  UsageNativeCost,
  UsageProviderKind,
  UsageFact,
  UsageOrigin,
  AGENT_USAGE_BATCH_BYTES,
  AGENT_USAGE_BATCH_MAX,
  AGENT_USAGE_CAPTURE_PROTOCOL,
} from "@t3tools/contracts";
import {
  usageCanonical,
  usageDigest,
  usageOriginId,
  usageFactId,
  UsageLinkUp,
  type UsageLinkDown,
} from "@t3tools/shared/agentUsage";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const Binding = Schema.Struct({
  orgId: Schema.NonEmptyString,
  projectId: Schema.NonEmptyString,
  mateId: Schema.NonEmptyString,
});
export type UsageBinding = typeof Binding.Type;
const CompletedUsage = Schema.Struct({
  provider: UsageProviderKind,
  at: UsageFact.fields.time.fields.at,
  nativeThreadId: UsageFact.fields.sessionId,
  nativeResponseId: UsageFact.fields.nativeId,
  model: UsageFact.fields.model,
  components: UsageComponents,
  nativeCost: Schema.NullOr(UsageNativeCost),
  parentId: UsageFact.fields.parentId,
});
export type CompletedUsage = typeof CompletedUsage.Type;
export class UsageOutboxError extends Schema.TaggedError<UsageOutboxError>()("UsageOutboxError", {
  code: Schema.String,
}) {}
const decodeResponse = Schema.decodeUnknownSync(Schema.fromJsonString(CompletedUsage));
const decodeBinding = Schema.decodeUnknownSync(Schema.fromJsonString(Binding));
const validateBinding = Schema.decodeUnknownEffect(Binding);
const validateResponse = Schema.decodeUnknownEffect(CompletedUsage);
const validateFact = Schema.decodeUnknownEffect(UsageFact);
const validateBatch = Schema.decodeUnknownEffect(UsageLinkUp);
const semantic = ({ at: _at, ...response }: CompletedUsage) => response;
const keyOf = (response: CompletedUsage) =>
  usageDigest([response.provider, response.nativeThreadId, response.nativeResponseId]);
const bodyOf = ({ batchId: _id, ...frame }: UsageLinkUp) => frame;
const bytes = (value: unknown) => new TextEncoder().encode(usageCanonical(value)).byteLength;

export const makeUsageOutbox = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`PRAGMA journal_mode = WAL`;
  yield* sql`PRAGMA synchronous = FULL`;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const version = yield* sql<{ user_version: number }>`PRAGMA user_version`;
      if (version[0]!.user_version > 2)
        return yield* new UsageOutboxError({ code: "outbox-version-unsupported" });
      if (version[0]!.user_version < 2) {
        // Old scanner state has no native completed-response identity and cannot be imported.
        for (const table of [
          "usage_meta",
          "usage_origins",
          "usage_facts",
          "usage_checkpoints",
          "usage_journal",
          "usage_prefix",
          "usage_snapshot",
        ])
          yield* sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
        yield* sql`PRAGMA user_version = 2`;
      }
      yield* sql`CREATE TABLE IF NOT EXISTS usage_binding (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)`;
      yield* sql`CREATE TABLE IF NOT EXISTS usage_outbox (identity TEXT PRIMARY KEY, value TEXT NOT NULL)`;
      yield* sql`CREATE TABLE IF NOT EXISTS usage_recorded_since (provider TEXT PRIMARY KEY, at TEXT NOT NULL)`;
    }),
  );
  const binding = Effect.gen(function* () {
    const rows = yield* sql<{ value: string }>`SELECT value FROM usage_binding WHERE id=1`;
    return rows[0] ? decodeBinding(rows[0].value) : undefined;
  });
  const bind = Effect.fnUntraced(function* (next: UsageBinding) {
    const validated = yield* validateBinding(next);
    yield* sql`INSERT OR IGNORE INTO usage_binding VALUES (1, ${usageCanonical(validated)})`;
    if (usageCanonical(yield* binding) !== usageCanonical(validated))
      return yield* new UsageOutboxError({ code: "mate-binding-conflict" });
  });
  const record = Effect.fnUntraced(function* (input: CompletedUsage) {
    const response = yield* validateResponse(input);
    const identity = keyOf(response);
    yield* sql`INSERT OR IGNORE INTO usage_outbox VALUES (${identity}, ${usageCanonical(response)})`;
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM usage_outbox WHERE identity=${identity}`;
    if (
      usageCanonical(semantic(decodeResponse(rows[0]!.value))) !==
      usageCanonical(semantic(response))
    )
      return yield* new UsageOutboxError({ code: "native-response-conflict" });
    yield* sql`INSERT OR IGNORE INTO usage_recorded_since VALUES (${response.provider},${response.at})`;
  });
  const batch = Effect.gen(function* () {
    const registered = yield* binding;
    if (!registered) return undefined;
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM usage_outbox ORDER BY rowid LIMIT ${AGENT_USAGE_BATCH_MAX}`;
    if (!rows.length) return undefined;
    const starts = yield* sql<{
      provider: string;
      at: string;
    }>`SELECT provider,at FROM usage_recorded_since`;
    const origins = new Map<string, UsageOrigin>();
    const facts: UsageFact[] = [];
    let frame: UsageLinkUp | undefined;
    for (const row of rows) {
      const response = decodeResponse(row.value);
      const originId = usageOriginId(registered, response.provider);
      const origin: UsageOrigin = {
        ...registered,
        originId,
        provider: response.provider,
        label: response.provider,
        coverage: {
          state: "partial",
          since: starts.find((start) => start.provider === response.provider)!.at,
          through: null,
          gaps:
            response.provider === "claude"
              ? ["before-first-recorded-response", "claude-sidechain-completions-unavailable"]
              : ["before-first-recorded-response", "codex-response-completion-delivery-unverified"],
        },
      };
      const fact: UsageFact = {
        originId,
        factId: usageFactId(response.nativeThreadId, response.nativeResponseId),
        nativeId: response.nativeResponseId,
        provider: response.provider,
        model: response.model,
        components: response.components,
        nativeCost: response.nativeCost,
        time: { kind: "instant", at: response.at, provenance: "server-completion" },
        evidence: "live-provider-response",
        meterVersion: "native-response-v1",
        sessionId: response.nativeThreadId,
        parentId: response.parentId,
      };
      yield* validateFact(fact);
      origins.set(originId, origin);
      const body = {
        type: "usage-facts" as const,
        protocol: AGENT_USAGE_CAPTURE_PROTOCOL,
        origins: [...origins.values()],
        facts: [...facts, fact],
      };
      const candidate = { ...body, batchId: usageDigest(body) };
      if (bytes(candidate) > AGENT_USAGE_BATCH_BYTES) {
        if (!frame) return yield* new UsageOutboxError({ code: "response-too-large" });
        break;
      }
      facts.push(fact);
      frame = candidate;
    }
    return frame ? yield* validateBatch(frame) : undefined;
  });
  const acknowledge = Effect.fnUntraced(function* (
    frame: UsageLinkUp,
    accepted: Extract<UsageLinkDown, { type: "usage-ack" }>["accepted"],
  ) {
    if (usageDigest(bodyOf(frame)) !== frame.batchId) return;
    for (const key of accepted) {
      const fact = frame.facts.find(
        (row) => row.originId === key.originId && row.factId === key.factId,
      );
      if (!fact) return yield* new UsageOutboxError({ code: "ack-outside-batch" });
    }
    for (const key of accepted) {
      const fact = frame.facts.find(
        (row) => row.originId === key.originId && row.factId === key.factId,
      )!;
      const identity = usageDigest([fact.provider, fact.sessionId, fact.nativeId]);
      yield* sql`DELETE FROM usage_outbox WHERE identity=${identity}`;
    }
  });
  return {
    record: (input: CompletedUsage) => sql.withTransaction(record(input)),
    bind,
    batch: sql.withTransaction(batch),
    acknowledge: (
      frame: UsageLinkUp,
      accepted: Extract<UsageLinkDown, { type: "usage-ack" }>["accepted"],
    ) => sql.withTransaction(acknowledge(frame, accepted)),
  };
});
export type UsageOutbox = Effect.Success<typeof makeUsageOutbox>;
