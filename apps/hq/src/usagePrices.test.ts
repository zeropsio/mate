import { assert, describe, it } from "@effect/vitest";
import { automaticUsageRates } from "./usagePrices.ts";
describe("automatic HQ usage price coverage", () => {
  it("does not invent rates for missing cache bands or unknown models", () => {
    const rates = automaticUsageRates({
      model: { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
    });
    assert.deepStrictEqual(rates.find((rate) => rate.pricingBand === "standard")?.rates, {
      uncachedInput: "1000",
      output: "2000",
      cachedInput: null,
      cacheCreation: null,
    });
    assert.isFalse(rates.some((rate) => rate.pricingBand === "fast"));
    assert.lengthOf(
      automaticUsageRates({ broken: { input_cost_per_token: -1, output_cost_per_token: 1 } }),
      0,
    );
  });
  it("supports only a proved published fast multiplier and preserves explicit zero prices", () => {
    const rates = automaticUsageRates({
      model: {
        input_cost_per_token: 0,
        output_cost_per_token: 0.000002,
        cache_read_input_token_cost: 0,
        cache_creation_input_token_cost: 0.000001,
        provider_specific_entry: { fast: 2 },
      },
    });
    assert.deepStrictEqual(rates.find((rate) => rate.pricingBand === "fast-cache-5m")?.rates, {
      uncachedInput: "0",
      output: "4000",
      cachedInput: "0",
      cacheCreation: "2000",
    });
  });
});
