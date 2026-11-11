import { describe, expect, it } from "vite-plus/test";
import { PICTURE_ASK_INSTRUCTIONS } from "./pictureAskInstructions.ts";

describe("PICTURE_ASK_INSTRUCTIONS", () => {
  it.each([
    ["a picture to make from words", '"do":"generate"'],
    ["pictures to edit", '"do":"edit"'],
    ["a design", '"do":"design"'],
  ])("a Mate sets up %s as a picture ask the person answers in one press", (_thing, shape) => {
    expect(PICTURE_ASK_INSTRUCTIONS).toContain("```picture-ask");
    expect(PICTURE_ASK_INSTRUCTIONS).toContain(shape);
  });

  // Codex truncates the middle of an additionalContext entry past ~4,000 bytes.
  it("stays inside Codex's per-entry cap", () => {
    expect(Buffer.byteLength(PICTURE_ASK_INSTRUCTIONS)).toBeLessThan(3_000);
  });
});
