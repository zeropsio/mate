import { assert, describe, it } from "@effect/vitest";
import {
  automatedOpenCodeModel,
  OPENCODE_KEY_PROVIDERS,
} from "@t3tools/shared/openCodeKeyProviders";
import { automaticUsageRates, USAGE_CACHE_RATES_URL } from "./usagePrices.ts";
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

it("Claude context selectors preserve published bands and exact variant prices", () => {
  const base = {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    provider_specific_entry: { fast: 2 },
  };
  const rates = automaticUsageRates({ "claude-opus-5-5": base });
  assert.deepStrictEqual(
    rates.find((row) => row.model === "claude-opus-5-5[1m]" && row.pricingBand === "fast")?.rates,
    rates.find((row) => row.model === "claude-opus-5-5" && row.pricingBand === "fast")?.rates,
  );
  assert.isFalse(rates.some((row) => row.model === "claude-opus-unknown[1m]"));
  assert.isFalse(rates.some((row) => row.model === "claude-opus-5-5[2m]"));
  const exact = automaticUsageRates({
    "claude-opus-5-5": base,
    "claude-opus-5-5[1m]": { ...base, input_cost_per_token: 0.00001 },
  });
  assert.strictEqual(
    exact.find((row) => row.model === "claude-opus-5-5[1m]" && row.pricingBand === "standard")
      ?.rates.uncachedInput,
    "10000",
  );
});
it("a Nebius model without a published cache rate takes models.dev's rate for the same provider and model", () => {
  const litellm = {
    "nebius/zai-org/GLM-5.3": { input_cost_per_token: 0.0000014, output_cost_per_token: 0.0000044 },
    "nebius/acme/tea-model": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
    "nebius/acme/listed-cache": {
      input_cost_per_token: 0.000001,
      output_cost_per_token: 0.000002,
      cache_read_input_token_cost: 0.0000001,
    },
  };
  const modelsDev = {
    nebius: {
      models: {
        "zai-org/GLM-5.3": {
          cost: { input: 1.4, output: 4.4, cache_read: 0.35, cache_write: 1.75 },
        },
        "acme/listed-cache": { cost: { input: 1, output: 2, cache_read: 0.5 } },
      },
    },
  };
  const rates = (model: string) =>
    automaticUsageRates(litellm, modelsDev).find(
      (rate) => rate.model === model && rate.pricingBand === "api-equivalent-baseline",
    )?.rates;
  // $0.35 and $1.75 per million tokens: 350 and 1750 nanodollars per token.
  assert.deepStrictEqual(rates("nebius/zai-org/GLM-5.3"), {
    uncachedInput: "1400",
    output: "4400",
    cachedInput: "350",
    cacheCreation: "1750",
  });
  // A rate LiteLLM publishes wins; a model neither source prices for cache stays unpriced for it.
  assert.strictEqual(rates("nebius/acme/listed-cache")?.cachedInput, "100");
  assert.deepStrictEqual(rates("nebius/acme/tea-model"), {
    uncachedInput: "1000",
    output: "2000",
    cachedInput: null,
    cacheCreation: null,
  });
});
it("a model an automated Mate runs on that LiteLLM does not list is priced from models.dev alone", () => {
  const modelsDev = {
    nebius: {
      models: {
        "acme/nova-coder": { cost: { input: 1.25, output: 4.25, cache_read: 0.125 } },
        "acme/listed": { cost: { input: 9, output: 9 } },
      },
    },
    elsewhere: { models: { "acme/juno": { cost: { input: 1, output: 2 } } } },
  };
  const rates = automaticUsageRates(
    { "nebius/acme/listed": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 } },
    modelsDev,
  );
  const baseline = (model: string) =>
    rates.find((rate) => rate.model === model && rate.pricingBand === "api-equivalent-baseline");
  assert.deepStrictEqual(baseline("nebius/acme/nova-coder")?.rates, {
    uncachedInput: "1250",
    output: "4250",
    cachedInput: "125",
    cacheCreation: null,
  });
  assert.strictEqual(baseline("nebius/acme/nova-coder")?.provenance, USAGE_CACHE_RATES_URL);
  // LiteLLM's published price wins over models.dev's for a model both list.
  assert.strictEqual(baseline("nebius/acme/listed")?.rates.uncachedInput, "1000");
  // Only the providers automated Mates run on: no other models.dev provider is copied in.
  assert.isUndefined(baseline("elsewhere/acme/juno"));
});
it("HQ prices every model an organization may pick for its automated Mates at the price it is offered", () => {
  // models.dev's Nebius rows for the offered models, as published on 2026-10-18.
  const modelsDev = {
    nebius: {
      models: {
        "zai-org/GLM-5.3": { cost: { input: 1.4, output: 4.4, cache_read: 1.4 } },
        "zai-org/GLM-5.3-Flash": { cost: { input: 0.15, output: 0.5, cache_read: 0.15 } },
        "deepseek-ai/DeepSeek-V4-Flash-0731": {
          cost: { input: 0.14, output: 0.28, cache_read: 0.14 },
        },
        "Qwen/Qwen3.5-397B-A17B": {
          cost: { input: 0.6, output: 3.6, cache_read: 0.06, cache_write: 0.75 },
        },
      },
    },
  };
  const rates = automaticUsageRates({}, modelsDev);
  const nanos = (usdPerMillion: number) => String(Math.round(usdPerMillion * 1000));
  const nebius = OPENCODE_KEY_PROVIDERS[0]!;
  for (const offer of nebius.automatedModels) {
    const priced = rates.find(
      (rate) =>
        rate.model === automatedOpenCodeModel(nebius, offer.id) && rate.pricingBand === "standard",
    )?.rates;
    assert.deepInclude(priced, {
      uncachedInput: nanos(offer.usdPerMillion.input),
      cachedInput: nanos(offer.usdPerMillion.cachedInput),
      output: nanos(offer.usdPerMillion.output),
    });
  }
});
