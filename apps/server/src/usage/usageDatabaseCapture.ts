/**
 * Capture from providers that keep their history in databases (OpenCode, Antigravity). They have no
 * byte offsets: a record's position is its source file and its ordinal rises every scan, so a
 * message the provider rewrites becomes its fact's next revision.
 */
import { usageCanonical, usageDigest } from "@t3tools/shared/agentUsage";
import { type UsageCoverage } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { readAntigravityUsage } from "./antigravityUsageReader.ts";
import { readOpenCodeUsage } from "./opencodeUsageReader.ts";
import { UsageLedgerError, type UsageBinding, type UsageLedger } from "./UsageLedger.ts";
import {
  meterAntigravityGeneration,
  meterOpenCodeMessage,
  type MeterFact,
  type MeterFacts,
} from "./usageMeters.ts";

export interface DatabaseSource {
  readonly provider: "opencode" | "antigravity";
  /** Every root the provider's history lives under on this host. */
  readonly roots: ReadonlyArray<string>;
}
export interface DatabaseCaptureOptions {
  /** When capture began (epoch ms): a record from before it is never a fact. */
  readonly floor?: number;
  /** The ledger this scan began in: a ledger started anew meanwhile ends the scan. */
  readonly ledgerId?: string;
  /** The scan's clock (epoch ms). */
  readonly now?: () => number;
}
/** A record written up to this long before the previous scan may still have been missed by it. */
export const DATABASE_LOOKBACK_MS = 60 * 60 * 1000;
/** Records captured per ledger transaction. */
const CAPTURE_BATCH = 256;
const Watermark = Schema.Struct({
  /** When the last scan that read every source began. */
  watermark: Schema.optionalKey(Schema.Number),
  /** The last scan's ordinal; each scan's is higher. */
  ordinal: Schema.Number,
});
const decodeWatermark = Schema.decodeUnknownSync(Schema.fromJsonString(Watermark));

interface Read {
  readonly records: ReadonlyArray<{ readonly position: string; readonly metered: MeterFacts }>;
  readonly gaps: ReadonlyArray<string>;
}

const read = async (source: DatabaseSource, since: number): Promise<Read> => {
  const position = (path: string) => usageDigest([source.provider, path]);
  if (source.provider === "opencode") {
    const records: Array<Read["records"][number]> = [];
    let failed = false;
    for (const root of source.roots) {
      const result = await readOpenCodeUsage(root, since);
      failed ||= result.error;
      for (const file of result.files)
        for (const record of file.records)
          records.push({ position: position(file.path), metered: meterOpenCodeMessage(record) });
    }
    return { records, gaps: failed ? ["opencode-source-unreadable"] : [] };
  }
  const result = await readAntigravityUsage(source.roots, since);
  return {
    records: result.generations.map((generation) => ({
      position: position(generation.path),
      metered: meterAntigravityGeneration(generation),
    })),
    gaps: result.errors.length > 0 ? ["antigravity-source-unreadable"] : [],
  };
};

export const captureDatabaseSource = Effect.fnUntraced(function* (
  ledger: UsageLedger,
  binding: UsageBinding,
  source: DatabaseSource,
  options: DatabaseCaptureOptions = {},
) {
  const origin = yield* ledger.bind(
    usageDigest(["container-provider-history", source.provider]),
    binding,
    source.provider,
  );
  const key = usageDigest(["database-watermark", source.provider, [...source.roots].sort()]);
  const saved = yield* ledger.checkpoint(key);
  const previous = saved ? decodeWatermark(saved) : undefined;
  const startedAt = options.now ? options.now() : yield* Clock.currentTimeMillis;
  const ordinal = Math.max(startedAt, (previous?.ordinal ?? 0) + 1);
  // Capture never backfills; a resumed scan re-reads only what the last one may have missed.
  const since = Math.max(
    options.floor ?? 0,
    previous?.watermark === undefined ? 0 : previous.watermark - DATABASE_LOOKBACK_MS,
  );
  const gaps = new Set<string>(origin.coverage.gaps);
  const result = yield* Effect.tryPromise(() => read(source, since)).pipe(
    Effect.catch(() =>
      Effect.succeed<Read>({ records: [], gaps: [`${source.provider}-source-unreadable`] }),
    ),
  );
  for (const gap of result.gaps) gaps.add(gap);
  for (const { metered } of result.records) for (const gap of metered.gaps) gaps.add(gap);
  const facts = result.records.flatMap(({ position, metered }) =>
    metered.facts.map((fact): [MeterFact, string] => [fact, position]),
  );
  let captured = true;
  for (let start = 0; start === 0 || start < facts.length; start += CAPTURE_BATCH) {
    const batch = facts.slice(start, start + CAPTURE_BATCH);
    const last = start + CAPTURE_BATCH >= facts.length;
    const written = yield* ledger
      .transaction(
        Effect.gen(function* () {
          if (options.ledgerId && (yield* ledger.metadata).ledgerId !== options.ledgerId)
            return yield* new UsageLedgerError({ code: "ledger-restarted" });
          for (const [fact, position] of batch)
            yield* ledger.capture({ ...fact, originId: origin.originId }, position, ordinal);
          if (!last) return;
          // A source that could not be read keeps its old watermark, so its records are read again.
          const watermark = result.gaps.length > 0 ? previous?.watermark : startedAt;
          yield* ledger.saveCheckpoint(
            key,
            usageCanonical({ ...(watermark === undefined ? {} : { watermark }), ordinal }),
          );
        }),
      )
      .pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      );
    if (!written) {
      captured = false;
      break;
    }
  }
  if (!captured) gaps.add("source-capture-failed");
  const latest = (yield* ledger.origins).find((item) => item.originId === origin.originId);
  for (const gap of latest?.coverage.gaps ?? []) gaps.add(gap);
  // A scan proves recorded contributions since capture began, not completeness.
  const coverage: UsageCoverage = {
    state: "partial",
    since: origin.coverage.since,
    through: null,
    gaps: [...gaps].slice(0, 32),
  };
  yield* ledger.coverage(origin.originId, coverage);
});
