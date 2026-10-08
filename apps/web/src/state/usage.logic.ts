import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { UsageReport, UsageReportQuery, UsageSummaryInput } from "@t3tools/contracts";
import type { UsageScope } from "../components/usage/usageDimensions";

export function usageReportQuery(
  input: UsageSummaryInput,
  scope: UsageScope,
  provenance: NonNullable<UsageReportQuery["provenance"]> = "live-responses",
): UsageReportQuery {
  const exact = input.resolution === "hour" && provenance === "live-responses";
  return {
    since:
      exact && input.sinceTime !== undefined ? input.sinceTime : `${input.sinceDay}T00:00:00.000Z`,
    until:
      exact && input.untilTime !== undefined
        ? input.untilTime
        : new Date(Date.parse(`${input.untilDay}T00:00:00.000Z`) + 86400000).toISOString(),
    mode: exact ? "exact" : "utc-days",
    provenance,
    timezone: input.timeZone,
    appId: scope.project ?? null,
    mateId: scope.mate ?? null,
    ownerUserId: scope.person ?? null,
    projectId: null,
    provider: null,
    model: null,
    groupBy: "mate",
  };
}
export function usageReportTotals(report: UsageReport | null) {
  const records = Number(report?.totals.records ?? 0);
  const priced = Number(report?.pricing.pricedModelEntries ?? 0);
  const unpriced = Number(report?.pricing.unpricedModelEntries ?? 0);
  const modelEntries = priced + unpriced;
  return {
    costUsd: Number(report?.pricing.costUsdNanos ?? 0) / 1e9,
    uncachedInputTokens: Number(report?.totals.uncachedInput ?? 0),
    cachedInputTokens: Number(report?.totals.cachedInput ?? 0),
    cacheCreationTokens: Number(report?.totals.cacheCreation ?? 0),
    outputTokens: Number(report?.totals.output ?? 0),
    reasoningTokens: Number(report?.totals.reasoning ?? 0),
    totalTokens: Number(report?.totals.tokens ?? 0),
    records,
    sessions: records,
    costQuality: {
      providerReportedShare: 0,
      modelPricedShare: modelEntries > 0 ? priced / modelEntries : 0,
      unpricedShare:
        report?.pricing.costUsdNanos === null ? 1 : modelEntries > 0 ? unpriced / modelEntries : 0,
      cacheSavingsUsd: 0,
    },
  };
}

const nativeIdentity = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Tuple([
      Schema.String,
      Schema.String,
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 18 })),
    ]),
  ),
);
/** A native charge retains its currency, basis and precision; it never prices tokens. */
export function usageNativeCosts(
  report: UsageReport | null,
): readonly { readonly key: string; readonly value: string }[] {
  return Object.entries(report?.nativeCosts ?? {}).flatMap(([key, quantity]) => {
    const identity = Option.getOrNull(nativeIdentity(key));
    if (identity === null) return [];
    const [currency, basis, scale] = identity;
    const padded = quantity.padStart(scale + 1, "0");
    const decimal =
      scale === 0
        ? padded
        : `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/u, "");
    return [{ key, value: `${currency} ${decimal} · ${basis}` }];
  });
}
