import { describe, expect, it } from "@effect/vitest";
import {
  type ModelCapabilities,
  type ModelSelection,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import {
  EFFORT_OPTION_IDS,
  preferredEffort,
  selectionWithPreferredEffort,
  withPreferredEffort,
} from "./zeropsEffort.ts";

const ids = (...values: string[]) => values.map((id) => ({ id }));

describe("preferredEffort", () => {
  // What each driver really reports (manifest, the live `codex app-server`
  // model list, the Grok/Cursor ACP fixtures, OpenCode's variant sets).
  const cases: ReadonlyArray<readonly [string, ReadonlyArray<{ id: string }>, string | null]> = [
    [
      "Claude Opus 5.5 offers xhigh",
      ids("low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"),
      "xhigh",
    ],
    ["Claude Opus 4.6 stops at max", ids("low", "medium", "high", "max", "ultrathink"), "high"],
    ["Claude Opus 4.5", ids("low", "medium", "high", "max"), "high"],
    ["Codex gpt-5.5", ids("low", "medium", "high", "xhigh"), "xhigh"],
    ["an older Codex model", ids("minimal", "low", "medium", "high"), "high"],
    ["Grok reports the ladder top first", ids("xhigh", "high", "low"), "xhigh"],
    ["the order a driver reports never ranks", ids("high", "medium", "low"), "high"],
    ["Cursor without xhigh", ids("low", "medium", "high", "max"), "high"],
    ["OpenCode on Anthropic", ids("high", "max"), "high"],
    ["OpenCode on Google", ids("low", "high"), "high"],
    ["OpenCode's synthesized set", ids("low", "medium", "high", "xhigh"), "xhigh"],
    ["only max is never picked", ids("max"), null],
    ["names off the ladder are not judged", ids("fast", "thinking"), null],
    ["no options", [], null],
  ];
  it.each(cases)("%s", (_name, options, expected) => {
    expect(preferredEffort(options)).toBe(expected);
  });
});

const caps = (descriptorId: string, ...options: string[]): ModelCapabilities => ({
  optionDescriptors: [
    {
      id: descriptorId,
      label: "Effort",
      type: "select",
      options: options.map((id, index) => ({
        id,
        label: id,
        ...(index === 0 ? { isDefault: true } : {}),
      })),
    },
    { id: "contextWindow", label: "Context", type: "select", options: [{ id: "1m", label: "1M" }] },
  ],
});

describe("withPreferredEffort", () => {
  const cases: ReadonlyArray<
    readonly [
      string,
      ModelCapabilities | undefined,
      ReadonlyArray<{ id: string; value: string | boolean }> | undefined,
      ReadonlyArray<{ id: string; value: string | boolean }> | undefined,
    ]
  > = [
    [
      "fills the effort of a new conversation",
      caps("effort", "medium", "high", "xhigh", "max"),
      undefined,
      [{ id: "effort", value: "xhigh" }],
    ],
    [
      "keeps the other options and adds the effort",
      caps("reasoningEffort", "low", "high"),
      [{ id: "contextWindow", value: "1m" }],
      [
        { id: "contextWindow", value: "1m" },
        { id: "reasoningEffort", value: "high" },
      ],
    ],
    [
      "a person's own pick wins",
      caps("effort", "medium", "xhigh"),
      [{ id: "effort", value: "medium" }],
      [{ id: "effort", value: "medium" }],
    ],
    [
      "OpenCode's variant is its effort",
      caps("variant", "low", "medium", "high", "xhigh"),
      undefined,
      [{ id: "variant", value: "xhigh" }],
    ],
    [
      "Cursor's reasoning is its effort",
      caps("reasoning", "low", "medium", "high", "max"),
      undefined,
      [{ id: "reasoning", value: "high" }],
    ],
    ["only max selects nothing", caps("effort", "max"), undefined, undefined],
    [
      "a model without an effort option selects nothing",
      { optionDescriptors: [{ id: "thinking", label: "Thinking", type: "boolean" }] },
      undefined,
      undefined,
    ],
    ["no capabilities select nothing", undefined, undefined, undefined],
  ];
  it.each(cases)("%s", (_name, capabilities, options, expected) => {
    expect(withPreferredEffort(capabilities, options)).toEqual(expected);
  });

  it("names every driver's effort option", () => {
    expect([...EFFORT_OPTION_IDS].toSorted()).toEqual([
      "effort",
      "reasoning",
      "reasoningEffort",
      "variant",
    ]);
  });
});

describe("selectionWithPreferredEffort", () => {
  const provider = {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    models: [
      { slug: "claude-opus-5-5", capabilities: caps("effort", "medium", "xhigh", "max") },
      { slug: "claude-haiku", capabilities: { optionDescriptors: [] } },
    ],
  } as unknown as ServerProvider;
  const selection = (model: string, instance = "claudeAgent"): ModelSelection => ({
    instanceId: ProviderInstanceId.make(instance),
    model,
  });

  const cases: ReadonlyArray<readonly [string, ModelSelection, ModelSelection]> = [
    [
      "the model's own options decide",
      selection("claude-opus-5-5"),
      { ...selection("claude-opus-5-5"), options: [{ id: "effort", value: "xhigh" }] },
    ],
    [
      "a model with no effort is left as it is",
      selection("claude-haiku"),
      selection("claude-haiku"),
    ],
    ["an unknown model is left as it is", selection("claude-next"), selection("claude-next")],
    ["an unknown instance is left as it is", selection("x", "codex"), selection("x", "codex")],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(selectionWithPreferredEffort([provider], input)).toEqual(expected);
  });
});
