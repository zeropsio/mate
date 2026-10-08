import { describe, expect, it } from "vite-plus/test";

import {
  parseUsageAliasForm,
  parseUsagePriceForm,
  previewAliasSuggestions,
  usagePriceForm,
} from "./usagePriceForm.ts";

describe("model price entry", () => {
  it("preserves exact model IDs and fractional rates", () => {
    expect(
      parseUsagePriceForm({
        ...usagePriceForm(),
        model: "  vendor/Example-Model  ",
        inputCostPerMillionTokens: "2.5",
        outputCostPerMillionTokens: "10",
      }),
    ).toEqual({
      model: "vendor/Example-Model",
      price: { inputCostPerMillionTokens: 2.5, outputCostPerMillionTokens: 10 },
    });
  });

  it("keeps free cache tokens distinct from blank cache prices", () => {
    const parsed = parseUsagePriceForm({
      ...usagePriceForm(),
      model: "example-model",
      inputCostPerMillionTokens: "2",
      outputCostPerMillionTokens: "8",
      cacheReadCostPerMillionTokens: "0",
      cacheWriteCostPerMillionTokens: " ",
    });
    expect(parsed?.price).toEqual({
      inputCostPerMillionTokens: 2,
      outputCostPerMillionTokens: 8,
      cacheReadCostPerMillionTokens: 0,
    });
  });

  it("preserves all prices when editing, including small fractional prices", () => {
    const price = {
      inputCostPerMillionTokens: 0,
      outputCostPerMillionTokens: 8,
      cacheReadCostPerMillionTokens: 0.0000001,
      cacheWriteCostPerMillionTokens: 3.5,
    };
    expect(parseUsagePriceForm(usagePriceForm("example-model", price))).toEqual({
      model: "example-model",
      price,
    });
  });

  it.each(["", " ", "-1", "Infinity", "NaN", "1e999", "$2", "0x10"])(
    "rejects invalid required prices: %j",
    (inputCostPerMillionTokens) => {
      expect(
        parseUsagePriceForm({
          ...usagePriceForm("example-model", {
            inputCostPerMillionTokens: 2,
            outputCostPerMillionTokens: 8,
          }),
          inputCostPerMillionTokens,
        }),
      ).toBeNull();
    },
  );

  it("rejects invalid optional rates and missing model IDs", () => {
    const form = usagePriceForm("example-model", {
      inputCostPerMillionTokens: 2,
      outputCostPerMillionTokens: 8,
    });
    expect(parseUsagePriceForm({ ...form, cacheReadCostPerMillionTokens: "-1" })).toBeNull();
    expect(parseUsagePriceForm({ ...form, cacheWriteCostPerMillionTokens: "invalid" })).toBeNull();
    expect(parseUsagePriceForm({ ...form, model: " " })).toBeNull();
  });
});

describe("parseUsageAliasForm", () => {
  it.each([
    {
      sentence: "maps a model to the model it counts as",
      form: { model: " a ", target: " b " },
      parsed: { model: "a", target: "b" },
    },
    { sentence: "needs both model IDs", form: { model: "a", target: "  " }, parsed: null },
    { sentence: "does not map a model to itself", form: { model: "a", target: "a" }, parsed: null },
  ])("$sentence", ({ form, parsed }) => {
    expect(parseUsageAliasForm(form)).toEqual(parsed);
  });
});

describe("previewAliasSuggestions", () => {
  it("offers to count a preview model as its released model when both appear in usage", () => {
    expect(
      previewAliasSuggestions(
        [
          "claude-sonnet-4-5",
          "claude-sonnet-4-5-preview",
          "gpt-6-preview-2026-09-01",
          "gpt-6",
          "o9-preview",
        ],
        {},
      ),
    ).toEqual([
      { model: "claude-sonnet-4-5-preview", target: "claude-sonnet-4-5" },
      { model: "gpt-6-preview-2026-09-01", target: "gpt-6" },
    ]);
  });

  it("does not offer a model that is already mapped", () => {
    expect(previewAliasSuggestions(["a", "a-preview"], { "a-preview": "a" })).toEqual([]);
  });
});
