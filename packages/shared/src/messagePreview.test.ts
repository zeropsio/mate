import { describe, expect, it } from "vite-plus/test";

import { MESSAGE_PREVIEW_MAX_LENGTH, messagePreviewText } from "./messagePreview.ts";

describe("messagePreviewText", () => {
  it.each([
    ["bold and italics", "**Done.** The app is *live* now.", "Done. The app is live now."],
    [
      "headings and bullets",
      "## Summary\n\n- Added the login page\n- [ ] Fix the redirect\n\n1. first\n2) second",
      "Summary Added the login page Fix the redirect first second",
    ],
    ["a quote", "> Ship it\n\nShipping.", "Ship it Shipping."],
    ["a code fence, keeping its code", "```ts\nconst a = 1;\n```", "const a = 1;"],
    ["inline code and strikethrough", "Run `npm test`, ~~then~~ now.", "Run npm test, then now."],
    [
      "links and images",
      "See [the docs](https://x.dev) and ![shot](img.png).",
      "See the docs and shot.",
    ],
    ["a rule between paragraphs", "Before\n\n---\n\nAfter", "Before After"],
    ["runs of whitespace", "please   do\n\n\nthe thing  ", "please do the thing"],
    ["snake_case left alone", "*emphasis* and snake_case_name", "emphasis and snake_case_name"],
  ])("quotes %s as plain words", (_, markdown, expected) => {
    expect(messagePreviewText(markdown)).toBe(expected);
  });

  it.each([
    ["nothing", ""],
    ["whitespace", "  \n\t "],
    ["marks alone", "---\n\n```\n```"],
  ])("has nothing to quote from %s", (_, markdown) => {
    expect(messagePreviewText(markdown)).toBeNull();
  });

  it("cuts a long message at a word and marks the cut", () => {
    const preview = messagePreviewText(`${"word ".repeat(60)}end`);
    expect(preview).toMatch(/^word(?: word)*…$/u);
    expect(Array.from(preview ?? "").length).toBeLessThanOrEqual(MESSAGE_PREVIEW_MAX_LENGTH);
  });

  it("cuts inside a word only when no space is near the limit", () => {
    const preview = messagePreviewText("x".repeat(400));
    expect(preview).toBe(`${"x".repeat(MESSAGE_PREVIEW_MAX_LENGTH)}…`);
  });

  it("keeps a message within the limit whole", () => {
    const text = "y".repeat(MESSAGE_PREVIEW_MAX_LENGTH);
    expect(messagePreviewText(text)).toBe(text);
  });
});
