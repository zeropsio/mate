// @effect-diagnostics globalDate:off -- validate wire UTC days without a runtime clock.
/** Durable recorded provider consumption. No transcripts, paths, logins or credentials. */
import * as Schema from "effect/Schema";
import { UsageProviderKind } from "./usage.ts";

export const AGENT_USAGE_CAPTURE_PROTOCOL = 2;
export const AGENT_USAGE_REPORT_PROTOCOL = 2;
export const AGENT_USAGE_EXACT_DAYS = 30;
export const AGENT_USAGE_BATCH_MAX = 100;
export const AGENT_USAGE_BATCH_BYTES = 48 * 1024;
export const UsageIdentity = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
/** Decimal integer on the wire, checked without a lossy Number conversion. */
export const UsageQuantity = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,37})$/u));
export const UsageDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
export const UsageUtcDay = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
  Schema.makeFilter((day) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
      ? undefined
      : "Invalid UTC day";
  }),
);
const Instant = Schema.String.check(
  Schema.makeFilter((value) =>
    /^\d{4}-\d{2}-\d{2}T.*Z$/u.test(value) && Number.isFinite(Date.parse(value))
      ? undefined
      : "Expected a UTC instant",
  ),
);
export const UsageComponents = Schema.Struct({
  uncachedInput: Schema.NullOr(UsageQuantity),
  cachedInput: Schema.NullOr(UsageQuantity),
  cacheCreation: Schema.NullOr(UsageQuantity),
  output: Schema.NullOr(UsageQuantity),
  reasoning: Schema.NullOr(UsageQuantity),
  /** A known inclusive total is an alternative to an incomplete split, never added to it. */
  inclusiveTotal: Schema.NullOr(UsageQuantity),
}).check(
  Schema.makeFilter((value) => {
    if (
      value.reasoning !== null &&
      value.output !== null &&
      BigInt(value.reasoning) > BigInt(value.output)
    )
      return "Reasoning exceeds output";
    const split = [value.uncachedInput, value.cachedInput, value.cacheCreation, value.output];
    if (
      value.inclusiveTotal !== null &&
      split.every((part) => part !== null) &&
      split.reduce((sum, part) => sum + BigInt(part!), 0n) !== BigInt(value.inclusiveTotal)
    )
      return "Inclusive total disagrees with disjoint components";
    return undefined;
  }),
);
export type UsageComponents = typeof UsageComponents.Type;
export const UsageTime = Schema.Struct({
  kind: Schema.Literal("instant"),
  at: Instant,
  provenance: UsageIdentity,
});
export const UsageNativeCost = Schema.Struct({
  amount: UsageQuantity,
  scale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 18 })),
  currency: UsageIdentity,
  basis: UsageIdentity,
});
export type UsageNativeCost = typeof UsageNativeCost.Type;
export const UsageModelLine = Schema.Struct({
  model: Schema.NullOr(UsageIdentity),
  components: UsageComponents,
  nativeCost: Schema.NullOr(UsageNativeCost),
});
export type UsageModelLine = typeof UsageModelLine.Type;
export const UsageFact = Schema.Struct({
  originId: UsageIdentity,
  factId: UsageIdentity,
  /** Native completed turn identity within the provider thread. */
  nativeId: UsageIdentity,
  provider: UsageProviderKind,
  models: Schema.Array(UsageModelLine).check(
    Schema.isMaxLength(AGENT_USAGE_BATCH_MAX),
    Schema.makeFilter((models) =>
      new Set(models.map((line) => line.model)).size === models.length
        ? undefined
        : "Repeated model in one turn",
    ),
  ),
  /** Separately reported turn charge; never added to per-model charges. */
  nativeCost: Schema.NullOr(UsageNativeCost),
  time: UsageTime,
  evidence: UsageIdentity,
  meterVersion: UsageIdentity,
  sessionId: UsageIdentity,
  parentId: Schema.NullOr(UsageIdentity),
});
export type UsageFact = typeof UsageFact.Type;
export const UsageCoverage = Schema.Struct({
  state: Schema.Literals(["unknown", "partial", "complete", "unsupported"]),
  since: Schema.NullOr(Instant),
  through: Schema.NullOr(Instant),
  gaps: Schema.Array(UsageIdentity).check(Schema.isMaxLength(32)),
});
export type UsageCoverage = typeof UsageCoverage.Type;
export const UsageOrigin = Schema.Struct({
  originId: UsageIdentity,
  orgId: UsageIdentity,
  projectId: UsageIdentity,
  /** Registration lifetime, distinct from a process boot or a ledger database. */
  mateId: UsageIdentity,
  provider: UsageProviderKind,
  label: UsageIdentity,
  coverage: UsageCoverage,
});
export type UsageOrigin = typeof UsageOrigin.Type;
export const UsageReportQuery = Schema.Struct({
  provenance: Schema.optionalKey(Schema.Literals(["live-responses", "legacy-scanner"])),
  since: Schema.NullOr(Instant),
  until: Instant,
  mode: Schema.Literals(["exact", "utc-days"]),
  timezone: Schema.String.check(
    Schema.makeFilter((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions();
        return undefined;
      } catch {
        return "Invalid IANA time zone";
      }
    }),
  ),
  projectId: Schema.NullOr(UsageIdentity),
  appId: Schema.NullOr(UsageIdentity),
  mateId: Schema.NullOr(UsageIdentity),
  ownerUserId: Schema.NullOr(UsageIdentity),
  provider: Schema.NullOr(UsageProviderKind),
  model: Schema.NullOr(UsageIdentity),
  groupBy: Schema.Literals([
    "hour",
    "day",
    "month",
    "year",
    "provider",
    "model",
    "mate",
    "project",
    "app",
    "owner",
  ]),
}).check(
  Schema.makeFilter((query) => {
    if (query.since !== null && Date.parse(query.since) >= Date.parse(query.until))
      return "Empty report window";
    if (
      query.mode === "utc-days" &&
      [query.since, query.until].some((at) => at !== null && !at.endsWith("T00:00:00.000Z"))
    )
      return "UTC trends require whole UTC days";
    return undefined;
  }),
);
export type UsageReportQuery = typeof UsageReportQuery.Type;
export const UsageReportGeneration = Schema.Struct({
  accounting: UsageQuantity,
  access: UsageDigest,
  pricing: UsageIdentity,
});
export const UsageDetailCursor = Schema.Struct({
  generation: UsageReportGeneration,
  after: Schema.String.check(Schema.isMaxLength(1024)),
});
export const AgentUsageScope = Schema.Struct({
  kind: Schema.Literal("agentUsage"),
  query: UsageReportQuery,
  detail: Schema.optionalKey(
    Schema.Struct({
      tier: Schema.Literals(["exact", "daily"]),
      cursor: Schema.optionalKey(UsageDetailCursor),
    }),
  ),
});
export type AgentUsageScope = typeof AgentUsageScope.Type;
/** Additive statistics retained per day and price band; unknown counters survive expiry. */
export const UsageStatistics = Schema.Struct({
  tokens: UsageQuantity,
  uncachedInput: UsageQuantity,
  cachedInput: UsageQuantity,
  cacheCreation: UsageQuantity,
  output: UsageQuantity,
  reasoning: UsageQuantity,
  records: UsageQuantity,
  unknownComponents: UsageQuantity,
});
export type UsageStatistics = typeof UsageStatistics.Type;
export const UsageDailyDetail = Schema.Struct({
  meterVersion: Schema.optionalKey(UsageIdentity),
  knownComponents: Schema.optionalKey(Schema.String),
  originId: UsageIdentity,
  day: UsageUtcDay,
  model: Schema.NullOr(UsageIdentity),
  pricingBand: UsageIdentity,
  statistics: UsageStatistics,
  nativeCost: Schema.Record(Schema.String, UsageQuantity),
});
export type UsageDailyDetail = typeof UsageDailyDetail.Type;
export const UsageReport = Schema.Struct({
  provenance: Schema.Literals(["live-responses", "legacy-scanner"]),
  query: UsageReportQuery,
  generation: UsageReportGeneration,
  exactSince: Schema.NullOr(Instant),
  basis: Schema.Literal("recorded-provider-usage-current-owner-and-app"),
  state: Schema.Literals(["unknown", "partial", "complete", "unsupported-exact-boundary"]),
  coverage: Schema.Array(
    Schema.Struct({
      /** Absent when an authorized Mate has not reported a usage origin. */
      originId: Schema.optionalKey(UsageIdentity),
      value: UsageCoverage,
      deleted: Schema.Boolean,
      projectId: Schema.optionalKey(UsageIdentity),
      mateId: Schema.optionalKey(UsageIdentity),
      appId: Schema.optionalKey(Schema.NullOr(UsageIdentity)),
      ownerUserId: Schema.optionalKey(Schema.NullOr(UsageIdentity)),
      label: Schema.optionalKey(UsageIdentity),
      placement: Schema.optionalKey(Schema.Literals(["current", "last-known"])),
    }),
  ).check(Schema.isMaxLength(200)),
  coverageMore: Schema.Boolean,
  recordedSince: Schema.optionalKey(Schema.NullOr(Instant)),
  nativeCosts: Schema.optionalKey(Schema.Record(Schema.String, UsageQuantity)),
  totals: UsageStatistics,
  pricing: Schema.Struct({
    basis: Schema.Literal("automatic-api-equivalent-estimate"),
    revision: UsageIdentity,
    /** Integer USD nanos; null means no usable rates, never a fully priced zero. */
    costUsdNanos: Schema.NullOr(UsageQuantity),
    pricedModelEntries: UsageQuantity,
    unpricedModelEntries: UsageQuantity,
  }),
  groups: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      period: Schema.optionalKey(UsageIdentity),
      provider: Schema.optionalKey(UsageProviderKind),
      model: Schema.optionalKey(Schema.NullOr(UsageIdentity)),
      /** Model groups count participating turns; these counts overlap across models. */
      totals: UsageStatistics,
      nativeCosts: Schema.optionalKey(Schema.Record(Schema.String, UsageQuantity)),
      costUsdNanos: Schema.NullOr(UsageQuantity),
      unpricedModelEntries: Schema.optionalKey(UsageQuantity),
      unpricedTokens: Schema.optionalKey(UsageQuantity),
    }),
  ).check(Schema.isMaxLength(200)),
  groupsMore: Schema.Boolean,
  detail: Schema.Array(Schema.Union([UsageFact, UsageDailyDetail])).check(Schema.isMaxLength(200)),
  next: Schema.NullOr(UsageDetailCursor),
});
export type UsageReport = typeof UsageReport.Type;
