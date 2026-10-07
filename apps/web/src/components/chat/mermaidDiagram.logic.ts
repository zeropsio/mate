export type MermaidRenderResult =
  | { readonly status: "rendered"; readonly svg: string }
  | { readonly status: "error"; readonly message: string; readonly retryable: boolean };

/**
 * What a Mermaid fence's frame holds. The frame keeps one height in every
 * state, so streaming, drawing, the diagram and a fallback never move the
 * answer around it.
 */
export type MermaidFrame = "source" | "drawing" | "diagram" | "fallback";

export function mermaidFrame(input: {
  readonly streaming: boolean;
  readonly showCode: boolean;
  readonly source: string;
  readonly result: MermaidRenderResult | null;
}): MermaidFrame {
  if (input.streaming || input.showCode || input.source.trim().length === 0) return "source";
  if (input.result === null) return "drawing";
  return input.result.status === "rendered" ? "diagram" : "fallback";
}

/**
 * Mermaid settings a diagram's own `%%{init}%%` directive may not change. Each
 * reaches the diagram's CSS or its HTML unescaped, so a directive could break
 * out of the diagram's rules or fetch from the network.
 */
export const MERMAID_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "htmlLabels",
  "themeCSS",
  "themeVariables",
  "fontFamily",
  "altFontFamily",
  "fontSize",
] as const;

// Anything that can make CSS fetch: url() other than a local #id, and every
// image function. A backslash escape could spell one of these, so it drops too.
const FETCHES = /\\|\b(?:image-set|image|cross-fade|element|src)\s*\(|url\(\s*(?!['"]?#)/iu;
const PINS = /^position$/iu;
const PINNED = /\b(?:fixed|sticky)\b/iu;

/** Splits at `separator` outside quotes and brackets; `null` when they do not balance. */
function splitTopLevel(text: string, separator: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
    if (depth < 0) return null;
  }
  if (quote !== null || depth !== 0) return null;
  parts.push(text.slice(start));
  return parts;
}

function safeDeclarations(body: string): string | null {
  const declarations = splitTopLevel(body, ";");
  if (declarations === null) return null;
  return declarations
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      if (declaration === "") return false;
      const colon = declaration.indexOf(":");
      if (colon <= 0) return false;
      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1);
      if (FETCHES.test(value)) return false;
      return !(PINS.test(property) && PINNED.test(value));
    })
    .join(";");
}

/** Top-level `prelude { body }` blocks; `null` when braces or quotes do not balance. */
function cssBlocks(css: string): { prelude: string; body: string }[] | null {
  const blocks: { prelude: string; body: string }[] = [];
  let depth = 0;
  let quote: string | null = null;
  let preludeStart = 0;
  let bodyStart = 0;
  let prelude = "";
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]!;
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "{") {
      if (depth === 0) {
        prelude = css.slice(preludeStart, index);
        bodyStart = index + 1;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth < 0) return null;
      if (depth === 0) {
        blocks.push({ prelude: prelude.trim(), body: css.slice(bodyStart, index) });
        preludeStart = index + 1;
      }
    } else if (char === ";" && depth === 0) {
      // A statement at-rule such as @import: never kept.
      preludeStart = index + 1;
    }
  }
  return quote === null && depth === 0 ? blocks : null;
}

function scopedTo(selector: string, svgId: string): boolean {
  const scope = `#${svgId}`;
  const parts = splitTopLevel(selector, ",");
  return (
    parts !== null &&
    parts.every((part) => {
      const trimmed = part.trim();
      return (
        trimmed === scope ||
        (trimmed.startsWith(scope) && /^[\s.:#[>+~]/u.test(trimmed.slice(scope.length)))
      );
    })
  );
}

/**
 * A drawn diagram's stylesheet, kept to rules on the diagram itself and its
 * keyframes, with nothing that fetches or pins it over the window. A
 * directive that breaks out of a rule cannot style the rest of the app; a
 * stylesheet that does not parse is dropped whole.
 */
export function diagramCss(css: string, svgId: string): string {
  const blocks = cssBlocks(css.replace(/\/\*[\s\S]*?\*\//gu, ""));
  if (blocks === null) return "";
  let out = "";
  for (const { prelude, body } of blocks) {
    if (/^@(?:-webkit-)?keyframes\s+[\w-]+$/iu.test(prelude)) {
      const frames = cssBlocks(body);
      if (frames === null) continue;
      const kept = frames.flatMap(({ prelude: frame, body: frameBody }) => {
        const declarations = safeDeclarations(frameBody);
        return declarations === null ? [] : [`${frame}{${declarations}}`];
      });
      out += `${prelude}{${kept.join("")}}`;
      continue;
    }
    if (prelude.startsWith("@") || !scopedTo(prelude, svgId)) continue;
    const declarations = safeDeclarations(body);
    if (declarations !== null) out += `${prelude}{${declarations}}`;
  }
  return out;
}

/** An element's inline style in a diagram, without what fetches or pins. */
export function diagramStyleAttribute(style: string): string {
  return safeDeclarations(style) ?? "";
}
