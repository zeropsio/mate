import type { ModelTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import {
  cacheHitRate,
  costPerMillionTokens,
  modelShare,
  sortModelsByTokens,
  usageTotals,
} from "./usageBreakdown";

const model = (
  name: string,
  totalTokens: number,
  costUsd: number,
  overrides: Partial<ModelTotals> = {},
): ModelTotals => ({
  model: name,
  provider: "codex",
  costUsd,
  totalTokens,
  tokens: {
    uncachedInputTokens: totalTokens,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  },
  records: 1,
  unpricedRecords: 0,
  unpricedTokens: 0,
  costShare: 0,
  tokenShare: 0,
  ...overrides,
});

describe("sortModelsByTokens", () => {
  it("sorts by tokens, breaks ties by cost, and leaves the input alone", () => {
    const models = [
      model("lower-cost", 100, 1),
      model("more-tokens", 200, 2),
      model("higher-cost", 100, 3),
    ];

    expect(sortModelsByTokens(models).map((item) => item.model)).toEqual([
      "more-tokens",
      "higher-cost",
      "lower-cost",
    ]);
    expect(models.map((item) => item.model)).toEqual(["lower-cost", "more-tokens", "higher-cost"]);
  });
});

describe("modelShare", () => {
  it("follows the selected metric", () => {
    const priced = model("priced", 100, 9, { costShare: 0.9, tokenShare: 0.25 });

    expect(modelShare(priced, "cost")).toBe(0.9);
    expect(modelShare(priced, "tokens")).toBe(0.25);
  });

  it("has no cost share for an unknown cost but keeps its token share", () => {
    const unpriced = model("unpriced", 300, 0, {
      unpricedRecords: 1,
      tokenShare: 0.75,
    });

    expect(modelShare(unpriced, "cost")).toBeNull();
    expect(modelShare(unpriced, "tokens")).toBe(0.75);
  });
});

describe("model rates", () => {
  it("counts cache writes as misses and leaves unpriced tokens out of $/1M", () => {
    const mixed = model("mixed", 4_000_000, 6, {
      tokens: {
        uncachedInputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        cacheCreationTokens: 2_000_000,
        outputTokens: 0,
        reasoningTokens: 0,
      },
      records: 4,
      unpricedRecords: 1,
      unpricedTokens: 1_000_000,
    });

    expect(cacheHitRate(mixed)).toBe(0.25);
    expect(costPerMillionTokens(mixed)).toBe(2);
    expect(costPerMillionTokens({ ...mixed, unpricedRecords: 4 })).toBeNull();
  });
});

describe("usageTotals", () => {
  const totals = {
    costUsd: 20,
    uncachedInputTokens: 1_000,
    cachedInputTokens: 6_000,
    cacheCreationTokens: 1_000,
    outputTokens: 2_000,
    totalTokens: 10_000,
    costQuality: { cacheSavingsUsd: 3 },
    categoryCost: { input: 2, cacheRead: 1, cacheWrite: 4, output: 9, unsplit: 4 },
    speedCost: { standard: 20, fast: 0, ultrafast: 0, premium: 0 },
  };
  const row = (rows: ReturnType<typeof usageTotals>, label: string) =>
    rows.find((entry) => entry.label === label);

  it("gives each kind of token its cost, and leaves cost no rates could split out of them", () => {
    const rows = usageTotals(totals, "cost");

    expect(rows.map(({ label, value, detail }) => [label, value, detail])).toEqual([
      ["Processed tokens", "10K", "$20.00 in all"],
      ["Uncached input", "1K", "$2.00"],
      ["Cached input", "6K", "$1.00"],
      ["Cache writes", "1K", "$4.00"],
      ["Output", "2K", "$9.00"],
      ["Estimated cache savings", "$3.00", "75.0% cache hit"],
    ]);
  });

  it("with tokens chosen, gives each kind of token its share of the tokens", () => {
    const rows = usageTotals(totals, "tokens");

    expect(row(rows, "Cached input")?.detail).toBe("60.0% of tokens");
    expect(row(rows, "Output")?.detail).toBe("20.0% of tokens");
  });

  it("lists fast mode only when some requests ran fast, with what it cost over standard", () => {
    expect(row(usageTotals(totals, "cost"), "Fast mode")).toBeUndefined();

    const fast = usageTotals(
      { ...totals, speedCost: { standard: 14, fast: 4, ultrafast: 2, premium: 3 } },
      "cost",
    );
    expect(row(fast, "Fast mode")).toMatchObject({ value: "$6.00", detail: "$3.00 over standard" });
  });
});
