import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderModel } from "@t3tools/contracts";

import { deriveProviderModelsForDisplay } from "./ProviderInstanceCard";

describe("deriveProviderModelsForDisplay", () => {
  it("uses current config custom models instead of stale live custom rows", () => {
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "server-model",
        name: "Server Model",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "removed-custom",
        name: "Removed Custom",
        isCustom: true,
        capabilities: null,
      },
      {
        slug: "kept-custom",
        name: "Kept Custom",
        isCustom: true,
        capabilities: null,
      },
    ];

    expect(
      deriveProviderModelsForDisplay({
        liveModels,
        customModels: [{ slug: "kept-custom", name: "kept-custom", capabilities: null }],
      }).map((model) => model.slug),
    ).toEqual(["server-model", "kept-custom"]);
  });

  it("prefers the entry's name and capabilities over the stale live custom row", () => {
    const liveCapabilities = { optionDescriptors: [] };
    const customCapabilities = {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select" as const,
          options: [{ id: "high", label: "High", isDefault: true }],
          currentValue: "high",
        },
      ],
    };
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      { slug: "bare", name: "bare", isCustom: true, capabilities: liveCapabilities },
      { slug: "named", name: "named", isCustom: true, capabilities: liveCapabilities },
    ];

    const display = deriveProviderModelsForDisplay({
      liveModels,
      customModels: [
        { slug: "bare", name: "bare", capabilities: null },
        { slug: "named", name: "My Model", capabilities: customCapabilities },
      ],
    });

    // A bare entry keeps the driver default the server filled in.
    expect(display[0]).toEqual({
      slug: "bare",
      name: "bare",
      isCustom: true,
      capabilities: liveCapabilities,
    });
    expect(display[1]).toEqual({
      slug: "named",
      name: "My Model",
      isCustom: true,
      capabilities: customCapabilities,
    });
  });
});
