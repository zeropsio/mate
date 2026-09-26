import { IMAGE_ONLY_BOOTSTRAP_PROMPT, USAGE_LIMIT_RESUME_PROMPT } from "@t3tools/shared/userAsk";
import { describe, expect, it } from "vite-plus/test";
import { formatThreadTitleContext, limitTitleMessage } from "./ThreadTitleContext.ts";

describe("thread title context", () => {
  it("keeps a user's scope change despite long assistant output", () => {
    const result = formatThreadTitleContext([
      { role: "user", text: "Review QR sharing" },
      { role: "assistant", text: "Old findings. ".repeat(2_000) },
      { role: "user", text: "Focus on pairing expiry instead. Keep remote access working." },
      { role: "assistant", text: "Implementation details. ".repeat(2_000) },
      { role: "user", text: "Merge it when green." },
    ]);
    expect(result.message.length).toBeLessThanOrEqual(8_000);
    expect(result.message).toContain("USER:\nReview QR sharing");
    expect(result.message).toContain(
      "USER:\nFocus on pairing expiry instead. Keep remote access working.",
    );
    expect(result.message).toContain("USER:\nMerge it when green.");
    expect(result.message).toContain("ASSISTANT:\nImplementation details.");
  });

  it("retains both ends and role labels in long user messages", () => {
    const result = formatThreadTitleContext([
      { role: "system", text: "System instructions" },
      { role: "user", text: `Fix Android pairing. ${"logs ".repeat(3_000)}Keep iOS behavior.` },
      { role: "assistant", text: "Found the cause." },
    ]);
    expect(result.message).toContain("USER:\nFix Android pairing.");
    expect(result.message).toContain("Keep iOS behavior.");
    expect(result.message).toContain("ASSISTANT:\nFound the cause.");
    expect(result.message).not.toContain("System instructions");
    expect(result.message.match(/USER:/g)).toHaveLength(1);
  });

  const shot = {
    type: "image" as const,
    id: "title-context-shot",
    name: "shot.png",
    mimeType: "image/png",
    sizeBytes: 5,
  };

  it.each([
    {
      name: "a slash command",
      message: { role: "user" as const, text: "/model opus" },
      expected: "USER:\nFix pairing\n\nASSISTANT:\nThe QR token expired.",
    },
    {
      name: "the usage-limit resume",
      message: { role: "user" as const, text: USAGE_LIMIT_RESUME_PROMPT },
      expected: "USER:\nFix pairing\n\nASSISTANT:\nThe QR token expired.",
    },
    {
      name: "the image-only placeholder, keeping the attachments",
      message: { role: "user" as const, text: IMAGE_ONLY_BOOTSTRAP_PROMPT, attachments: [shot] },
      expected:
        "USER:\nFix pairing\n\nASSISTANT:\nThe QR token expired.\n\nUSER:\n[Attachments: shot.png]",
    },
  ])("leaves out $name", ({ message, expected }) => {
    expect(
      formatThreadTitleContext([
        { role: "user", text: "Fix pairing" },
        { role: "assistant", text: "The QR token expired." },
        message,
      ]).message,
    ).toBe(expected);
  });

  it("preserves short conversations unchanged and handles tiny budgets", () => {
    expect(
      formatThreadTitleContext([
        { role: "user", text: "Fix pairing" },
        { role: "assistant", text: "The QR token expired." },
      ]).message,
    ).toBe("USER:\nFix pairing\n\nASSISTANT:\nThe QR token expired.");
    expect(limitTitleMessage("x".repeat(100), 0)).toBe("");
    for (let budget = 1; budget < 40; budget++) {
      expect(limitTitleMessage("x".repeat(100), budget).length).toBeLessThanOrEqual(budget);
    }
    expect(formatThreadTitleContext([])).toEqual({ message: "", attachments: [] });
  });
});
