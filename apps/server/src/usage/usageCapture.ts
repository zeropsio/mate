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
import { CodexMeterState, initialMeterState, meterLine } from "./usageMeters.ts";
import {
  UsageLedgerError,
  unknownCoverage,
  type UsageBinding,
  type UsageLedger,
} from "./UsageLedger.ts";

/** IO budgets bound each transaction and the one-time retained import, never determine completeness. */
export const CAPTURE_READ_BYTES = 1024 * 1024;
export const RETAINED_IMPORT_BYTES = 64 * 1024 * 1024;
export const CAPTURE_FILES_MAX = 2048;
const Checkpoint = Schema.Struct({
  offset: Schema.Number,
  prefix: Schema.String,
  meter: CodexMeterState,
  stamp: Schema.optionalKey(Schema.String),
});
const decodeCheckpoint = Schema.decodeUnknownSync(Schema.fromJsonString(Checkpoint));
const prefixDigest = (bytes: Uint8Array) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const EMPTY_PREFIX = prefixDigest(new Uint8Array());
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export interface CaptureSource {
  readonly provider: "claude" | "codex";
  readonly directory: string;
}

/** Fails on incomplete listings, rather than certifying a swallowed IO error as an empty source. */
async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await NodeFSP.readdir(dir, { withFileTypes: true })) {
      if (files.length >= CAPTURE_FILES_MAX) throw new Error("transcript-file-budget");
      if (entry.isDirectory()) await walk(NodePath.join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
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
  const files = yield* Effect.tryPromise(() => listFiles(directory.value)).pipe(
    Effect.catch(() =>
      ledger
        .coverage(origin.originId, unknownCoverage("source-listing-unavailable"))
        .pipe(Effect.as(undefined)),
    ),
  );
  if (!files) return;
  const importKey = `${sourceId}:retained-import`;
  let importedBytes = 0;
  const gaps = new Set<string>(origin.coverage.gaps);
  const retainedImport = (yield* ledger.checkpoint(importKey)) === undefined;
  if (retainedImport)
    yield* ledger.coverage(origin.originId, {
      state: "backfilling",
      since: null,
      through: null,
      gaps: ["retained-history-unsealed"],
    });
  for (const file of files) {
    const key = usageDigest([sourceId, file]);
    const scan = ledger.transaction(
      Effect.gen(function* () {
        const saved = yield* ledger.checkpoint(key);
        let checkpoint: typeof Checkpoint.Type = saved
          ? decodeCheckpoint(saved)
          : { offset: 0, prefix: EMPTY_PREFIX, meter: initialMeterState() };
        if (importedBytes >= RETAINED_IMPORT_BYTES) {
          gaps.add("retained-import-budget");
          return;
        }
        const handle = yield* Effect.acquireRelease(
          Effect.tryPromise(() => NodeFSP.open(file, "r")),
          (handle) => Effect.promise(() => handle.close()),
        );
        const stats = yield* Effect.tryPromise(() => handle.stat());
        const stamp = usageDigest([stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs]);
        // Unchanged files need no prefix IO. This cache never changes a fact or declares coverage.
        if (saved && checkpoint.offset === stats.size && checkpoint.stamp === stamp) return false;
        // A whole-prefix hash verifies comparable positions across truncation/replacement.
        // Prefix verification has the same declared byte budget as the retained import.
        if (checkpoint.offset > RETAINED_IMPORT_BYTES) {
          gaps.add("source-prefix-budget");
          return;
        }
        const prefix = Buffer.alloc(Math.min(checkpoint.offset, stats.size));
        if (prefix.length) yield* Effect.tryPromise(() => handle.read(prefix, 0, prefix.length, 0));
        if (stats.size < checkpoint.offset || prefixDigest(prefix) !== checkpoint.prefix) {
          gaps.add("source-rewritten");
          // Reconcile stable native IDs from the beginning; missing rows never retract facts.
          checkpoint = { offset: 0, prefix: EMPTY_PREFIX, meter: initialMeterState() };
        }
        const allowance = Math.min(CAPTURE_READ_BYTES, RETAINED_IMPORT_BYTES - importedBytes);
        const buffer = Buffer.alloc(
          Math.min(allowance, Math.max(0, stats.size - checkpoint.offset)),
        );
        const read = yield* Effect.tryPromise(() =>
          handle.read(buffer, 0, buffer.length, checkpoint.offset),
        );
        importedBytes += read.bytesRead;
        const end = buffer.subarray(0, read.bytesRead).lastIndexOf(10);
        if (end < 0) {
          if (stats.size > checkpoint.offset) gaps.add("incomplete-or-oversize-record");
          return;
        }
        const consumed = buffer.subarray(0, end + 1);
        let offset = checkpoint.offset;
        for (const line of utf8.decode(consumed).split("\n").slice(0, -1)) {
          offset += Buffer.byteLength(line, "utf8") + 1;
          const result = meterLine(source.provider, line, checkpoint.meter);
          if (result.gap) gaps.add(result.gap);
          if (result.fact)
            yield* ledger.capture({ ...result.fact, originId: origin.originId }, key, offset);
        }
        const completePrefix = Buffer.alloc(offset);
        yield* Effect.tryPromise(() => handle.read(completePrefix, 0, offset, 0));
        const after = yield* Effect.tryPromise(() => handle.stat());
        if (usageDigest([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs]) !== stamp)
          return yield* new UsageLedgerError({ code: "source-changed-during-capture" });
        yield* ledger.saveCheckpoint(
          key,
          usageCanonical({
            offset,
            prefix: prefixDigest(completePrefix),
            meter: checkpoint.meter,
            stamp,
          }),
        );
        if (offset < stats.size) {
          if (importedBytes >= RETAINED_IMPORT_BYTES) gaps.add("capture-read-budget");
          else return true;
        }
        return false;
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
  if (retainedImport)
    yield* ledger.transaction(ledger.saveCheckpoint(importKey, "bounded-import-attempted"));
  const latest = (yield* ledger.origins).find((item) => item.originId === origin.originId);
  for (const gap of latest?.coverage.gaps ?? []) gaps.add(gap);
  // A scan proves recorded contributions, not cancellation, completeness or a historical zero.
  gaps.add("retained-history-unsealed");
  const coverage: UsageCoverage = {
    state: "partial",
    since: null,
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
