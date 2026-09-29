import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type RuntimeMode,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  composerModelControlLabel,
  composerModelControlText,
  showsAccessControl,
} from "./ComposerModelControl.logic";

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");

type Select = Extract<ProviderOptionDescriptor, { type: "select" }>;
type Toggle = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

function select(
  id: string,
  options: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly isDefault?: true;
  }>,
  currentValue?: string,
): Select {
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(currentValue === undefined ? {} : { currentValue }),
  };
}

const effort = (currentValue?: string) =>
  select(
    "effort",
    [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
      { id: "ultrathink", label: "Ultrathink" },
    ],
    currentValue,
  );
const contextWindow = (currentValue?: string) =>
  select(
    "contextWindow",
    [
      { id: "200k", label: "200k", isDefault: true },
      { id: "1m", label: "1M" },
    ],
    currentValue,
  );
const serviceTier = (currentValue: string) =>
  select(
    "serviceTier",
    [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Fast" },
      { id: "flex", label: "Flex" },
    ],
    currentValue,
  );
const fastMode = (currentValue: boolean): Toggle => ({
  id: "fastMode",
  label: "Fast Mode",
  type: "boolean",
  currentValue,
});
const thinking = (currentValue: boolean): Toggle => ({
  id: "thinking",
  label: "Thinking",
  type: "boolean",
  currentValue,
});

describe("composerModelControlLabel", () => {
  it.each<{
    readonly case: string;
    readonly provider: ProviderDriverKind;
    readonly modelName: string;
    readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
    readonly ultrathink?: boolean;
    readonly text: string;
    readonly fast?: boolean;
  }>([
    {
      case: "the model and its effort, the agent's name left to its mark",
      provider: CLAUDE,
      modelName: "Claude Sonnet 5",
      descriptors: [effort("high"), contextWindow()],
      text: "Sonnet 5 · High",
    },
    {
      case: "the effort's default when none is chosen",
      provider: CLAUDE,
      modelName: "Claude Sonnet 5",
      descriptors: [effort(), contextWindow()],
      text: "Sonnet 5 · High",
    },
    {
      case: "another choice only once it is off its default",
      provider: CLAUDE,
      modelName: "Claude Sonnet 5",
      descriptors: [effort("max"), contextWindow("1m")],
      text: "Sonnet 5 · Max · 1M",
    },
    {
      case: "ultrathink written into the prompt",
      provider: CLAUDE,
      modelName: "Claude Sonnet 5",
      descriptors: [effort("high")],
      ultrathink: true,
      text: "Sonnet 5 · Ultrathink",
    },
    {
      case: "a model with no effort to choose",
      provider: CLAUDE,
      modelName: "Claude Haiku 4.5",
      descriptors: [],
      text: "Haiku 4.5",
    },
    {
      case: "a model whose name does not start with its agent's",
      provider: CODEX,
      modelName: "GPT-5.5",
      descriptors: [select("reasoningEffort", [{ id: "high", label: "High" }], "high")],
      text: "GPT-5.5 · High",
    },
    {
      case: "a name that is only the agent's, kept whole",
      provider: CLAUDE,
      modelName: "Claude",
      descriptors: [],
      text: "Claude",
    },
    {
      case: "fast mode as a bolt, not a word",
      provider: CLAUDE,
      modelName: "Claude Opus 4.8",
      descriptors: [effort("high"), fastMode(true)],
      text: "Opus 4.8 · High",
      fast: true,
    },
    {
      case: "fast mode off says nothing",
      provider: CLAUDE,
      modelName: "Claude Opus 4.8",
      descriptors: [effort("high"), fastMode(false)],
      text: "Opus 4.8 · High",
    },
    {
      case: "Codex's fast tier as the bolt",
      provider: CODEX,
      modelName: "GPT-5.5",
      descriptors: [
        select("reasoningEffort", [{ id: "high", label: "High" }], "high"),
        serviceTier("priority"),
      ],
      text: "GPT-5.5 · High",
      fast: true,
    },
    {
      case: "Codex's standard tier says nothing",
      provider: CODEX,
      modelName: "GPT-5.5",
      descriptors: [
        select("reasoningEffort", [{ id: "high", label: "High" }], "high"),
        serviceTier("default"),
      ],
      text: "GPT-5.5 · High",
    },
    {
      case: "Codex's flex tier, off its default, named",
      provider: CODEX,
      modelName: "GPT-5.5",
      descriptors: [
        select("reasoningEffort", [{ id: "high", label: "High" }], "high"),
        serviceTier("flex"),
      ],
      text: "GPT-5.5 · High · Flex",
    },
    {
      case: "a switch other than fast mode stays in the menu",
      provider: CLAUDE,
      modelName: "Claude Sonnet 5",
      descriptors: [effort("high"), thinking(true)],
      text: "Sonnet 5 · High",
    },
  ])(
    "$case: $text",
    ({ provider, modelName, descriptors, ultrathink = false, text, fast = false }) => {
      const label = composerModelControlLabel({
        provider,
        modelName,
        descriptors,
        ultrathinkPromptControlled: ultrathink,
      });
      expect(composerModelControlText(label)).toBe(text);
      expect(label.fast).toBe(fast);
    },
  );
});

describe("showsAccessControl", () => {
  // The access control stands in the toolbar while it is not the usual
  // setting — and whenever the one control's menu, which holds the access,
  // cannot be opened: the provider's setup stands in its place, or the
  // catalog is still being read. Access is reachable in every state.
  it.each<{
    readonly runtimeMode: RuntimeMode;
    readonly menu: "opens" | "provider setup instead" | "catalog being read";
    readonly shown: boolean;
  }>([
    { runtimeMode: "full-access", menu: "opens", shown: false },
    { runtimeMode: "approval-required", menu: "opens", shown: true },
    { runtimeMode: "auto-accept-edits", menu: "opens", shown: true },
    { runtimeMode: "auto", menu: "opens", shown: true },
    { runtimeMode: "full-access", menu: "provider setup instead", shown: true },
    { runtimeMode: "approval-required", menu: "provider setup instead", shown: true },
    { runtimeMode: "full-access", menu: "catalog being read", shown: true },
    { runtimeMode: "auto", menu: "catalog being read", shown: true },
  ])("$runtimeMode, the menu $menu: shown $shown", ({ runtimeMode, menu, shown }) => {
    expect(showsAccessControl(runtimeMode, { modelMenuOpens: menu === "opens" })).toBe(shown);
  });
});
