/** What a piece of a playground's JSX is, for its tint. */
export type JsxTokenKind = "punctuation" | "tag" | "attribute" | "string" | "expression" | "text";

export interface JsxToken {
  readonly kind: JsxTokenKind;
  readonly text: string;
}

/** The end of a `{…}` that starts at `from`, braces balanced; the source's end when it never closes. */
function closingBrace(source: string, from: number): number {
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

const TAG_START = /^<\/?[A-Za-z]/u;
const NAME = /^[A-Za-z_$][\w.$-]*/u;
const SPACE = /^\s+/u;
const STRING = /^"[^"]*"?/u;

/**
 * The playground's JSX in tinted pieces: tags, their props and values, braces, and the text
 * between them. Unknown characters stay text, so a piece it does not know reads as written.
 */
export function jsxTokens(source: string): readonly JsxToken[] {
  const tokens: JsxToken[] = [];
  const push = (kind: JsxTokenKind, text: string) => {
    const last = tokens.at(-1);
    if (last !== undefined && last.kind === kind)
      tokens[tokens.length - 1] = { kind, text: last.text + text };
    else tokens.push({ kind, text });
  };
  let index = 0;
  let inTag = false;
  while (index < source.length) {
    const rest = source.slice(index);
    if (!inTag) {
      if (TAG_START.test(rest)) {
        const open = rest.startsWith("</") ? "</" : "<";
        push("punctuation", open);
        index += open.length;
        const name = NAME.exec(source.slice(index))?.[0] ?? "";
        push("tag", name);
        index += name.length;
        inTag = true;
        continue;
      }
      if (rest.startsWith("{")) {
        const end = closingBrace(source, index);
        push("expression", source.slice(index, end));
        index = end;
        continue;
      }
      push("text", rest[0] ?? "");
      index += 1;
      continue;
    }
    if (rest.startsWith("/>") || rest.startsWith(">")) {
      const close = rest.startsWith("/>") ? "/>" : ">";
      push("punctuation", close);
      index += close.length;
      inTag = false;
      continue;
    }
    const space = SPACE.exec(rest)?.[0];
    if (space !== undefined) {
      push("text", space);
      index += space.length;
      continue;
    }
    const string = STRING.exec(rest)?.[0];
    if (string !== undefined) {
      push("string", string);
      index += string.length;
      continue;
    }
    if (rest.startsWith("{")) {
      const end = closingBrace(source, index);
      push("expression", source.slice(index, end));
      index = end;
      continue;
    }
    if (rest.startsWith("=")) {
      push("punctuation", "=");
      index += 1;
      continue;
    }
    const name = NAME.exec(rest)?.[0];
    if (name !== undefined) {
      push("attribute", name);
      index += name.length;
      continue;
    }
    push("text", rest[0] ?? "");
    index += 1;
  }
  return tokens;
}
