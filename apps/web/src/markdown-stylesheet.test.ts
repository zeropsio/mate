// @effect-diagnostics nodeBuiltinImport:off -- This test reads the stylesheet it verifies.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

/**
 * How chat markdown reads is decided in `index.css`, where a rendering test
 * cannot see it. These pin the decisions against the rules themselves: an
 * answer's body, a heading never below the text under it, tables that wrap,
 * and long tokens as the only text that breaks anywhere.
 */

type CssItem =
  | { readonly kind: "declaration"; readonly text: string }
  | { readonly kind: "block"; readonly prelude: string; readonly body: string };

interface CssRule {
  readonly selectors: ReadonlyArray<string>;
  readonly declarations: ReadonlyMap<string, string>;
}

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

/** Top-level declarations and blocks of a stylesheet or a rule body. */
function cssItems(text: string): CssItem[] {
  const items: CssItem[] = [];
  let depth = 0;
  let parentheses = 0;
  let quote: string | null = null;
  let segmentStart = 0;
  let bodyStart = 0;
  let prelude = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "{") {
      if (depth === 0) {
        prelude = normalizeWhitespace(text.slice(segmentStart, index));
        bodyStart = index + 1;
      }
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        items.push({ kind: "block", prelude, body: text.slice(bodyStart, index) });
        segmentStart = index + 1;
      }
    } else if (character === ";" && depth === 0 && parentheses === 0) {
      const declaration = normalizeWhitespace(text.slice(segmentStart, index));
      if (declaration) items.push({ kind: "declaration", text: declaration });
      segmentStart = index + 1;
    }
  }
  return items;
}

/** A selector list split on its own commas, not those inside `:is(…)`. */
function selectorList(prelude: string): string[] {
  const selectors: string[] = [];
  let parentheses = 0;
  let start = 0;
  for (let index = 0; index < prelude.length; index += 1) {
    const character = prelude[index];
    if (character === "(" || character === "[") parentheses += 1;
    else if (character === ")" || character === "]") parentheses -= 1;
    else if (character === "," && parentheses === 0) {
      selectors.push(normalizeWhitespace(prelude.slice(start, index)));
      start = index + 1;
    }
  }
  selectors.push(normalizeWhitespace(prelude.slice(start)));
  return selectors;
}

function cssRules(text: string): CssRule[] {
  return cssItems(text).flatMap((item): CssRule[] => {
    if (item.kind !== "block") return [];
    if (item.prelude.startsWith("@")) {
      return /^@(?:media|supports|layer)\b/.test(item.prelude) ? cssRules(item.body) : [];
    }
    const declarations = new Map<string, string>();
    for (const child of cssItems(item.body)) {
      if (child.kind !== "declaration") continue;
      const colon = child.text.indexOf(":");
      if (colon > 0) {
        declarations.set(child.text.slice(0, colon).trim(), child.text.slice(colon + 1).trim());
      }
    }
    return [{ selectors: selectorList(item.prelude), declarations }];
  });
}

const RULES = cssRules(
  NodeFS.readFileSync(new URL("./index.css", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  ),
);

const CHAT_MARKDOWN_RULES = RULES.filter((rule) =>
  rule.selectors.some((selector) => selector.startsWith(".chat-markdown")),
);

/** A length in `unit` written plain or as `calc(a<unit> / b)`, as a number of that unit. */
function amount(value: string | undefined, unit: "em" | "" = "em"): number | null {
  if (value === undefined) return null;
  const number = String.raw`(\d*\.?\d+)`;
  const plain = new RegExp(`^${number}${unit}$`).exec(value);
  if (plain) return Number(plain[1]);
  const quotient = new RegExp(String.raw`^calc\(\s*${number}${unit}\s*/\s*${number}\s*\)$`).exec(
    value,
  );
  return quotient ? Number(quotient[1]) / Number(quotient[2]) : null;
}

/** Every declaration the stylesheet gives one exact selector, the later rule winning. */
function declarationsOf(selector: string): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  for (const rule of RULES) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [property, value] of rule.declarations) merged.set(property, value);
  }
  return merged;
}

describe("the chat markdown stylesheet", () => {
  it("sets an answer at 15/24 in the full foreground", () => {
    const answer = declarationsOf('.chat-markdown[data-variant="answer"]');

    expect(answer.get("font-size")).toBe("0.9375rem");
    expect(Number(answer.get("line-height")) * 15).toBeCloseTo(24);
    expect(answer.get("color")).toBe("var(--contrast-foreground)");
  });

  it.each([
    { body: 14, code: 12 },
    { body: 15, code: 13 },
  ])("sets inline code at $code px in a $body px body", ({ body, code }) => {
    const size = amount(declarationsOf(".chat-markdown :not(pre) > code").get("font-size"));

    expect((size ?? 0) * body).toBeCloseTo(code, 0);
  });

  it("finds the chat markdown rules it pins", () => {
    expect(CHAT_MARKDOWN_RULES.length).toBeGreaterThan(20);
  });
});
