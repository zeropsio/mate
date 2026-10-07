#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off -- host codemod over source files.
/**
 * Effect 4.0.0-rc.115 → 4.0.1, the way upstream's 194c73f3f did it, re-runnable on any branch.
 *
 *   node scripts/effect-401-codemod.ts [dir] [--dry-run] [--fmt] [--include-import-zone]
 *
 * Rewrites, in every source, JSON, Markdown and YAML file under `dir` (default: cwd):
 * - `effect/unstable/<area>` → `effect/<area>`, `httpapi` → `http-api` (strings, imports,
 *   `import()`, and the `effect\/unstable\/` form inside regular expressions);
 * - `import * as X from "effect/Encoding"` → `effect/encoding/{Base64,Base64Url,Hex,EncodingError}`,
 *   each `X.member` to its new home (`randomHex` → `Hex.random`).
 *
 * Prints every change, then the sites it could not rewrite (hand fixes: APIs 4.0.1 removed) and
 * the sites whose meaning changed under the same name (checks). A second run changes nothing.
 * The Import zone (paths in `imported.lock`) is skipped: it is re-imported, never edited.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Built from parts so a run over this repository leaves this file alone.
const OLD_ROOT = ["effect", "unstable"].join("/");
const OLD_ENCODING = ["effect", "Encoding"].join("/");

/** The areas 4.0.1 exports at the package root; `httpapi` is the one that was renamed. */
const AREAS = new Map<string, string>([
  ["ai", "ai"],
  ["cli", "cli"],
  ["cluster", "cluster"],
  ["devtools", "devtools"],
  ["encoding", "encoding"],
  ["eventlog", "eventlog"],
  ["http", "http"],
  ["httpapi", "http-api"],
  ["net", "net"],
  ["observability", "observability"],
  ["persistence", "persistence"],
  ["process", "process"],
  ["reactivity", "reactivity"],
  ["rpc", "rpc"],
  ["schema", "schema"],
  ["socket", "socket"],
  ["sql", "sql"],
  ["workflow", "workflow"],
  ["workers", "workers"],
]);

/** `effect/Encoding` members → [module under effect/encoding, new name]. */
const ENCODING_MEMBERS = new Map<string, readonly [string, string]>([
  ["encodeBase64", ["Base64", "encode"]],
  ["decodeBase64", ["Base64", "decode"]],
  ["decodeBase64String", ["Base64", "decodeString"]],
  ["encodeBase64Url", ["Base64Url", "encode"]],
  ["decodeBase64Url", ["Base64Url", "decode"]],
  ["decodeBase64UrlString", ["Base64Url", "decodeString"]],
  ["encodeHex", ["Hex", "encode"]],
  ["decodeHex", ["Hex", "decode"]],
  ["decodeHexString", ["Hex", "decodeString"]],
  ["randomHex", ["Hex", "random"]],
  ["EncodingError", ["EncodingError", "EncodingError"]],
  ["EncodingErrorTypeId", ["EncodingError", "EncodingErrorTypeId"]],
  ["isEncodingError", ["EncodingError", "isEncodingError"]],
]);
const ENCODING_MODULE_ORDER = ["Base64", "Base64Url", "EncodingError", "Hex"];

export interface Site {
  readonly line: number;
  readonly message: string;
}

export interface FileResult {
  readonly text: string;
  readonly changes: ReadonlyArray<Site>;
  readonly handFixes: ReadonlyArray<Site>;
  readonly checks: ReadonlyArray<Site>;
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");

const rewriteUnstable = (text: string, changes: Array<Site>, handFixes: Array<Site>): string => {
  // Plain form: "effect/unstable/http/HttpClient".
  const plain = new RegExp(`${escapeRegExp(OLD_ROOT)}(?:/([A-Za-z][\\w-]*))?`, "gu");
  let out = text.replace(plain, (match, area: string | undefined, offset: number) => {
    const next = area === undefined ? undefined : AREAS.get(area);
    if (next === undefined) {
      handFixes.push({
        line: lineAt(text, offset),
        message: `\`${match}\` has no 4.0.1 home the codemod knows`,
      });
      return match;
    }
    changes.push({ line: lineAt(text, offset), message: `${match} → effect/${next}` });
    return `effect/${next}`;
  });
  // Escaped form inside a regular expression: /^effect\/unstable\/(?:http|socket)/.
  const escapedRoot = OLD_ROOT.replace("/", "\\/");
  const escaped = new RegExp(
    `${escapeRegExp(escapedRoot)}\\\\/(\\(\\?:[^)]*\\)|[A-Za-z][\\w-]*)`,
    "gu",
  );
  out = out.replace(escaped, (match, tail: string, offset: number) => {
    if (tail.startsWith("(?:")) {
      const names = tail.slice(3, -1).split("|");
      if (names.every((name) => AREAS.has(name))) {
        const next = `(?:${names.map((name) => AREAS.get(name)).join("|")})`;
        changes.push({ line: lineAt(out, offset), message: `${match} → effect\\/${next}` });
        return `effect\\/${next}`;
      }
    } else if (AREAS.has(tail)) {
      changes.push({
        line: lineAt(out, offset),
        message: `${match} → effect\\/${AREAS.get(tail)}`,
      });
      return `effect\\/${AREAS.get(tail)}`;
    }
    handFixes.push({
      line: lineAt(out, offset),
      message: `\`${match}\` in a pattern has no 4.0.1 home the codemod knows`,
    });
    return match;
  });
  return out;
};

const rewriteEncoding = (text: string, changes: Array<Site>, handFixes: Array<Site>): string => {
  const quoted = `(["'])${escapeRegExp(OLD_ENCODING)}\\`;
  const named = new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\}\\s+from\\s+${quoted}1`, "gu");
  for (const match of text.matchAll(named)) {
    handFixes.push({
      line: lineAt(text, match.index),
      message: `named import from ${OLD_ENCODING}: import its module from effect/encoding/* by hand`,
    });
  }
  const namespace = new RegExp(
    `^import\\s+(type\\s+)?\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+${quoted}3;?[ \\t]*\\n?`,
    "mu",
  );
  const found = namespace.exec(text);
  if (found === null) return text;
  const statement = found[0];
  const typeOnly = found[1] ?? "";
  const alias = found[2] ?? "";
  const importLine = lineAt(text, found.index);
  const importEnd = found.index + statement.length;
  const rest = text.slice(0, found.index) + text.slice(importEnd);
  const outsideImport = (match: RegExpExecArray) =>
    match.index < found.index || match.index >= importEnd;

  const memberUse = new RegExp(`(?<![\\w$.])${escapeRegExp(alias)}\\.([A-Za-z_$][\\w$]*)`, "gu");
  const bareUse = new RegExp(`(?<![\\w$.])${escapeRegExp(alias)}\\b(?!\\.)`, "gu");
  const needed = new Set<string>();
  let blocked = false;
  for (const use of [...text.matchAll(memberUse)].filter(outsideImport)) {
    const target = ENCODING_MEMBERS.get(use[1] ?? "");
    if (target === undefined) {
      blocked = true;
      handFixes.push({
        line: lineAt(text, use.index),
        message: `${alias}.${use[1]} has no 4.0.1 home the codemod knows`,
      });
    } else needed.add(target[0]);
  }
  for (const use of [...text.matchAll(bareUse)].filter(outsideImport)) {
    blocked = true;
    handFixes.push({
      line: lineAt(text, use.index),
      message: `${alias} used as a value, not as ${alias}.member: split it by hand`,
    });
  }
  const reuse = new Set<string>();
  for (const module of needed) {
    const existing = new RegExp(
      `import\\s+(?:type\\s+)?\\*\\s+as\\s+${module}\\s+from\\s+["']effect/encoding/${module}["']`,
      "u",
    );
    if (existing.test(rest)) {
      reuse.add(module);
      continue;
    }
    const clash = new RegExp(`(?<![\\w$.])${module}\\b`, "u").exec(rest);
    if (clash !== null) {
      blocked = true;
      handFixes.push({
        line: importLine,
        message: `\`${module}\` is already a name in this file: import effect/encoding/${module} under another name by hand`,
      });
    }
  }
  if (blocked) return text;

  const body = rest.replace(memberUse, (_match, member: string) => {
    const [module, name] = ENCODING_MEMBERS.get(member)!;
    return `${module}.${name}`;
  });
  const imports = ENCODING_MODULE_ORDER.filter((module) => needed.has(module) && !reuse.has(module))
    .map((module) => `import ${typeOnly}* as ${module} from "effect/encoding/${module}";\n`)
    .join("");
  changes.push({
    line: importLine,
    message:
      needed.size === 0
        ? `unused ${OLD_ENCODING} import removed`
        : `${OLD_ENCODING} → ${[...needed]
            .toSorted()
            .map((module) => `effect/encoding/${module}`)
            .join(", ")}`,
  });
  return body.slice(0, found.index) + imports + body.slice(found.index);
};

interface Pattern {
  readonly test: RegExp;
  readonly message: string;
  /** Only in files whose text matches this as well. */
  readonly within?: RegExp;
  /** Only in files whose path matches this. */
  readonly path?: RegExp;
}

/** APIs 4.0.1 removed: the code does not compile until a person rewrites it. */
const REMOVED: ReadonlyArray<Pattern> = [
  {
    test: /\bSchemaGetter\.on(?:Some|None)\b/u,
    message:
      "SchemaGetter.onSome/onNone were removed (upstream: onSome → SchemaGetter.transformEffect, without Effect.asSome)",
  },
  {
    test: /\b(?:SchemaGetter|SchemaTransformation)\.[\w$<>,\s]*\([^)]*\)\.compose\(/u,
    message:
      "the .compose method was removed: x.pipe(SchemaGetter.compose(y)) / x.pipe(SchemaTransformation.composeTransformation(y))",
  },
  {
    test: /\bSchema\.is(?:StartsWith|EndsWith|Includes|LengthBetween|SizeBetween|PropertiesLengthBetween)\b/u,
    message: "this Schema check was removed in 4.0.1",
  },
  {
    test: /\bRpcClient\.RequestHooks\b/u,
    message: "RpcClient.RequestHooks is gone (it lived in our rc.115 patch only)",
  },
  {
    test: /\bMcpSchema\.(?:BooleanSchema|EnumSchema|LegacyTitledEnumSchema|MultiSelectEnumSchema|NumberSchema|SingleSelectEnumSchema|StringSchema|TitledMultiSelectEnumSchema|TitledSingleSelectEnumSchema|ToolJsonSchema|UntitledMultiSelectEnumSchema|UntitledSingleSelectEnumSchema)\b/u,
    message: "this McpSchema export was removed in 4.0.1",
  },
];

/** Same name, different meaning in 4.0.1: a person confirms each site. */
const CHANGED: ReadonlyArray<Pattern> = [
  {
    test: /\b(?:Effect|Arr|Array|Chunk|Record|Rec|Option|Iterable)\.partition(?:Map)?\(/u,
    message:
      "partition now returns [passes, fails] (rc.115: [fails, passes]): swap the destructuring",
  },
  {
    test: /\bStream\.scan\(\s*(?!\(|function\b|async\b)/u,
    message: "Stream.scan takes a lazy initial state: pass () => initial",
  },
  {
    test: /\bTracerDisabledWhen\b/u,
    within: /\bHttpRouter\b|\bHttpMiddleware\b/u,
    message:
      "HttpRouter.serve builds its routes in a private memo map: a service merged into the routes no longer reaches them, provide it to the served layer",
  },
  {
    test: /\.structuredContent\b/u,
    path: /\.test\.tsx?$/u,
    message:
      "a declared MCP tool failure is now isError with its encoded payload as JSON text, never structuredContent",
  },
];

const scanPatterns = (
  text: string,
  path: string,
  patterns: ReadonlyArray<Pattern>,
  into: Array<Site>,
) => {
  const lines = text.split("\n");
  for (const pattern of patterns) {
    if (pattern.path !== undefined && !pattern.path.test(path)) continue;
    if (pattern.within !== undefined && !pattern.within.test(text)) continue;
    lines.forEach((line, index) => {
      if (pattern.test.test(line)) into.push({ line: index + 1, message: pattern.message });
    });
  }
};

/** One file's rewrite. Pure: the same input always gives the same output. */
export const rewriteFile = (path: string, text: string): FileResult => {
  const changes: Array<Site> = [];
  const handFixes: Array<Site> = [];
  const checks: Array<Site> = [];
  let out = rewriteUnstable(text, changes, handFixes);
  if (/\.(?:[cm]?[jt]sx?)$/u.test(path)) {
    out = rewriteEncoding(out, changes, handFixes);
    scanPatterns(out, path, REMOVED, handFixes);
    scanPatterns(out, path, CHANGED, checks);
  }
  const byLine = (a: Site, b: Site) => a.line - b.line;
  return {
    text: out,
    changes: changes.toSorted(byLine),
    handFixes: handFixes.toSorted(byLine),
    checks: checks.toSorted(byLine),
  };
};

const SOURCE = /\.(?:[cm]?[jt]sx?|json|jsonc|md|mdx|ya?ml)$/u;
const SKIP_DIRS = new Set([
  ".git",
  ".repos",
  ".reference",
  ".turbo",
  ".claude",
  ".alchemy",
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "coverage",
  "patches",
  "ios",
  "android",
]);
const SKIP_FILES = /(?:^|\/)(?:pnpm-lock\.yaml|effect-401-codemod(?:\.test)?\.ts)$/u;

const importZone = (root: string): ReadonlyArray<string> => {
  const lock = NodePath.join(root, "imported.lock");
  if (!NodeFS.existsSync(lock)) return [];
  const parsed = JSON.parse(NodeFS.readFileSync(lock, "utf8")) as {
    readonly paths?: Record<string, string>;
  };
  return Object.keys(parsed.paths ?? {});
};

export const listFiles = (
  root: string,
  options: { readonly includeImportZone: boolean },
): ReadonlyArray<string> => {
  const zone = options.includeImportZone ? [] : importZone(root);
  const files: Array<string> = [];
  const walk = (relative: string) => {
    for (const entry of NodeFS.readdirSync(NodePath.join(root, relative), {
      withFileTypes: true,
    })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (zone.includes(path)) continue;
        walk(path);
      } else if (entry.isFile() && SOURCE.test(entry.name) && !SKIP_FILES.test(path)) {
        files.push(path);
      }
    }
  };
  walk("");
  return files.toSorted();
};

export interface RunResult {
  readonly changed: ReadonlyArray<string>;
  readonly report: ReadonlyArray<{ readonly path: string; readonly result: FileResult }>;
}

export const run = (
  root: string,
  options: { readonly dryRun: boolean; readonly includeImportZone: boolean },
): RunResult => {
  const changed: Array<string> = [];
  const report: Array<{ path: string; result: FileResult }> = [];
  for (const path of listFiles(root, options)) {
    const absolute = NodePath.join(root, path);
    const text = NodeFS.readFileSync(absolute, "utf8");
    if (text.includes("\u0000")) continue;
    const result = rewriteFile(path, text);
    if (result.text !== text) {
      changed.push(path);
      if (!options.dryRun) NodeFS.writeFileSync(absolute, result.text);
    }
    if (result.changes.length + result.handFixes.length + result.checks.length > 0) {
      report.push({ path, result });
    }
  }
  return { changed, report };
};

const main = () => {
  const args = process.argv.slice(2);
  const root = NodePath.resolve(args.find((arg) => !arg.startsWith("--")) ?? ".");
  const dryRun = args.includes("--dry-run");
  const fmt = args.includes("--fmt");
  const includeImportZone = args.includes("--include-import-zone");
  const started = Date.now();
  const { changed, report } = run(root, { dryRun, includeImportZone });

  const print = (title: string, pick: (result: FileResult) => ReadonlyArray<Site>) => {
    const rows = report.flatMap(({ path, result }) =>
      pick(result).map((site) => `  ${path}:${site.line}  ${site.message}`),
    );
    console.log(`\n${title} (${rows.length})`);
    for (const row of rows) console.log(row);
    return rows.length;
  };
  print("Changed", (result) => result.changes);
  const handFixes = print("Hand fixes — 4.0.1 removed these", (result) => result.handFixes);
  print("Checks — same name, new meaning in 4.0.1", (result) => result.checks);
  console.log(
    `\n${changed.length} file(s) ${dryRun ? "would change" : "changed"}, ${handFixes} hand fix(es), in ${Date.now() - started} ms.`,
  );
  if (!includeImportZone && importZone(root).length > 0) {
    console.log(`Import zone skipped: ${importZone(root).join(", ")} (re-import, never edit).`);
  }

  if (fmt && !dryRun && changed.length > 0) {
    const vp = NodePath.join(root, "node_modules/.bin/vp");
    for (let index = 0; index < changed.length; index += 200) {
      NodeChildProcess.execFileSync(vp, ["fmt", ...changed.slice(index, index + 200)], {
        cwd: root,
        stdio: "inherit",
      });
    }
  }
};

if (import.meta.main) main();
