import type { UsageFact, UsageStatistics } from "@t3tools/contracts";

export const zeroUsage = (): UsageStatistics => ({
  tokens: "0",
  uncachedInput: "0",
  cachedInput: "0",
  cacheCreation: "0",
  output: "0",
  reasoning: "0",
  records: "0",
  unknownComponents: "0",
  provisional: "0",
});
export interface UsageContribution {
  readonly day: string;
  readonly model: string;
  readonly pricingBand: string;
  readonly meterVersion: string;
  readonly knownComponents: string;
  readonly statistics: UsageStatistics;
  /** Currency, basis and decimal scale remain separate; never sum unlike native costs. */
  readonly nativeCost: Readonly<Record<string, string>>;
}
export const contributionOf = (fact: UsageFact): UsageContribution | null => {
  if (fact.state === "retracted") return null;
  const parts = [
    fact.components.uncachedInput,
    fact.components.cachedInput,
    fact.components.cacheCreation,
    fact.components.output,
  ];
  const knownSplit = parts.reduce<bigint>((sum, part) => sum + BigInt(part ?? "0"), 0n);
  const tokens =
    fact.components.inclusiveTotal === null ? knownSplit : BigInt(fact.components.inclusiveTotal);
  if (tokens < knownSplit || tokens >= 10n ** 38n) throw new Error("Invalid usage total");
  return {
    // Intervals and undated facts are explicitly unallocated, never assigned to the last sample.
    day: fact.time.kind === "instant" ? fact.time.at.slice(0, 10) : "unallocated",
    model: fact.model ?? "",
    pricingBand: fact.pricingBand,
    meterVersion: fact.meterVersion,
    knownComponents: parts.map((part) => (part === null ? "0" : "1")).join(""),
    statistics: {
      tokens: String(tokens),
      uncachedInput: fact.components.uncachedInput ?? "0",
      cachedInput: fact.components.cachedInput ?? "0",
      cacheCreation: fact.components.cacheCreation ?? "0",
      output: fact.components.output ?? "0",
      reasoning: fact.components.reasoning ?? "0",
      records: "1",
      unknownComponents: parts.some((part) => part === null) ? "1" : "0",
      provisional: fact.state === "provisional" ? "1" : "0",
    },
    nativeCost:
      fact.nativeCost === null
        ? {}
        : {
            [JSON.stringify([
              fact.nativeCost.currency,
              fact.nativeCost.basis,
              fact.nativeCost.scale,
            ])]: fact.nativeCost.amount,
          },
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
