/**
 * The "By model" rows: ranked, shared out and valued by the metric the screen's
 * toggle selects, like the provider rows above them.
 *
 * @module usageModelRows
 */
import type { UsageProviderKind } from "@t3tools/contracts";
import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { isModelCostUnknown, type ModelTotals } from "@t3tools/shared/usageMerge";

import type { UsageChartMetric } from "./usageChartData";

export interface UsageModelRow {
  readonly key: string;
  readonly provider: UsageProviderKind;
  readonly name: string;
  readonly detail: string;
  readonly value: string;
}

export function usageModelRows(
  models: readonly ModelTotals[],
  metric: UsageChartMetric,
): readonly UsageModelRow[] {
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023 method.
  const ordered = [...models].sort((a, b) =>
    metric === "cost"
      ? b.costUsd - a.costUsd || b.totalTokens - a.totalTokens
      : b.totalTokens - a.totalTokens || b.costUsd - a.costUsd,
  );
  return ordered.map((model) => {
    const unpriced = isModelCostUnknown(model);
    return {
      key: `${model.provider}:${model.model}`,
      provider: model.provider,
      name: model.model,
      detail:
        metric === "tokens"
          ? `${formatPercent(model.tokenShare)} of tokens · ${unpriced ? "no known rates" : formatUsd(model.costUsd)}`
          : unpriced
            ? `no known rates · ${formatTokens(model.totalTokens)} tokens`
            : `${formatPercent(model.costShare)} of cost · ${formatTokens(model.totalTokens)} tokens`,
      value:
        metric === "tokens"
          ? formatTokens(model.totalTokens)
          : unpriced
            ? "Unpriced"
            : formatUsd(model.costUsd),
    };
  });
}
