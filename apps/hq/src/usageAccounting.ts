import type {
  UsageFact,
  UsageStatistics,
  UsageNativeCost,
  UsageModelLine,
} from "@t3tools/contracts";

export const zeroUsage = (): UsageStatistics => ({
  tokens: "0",
  uncachedInput: "0",
  cachedInput: "0",
  cacheCreation: "0",
  output: "0",
  reasoning: "0",
  records: "0",
  unknownComponents: "0",
});
export interface UsageHeadlineContribution {
  readonly day: string;
  readonly meterVersion: string;
  readonly statistics: UsageStatistics;
  readonly nativeCost: Readonly<Record<string, string>>;
}
export interface UsageModelContribution extends UsageHeadlineContribution {
  readonly model: string;
  readonly pricingBand: string;
  readonly knownComponents: string;
}
export interface UsageContribution {
  readonly headline: UsageHeadlineContribution;
  readonly models: ReadonlyArray<UsageModelContribution>;
}
const nativeCostOf = (cost: UsageNativeCost | null): Readonly<Record<string, string>> =>
  cost === null ? {} : { [JSON.stringify([cost.currency, cost.basis, cost.scale])]: cost.amount };
const statisticsOf = (line: UsageModelLine): UsageStatistics => {
  const parts = [
    line.components.uncachedInput,
    line.components.cachedInput,
    line.components.cacheCreation,
    line.components.output,
  ];
  const knownSplit = parts.reduce<bigint>((sum, part) => sum + BigInt(part ?? "0"), 0n);
  const tokens =
    line.components.inclusiveTotal === null ? knownSplit : BigInt(line.components.inclusiveTotal);
  if (tokens < knownSplit || tokens >= 10n ** 38n) throw new Error("Invalid usage total");
  return {
    tokens: String(tokens),
    uncachedInput: line.components.uncachedInput ?? "0",
    cachedInput: line.components.cachedInput ?? "0",
    cacheCreation: line.components.cacheCreation ?? "0",
    output: line.components.output ?? "0",
    reasoning: line.components.reasoning ?? "0",
    records: "1",
    unknownComponents: parts.some((part) => part === null) ? "1" : "0",
  };
};
export const contributionOf = (fact: UsageFact): UsageContribution => {
  if (new Set(fact.models.map((line) => line.model)).size !== fact.models.length)
    throw new Error("Expected unique model lines for one turn");
  const models = fact.models.map((line): UsageModelContribution => ({
    day: fact.time.at.slice(0, 10),
    meterVersion: fact.meterVersion,
    model: line.model ?? "",
    pricingBand: "api-equivalent-baseline",
    knownComponents: [
      line.components.uncachedInput,
      line.components.cachedInput,
      line.components.cacheCreation,
      line.components.output,
    ]
      .map((part) => (part === null ? "0" : "1"))
      .join(""),
    statistics: statisticsOf(line),
    nativeCost: nativeCostOf(line.nativeCost),
  }));
  const sum = models.reduce(
    (statistics, line) => addUsage(statistics, line.statistics),
    zeroUsage(),
  );
  return {
    headline: {
      day: fact.time.at.slice(0, 10),
      meterVersion: fact.meterVersion,
      statistics: {
        ...sum,
        records: "1",
        unknownComponents: sum.unknownComponents === "0" ? "0" : "1",
      },
      nativeCost: nativeCostOf(fact.nativeCost),
    },
    models,
  };
};
export const addUsage = (a: UsageStatistics, b: UsageStatistics): UsageStatistics =>
  Object.fromEntries(
    Object.keys(a).map((key) => {
      const field = key as keyof UsageStatistics;
      const amount = BigInt(a[field]) + BigInt(b[field]);
      if (amount >= 10n ** 38n) throw new Error("Usage overflow");
      return [field, String(amount)];
    }),
  ) as UsageStatistics;
