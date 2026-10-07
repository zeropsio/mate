/** Owned accounting evidence. SQLite transactions serialize capture across shared-home processes. */
// @effect-diagnostics nodeBuiltinImport:off -- persistent ledger identity is allocated once.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import { UsageCoverage, UsageFact, UsageJournalEntry, UsageOrigin } from "@t3tools/contracts";
import {
  AGENT_USAGE_BATCH_BYTES,
  AGENT_USAGE_BATCH_MAX,
  AGENT_USAGE_CAPTURE_PROTOCOL,
  USAGE_GENESIS_DIGEST,
  usageCanonical,
  usageEntryDigest,
  usageSnapshotDigest,
  usageDigest,
  UsageSnapshot,
} from "@t3tools/shared/agentUsage";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export class UsageLedgerError extends Schema.TaggedError<UsageLedgerError>()("UsageLedgerError", {
  code: Schema.String,
}) {}
const fail = (code: string) => new UsageLedgerError({ code });
const decodeFact = Schema.decodeUnknownSync(Schema.fromJsonString(UsageFact));
const decodeOrigin = Schema.decodeUnknownSync(Schema.fromJsonString(UsageOrigin));
const decodeEntry = Schema.decodeUnknownSync(Schema.fromJsonString(UsageJournalEntry));
const decodePage = Schema.decodeUnknownSync(Schema.fromJsonString(UsageSnapshot));
const validateCoverage = Schema.decodeEffect(UsageCoverage);
const validateFact = Schema.decodeEffect(UsageFact);
const validateOrigin = Schema.decodeEffect(UsageOrigin);
const validateEntry = Schema.decodeEffect(UsageJournalEntry);
const validatePage = Schema.decodeEffect(UsageSnapshot);
const bytes = (value: unknown) => new TextEncoder().encode(usageCanonical(value)).byteLength;
const Binding = Schema.Struct({
  orgId: Schema.String,
  projectId: Schema.String,
  mateId: Schema.String,
});
const Metadata = Schema.Struct({
  ledgerId: Schema.String,
  highWater: Schema.Number,
  highDigest: Schema.String,
  ack: Schema.Number,
  ackDigest: Schema.String,
  /** The registration this ledger captures for, fixed at HQ's first offer. */
  binding: Schema.optionalKey(Binding),
  /** When capture began: nothing a transcript held before it is ever a fact. */
  startedAt: Schema.optionalKey(Schema.String),
  /** Whether the transcripts on disk when capture began have their checkpoints at their end. */
  baselined: Schema.optionalKey(Schema.Boolean),
});
const decodeMeta = Schema.decodeUnknownSync(Schema.fromJsonString(Metadata));
export type UsageBinding = Pick<UsageOrigin, "orgId" | "projectId" | "mateId">;
export const USAGE_LOCAL_SOFT_BYTES = 256 * 1024 * 1024;
const LOSS_METADATA_RESERVE_BYTES = 4 * 1024 * 1024;
export const unknownCoverage = (gap: string): UsageCoverage => ({
  state: "partial",
  since: null,
  through: null,
  gaps: [gap],
});

export const makeUsageLedger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`PRAGMA busy_timeout = 5000`;
  yield* sql`PRAGMA journal_mode = WAL`;
  yield* sql`PRAGMA synchronous = FULL`;
  yield* sql`CREATE TABLE IF NOT EXISTS usage_meta (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)`;
  yield* sql`CREATE TABLE IF NOT EXISTS usage_origins (source TEXT PRIMARY KEY, value TEXT NOT NULL)`;
  yield* sql`CREATE TABLE IF NOT EXISTS usage_facts (
    origin TEXT NOT NULL, native TEXT NOT NULL, value TEXT NOT NULL,
    position TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(origin,native))`;
  yield* sql`CREATE TABLE IF NOT EXISTS usage_checkpoints (source TEXT PRIMARY KEY, value TEXT NOT NULL)`;
  yield* sql`CREATE TABLE IF NOT EXISTS usage_journal (sequence INTEGER PRIMARY KEY, digest TEXT NOT NULL, value TEXT NOT NULL)`;
  yield* sql`CREATE TABLE IF NOT EXISTS usage_prefix (sequence INTEGER PRIMARY KEY, digest TEXT NOT NULL)`;
  yield* sql`INSERT OR IGNORE INTO usage_prefix SELECT sequence,digest FROM usage_journal`;
  yield* sql`CREATE TABLE IF NOT EXISTS usage_snapshot (page INTEGER PRIMARY KEY, value TEXT NOT NULL)`;
  yield* sql`INSERT OR IGNORE INTO usage_meta VALUES (1, ${usageCanonical({
    ledgerId: NodeCrypto.randomUUID(),
    highWater: 0,
    highDigest: USAGE_GENESIS_DIGEST,
    ack: 0,
    ackDigest: USAGE_GENESIS_DIGEST,
  })})`;
  const metadata = Effect.gen(function* () {
    const rows = yield* sql<{ value: string }>`SELECT value FROM usage_meta WHERE id=1`;
    return decodeMeta(rows[0]!.value);
  });
  const saveMeta = (meta: typeof Metadata.Type) =>
    sql`UPDATE usage_meta SET value=${usageCanonical(meta)} WHERE id=1`;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const capacity = Effect.fnUntraced(function* (additional: number, reserve: number) {
    const pages = yield* sql<{ page_count: number }>`PRAGMA page_count`;
    const size = yield* sql<{ page_size: number }>`PRAGMA page_size`;
    const databases = yield* sql<{ file: string }>`PRAGMA database_list`;
    const file = databases[0]?.file;
    const wal = file
      ? yield* Effect.tryPromise(() => NodeFSP.stat(`${file}-wal`)).pipe(
          Effect.map((value) => value.size),
          Effect.catch(() => Effect.succeed(0)),
        )
      : 0;
    if (
      pages[0]!.page_count * size[0]!.page_size + wal + additional >
      USAGE_LOCAL_SOFT_BYTES - reserve
    )
      return yield* fail("local-storage-pressure");
  });
  const origins = Effect.gen(function* () {
    const rows = yield* sql<{ value: string }>`SELECT value FROM usage_origins ORDER BY source`;
    return rows.map((row) => decodeOrigin(row.value));
  });
  const append = Effect.fnUntraced(function* (
    facts: ReadonlyArray<UsageFact>,
    coverage: UsageJournalEntry["coverage"],
  ) {
    const meta = yield* metadata;
    if (!Number.isSafeInteger(meta.highWater + 1)) return yield* fail("sequence-exhausted");
    const base = {
      sequence: String(meta.highWater + 1),
      previousDigest: meta.highDigest,
      facts,
      coverage,
    };
    const entry = { ...base, digest: usageEntryDigest(base) };
    yield* validateEntry(entry);
    if (bytes(entry) > AGENT_USAGE_BATCH_BYTES - 1024) return yield* fail("entry-too-large");
    yield* capacity(bytes(entry) * 3, facts.length ? LOSS_METADATA_RESERVE_BYTES : 0);
    yield* sql`INSERT INTO usage_journal VALUES (${meta.highWater + 1}, ${entry.digest}, ${usageCanonical(entry)})`;
    yield* sql`INSERT INTO usage_prefix VALUES (${meta.highWater + 1}, ${entry.digest})`;
    yield* saveMeta({ ...meta, highWater: meta.highWater + 1, highDigest: entry.digest });
  });
  const bind = Effect.fnUntraced(function* (
    source: string,
    binding: UsageBinding,
    provider: UsageOrigin["provider"],
  ) {
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM usage_origins WHERE source=${source}`;
    if (rows.length) {
      const origin = decodeOrigin(rows[0]!.value);
      if (
        origin.orgId !== binding.orgId ||
        origin.projectId !== binding.projectId ||
        origin.mateId !== binding.mateId
      )
        return yield* fail("source-binding-conflict");
      return origin;
    }
    if ((yield* origins).length >= 64) return yield* fail("source-capacity");
    const meta = yield* metadata;
    const origin: UsageOrigin = {
      // A wiped home with surviving native history must be refused by HQ's existing lineage,
      // rather than minting another origin for the same registration/provider history.
      ...binding,
      originId: usageDigest([binding, provider, source]),
      writerId: NodeCrypto.randomUUID(),
      provider,
      label: provider,
      coverage: { state: "partial", since: meta.startedAt ?? null, through: null, gaps: [] },
    };
    yield* validateOrigin(origin);
    yield* sql`INSERT INTO usage_origins VALUES (${source}, ${usageCanonical(origin)})`;
    yield* append([], [{ originId: origin.originId, value: origin.coverage }]);
    return origin;
  });
  const coverage = Effect.fnUntraced(function* (originId: string, value: UsageCoverage) {
    yield* validateCoverage(value);
    const rows = yield* sql<{
      source: string;
      value: string;
    }>`SELECT source,value FROM usage_origins`;
    const row = rows.find((row) => decodeOrigin(row.value).originId === originId);
    if (!row) return yield* fail("unknown-origin");
    const origin = decodeOrigin(row.value);
    if (usageCanonical(origin.coverage) === usageCanonical(value)) return;
    yield* sql`UPDATE usage_origins SET value=${usageCanonical({ ...origin, coverage: value })} WHERE source=${row.source}`;
    yield* append([], [{ originId, value }]);
  });
  const capture = Effect.fnUntraced(function* (
    input: Omit<UsageFact, "revision">,
    position: string,
    ordinal: number,
  ) {
    const origin = (yield* origins).find((origin) => origin.originId === input.originId);
    if (!origin || origin.provider !== input.provider) return yield* fail("unknown-origin");
    const rows = yield* sql<{ value: string; position: string; ordinal: number }>`
      SELECT value,position,ordinal FROM usage_facts WHERE origin=${input.originId} AND native=${input.nativeId}`;
    const row = rows[0];
    const previous = row ? decodeFact(row.value) : undefined;
    const fact = { ...input, revision: previous?.revision ?? "1" };
    yield* validateFact(fact);
    if (previous && usageCanonical(previous) === usageCanonical(fact)) return false;
    if (row && (row.position !== position || ordinal <= row.ordinal)) {
      yield* coverage(origin.originId, unknownCoverage("incomparable-native-evidence"));
      return false;
    }
    if (previous) fact.revision = String(BigInt(previous.revision) + 1n);
    yield* append([fact], []);
    yield* sql`INSERT INTO usage_facts VALUES (${fact.originId}, ${fact.nativeId}, ${usageCanonical(fact)}, ${position}, ${ordinal})
      ON CONFLICT(origin,native) DO UPDATE SET value=excluded.value, position=excluded.position,ordinal=excluded.ordinal`;
    return true;
  });
  const checkpoint = Effect.fnUntraced(function* (source: string) {
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM usage_checkpoints WHERE source=${source}`;
    return rows[0]?.value;
  });
  const saveCheckpoint = (source: string, value: string) => sql`
    INSERT INTO usage_checkpoints VALUES (${source},${value}) ON CONFLICT(source) DO UPDATE SET value=excluded.value`;
  const hello = Effect.gen(function* () {
    const meta = yield* metadata;
    const first = yield* sql<{
      sequence: number;
    }>`SELECT sequence FROM usage_journal ORDER BY sequence LIMIT 1`;
    return {
      type: "usage-hello",
      protocol: AGENT_USAGE_CAPTURE_PROTOCOL,
      ledgerId: meta.ledgerId,
      highWater: String(meta.highWater),
      highDigest: meta.highDigest,
      replayFloor: String(first[0]?.sequence ?? meta.highWater + 1),
      origins: yield* origins,
    } as const;
  });
  const digestAt = Effect.fnUntraced(function* (cursor: string) {
    const meta = yield* metadata;
    if (BigInt(cursor) > BigInt(meta.highWater)) return yield* fail("ledger-rollback");
    if (cursor === "0") return USAGE_GENESIS_DIGEST;
    if (cursor === String(meta.highWater)) return meta.highDigest;
    if (cursor === String(meta.ack)) return meta.ackDigest;
    const rows = yield* sql<{
      digest: string;
    }>`SELECT digest FROM usage_prefix WHERE sequence=${Number(cursor)}`;
    if (rows[0]) return rows[0].digest;
    const pinned = yield* sql<{
      value: string;
    }>`SELECT value FROM usage_snapshot ORDER BY page LIMIT 1`;
    if (pinned[0]) {
      const page = decodePage(pinned[0].value);
      if (page.highWater === cursor) return page.highDigest;
    }
    return undefined;
  });
  const acknowledge = Effect.fnUntraced(function* (cursor: string, digest: string) {
    if ((yield* digestAt(cursor)) !== digest) return yield* fail("prefix-conflict");
    const meta = yield* metadata;
    // An authenticated restored HQ may commit below the previous ACK. Its actual cut wins.
    yield* saveMeta({ ...meta, ack: Number(cursor), ackDigest: digest });
  });
  const batch = Effect.fnUntraced(function* (cursor: string, channel: string) {
    const meta = yield* metadata;
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM usage_journal WHERE sequence>${Number(cursor)} ORDER BY sequence LIMIT ${AGENT_USAGE_BATCH_MAX}`;
    const entries: UsageJournalEntry[] = [];
    for (const row of rows) {
      const entry = decodeEntry(row.value);
      if (
        entries.length &&
        bytes({
          type: "usage-batch",
          ledgerId: meta.ledgerId,
          channel,
          entries: [...entries, entry],
        }) > AGENT_USAGE_BATCH_BYTES
      )
        break;
      entries.push(entry);
    }
    if (!entries.length) return undefined;
    if (entries[0]!.sequence !== String(BigInt(cursor) + 1n))
      return yield* fail("replay-compacted");
    const message = { type: "usage-batch", ledgerId: meta.ledgerId, channel, entries } as const;
    if (bytes(message) > AGENT_USAGE_BATCH_BYTES) return yield* fail("batch-too-large");
    return message;
  });
  const snapshot = Effect.fnUntraced(function* (channel: string) {
    const held = yield* sql<{ value: string }>`SELECT value FROM usage_snapshot ORDER BY page`;
    if (held.length) return held.map((row) => ({ ...decodePage(row.value), channel }));
    const meta = yield* metadata;
    const total = yield* sql<{
      count: number;
      bytes: number;
    }>`SELECT count(*) AS count,coalesce(sum(length(value)),0) AS bytes FROM usage_facts`;
    yield* capacity(total[0]!.bytes * 2, LOSS_METADATA_RESERVE_BYTES);
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM usage_facts ORDER BY origin,native`;
    const coverage = (yield* origins).map((origin) => ({
      originId: origin.originId,
      value: origin.coverage,
    }));
    // One snapshot is pinned in SQLite. No canonical changes or compacted tail can change its pages.
    const groups: UsageFact[][] = [[]];
    let groupBytes = 2;
    for (const row of rows) {
      const fact = decodeFact(row.value);
      let group = groups[groups.length - 1]!;
      const factBytes = bytes(fact);
      if (
        group.length >= AGENT_USAGE_BATCH_MAX ||
        groupBytes + factBytes + (group.length ? 1 : 0) > AGENT_USAGE_BATCH_BYTES - 12 * 1024
      ) {
        group = [];
        groups.push(group);
        groupBytes = 2;
      }
      groupBytes += factBytes + (group.length ? 1 : 0);
      group.push(fact);
    }
    const snapshotId = NodeCrypto.randomUUID();
    let previousDigest = USAGE_GENESIS_DIGEST;
    const pages = groups.map((facts, page) => {
      const base = {
        ledgerId: meta.ledgerId,
        snapshotId,
        highWater: String(meta.highWater),
        highDigest: meta.highDigest,
        page,
        totalFacts: String(rows.length),
        pages: groups.length,
        previousDigest,
        facts,
        coverage: page === 0 ? coverage : [],
      };
      const digest = usageSnapshotDigest(base);
      previousDigest = digest;
      return { ...base, type: "usage-snapshot" as const, channel, digest, manifestDigest: "" };
    });
    for (const page of pages) {
      page.manifestDigest = previousDigest;
      yield* validatePage(page);
      if (bytes(page) > AGENT_USAGE_BATCH_BYTES) return yield* fail("snapshot-page-too-large");
      yield* sql`INSERT INTO usage_snapshot VALUES (${page.page}, ${usageCanonical(page)})`;
    }
    return pages;
  });
  const finishSnapshot = sql`DELETE FROM usage_snapshot`;
  const compact = Effect.gen(function* () {
    const meta = yield* metadata;
    // A pinned snapshot requires H+1, including entries ACKed by a different connection.
    const held = yield* sql<{
      value: string;
    }>`SELECT value FROM usage_snapshot ORDER BY page LIMIT 1`;
    const through = held.length
      ? Math.min(meta.ack, Number(decodePage(held[0]!.value).highWater))
      : meta.ack;
    yield* sql`DELETE FROM usage_journal WHERE sequence<=${through}`;
  });
  /** Fixes the registration at HQ's first offer; capture begins then, never before. */
  const begin = Effect.fnUntraced(function* (binding: UsageBinding) {
    const meta = yield* metadata;
    if (meta.binding === undefined) {
      yield* saveMeta({ ...meta, binding, startedAt: yield* now, baselined: false });
      return;
    }
    if (usageCanonical(meta.binding) !== usageCanonical(binding))
      return yield* fail("source-binding-conflict");
  });
  const markBaselined = Effect.gen(function* () {
    yield* saveMeta({ ...(yield* metadata), baselined: true });
  });
  const transaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    sql.withTransaction(
      // Obtain a write lock before reading a checkpoint: SQLite's lock is shared across processes.
      sql`UPDATE usage_meta SET value=value WHERE id=1`.pipe(Effect.andThen(effect)),
    );
  // A ledger from a build that imported history begins capture now, bound as its origins are.
  const loaded = yield* metadata;
  const retained = yield* origins;
  if (loaded.startedAt === undefined && retained.length > 0) {
    const { orgId, projectId, mateId } = retained[0]!;
    yield* saveMeta({
      ...loaded,
      binding: { orgId, projectId, mateId },
      startedAt: yield* now,
      baselined: false,
    });
  }
  return {
    metadata,
    origins,
    begin: (binding: UsageBinding) => transaction(begin(binding)),
    markBaselined: transaction(markBaselined),
    hello,
    digestAt,
    batch,
    bind: (...args: Parameters<typeof bind>) => transaction(bind(...args)),
    capture: (...args: Parameters<typeof capture>) => transaction(capture(...args)),
    coverage: (...args: Parameters<typeof coverage>) => transaction(coverage(...args)),
    checkpoint,
    saveCheckpoint,
    transaction,
    acknowledge: (...args: Parameters<typeof acknowledge>) => transaction(acknowledge(...args)),
    snapshot: (channel: string) => transaction(snapshot(channel)),
    finishSnapshot: transaction(finishSnapshot),
    compact: transaction(compact),
  };
});
export type UsageLedger = Effect.Success<typeof makeUsageLedger>;
