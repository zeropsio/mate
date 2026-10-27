import { describe, expect, it } from "vite-plus/test";
import { CONTENT_CONTRACT } from "../contentContract.ts";
import { MAC_HOST_INSTRUCTIONS } from "../macHostInstructions.ts";
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

  it("tells a model that takes no image input to verify by text and never say what an unseen image shows", () => {
    const instructions = buildRuntimeInstructions({
      harness: "OpenCode",
      model: "nebius/zai-org/GLM-5.3-Flash",
      imageInput: false,
    });
    expect(instructions).toContain("cannot see images");
    expect(instructions).toContain("Verify a UI by text");
    expect(instructions).toContain("zerops_browser");
    expect(instructions).toContain("caption it only with what that text evidence proves");
    expect(instructions).toContain("Never say what an image shows");
    expect(instructions.endsWith(MAC_HOST_INSTRUCTIONS)).toBe(true);
  });

  it.each([true, undefined])(
    "gives a model that reads images, or whose image input is unstated (%s), no text-only rule",
    (imageInput) => {
      const instructions = buildRuntimeInstructions({ harness: "Claude Code", imageInput });
      expect(instructions).not.toContain("cannot see images");
      expect(instructions).toBe(buildRuntimeInstructions({ harness: "Claude Code" }));
      expect(instructions).toContain(
        `</runtime_info>\n${CONTENT_CONTRACT}\n${MAC_HOST_INSTRUCTIONS}`,
      );
    },
  );

  it.each([undefined, "", "auto", "default"])("omits unresolved model %s", (model) => {
    const instructions = buildRuntimeInstructions({ harness: "Cursor", model });
    expect(instructions).toContain("through the Cursor harness.");
    expect(instructions).not.toContain("reasoning effort");
  });
});
