/** HQ reports through the account store; this view never opens or reads a Mate. */
import { useMemo } from "react";
import { Atom } from "effect/reactivity";
import { agentUsage, agentUsageOwner, type AgentUsageRead } from "@t3tools/client-runtime/data";
import {
  EnvironmentId,
  type UsageReport,
  type UsageReportQuery,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import type { MergedUsage, ModelTotals, ProviderTotals } from "@t3tools/shared/usageMerge";
import {
  useAccountDataOptional,
  useDetailDemand,
  useProjection,
} from "../zerops/ZeropsAccountData";
import type { UsageScope } from "../components/usage/usageDimensions";
import { usageReportQuery, usageReportTotals } from "./usage.logic";

const UNREAD = Atom.make<AgentUsageRead>({ kind: "reading" });
function useReport(query: UsageReportQuery, enabled: boolean) {
  const account = useAccountDataOptional();
  const owner = agentUsageOwner(query);
  useDetailDemand("agentUsage", undefined, enabled ? owner : null);
  const result = useProjection(
    agentUsage,
    !enabled || account?.orgId == null ? null : { orgId: account.orgId, owner },
    UNREAD,
  );
  return { result, refresh: () => account?.retryDetail({ family: "agentUsage", ownerId: owner }) };
}
const reportOf = (read: AgentUsageRead) => (read.kind === "read" ? read.report : null);
const sameGeneration = (left: UsageReport | null, right: UsageReport | null) =>
  left !== null &&
  right !== null &&
  left.generation.accounting === right.generation.accounting &&
  left.generation.access === right.generation.access &&
  left.generation.pricing === right.generation.pricing;
const matchedReport = (report: UsageReport | null, read: AgentUsageRead) =>
  sameGeneration(report, reportOf(read)) ? reportOf(read) : null;
export function useAgentUsage(
  input: UsageSummaryInput,
  scope: UsageScope,
  enabled = true,
  provenance: NonNullable<UsageReportQuery["provenance"]> = "live-responses",
  model?: Pick<ModelTotals, "provider" | "model">,
) {
  const query = {
    ...usageReportQuery(input, scope, provenance),
    ...(model === undefined ? {} : { provider: model.provider, model: model.model }),
  };
  const primary = useReport(query, enabled);
  const overall = useReport({ ...query, appId: null, mateId: null, ownerUserId: null }, enabled);
  const models = useReport({ ...query, groupBy: "model" }, enabled);
  const providers = useReport({ ...query, groupBy: "provider" }, enabled);
  const periods = useReport(
    { ...query, groupBy: input.resolution === "hour" ? "hour" : "day" },
    enabled,
  );
  const report = reportOf(primary.result);
  const merged = useMemo(
    () =>
      usageReportView(
        report,
        matchedReport(report, models.result),
        matchedReport(report, providers.result),
        matchedReport(report, periods.result),
        input.resolution === "hour",
      ),
    [report, models.result, providers.result, periods.result, input.resolution],
  );
  return {
    merged,
    overall: useMemo(() => usageReportView(reportOf(overall.result)), [overall.result]),
    report,
    overallReport: reportOf(overall.result),
    detailPending: [models.result, providers.result, periods.result].some(
      (read) =>
        read.kind === "reading" || (read.kind === "read" && !sameGeneration(report, read.report)),
    ),
    detailUnavailable: [models.result, providers.result, periods.result].some(
      (read) => read.kind === "unavailable",
    ),
    read: primary.result,
    stale: primary.result.kind === "read" && primary.result.stale,
    refresh: () => {
      primary.refresh();
      overall.refresh();
      models.refresh();
      providers.refresh();
      periods.refresh();
    },
  };
}

/** Display aggregates only; permanent identity and deduplication remain at HQ. */
export function usageReportView(
  report: UsageReport | null,
  models: UsageReport | null = null,
  providers: UsageReport | null = null,
  periods: UsageReport | null = null,
  hourly = false,
): MergedUsage {
  const totals = usageReportTotals(report);
  const partial = (row: UsageReport["groups"][number]) =>
    row.unpricedModelEntries === undefined
      ? totals.costQuality.unpricedShare > 0
      : Number(row.unpricedModelEntries) > 0;
  const providerRows: ProviderTotals[] = (providers?.groups ?? []).flatMap((row) =>
    row.provider == null
      ? []
      : [
          {
            provider: row.provider,
            costKnown: row.costUsdNanos !== null,
            costPartial: partial(row),
            costUsd: Number(row.costUsdNanos ?? 0) / 1e9,
            totalTokens: Number(row.totals.tokens),
            records: Number(row.totals.records),
            sessions: Number(row.totals.records),
            costShare:
              totals.costUsd > 0 ? Number(row.costUsdNanos ?? 0) / 1e9 / totals.costUsd : 0,
            tokenShare: totals.totalTokens > 0 ? Number(row.totals.tokens) / totals.totalTokens : 0,
          },
        ],
  );
  const modelRows: ModelTotals[] = (models?.groups ?? [])
    .flatMap((row) =>
      row.provider == null
        ? []
        : [
            {
              provider: row.provider,
              model: row.model ?? "Unknown model",
              costKnown: row.costUsdNanos !== null,
              costPartial: partial(row),
              costUsd: Number(row.costUsdNanos ?? 0) / 1e9,
              totalTokens: Number(row.totals.tokens),
              tokens: {
                totalTokens: Number(row.totals.tokens),
                uncachedInputTokens: Number(row.totals.uncachedInput),
                cachedInputTokens: Number(row.totals.cachedInput),
                cacheCreationTokens: Number(row.totals.cacheCreation),
                outputTokens: Number(row.totals.output),
                reasoningTokens: Number(row.totals.reasoning),
              },
              unpricedTokens: Number(
                row.unpricedTokens ?? (row.costUsdNanos === null ? row.totals.tokens : 0),
              ),
              records: Number(row.totals.records),
              unpricedRecords: Number(
                row.unpricedModelEntries ?? (row.costUsdNanos === null ? row.totals.records : 0),
              ),
              costShare:
                totals.costUsd > 0 ? Number(row.costUsdNanos ?? 0) / 1e9 / totals.costUsd : 0,
              tokenShare:
                totals.totalTokens > 0 ? Number(row.totals.tokens) / totals.totalTokens : 0,
            },
          ],
    )
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
  const buckets = new Map<
    string,
    {
      day: string;
      hourStart: string;
      costUsd: number;
      costKnown: boolean;
      costPartial: boolean;
      totalTokens: number;
      byProvider: Map<
        ProviderTotals["provider"],
        { costUsd: number; totalTokens: number; costKnown: boolean; costPartial: boolean }
      >;
    }
  >();
  for (const row of periods?.groups ?? []) {
    if (row.period === undefined || row.provider === undefined) continue;
    const bucket = buckets.get(row.period) ?? {
      day: row.period.slice(0, 10),
      hourStart: row.period,
      costUsd: 0,
      costKnown: false,
      costPartial: false,
      totalTokens: 0,
      byProvider: new Map(),
    };
    const costUsd = Number(row.costUsdNanos ?? 0) / 1e9;
    const totalTokens = Number(row.totals.tokens);
    bucket.costUsd += costUsd;
    bucket.costKnown ||= row.costUsdNanos !== null;
    bucket.costPartial ||= partial(row);
    bucket.totalTokens += totalTokens;
    bucket.byProvider.set(row.provider, {
      costUsd,
      totalTokens,
      costKnown: row.costUsdNanos !== null,
      costPartial: partial(row),
    });
    buckets.set(row.period, bucket);
  }
  const periodRows = [...buckets.values()].sort((a, b) => a.hourStart.localeCompare(b.hourStart));
  const byEnvironment = (report?.groups ?? []).map((row) => ({
    environmentId: EnvironmentId.make(row.key),
    costKnown: row.costUsdNanos !== null,
    costPartial: partial(row),
    costUsd: Number(row.costUsdNanos ?? 0) / 1e9,
    totalTokens: Number(row.totals.tokens),
    records: Number(row.totals.records),
    unpricedRecords: Number(
      row.unpricedModelEntries ?? (row.costUsdNanos === null ? row.totals.records : 0),
    ),
    sessions: Number(row.totals.records),
    costShare: totals.costUsd > 0 ? Number(row.costUsdNanos ?? 0) / 1e9 / totals.costUsd : 0,
    tokenShare: totals.totalTokens > 0 ? Number(row.totals.tokens) / totals.totalTokens : 0,
    providers: [],
  }));
  return {
    ...totals,
    categoryCost: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, unsplit: totals.costUsd },
    speedCost: { standard: 0, fast: 0, ultrafast: 0, premium: 0 },
    models: modelRows,
    providers: providerRows,
    daily: hourly ? [] : periodRows.map(({ hourStart: _hourStart, ...day }) => day),
    hourly: hourly ? periodRows : [],
    byEnvironment,
    contributingEnvironments: byEnvironment.map((row) => row.environmentId),
    duplicateSources: [],
    contractMismatches: [],
  };
}
