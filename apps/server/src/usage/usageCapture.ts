// @effect-diagnostics nodeBuiltinImport:off -- bounded native transcript IO and watcher ownership.
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";
import { usageCanonical, usageDigest } from "@t3tools/shared/agentUsage";
import { type UsageCoverage } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  CodexMeterState,
  initialMeterState,
  meterGrokLine,
  meterLine,
  type MeterFacts,
} from "./usageMeters.ts";
import {
  UsageLedgerError,
  unknownCoverage,
  type UsageBinding,
  type UsageLedger,
} from "./UsageLedger.ts";

/** One transaction reads at most one chunk; a record longer than the record cap is a gap. */
export const CAPTURE_READ_BYTES = 1024 * 1024;
export const CAPTURE_RECORD_MAX_BYTES = 32 * 1024 * 1024;
export const CAPTURE_FILES_MAX = 2048;
/** The bytes before a checkpoint that a resumed scan re-reads to notice a rewritten transcript. */
export const CAPTURE_GUARD_BYTES = 64 * 1024;
const Checkpoint = Schema.Struct({
  /** Claude v2 excludes synthetic refusals; an older checkpoint needs one reconciliation scan. */
  normalization: Schema.optionalKey(Schema.String),
  /** Upgrade reconciliation retracts old records without importing the prefix skipped at capture. */
  reconcileUntil: Schema.optionalKey(Schema.Number),
  offset: Schema.Number,
  /** Digest of the bytes from `from` up to `offset`; absent on a checkpoint from an older build. */
  guard: Schema.optionalKey(Schema.Struct({ from: Schema.Number, digest: Schema.String })),
  identity: Schema.optionalKey(Schema.String),
  prefix: Schema.optionalKey(Schema.String),
  meter: CodexMeterState,
  stamp: Schema.optionalKey(Schema.String),
  /** The record at `offset` is past the cap: no newline ends it before this byte. */
  skipTo: Schema.optionalKey(Schema.Number),
});
type Checkpoint = typeof Checkpoint.Type;
const decodeCheckpoint = Schema.decodeUnknownSync(Schema.fromJsonString(Checkpoint));
const bytesDigest = (bytes: Uint8Array) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export interface CaptureSource {
  readonly provider: "claude" | "codex" | "grok";
  readonly directory: string;
}
/** Grok keeps a session's records in one log beside files that are not usage. */
const SOURCE_FILE: Partial<Record<CaptureSource["provider"], string>> = { grok: "updates.jsonl" };
export interface CaptureOptions {
  /** When capture began (epoch ms): a record from before it is never a fact. */
  readonly floor?: number;
  /** Capture is beginning: a Claude transcript with no checkpoint starts at its last record's end. */
  readonly baseline?: boolean;
  /** Every byte read from a transcript, for IO accounting. */
  readonly onRead?: (bytes: number) => void;
  /** The ledger this scan began in: a ledger started anew meanwhile ends the scan. */
  readonly ledgerId?: string;
}

/** Fails on incomplete listings, rather than certifying a swallowed IO error as an empty source. */
async function listFiles(directory: string, fileName: string | undefined): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await NodeFSP.readdir(dir, { withFileTypes: true })) {
      if (files.length >= CAPTURE_FILES_MAX) throw new Error("transcript-file-budget");
      if (entry.isDirectory()) await walk(NodePath.join(dir, entry.name));
      else if (
        entry.isFile() &&
        (fileName === undefined ? entry.name.endsWith(".jsonl") : entry.name === fileName)
      )
        files.push(NodePath.join(dir, entry.name));
    }
  };
  await walk(directory);
  return files.sort();
}

export const captureSource = Effect.fnUntraced(function* (
  ledger: UsageLedger,
  binding: UsageBinding,
  source: CaptureSource,
  options: CaptureOptions = {},
) {
  // Multiple configured homes may contain copies of one native session. They share its
  // provider history origin; file positions remain separate reconciliation evidence.
  const origin = yield* ledger.bind(
    usageDigest(["container-provider-history", source.provider]),
    binding,
    source.provider,
  );
  const directory = yield* Effect.tryPromise(() => NodeFSP.realpath(source.directory)).pipe(
    Effect.option,
  );
  if (Option.isNone(directory)) {
    yield* ledger.coverage(origin.originId, unknownCoverage("source-directory-unavailable"));
    return;
  }
  const sourceId = usageDigest([source.provider, directory.value]);
  const files = yield* Effect.tryPromise(() =>
    listFiles(directory.value, SOURCE_FILE[source.provider]),
  ).pipe(
    Effect.catch(() =>
      ledger
        .coverage(origin.originId, unknownCoverage("source-listing-unavailable"))
        .pipe(Effect.as(undefined)),
    ),
  );
  if (!files) return;
  const gaps = new Set<string>(origin.coverage.gaps);
  for (const file of files) {
    const key = usageDigest([sourceId, file]);
    const scan = ledger.transaction(
      Effect.gen(function* () {
        if (options.ledgerId && (yield* ledger.metadata).ledgerId !== options.ledgerId)
          return yield* new UsageLedgerError({ code: "ledger-restarted" });
        const saved = yield* ledger.checkpoint(key);
        let checkpoint: Checkpoint = saved
          ? decodeCheckpoint(saved)
          : { offset: 0, meter: initialMeterState() };
        const normalization = source.provider === "claude" ? "claude-refusals-v2" : undefined;
        if (saved && normalization !== undefined && checkpoint.normalization !== normalization)
          checkpoint = { offset: 0, meter: initialMeterState(), reconcileUntil: checkpoint.offset };
        const handle = yield* Effect.acquireRelease(
          Effect.tryPromise(() => NodeFSP.open(file, "r")),
          (handle) => Effect.promise(() => handle.close()),
        );
        const read = (position: number, length: number) =>
          Effect.tryPromise(async () => {
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, position);
            options.onRead?.(bytesRead);
            return buffer.subarray(0, bytesRead);
          });
        const stats = yield* Effect.tryPromise(() => handle.stat());
        const identity = `${stats.dev}:${stats.ino}`;
        const stamp = usageDigest([stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs]);
        // Unchanged files need no IO. This cache never changes a fact or declares coverage.
        if (saved && checkpoint.offset === stats.size && checkpoint.stamp === stamp) return false;
        if (!saved && options.baseline && source.provider !== "codex") {
          // Capture begins after the last complete record; nothing before it is read.
          let end = stats.size;
          let newline = -1;
          while (newline < 0 && end > 0) {
            const from = Math.max(0, end - CAPTURE_READ_BYTES);
            const tail = yield* read(from, end - from);
            const index = tail.lastIndexOf(10);
            if (index >= 0) newline = from + index;
            end = from;
          }
          const offset = newline + 1;
          const from = Math.max(0, offset - CAPTURE_GUARD_BYTES);
          yield* ledger.saveCheckpoint(
            key,
            usageCanonical({
              offset,
              normalization,
              guard: { from, digest: bytesDigest(yield* read(from, offset - from)) },
              identity,
              meter: initialMeterState(),
            }),
          );
          return false;
        }
        // A bounded guard before the checkpoint notices a truncated, replaced or rewritten tail
        // without re-reading the prefix; a checkpoint from an older build is trusted once.
        const guard = checkpoint.guard;
        const rewritten =
          stats.size < checkpoint.offset ||
          (checkpoint.identity !== undefined && checkpoint.identity !== identity) ||
          (guard !== undefined &&
            bytesDigest(yield* read(guard.from, checkpoint.offset - guard.from)) !== guard.digest);
        if (rewritten) {
          gaps.add("source-rewritten");
          // Reconcile stable native IDs from the beginning; missing rows never retract facts.
          checkpoint = {
            offset: 0,
            meter: initialMeterState(),
            ...(checkpoint.reconcileUntil === undefined
              ? {}
              : { reconcileUntil: checkpoint.reconcileUntil }),
          };
        }
        const checkpointAt = (offset: number, extra: { readonly skipTo?: number } = {}) =>
          Effect.gen(function* () {
            const from = Math.max(0, offset - CAPTURE_GUARD_BYTES);
            yield* ledger.saveCheckpoint(
              key,
              usageCanonical({
                offset,
                normalization,
                reconcileUntil:
                  offset < (checkpoint.reconcileUntil ?? 0) ? checkpoint.reconcileUntil : undefined,
                guard: { from, digest: bytesDigest(yield* read(from, offset - from)) },
                identity,
                meter: checkpoint.meter,
                ...extra,
              }),
            );
          });
        /** The first newline at or after `from`, read a chunk at a time and never held. */
        const newlineFrom = (from: number) =>
          Effect.gen(function* () {
            for (let at = from; at < stats.size; at += CAPTURE_READ_BYTES) {
              const index = (yield* read(
                at,
                Math.min(CAPTURE_READ_BYTES, stats.size - at),
              )).indexOf(10);
              if (index >= 0) return at + index;
            }
            return -1;
          });
        if (checkpoint.skipTo !== undefined) {
          // Still inside a record past the cap: look for its end from where the last scan stopped.
          const newline = yield* newlineFrom(checkpoint.skipTo);
          if (newline < 0) {
            yield* checkpointAt(checkpoint.offset, { skipTo: stats.size });
            return false;
          }
          yield* checkpointAt(newline + 1);
          return true;
        }
        const start = checkpoint.offset;
        let chunk = yield* read(start, Math.min(CAPTURE_READ_BYTES, stats.size - start));
        let end = chunk.lastIndexOf(10);
        // A record longer than one chunk is read whole, up to the record cap; past it, it is a gap
        // and the transcript reads on after its end.
        while (end < 0 && start + chunk.length < stats.size) {
          if (chunk.length >= CAPTURE_RECORD_MAX_BYTES) {
            gaps.add("oversize-record");
            const newline = yield* newlineFrom(start + chunk.length);
            if (newline < 0) {
              yield* checkpointAt(start, { skipTo: stats.size });
              return false;
            }
            yield* checkpointAt(newline + 1);
            return true;
          }
          chunk = yield* read(start, Math.min(chunk.length * 2, stats.size - start));
          end = chunk.lastIndexOf(10);
        }
        if (end < 0) {
          if (stats.size > start) gaps.add("incomplete-or-oversize-record");
          return false;
        }
        const consumed = chunk.subarray(0, end + 1);
        let offset = start;
        for (const line of utf8.decode(consumed).split("\n").slice(0, -1)) {
          offset += Buffer.byteLength(line, "utf8") + 1;
          let metered: MeterFacts;
          if (source.provider === "grok") metered = meterGrokLine(line, options.floor);
          else {
            const result = meterLine(source.provider, line, checkpoint.meter, options.floor);
            if (result.retract !== undefined)
              yield* ledger.retract(origin.originId, result.retract);
            const reconciling = offset <= (checkpoint.reconcileUntil ?? 0);
            metered = {
              facts: !reconciling && result.fact ? [result.fact] : [],
              gaps: !reconciling && result.gap ? [result.gap] : [],
            };
          }
          for (const gap of metered.gaps) gaps.add(gap);
          for (const fact of metered.facts)
            yield* ledger.capture({ ...fact, originId: origin.originId }, key, offset);
        }
        // What was parsed must still be on disk: a rewrite during capture rolls the chunk back.
        const after = yield* Effect.tryPromise(() => handle.stat());
        if (
          `${after.dev}:${after.ino}` !== identity ||
          !consumed.equals(yield* read(start, consumed.length))
        )
          return yield* new UsageLedgerError({ code: "source-changed-during-capture" });
        const from = Math.max(0, offset - CAPTURE_GUARD_BYTES);
        const tail =
          from >= start
            ? consumed.subarray(from - start)
            : Buffer.concat([yield* read(from, start - from), consumed]);
        yield* ledger.saveCheckpoint(
          key,
          usageCanonical({
            offset,
            normalization,
            reconcileUntil:
              offset < (checkpoint.reconcileUntil ?? 0) ? checkpoint.reconcileUntil : undefined,
            guard: { from, digest: bytesDigest(tail) },
            identity,
            meter: checkpoint.meter,
            ...(offset === stats.size ? { stamp } : {}),
          }),
        );
        return offset < stats.size;
      }),
    );
    while (
      yield* Effect.scoped(scan).pipe(
        Effect.catchCause(() =>
          Effect.sync(() => {
            gaps.add("source-capture-failed");
            return false;
          }),
        ),
      )
    ) {
      yield* Effect.yieldNow;
    }
  }
  const latest = (yield* ledger.origins).find((item) => item.originId === origin.originId);
  for (const gap of latest?.coverage.gaps ?? []) gaps.add(gap);
  // A scan proves recorded contributions since capture began, not cancellation or completeness.
  const coverage: UsageCoverage = {
    state: "partial",
    since: origin.coverage.since,
    through: null,
    gaps: [...gaps].slice(0, 32),
  };
  yield* ledger.coverage(origin.originId, coverage);
});

export interface WatchOptions {
  /** Every entry beneath the directory, or only its own entries. */
  readonly recursive: boolean;
  /** The changed entry's name relative to the directory, or null when the platform gives none. */
  readonly changed: (name: string | null) => void;
  /** The watch stopped working; the caller replaces it. */
  readonly failed: () => void;
}
export type WatchDirectory = (directory: string, options: WatchOptions) => () => void;

/** Watch source changes, never attention/report ticks. The same ledger transaction owns each scan. */
export const watchDirectory: WatchDirectory = (directory, { recursive, changed, failed }) => {
  const watcher = NodeFS.watch(directory, { recursive }, (_event, name) =>
    changed(name === null ? null : String(name)),
  );
  watcher.on("error", failed);
  return () => watcher.close();
};
