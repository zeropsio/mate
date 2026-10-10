import { describe, expect, it } from "vite-plus/test";

import {
  maskSecrets,
  MESSAGE_PREVIEW_MAX_LENGTH,
  messagePreviewText,
  messageWords,
  quoteWords,
  SECRET_MASK,
} from "./messagePreview.ts";

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
    [
      "a table, its cells' words without its pipes or rule",
      "Deploys:\n\n| Service | State |\n|:--------|------:|\n| api | **up** |\n| web | down |",
      "Deploys: Service State api up web down",
    ],
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

describe("messageWords", () => {
  it("drops markdown's marks the way a preview does, and keeps every word", () => {
    const long = `**Done.** ${"word ".repeat(60)}\n\n- the \`end\``;
    expect(messageWords(long)).toBe(`Done. ${"word ".repeat(60)}the end`);
  });

  it("says a callout's word into its first line, as the chat draws it", () => {
    expect(messageWords("> [!WARNING]\n> My earlier claim was incorrect.")).toBe(
      "Warning: My earlier claim was incorrect.",
    );
  });
});

describe("quoteWords", () => {
  it.each([
    [
      "a quote",
      "Added it.\n\n> It stays behind the sign-in.",
      "Added it.\n\nIt stays behind the sign-in.",
    ],
    ["a quote in a quote", "> > Like the rest.", "Like the rest."],
    // e2e 2026-10-03: a Mate's "> [!WARNING]" read as "> [!WARNING] > My earlier claim…".
    [
      "a callout, its word run into its first line",
      "> [!WARNING]\n> My earlier claim was incorrect.",
      "Warning:\nMy earlier claim was incorrect.",
    ],
    ["a callout's kind in any case", "> [!note]\n> Read this.", "Note:\nRead this."],
    // GitHub's rule: a marker with words after it on its line is an ordinary quote.
    ["a marker with words after it", "> [!TIP] aside", "[!TIP] aside"],
    ["a marker outside a quote", "[!CAUTION]", "[!CAUTION]"],
  ])("%s", (_name, markdown, words) => {
    expect(quoteWords(markdown)).toBe(words);
  });
});

// Made-up credentials, put together here so that no scanner of this public
// repository mistakes a test for a leak.
const PASSWORD = ["xK93mPq", "Lw2vNt8RzY4a"].join("_");
const GITHUB_TOKEN = ["ghp", "abcdefghijklmnopqrstuvwxyz0123"].join("_");
const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "abcDEF123_x"].join(".");
const ANTHROPIC_KEY = ["sk", "ant", "api03", "AbCdEfGhIjKlMnOpQrStUv"].join("-");
const AWS_KEY_ID = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const PRIVATE_KEY = [
  "-----BEGIN RSA PRIVATE",
  "KEY----- MIIEow -----END RSA PRIVATE",
  "KEY-----",
].join(" ");

describe("maskSecrets", () => {
  const M = SECRET_MASK;
  it.each([
    [
      "a value after a password's name",
      "SHOP_API_PASSWORD hunter2026 SHOP_API_USER ShopAdmin",
      `SHOP_API_PASSWORD ${M} SHOP_API_USER ShopAdmin`,
    ],
    [
      "a password in Czech, after a colon",
      `Účet vera@shop.test, Heslo: ${PASSWORD} pro stage`,
      `Účet vera@shop.test, Heslo: ${M} pro stage`,
    ],
    [
      "an assignment, its comma kept",
      "password=abc123, then the rest",
      `password=${M}, then the rest`,
    ],
    ["a quoted value with a space in it", "DB_PASS='s3cr3t pass' next", `DB_PASS=${M} next`],
    ["a quote left open", "DB_PASS='s3cr3t next", `DB_PASS=${M} next`],
    ["a name in camel case", "apiKey: AbC123xyz and more", `apiKey: ${M} and more`],
    ["a token by its own shape", `use ${GITHUB_TOKEN} for it`, `use ${M} for it`],
    ["a token after its name", `export GITHUB_TOKEN=${GITHUB_TOKEN}`, `export GITHUB_TOKEN=${M}`],
    ["a bearer token", "Authorization: Bearer abc.def-ghi_jkl", `Authorization: Bearer ${M}`],
    [
      "a password in a URL",
      "clone https://ales:tajne123@git.example.com/repo",
      `clone https://ales:${M}@git.example.com/repo`,
    ],
    ["a JSON web token", JWT, M],
    ["an API key by its shape", `key ${ANTHROPIC_KEY}`, `key ${M}`],
    ["an AWS access key", `${AWS_KEY_ID} is the id`, `${M} is the id`],
    ["a password said in a sentence", "the password is hunter2", `the password is ${M}`],
    ["a Czech sentence", "heslo je Tajne2026", `heslo je ${M}`],
    ["a private key", PRIVATE_KEY, M],
  ])("masks %s", (_, text, masked) => {
    expect(maskSecrets(text)).toBe(masked);
  });

  it.each([
    "the password is too long",
    "pass the tests first",
    "author: Jan, tokenizer: fast",
    "primary key: id",
    "Merge #2 into main at a1b2c3d4e5f6",
    "open zXUaCquAQyu1Jld65n1UFQ in Zerops",
    "Note: the password must be long",
    "const apiKey = process.env.SHOP_KEY",
    "PRD je hotový v jednom souboru",
  ])("leaves %j alone", (text) => {
    expect(maskSecrets(text)).toBe(text);
  });
});

describe("messagePreviewText, masked", () => {
  it("never quotes a password", () => {
    expect(messagePreviewText("Here it is. **Heslo:** `Xy7_abcdefgh12` for dev.")).toBe(
      `Here it is. Heslo: ${SECRET_MASK} for dev.`,
    );
  });
});
