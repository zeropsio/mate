import type { ModelTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import { usageModelRows } from "./usageModelRows";

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

describe("usageModelRows", () => {
  const cheapBusy = model("cheap-busy", 3_000, 1, { costShare: 0.1, tokenShare: 0.75 });
  const dearQuiet = model("dear-quiet", 1_000, 9, { costShare: 0.9, tokenShare: 0.25 });

  it("ranks models by the selected metric", () => {
    expect(usageModelRows([cheapBusy, dearQuiet], "cost").map((row) => row.name)).toEqual([
      "dear-quiet",
      "cheap-busy",
    ]);
    expect(usageModelRows([dearQuiet, cheapBusy], "tokens").map((row) => row.name)).toEqual([
      "cheap-busy",
      "dear-quiet",
    ]);
  });

  it("shows each model's share of the selected metric", () => {
    const [cost] = usageModelRows([dearQuiet], "cost");
    const [tokens] = usageModelRows([dearQuiet], "tokens");

    expect(cost).toMatchObject({ detail: "90.0% of cost · 1K tokens", value: "$9.00" });
    expect(tokens).toMatchObject({ detail: "25.0% of tokens · $9.00", value: "1K" });
  });

  it("keeps an unpriced model's token share while its cost stays unknown", () => {
    const unpriced = model("unpriced", 3_000, 0, { unpricedRecords: 1, tokenShare: 0.75 });

    expect(usageModelRows([unpriced], "cost")[0]).toMatchObject({
      detail: "no known rates · 3K tokens",
      value: "Unpriced",
    });
    expect(usageModelRows([unpriced], "tokens")[0]).toMatchObject({
      detail: "75.0% of tokens · no known rates",
      value: "3K",
    });
  });
});
