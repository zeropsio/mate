interface ImportStatement {
  readonly clause: string;
  readonly reexport: boolean;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

// `[^;]*?` (not `.*?`) so a multi-line brace clause is captured whole: import
// clauses never contain a semicolon, so this cannot run past the statement.
const STATIC_IMPORT_PATTERN = /import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_PATTERN = /import\s*["']([^"']+)["']/g;
const REEXPORT_PATTERN =
  /export\s+(type\s+)?(\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^;]*?\})\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_CALL_PATTERN = /\bimport\s*\(\s*([^)]*?)\s*\)/gs;
export const IMPORT_ASSIGNMENT_PATTERN =
  /\bimport\s+(?:type\s+)?[A-Za-z_$][\w$]*\s*=\s*require\s*\(/g;

function isBracedTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }
  const bindings = trimmed
    .slice(1, -1)
    .split(",")
    .map((binding) => binding.trim())
    .filter((binding) => binding.length > 0);
  return bindings.length > 0 && bindings.every((binding) => /^type\s+/u.test(binding));
}

export function isPlainStringLiteral(value: string): boolean {
  if (value.length < 2) {
    return false;
  }
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) {
    return false;
  }
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
    } else if (character === quote || character === "\n" || character === "\r") {
      return false;
    }
  }
  return true;
}

// Over the source with its comments blanked: prose that reads "import (" is no import.
export function collectDynamicImportArguments(
  source: string,
  commentFree = scanSourceLiterals(source).commentFree,
): ReadonlyArray<string> {
  return [...commentFree.matchAll(DYNAMIC_IMPORT_CALL_PATTERN)].map((match) => match[1]!.trim());
}

export function collectImportStatements(
  source: string,
  dynamicImports = collectDynamicImportArguments(source),
): ReadonlyArray<ImportStatement> {
  const statements: Array<ImportStatement> = [];
  for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
    const clause = match[2] ?? "";
    statements.push({
      clause,
      reexport: false,
      specifier: match[3]!,
      typeOnly: match[1] !== undefined || isBracedTypeOnlyClause(clause),
    });
  }
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_PATTERN)) {
    statements.push({ clause: "", reexport: false, specifier: match[1]!, typeOnly: false });
  }
  for (const match of source.matchAll(REEXPORT_PATTERN)) {
    const clause = match[2] ?? "";
    statements.push({
      clause,
      reexport: true,
      specifier: match[3]!,
      typeOnly: match[1] !== undefined || isBracedTypeOnlyClause(clause),
    });
  }
  for (const argument of dynamicImports) {
    if (isPlainStringLiteral(argument)) {
      statements.push({
        clause: "",
        reexport: false,
        specifier: argument.slice(1, -1),
        typeOnly: false,
      });
    }
  }
  return statements;
}

interface SourceLiteral {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

function decodeSourceLiteral(raw: string): string {
  return raw.replace(
    /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([0btnrfv\\'"`]))/gu,
    (
      _match,
      codePoint: string | undefined,
      unicode: string | undefined,
      hex: string | undefined,
      simple: string | undefined,
    ) => {
      if (codePoint !== undefined) return String.fromCodePoint(Number.parseInt(codePoint, 16));
      if (unicode !== undefined) return String.fromCodePoint(Number.parseInt(unicode, 16));
      if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
      switch (simple) {
        case "0":
          return "\0";
        case "b":
          return "\b";
        case "t":
          return "\t";
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "f":
          return "\f";
        case "v":
          return "\v";
        default:
          return simple ?? "";
      }
    },
  );
}

export function scanSourceLiterals(source: string): {
  readonly literals: ReadonlyArray<SourceLiteral>;
  readonly jsxSource: string;
  /** The source with its comments blanked and its literals kept. */
  readonly commentFree: string;
} {
  const literals: Array<SourceLiteral> = [];
  const jsxCharacters = source.split("");
  const codeCharacters = source.split("");

  const blank = (characters: Array<string>, start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
      }
    }
  };
  const mask = (start: number, end: number) => blank(jsxCharacters, start, end);
  const maskComment = (start: number, end: number) => {
    mask(start, end);
    blank(codeCharacters, start, end);
  };

  const readQuoted = (start: number, quote: "'" | '"'): number => {
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === quote) {
        const end = index + 1;
        literals.push({
          value: decodeSourceLiteral(source.slice(start + 1, index)),
          start,
          end,
        });
        mask(start, end);
        return end;
      }
      index += 1;
    }
    mask(start, source.length);
    return source.length;
  };

  const readLineComment = (start: number): number => {
    const newline = source.indexOf("\n", start + 2);
    const end = newline === -1 ? source.length : newline;
    maskComment(start, end);
    return end;
  };

  const readBlockComment = (start: number): number => {
    const close = source.indexOf("*/", start + 2);
    const end = close === -1 ? source.length : close + 2;
    maskComment(start, end);
    return end;
  };

  // A `/` opens a regex literal only where an expression may start; read as code, the quotes,
  // backticks and `//` inside a regex would open strings and comments and shift every later one.
  // The keyword test reads a short tail, not the whole prefix: no keyword is longer than six letters.
  const startsRegex = (start: number): boolean => {
    let previous = start - 1;
    while (previous >= 0 && /\s/u.test(codeCharacters[previous] ?? "")) previous -= 1;
    if (previous < 0) return true;
    if ("(,=:[!&|?{;+-*%~^".includes(codeCharacters[previous] ?? "")) return true;
    const before = codeCharacters.slice(Math.max(0, previous - 10), previous + 1).join("");
    return /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/u.test(
      before,
    );
  };

  const readRegex = (start: number): number => {
    let index = start + 1;
    let inClass = false;
    while (index < source.length) {
      const character = source[index];
      if (character === "\n" || character === "\r") return start + 1;
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (inClass) {
        if (character === "]") inClass = false;
      } else if (character === "[") {
        inClass = true;
      } else if (character === "/") {
        index += 1;
        while (index < source.length && /[a-z]/u.test(source[index] ?? "")) index += 1;
        return index;
      }
      index += 1;
    }
    return start + 1;
  };

  const readTemplate = (start: number): number => {
    let quasiStart = start + 1;
    let index = quasiStart;
    let braceDepth = 0;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === "`" && braceDepth === 0) {
        literals.push({
          value: decodeSourceLiteral(source.slice(quasiStart, index)),
          start: quasiStart,
          end: index,
        });
        const end = index + 1;
        mask(start, end);
        return end;
      }
      if (source[index] === "$" && source[index + 1] === "{" && braceDepth === 0) {
        literals.push({
          value: decodeSourceLiteral(source.slice(quasiStart, index)),
          start: quasiStart,
          end: index,
        });
        braceDepth = 1;
        index += 2;
        continue;
      }
      if (braceDepth > 0) {
        if (source[index] === "'" || source[index] === '"') {
          index = readQuoted(index, source[index] as "'" | '"');
          continue;
        }
        if (source[index] === "`") {
          index = readTemplate(index);
          continue;
        }
        if (source[index] === "/" && source[index + 1] === "/") {
          index = readLineComment(index);
          continue;
        }
        if (source[index] === "/" && source[index + 1] === "*") {
          index = readBlockComment(index);
          continue;
        }
        if (source[index] === "/" && startsRegex(index)) {
          index = readRegex(index);
          continue;
        }
        if (source[index] === "{") braceDepth += 1;
        if (source[index] === "}") {
          braceDepth -= 1;
          if (braceDepth === 0) quasiStart = index + 1;
        }
      }
      index += 1;
    }
    mask(start, source.length);
    return source.length;
  };

  let index = 0;
  while (index < source.length) {
    if (source[index] === "'" || source[index] === '"') {
      index = readQuoted(index, source[index] as "'" | '"');
    } else if (source[index] === "`") {
      index = readTemplate(index);
    } else if (source[index] === "/" && source[index + 1] === "/") {
      index = readLineComment(index);
    } else if (source[index] === "/" && source[index + 1] === "*") {
      index = readBlockComment(index);
    } else if (source[index] === "/" && startsRegex(index)) {
      index = readRegex(index);
    } else {
      index += 1;
    }
  }

  return {
    literals,
    jsxSource: jsxCharacters.join(""),
    commentFree: codeCharacters.join(""),
  };
}

export interface ForbiddenUse {
  readonly name: string;
  readonly pattern: RegExp;
}

export const globalUse = (name: string): ForbiddenUse => ({
  name,
  pattern: new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "u"),
});

export const TIMER_USES: ReadonlyArray<ForbiddenUse> = [
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
].map(globalUse);
