import { describe, expect, it } from "vite-plus/test";
import { CONTENT_CONTRACT } from "../contentContract.ts";
import { MAC_HOST_INSTRUCTIONS } from "../zerops/mac/macInstructions.ts";
import { buildRuntimeInstructions } from "./RuntimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it.each(["Claude Code", "Codex", "Cursor"])(
    "gives the %s harness the content contract after its runtime info",
    (harness) => {
      expect(buildRuntimeInstructions({ harness })).toMatch(
        /^<runtime_info>[^\n]*<\/runtime_info>\n<writing>/,
      );
      expect(buildRuntimeInstructions({ harness })).toContain(
        `</runtime_info>\n${CONTENT_CONTRACT}`,
      );
    },
  );

  it.each(["Claude Code", "Codex", "Cursor", "OpenCode", "Grok", "Antigravity"])(
    "tells the %s harness how to work on a Mac the user pairs",
    (harness) => {
      expect(buildRuntimeInstructions({ harness }).endsWith(MAC_HOST_INSTRUCTIONS)).toBe(true);
    },
  );

  it("keeps known model and effort metadata on one line", () => {
    expect(
      buildRuntimeInstructions({
        harness: "Codex",
        model: "  custom\nmodel  ",
        reasoningEffort: " high\n",
      }),
    ).toContain("through the Codex harness, as custom model with high reasoning effort.");
  });

  it("names the model by display name and slug when they differ", () => {
    expect(
      buildRuntimeInstructions({ harness: "Codex", model: "gpt-5.4", modelName: "GPT-5.4" }),
    ).toContain("through the Codex harness, as GPT-5.4 (model slug: gpt-5.4).");
    expect(
      buildRuntimeInstructions({ harness: "Codex", model: "my-model", modelName: "my-model" }),
    ).toContain("through the Codex harness, as my-model.");
  });

  it.each([undefined, "", "auto", "default"])("omits unresolved model %s", (model) => {
    const instructions = buildRuntimeInstructions({ harness: "Cursor", model });
    expect(instructions).toContain("through the Cursor harness.");
    expect(instructions).not.toContain("reasoning effort");
  });
});
