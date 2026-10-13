import { assert, it } from "@effect/vitest";

import {
  appendCustomCodexModels,
  applyPreferredCodexDefaultModel,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "The fastest available responses for latency-sensitive work.",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("prefers sol over terra when both are available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", isCustom: false, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.6-sol");
});

it("ranks qualified Codex models while preserving their wire ids", () => {
  const models = applyPreferredCodexDefaultModel([
    {
      slug: "openai.gpt-5.6-luna",
      name: "Luna",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    { slug: "openai.gpt-5.6-sol", name: "Sol", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(
    models.filter((model) => model.isDefault).map((model) => model.slug),
    ["openai.gpt-5.6-sol"],
  );
});

it("keeps Codex's own default when no preferred model is available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

// Native catalog evidence: codex-cli 0.157.1 on Fen, 2026-10-13.
// model/list omits these limits; models_cache.json records them per model.
it.each([
  { window: 272000, max: 872000, expected: ["272000", "872000"] },
  { window: 500000, max: 872000, expected: ["500000", "872000"] },
  { window: 272000, max: 272000, expected: [] },
  { window: 272000, max: undefined, expected: [] },
])(
  "offers only larger context windows supported by the Codex catalog ($window → $max)",
  ({ window, max, expected }) => {
    const capabilities = mapCodexModelCapabilities(
      {
        defaultReasoningEffort: "low",
        description: "Test",
        displayName: "GPT Test",
        hidden: false,
        id: "gpt-test",
        isDefault: true,
        model: "gpt-test",
        supportedReasoningEfforts: [],
      },
      { context_window: window, ...(max !== undefined ? { max_context_window: max } : {}) },
    );
    const descriptor = capabilities.optionDescriptors?.find(
      (option) => option.id === "contextWindow",
    );
    assert.deepStrictEqual(
      descriptor?.type === "select" ? descriptor.options.map((option) => option.id) : [],
      expected,
    );
    if (expected.length > 0) {
      assert.deepStrictEqual(descriptor, {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        currentValue: String(window),
        options: [
          { id: String(window), label: `${window / 1000}k`, isDefault: true },
          { id: String(max), label: `${max! / 1000}k` },
        ],
      });
    }
  },
);

it("a custom Codex slug never borrows another model's supported context windows", () => {
  const capabilities = {
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select" as const,
        currentValue: "low",
        options: [{ id: "low", label: "Low" }],
      },
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select" as const,
        currentValue: "272000",
        options: [
          { id: "272000", label: "272k" },
          { id: "872000", label: "872k" },
        ],
      },
    ],
  };
  const models = appendCustomCodexModels(
    [{ slug: "gpt-6-luna", name: "GPT-6-Luna", isCustom: false, capabilities }],
    ["custom-model"],
  );
  assert.deepStrictEqual(
    models[1]?.capabilities?.optionDescriptors?.map((option) => option.id),
    ["reasoningEffort"],
  );
});
