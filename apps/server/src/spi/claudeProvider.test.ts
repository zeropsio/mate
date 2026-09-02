import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  getClaudeCatalogModelCapabilities,
  isClaudeCatalogUltracodeEffort,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
} from "./claudeProvider.ts";

const INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const catalog = BUNDLED_CLAUDE_MODEL_CATALOG;

describe("getClaudeCatalogModelCapabilities", () => {
  it("returns a bundled catalog entry's capabilities for a known model", () => {
    const caps = getClaudeCatalogModelCapabilities(catalog, "claude-fable-5");
    expect(caps.optionDescriptors ?? []).not.toEqual([]);
  });

  it("falls back to the default capabilities (no option descriptors) for an unknown model", () => {
    const caps = getClaudeCatalogModelCapabilities(catalog, "some-future-custom-model");
    expect(caps.optionDescriptors ?? []).toEqual([]);
  });
});

describe("resolveClaudeCatalogEffort + normalizeClaudeCatalogEffort + isClaudeCatalogUltracodeEffort", () => {
  it("resolves the ultracode effort selection and maps it to the CLI's xhigh flag", () => {
    const resolved = resolveClaudeCatalogEffort(catalog, "claude-fable-5", "ultracode");
    expect(resolved).toBe("ultracode");
    expect(isClaudeCatalogUltracodeEffort(resolved)).toBe(true);
    expect(normalizeClaudeCatalogEffort(catalog, resolved, "claude-fable-5")).toBe("xhigh");
  });

  it("filters ultrathink out entirely (a prompt-prefix mode, not a CLI flag)", () => {
    expect(normalizeClaudeCatalogEffort(catalog, "ultrathink", "claude-fable-5")).toBeUndefined();
  });

  it("keeps xhigh as-is for current flagship models", () => {
    expect(normalizeClaudeCatalogEffort(catalog, "xhigh", "claude-fable-5")).toBe("xhigh");
    expect(normalizeClaudeCatalogEffort(catalog, "xhigh", "claude-opus-5")).toBe("xhigh");
  });

  it("remaps xhigh to max for models outside the current flagship set", () => {
    expect(normalizeClaudeCatalogEffort(catalog, "xhigh", "claude-opus-4-7")).toBe("max");
  });

  it("remaps max to high for claude-sonnet-4-6 only", () => {
    expect(normalizeClaudeCatalogEffort(catalog, "max", "claude-sonnet-4-6")).toBe("high");
    expect(normalizeClaudeCatalogEffort(catalog, "max", "claude-opus-5")).toBe("max");
  });
});

describe("resolveClaudeCatalogApiModelId", () => {
  it("returns the bare model slug for an unknown/custom model (no contextWindow option exists)", () => {
    const modelSelection = createModelSelection(INSTANCE_ID, "some-future-custom-model");
    expect(resolveClaudeCatalogApiModelId(catalog, modelSelection)).toBe(
      "some-future-custom-model",
    );
  });

  it("appends [1m] for a known model whose contextWindow option defaults to 1m", () => {
    const modelSelection = createModelSelection(INSTANCE_ID, "claude-fable-5");
    expect(resolveClaudeCatalogApiModelId(catalog, modelSelection)).toBe("claude-fable-5[1m]");
  });

  it("drops the [1m] suffix when the 200k context window is explicitly selected", () => {
    const modelSelection = createModelSelection(INSTANCE_ID, "claude-fable-5", [
      { id: "contextWindow", value: "200k" },
    ]);
    expect(resolveClaudeCatalogApiModelId(catalog, modelSelection)).toBe("claude-fable-5");
  });
});
