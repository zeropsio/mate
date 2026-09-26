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

/** A box shorthand (`margin: a b c d`, one to four values) as its four sides. */
function sides(value: string | undefined): ReadonlyArray<string | undefined> {
  const parts = (value ?? "").match(/calc\([^)]*\)|\S+/g) ?? [];
  const [top, right = top, bottom = top, left = right] = parts;
  return [top, right, bottom, left];
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

  // In px at an answer's 15 px body; the log's 14 px scales every figure.
  it.each([
    { tag: "h1", size: 19, line: 26, above: 28, below: 8, ink: "var(--contrast-foreground)" },
    { tag: "h2", size: 19, line: 26, above: 28, below: 8, ink: "var(--contrast-foreground)" },
    { tag: "h3", size: 16.5, line: 24, above: 20, below: 6, ink: "var(--contrast-foreground)" },
    {
      tag: "h4",
      size: 15,
      line: null,
      above: 16,
      below: 4,
      ink: "var(--contrast-muted-foreground)",
    },
    {
      tag: "h5",
      size: 15,
      line: null,
      above: 16,
      below: 4,
      ink: "var(--contrast-muted-foreground)",
    },
    {
      tag: "h6",
      size: 15,
      line: null,
      above: 16,
      below: 4,
      ink: "var(--contrast-muted-foreground)",
    },
  ])("sets $tag at $size px, $above px above and $below below", (heading) => {
    const rule = declarationsOf(`.chat-markdown ${heading.tag}`);
    const size = amount(rule.get("font-size")) ?? 0;
    const [above, , below] = sides(rule.get("margin")).map((side) => amount(side) ?? 0);

    // Never below the body: a heading the size of its text reads as a bold lead-in.
    expect(size).toBeGreaterThanOrEqual(1);
    expect(size * 15).toBeCloseTo(heading.size);
    expect(rule.get("font-weight")).toBe("600");
    expect(rule.get("color")).toBe(heading.ink);
    expect((above ?? 0) * size * 15).toBeCloseTo(heading.above);
    expect((below ?? 0) * size * 15).toBeCloseTo(heading.below);
    // Without a line of its own, a heading keeps the body's.
    const line = amount(rule.get("line-height"), "");
    if (heading.line === null) expect(line).toBeNull();
    else expect((line ?? 0) * heading.size).toBeCloseTo(heading.line);
  });

  it("lets a heading own the gap under it, and none above when it opens the text", () => {
    expect(declarationsOf(".chat-markdown :is(h1, h2, h3, h4, h5, h6) + *").get("margin-top")).toBe(
      "0",
    );
    expect(declarationsOf(".chat-markdown > :first-child").get("margin-top")).toBe("0");
  });

  it("mutes list markers and sets items 6 px apart", () => {
    expect(declarationsOf(".chat-markdown li::marker").get("color")).toBe(
      "var(--contrast-muted-foreground)",
    );
    expect(
      (amount(declarationsOf(".chat-markdown li + li").get("margin-top")) ?? 0) * 15,
    ).toBeCloseTo(6);
  });

  it("hangs a nested list on a hairline guide, 6 px under its parent's text", () => {
    const nested = declarationsOf(".chat-markdown li > :is(ul, ol)");
    const [above, , below] = sides(nested.get("margin"));

    // A faint cut of the markers' own ink: the border token vanishes on the canvas.
    expect(nested.get("border-left")).toBe(
      "1px solid color-mix(in srgb, var(--contrast-muted-foreground) 30%, transparent)",
    );
    expect((amount(above) ?? 0) * 15).toBeCloseTo(6);
    expect(below).toBe("0");
  });

  it("draws a third level like the second, with no further indent", () => {
    const third = declarationsOf(".chat-markdown li li > :is(ul, ol)");

    expect(third.get("padding-left")).toBe("0");
    expect(third.get("border-left")).toBe("none");
    // No marker of its own either: the second level's circle and letters hold.
    expect(
      CHAT_MARKDOWN_RULES.some((rule) =>
        rule.selectors.some((selector) => /\b(?:ul|ol) (?:ul|ol) (?:ul|ol)\b/.test(selector)),
      ),
    ).toBe(false);
  });

  it("sets a table at 13/20 in a 15 px body, with sentence-case headers in the muted ink", () => {
    const table = declarationsOf(".chat-markdown table");
    const size = amount(table.get("font-size")) ?? 0;
    const header = declarationsOf(".chat-markdown thead th");

    expect(size * 15).toBeCloseTo(13);
    expect((amount(table.get("line-height"), "") ?? 0) * size * 15).toBeCloseTo(20);
    expect(header.get("font-weight")).toBe("600");
    expect(header.get("color")).toBe("var(--contrast-muted-foreground)");
    expect(header.get("text-transform") ?? "none").toBe("none");
    expect(header.get("letter-spacing") ?? "normal").toBe("normal");
  });

  it("wraps table cells and lets the table grow past the column only when its words do", () => {
    const cellRules = CHAT_MARKDOWN_RULES.filter((rule) =>
      rule.selectors.some((selector) => /\b(?:table|th|td)\b/.test(selector)),
    );

    for (const rule of cellRules) {
      expect(rule.declarations.get("white-space")).toBeUndefined();
      expect(rule.declarations.get("max-width")).toBeUndefined();
      expect(rule.declarations.get("text-overflow")).toBeUndefined();
      expect(rule.declarations.get("min-width")).toBeUndefined();
    }
    expect(declarationsOf(".chat-markdown td").get("vertical-align")).toBe("top");
    // No toggle between a truncated and a wrapped table is left to style.
    expect(
      CHAT_MARKDOWN_RULES.some((rule) =>
        rule.selectors.some((selector) => selector.includes("data-expanded")),
      ),
    ).toBe(false);
  });

  it("breaks a word only when it cannot fit a line, and long tokens anywhere", () => {
    // break-word leaves min-content whole-word, so a table column never
    // shrinks to one letter; a link or inline code (an address, a path, a
    // hash) still breaks where it must.
    expect(declarationsOf(".chat-markdown").get("overflow-wrap")).toBe("break-word");
    for (const token of [".chat-markdown a", ".chat-markdown :not(pre) > code"]) {
      expect(declarationsOf(token).get("overflow-wrap")).toBe("anywhere");
    }
    const breaksAnywhere = CHAT_MARKDOWN_RULES.filter(
      (rule) =>
        rule.declarations.get("overflow-wrap") === "anywhere" ||
        rule.declarations.get("word-break") === "break-all",
    ).flatMap((rule) => rule.selectors);
    expect(breaksAnywhere.toSorted()).toEqual(
      [
        ".chat-markdown a",
        ".chat-markdown :not(pre) > code",
        '.chat-markdown .chat-markdown-codeblock[data-wrap="true"] pre',
      ].toSorted(),
    );
    // Tables inherit the root's rule rather than resetting it.
    expect(declarationsOf(".chat-markdown table").get("overflow-wrap")).toBeUndefined();
  });

  it("finds the chat markdown rules it pins", () => {
    expect(CHAT_MARKDOWN_RULES.length).toBeGreaterThan(20);
  });
});
