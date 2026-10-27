import type { UsageTokenTotals } from "@t3tools/contracts";
import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import {
  isModelCostUnknown,
  type CategoryCost,
  type MergedUsage,
  type ModelTotals,
  type SpeedCost,
} from "@t3tools/shared/usageMerge";

import type { ShareSegment } from "./UsageShareBar";

export function sortModelsByTokens(models: readonly ModelTotals[]) {
  return models.toSorted(
    (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
  );
}

/**
 * A model's share of the selected metric, or `null` for a cost share of an
 * unknown cost. An unpriced model still has a real token share.
 */
export function modelShare(model: ModelTotals, metric: "cost" | "tokens"): number | null {
  if (metric === "tokens") return model.tokenShare;
  return isModelCostUnknown(model) ? null : model.costShare;
}

/**
 * Share of a model's input read from cache, or `null` without input. Cache
 * writes count as misses: that input was processed in full.
 */
export function cacheHitRate({ tokens }: ModelTotals): number | null {
  const input = tokens.uncachedInputTokens + tokens.cachedInputTokens + tokens.cacheCreationTokens;
  return input === 0 ? null : tokens.cachedInputTokens / input;
}

/** Effective USD per million priced tokens, or `null` when none were priced. */
export function costPerMillionTokens(model: ModelTotals): number | null {
  const pricedTokens = model.totalTokens - model.unpricedTokens;
  return pricedTokens <= 0 || isModelCostUnknown(model)
    ? null
    : (model.costUsd / pricedTokens) * 1_000_000;
}

/** A neutral step between background and foreground, so mixes never borrow a provider's color. */
const ink = (percent: number) =>
  `color-mix(in oklab, var(--foreground) ${percent}%, var(--background))`;

/** Adjacent segments stay above the 15 ΔE separation floor in both themes. */
const TYPE_COLORS = {
  input: ink(60),
  cacheRead: ink(30),
  cacheWrite: ink(72),
  output: ink(100),
  other: ink(44),
};

export function costTypeSegments(cost: CategoryCost): readonly ShareSegment[] {
  return [
    { label: "Uncached input", value: cost.input, color: TYPE_COLORS.input },
    { label: "Cached input", value: cost.cacheRead, color: TYPE_COLORS.cacheRead },
    { label: "Cache writes", value: cost.cacheWrite, color: TYPE_COLORS.cacheWrite },
    { label: "Output", value: cost.output, color: TYPE_COLORS.output },
    // Reported cost with no rates to split it, or from older servers. Below a
    // cent it is rounding, not usage.
    { label: "Other", value: cost.unsplit >= 0.005 ? cost.unsplit : 0, color: TYPE_COLORS.other },
  ];
}

export function tokenTypeSegments(
  tokens: Omit<UsageTokenTotals, "reasoningTokens">,
): readonly ShareSegment[] {
  return [
    { label: "Uncached input", value: tokens.uncachedInputTokens, color: TYPE_COLORS.input },
    { label: "Cached input", value: tokens.cachedInputTokens, color: TYPE_COLORS.cacheRead },
    { label: "Cache writes", value: tokens.cacheCreationTokens, color: TYPE_COLORS.cacheWrite },
    { label: "Output", value: tokens.outputTokens, color: TYPE_COLORS.output },
  ];
}

/** Speeds are ordered by price, so they brighten from standard to ultrafast. */
export function speedCostSegments(cost: SpeedCost): readonly ShareSegment[] {
  return [
    { label: "Standard", value: cost.standard, color: ink(34) },
    { label: "Fast", value: cost.fast, color: ink(66) },
    { label: "Ultrafast", value: cost.ultrafast, color: ink(100) },
  ];
}

export interface UsageTotal {
  readonly label: string;
  readonly value: string;
  /** The line under the value, always present so the row keeps one height. */
  readonly detail: string;
}

/**
 * The Totals row: processed tokens, each kind of token with its cost (or its
 * share of the tokens when tokens are chosen), cache savings, and fast mode
 * when some requests ran fast. Cost no rates could split stays only in the
 * processed total.
 */
export function usageTotals(
  usage: Pick<
    MergedUsage,
    | "costUsd"
    | "uncachedInputTokens"
    | "cachedInputTokens"
    | "cacheCreationTokens"
    | "outputTokens"
    | "totalTokens"
    | "categoryCost"
    | "speedCost"
  > & { readonly costQuality: Pick<MergedUsage["costQuality"], "cacheSavingsUsd"> },
  metric: "cost" | "tokens",
): readonly UsageTotal[] {
  const kind = (label: string, tokens: number, costUsd: number): UsageTotal => ({
    label,
    value: formatTokens(tokens),
    detail:
      metric === "cost"
        ? formatUsd(costUsd)
        : `${formatPercent(usage.totalTokens === 0 ? 0 : tokens / usage.totalTokens)} of tokens`,
  });
  const input = usage.uncachedInputTokens + usage.cachedInputTokens + usage.cacheCreationTokens;
  const rows: UsageTotal[] = [
    {
      label: "Processed tokens",
      value: formatTokens(usage.totalTokens),
      detail: `${formatUsd(usage.costUsd)} in all`,
    },
    kind("Uncached input", usage.uncachedInputTokens, usage.categoryCost.input),
    kind("Cached input", usage.cachedInputTokens, usage.categoryCost.cacheRead),
    kind("Cache writes", usage.cacheCreationTokens, usage.categoryCost.cacheWrite),
    kind("Output", usage.outputTokens, usage.categoryCost.output),
    {
      label: "Estimated cache savings",
      value: formatUsd(usage.costQuality.cacheSavingsUsd),
      detail: `${formatPercent(input === 0 ? 0 : usage.cachedInputTokens / input)} cache hit`,
    },
  ];
  const fastUsd = usage.speedCost.fast + usage.speedCost.ultrafast;
  if (fastUsd > 0) {
    rows.push({
      label: "Fast mode",
      value: formatUsd(fastUsd),
      detail: `${formatUsd(usage.speedCost.premium)} over standard`,
    });
  }
  return rows;
}
