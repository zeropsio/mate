// The zone map (methodology §3): the fork imports two upstream packages
// byte-identically (pinned by imported.lock, scripts/imported-lock.ts) and
// ports the provider drivers behind an adapter SPI. This test machine-checks
// the two import-direction invariants that make those zones meaningful:
// the ported zone must stay Zerops-free, and owned product must reach
// providers only through the (not-yet-built) SPI, never their internals
// directly. No AST — small source scans over import and re-export syntax are
// enough for these checks.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";

const repoRootUrl = new URL("..", import.meta.url);
const repoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(repoRootUrl)),
);

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", "dist", "dist-electron"]);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

function collectTsFiles(
  root: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    if (!(yield* fs.exists(root))) {
      return [];
    }

    const rootStat = yield* fs.stat(root);
    if (rootStat.type === "File") {
      return TS_EXTENSIONS.has(path.extname(root)) ? [root] : [];
    }

    const entries = yield* fs.readDirectory(root);
    const files: Array<string> = [];
    for (const entry of entries) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry)) {
        continue;
      }
      const entryPath = path.join(root, entry);
      const entryStat = yield* fs.stat(entryPath);
      if (entryStat.type === "Directory") {
        files.push(...(yield* collectTsFiles(entryPath)));
      } else if (entryStat.type === "File" && TS_EXTENSIONS.has(path.extname(entry))) {
        files.push(entryPath);
      }
    }
    return files;
  });
}

// packages/contracts/src/provider*.ts names direct children only, not a
// recursive tree.
const collectProviderContractFiles = Effect.fn("collectProviderContractFiles")(function* (
  root: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contractsSrcDir = path.join(root, "packages/contracts/src");
  const entries = yield* fs.readDirectory(contractsSrcDir);
  return entries
    .filter((name) => /^provider.*\.ts$/.test(name))
    .map((name) => path.join(contractsSrcDir, name));
});

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
const REEXPORT_PATTERN = /export\s+(type\s+)?(\*|\{[^;]*?\})\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_CALL_PATTERN = /\bimport\s*\(\s*([^)]*?)\s*\)/gs;
const IMPORT_ASSIGNMENT_PATTERN = /\bimport\s+(?:type\s+)?[A-Za-z_$][\w$]*\s*=\s*require\s*\(/g;

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

function isPlainStringLiteral(value: string): boolean {
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

function collectDynamicImportArguments(source: string): ReadonlyArray<string> {
  return [...source.matchAll(DYNAMIC_IMPORT_CALL_PATTERN)].map((match) => match[1]!.trim());
}

function collectImportStatements(source: string): ReadonlyArray<ImportStatement> {
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
  for (const argument of collectDynamicImportArguments(source)) {
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

interface ExportBinding {
  readonly exported: string;
  readonly source: string;
  readonly typeOnly: boolean;
}

function collectExportBindings(clause: string): ReadonlyArray<ExportBinding> {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return [];
  }
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((binding) => binding.trim())
    .filter((binding) => binding.length > 0)
    .map((binding) => {
      const typeOnly = binding.startsWith("type ");
      const valueBinding = typeOnly ? binding.slice("type ".length).trim() : binding;
      const [source, exported = source] = valueBinding.split(/\s+as\s+/u);
      return { exported: exported!, source: source!, typeOnly };
    });
}

function requestedRuntimeExports(clause: string): ReadonlySet<string> | undefined {
  const trimmed = clause.trim();
  if (trimmed === "" || trimmed.startsWith("*")) {
    return undefined;
  }

  const requested = new Set<string>();
  const braceStart = trimmed.indexOf("{");
  if (braceStart === -1) {
    requested.add("default");
  } else {
    if (trimmed.slice(0, braceStart).replace(/,$/u, "").trim() !== "") {
      requested.add("default");
    }
    const braceEnd = trimmed.lastIndexOf("}");
    for (const binding of collectExportBindings(trimmed.slice(braceStart, braceEnd + 1))) {
      if (!binding.typeOnly) {
        requested.add(binding.source);
      }
    }
  }
  return requested.size === 0 ? undefined : requested;
}

function requestedReexportSources(
  clause: string,
  requestedExports: ReadonlySet<string>,
): ReadonlySet<string> {
  const requestedSources = new Set<string>();
  for (const binding of collectExportBindings(clause)) {
    if (!binding.typeOnly && requestedExports.has(binding.exported)) {
      requestedSources.add(binding.source);
    }
  }
  return requestedSources;
}

const THREAD_STATUS_PHRASES = [
  "Working",
  "Connecting",
  "Monitoring",
  "Failed",
  "Plan Ready",
  "Done",
  "Woke",
  "Approval",
  "Input",
  "Pending Approval",
  "Awaiting Input",
  "Completed",
  "Waiting",
] as const;

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

function scanSourceLiterals(source: string): {
  readonly literals: ReadonlyArray<SourceLiteral>;
  readonly jsxSource: string;
} {
  const literals: Array<SourceLiteral> = [];
  const jsxCharacters = source.split("");

  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (jsxCharacters[index] !== "\n" && jsxCharacters[index] !== "\r") {
        jsxCharacters[index] = " ";
      }
    }
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
    mask(start, end);
    return end;
  };

  const readBlockComment = (start: number): number => {
    const close = source.indexOf("*/", start + 2);
    const end = close === -1 ? source.length : close + 2;
    mask(start, end);
    return end;
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
    } else {
      index += 1;
    }
  }

  return { literals, jsxSource: jsxCharacters.join("") };
}

function findLocalThreadStatusPhrases(source: string): ReadonlyArray<string> {
  const phrases = new Set<string>(THREAD_STATUS_PHRASES);
  const found = new Set<string>();
  const { literals, jsxSource } = scanSourceLiterals(source);
  const sortedLiterals = [...literals].sort((left, right) => left.start - right.start);

  for (const literal of sortedLiterals) {
    const value = literal.value.trim();
    if (phrases.has(value)) found.add(value);
  }
  for (let index = 0; index < sortedLiterals.length - 1; index += 1) {
    const left = sortedLiterals[index]!;
    const right = sortedLiterals[index + 1]!;
    if (!/^\s*\+\s*$/u.test(source.slice(left.end, right.start))) continue;
    const value = `${left.value}${right.value}`.trim();
    if (phrases.has(value)) found.add(value);
  }
  for (const match of jsxSource.matchAll(/>([^<>]*)</gsu)) {
    const value = match[1]?.trim() ?? "";
    if (phrases.has(value)) found.add(value);
  }

  return [...found].sort();
}

interface ImportViolation {
  readonly file: string;
  readonly specifier: string;
}

interface SourceFile {
  readonly file: string;
  readonly source: string;
}

const UI_IMPORT_PREFIXES = [
  "react",
  "react-dom",
  "react-native",
  "expo",
  "expo-",
  "@effect/atom-react",
] as const;

function collectUiImportViolations(
  files: ReadonlyArray<SourceFile>,
): ReadonlyArray<ImportViolation> {
  const violations: Array<ImportViolation> = [];
  for (const file of files) {
    for (const { specifier } of collectImportStatements(file.source)) {
      if (UI_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
        violations.push({ file: file.file, specifier });
      }
    }
  }
  return violations;
}

// Dependency rules 2 and 3 of the client state model
// (docs/internals/zerops/client-state-model.md, "Module boundaries"). A zone is
// a set of paths under `cr/zerops`, matched by name so that a module landing at
// a zone path is checked from its first commit; a path with no file yet holds
// vacuously. Each zone file is walked through its value imports: relative
// edges are followed transitively, a type-only edge is erased at compile time
// and skipped, and a package edge must name a pure effect data module or a
// pure shared module.
const CLIENT_RUNTIME_ZEROPS_DIR = "packages/client-runtime/src/zerops";

// Effect modules that compute values and run nothing. Every other `effect`
// module (Effect, Stream, Layer, Fiber, Schedule, Clock, Schema, the bare
// `effect` barrel, …) and every other package is out of bounds for a value
// import from a pure zone; a type-only import of any of them is allowed.
const PURE_EFFECT_MODULES: ReadonlySet<string> = new Set([
  "effect/Array",
  "effect/Equal",
  "effect/Equivalence",
  "effect/Function",
  "effect/Hash",
  "effect/Option",
  "effect/Order",
  "effect/Predicate",
  "effect/Record",
  "effect/Result",
  "effect/Struct",
]);

// Shared modules that compute values, import nothing and run nothing.
const PURE_SHARED_MODULES: ReadonlySet<string> = new Set(["@t3tools/shared/semver"]);

// A use no pure zone file may make, reported as `uses ${name}`.
interface ForbiddenUse {
  readonly name: string;
  readonly pattern: RegExp;
}

const globalUse = (name: string): ForbiddenUse => ({
  name,
  pattern: new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "u"),
});

const NETWORK_AND_STORAGE_USES: ReadonlyArray<ForbiddenUse> = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "localStorage",
  "sessionStorage",
  "indexedDB",
].map(globalUse);

const TIMER_USES: ReadonlyArray<ForbiddenUse> = [
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
].map(globalUse);

// Reads of the wall or the monotonic clock. Time reaches a machine, reducer or
// pure projection only through `ctx.now`.
const CLOCK_READS: ReadonlyArray<ForbiddenUse> = [
  { name: "Date.now", pattern: /(?<![\w$])Date\s*\.\s*now(?![\w$])/u },
  { name: "performance.now", pattern: /(?<![\w$])performance\s*\.\s*now(?![\w$])/u },
  // `new Date()` and `new Date` read the clock; `new Date(value)` does not.
  { name: "new Date()", pattern: /(?<![\w$])new\s+Date(?![\w$])(?!\s*\(\s*[^\s)])/u },
];

const FORBIDDEN_USES: ReadonlyArray<ForbiddenUse> = [
  ...NETWORK_AND_STORAGE_USES,
  ...TIMER_USES,
  ...CLOCK_READS,
];

interface PureZone {
  readonly contains: (zeropsRelativeFile: string) => boolean;
}

// `knowledge/` ports and the invalidation bus are drivers, not reducers.
const KNOWLEDGE_DRIVER_FILES: ReadonlySet<string> = new Set([
  "knowledge/invalidation.ts",
  "knowledge/signals.ts",
  "knowledge/clock.ts",
]);

// Rule 2: machine and reducer files import no Effect runtime, fetch or
// storage, read no clock and set no timer.
const MACHINE_ZONE: PureZone = {
  contains: (file) =>
    (file.startsWith("knowledge/") && !KNOWLEDGE_DRIVER_FILES.has(file)) ||
    file === "data/access/grant.ts" ||
    file === "environments/reachability.ts" ||
    file === "environments/gate.ts" ||
    /Machine\.tsx?$/u.test(file),
};

// Rule 3: projections and the named pure modules are pure — no Effect runtime,
// fetch, storage, clock or timers.
const PURE_PROJECTION_ZONE: PureZone = {
  contains: (file) =>
    file.startsWith("projections/") ||
    file === "flow/groupFlow.ts" ||
    file === "environments/reachability.ts" ||
    file === "environments/gate.ts",
};

function isTestFile(file: string): boolean {
  return /\.test\.tsx?$/u.test(file);
}

interface PureZoneViolation {
  readonly root: string;
  readonly file: string;
  readonly reason: string;
}

function collectPureZoneViolations(
  root: string,
  zone: PureZone,
): Effect.Effect<
  ReadonlyArray<PureZoneViolation>,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const zeropsDir = path.join(root, CLIENT_RUNTIME_ZEROPS_DIR);
    const label = (file: string): string => path.relative(root, file).split(path.sep).join("/");
    const zoneFiles = (yield* collectTsFiles(zeropsDir)).filter(
      (file) =>
        !isTestFile(file) &&
        zone.contains(path.relative(zeropsDir, file).split(path.sep).join("/")),
    );

    const violations: Array<PureZoneViolation> = [];
    for (const zoneFile of zoneFiles) {
      const visited = new Set<string>();
      const pending = [zoneFile];
      while (pending.length > 0) {
        const file = pending.pop()!;
        if (visited.has(file)) {
          continue;
        }
        visited.add(file);
        const report = (reason: string) =>
          violations.push({ root: label(zoneFile), file: label(file), reason });

        const source = yield* fs.readFileString(file);
        const code = scanSourceLiterals(source).jsxSource;
        for (const use of FORBIDDEN_USES) {
          if (use.pattern.test(code)) {
            report(`uses ${use.name}`);
          }
        }
        if (collectDynamicImportArguments(source).length > 0) {
          report("uses a dynamic import");
        }
        if ((source.match(IMPORT_ASSIGNMENT_PATTERN)?.length ?? 0) > 0) {
          report("uses a TypeScript import assignment");
        }

        for (const statement of collectImportStatements(source)) {
          if (statement.typeOnly) {
            continue;
          }
          if (!statement.specifier.startsWith(".")) {
            if (
              !PURE_EFFECT_MODULES.has(statement.specifier) &&
              !PURE_SHARED_MODULES.has(statement.specifier)
            ) {
              report(`imports ${statement.specifier}, which is not a pure effect data module`);
            }
            continue;
          }
          const unresolved = path.resolve(path.dirname(file), statement.specifier);
          const extension = path.extname(unresolved);
          const candidates =
            TS_EXTENSIONS.has(extension) || extension === ".json"
              ? [unresolved]
              : [
                  `${unresolved}.ts`,
                  `${unresolved}.tsx`,
                  path.join(unresolved, "index.ts"),
                  path.join(unresolved, "index.tsx"),
                ];
          let imported: string | undefined;
          for (const candidate of candidates) {
            if (imported === undefined && (yield* fs.exists(candidate))) {
              imported = candidate;
            }
          }
          if (imported === undefined) {
            report(`imports ${statement.specifier}, which does not resolve to a module`);
          } else if (TS_EXTENSIONS.has(path.extname(imported))) {
            pending.push(imported);
          }
        }
      }
    }

    return violations.sort(
      (left, right) =>
        left.root.localeCompare(right.root) ||
        left.file.localeCompare(right.file) ||
        left.reason.localeCompare(right.reason),
    );
  });
}

// Rule 6: dependencies run one way — data ← environments ← flow and
// data ← forge ← flow — and nothing under `cr/zerops` depends on `account/`
// except `account/` itself and the `testing/` harness, which drives sessions.
// Every import edge counts, type-only included: the rule is about the module
// graph, not the emitted code. Test files are not part of the graph.
const FORBIDDEN_LAYER_EDGES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["data", new Set(["environments", "forge", "flow"])],
  ["environments", new Set(["flow"])],
  ["forge", new Set(["flow"])],
]);

interface OneWayViolation {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

function collectOneWayViolations(
  root: string,
): Effect.Effect<ReadonlyArray<OneWayViolation>, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const zeropsDir = path.join(root, CLIENT_RUNTIME_ZEROPS_DIR);
    // The top-level directory of a path under `cr/zerops`, or undefined for a
    // top-level file or a path outside it.
    const layerOf = (file: string): string | undefined => {
      const segments = path.relative(zeropsDir, file).split(path.sep);
      const [first] = segments;
      if (first === undefined || first === ".." || first === "") {
        return undefined;
      }
      return segments.length > 1 || !TS_EXTENSIONS.has(path.extname(first)) ? first : undefined;
    };

    const violations: Array<OneWayViolation> = [];
    for (const file of yield* collectTsFiles(zeropsDir)) {
      if (isTestFile(file)) {
        continue;
      }
      const fromLayer = layerOf(file);
      const source = yield* fs.readFileString(file);
      for (const { specifier } of collectImportStatements(source)) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        const toLayer = layerOf(path.resolve(path.dirname(file), specifier));
        const report = (reason: string) =>
          violations.push({
            file: path.relative(root, file).split(path.sep).join("/"),
            specifier,
            reason,
          });
        if (toLayer === "account" && fromLayer !== "account" && fromLayer !== "testing") {
          report("only account/ and testing/ may depend on account/");
        } else if (
          fromLayer !== undefined &&
          toLayer !== undefined &&
          FORBIDDEN_LAYER_EDGES.get(fromLayer)?.has(toLayer)
        ) {
          report(`${fromLayer}/ must not depend on ${toLayer}/`);
        }
      }
    }

    return violations.sort(
      (left, right) =>
        left.file.localeCompare(right.file) || left.specifier.localeCompare(right.specifier),
    );
  });
}

// Rule 5: `Cell`, `newCell`, `advance` and `read` stay private to the stores
// (docs/internals/zerops/client-state-model.md, "Module boundaries"). A store is
// the knowledge kernel itself, the store kit, the data runtime (one store whose
// internals hold its cells) or a module named `…Store`. Every edge counts, a
// type-only `Cell` included, and a namespace, star or dynamic import of the
// module counts as importing all of it. Test files are not part of the graph.
const KNOWN_MODULE = "knowledge/known";
const KNOWN_PACKAGE_SPECIFIER = "@t3tools/client-runtime/zerops/knowledge/known";
const STORE_PRIVATE_KNOWLEDGE: ReadonlySet<string> = new Set([
  "Cell",
  "newCell",
  "advance",
  "read",
]);
const CELL_IMPORT_SCAN_ROOTS = ["packages/client-runtime/src", "apps/web/src", "apps/mobile/src"];

function isStoreModule(zeropsRelativeFile: string): boolean {
  return (
    zeropsRelativeFile.startsWith("knowledge/") ||
    zeropsRelativeFile.startsWith("store/") ||
    zeropsRelativeFile.startsWith("data/") ||
    /Store\.tsx?$/u.test(zeropsRelativeFile)
  );
}

// The names a clause binds from its module, or undefined when it binds the
// whole module (`* as X`, `export *`).
function importedNames(clause: string): ReadonlyArray<string> | undefined {
  if (clause.trim() === "*" || /\*\s+as\s/u.test(clause)) {
    return undefined;
  }
  const braced = /\{([^}]*)\}/u.exec(clause)?.[1] ?? "";
  return braced
    .split(",")
    .map((binding) => binding.trim().replace(/^type\s+/u, ""))
    .filter((binding) => binding.length > 0)
    .map((binding) => binding.split(/\s+as\s+/u)[0]!);
}

interface CellImportViolation {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

function collectCellImportViolations(
  root: string,
): Effect.Effect<
  ReadonlyArray<CellImportViolation>,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const zeropsDir = path.join(root, CLIENT_RUNTIME_ZEROPS_DIR);
    const knownModule = path.join(zeropsDir, KNOWN_MODULE);
    const withoutExtension = (specifier: string): string =>
      specifier.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
    const namesKnownModule = (file: string, specifier: string): boolean =>
      specifier.startsWith(".")
        ? withoutExtension(path.resolve(path.dirname(file), specifier)) === knownModule
        : withoutExtension(specifier) === KNOWN_PACKAGE_SPECIFIER;

    const violations: Array<CellImportViolation> = [];
    for (const scanRoot of CELL_IMPORT_SCAN_ROOTS) {
      for (const file of yield* collectTsFiles(path.join(root, scanRoot))) {
        const zeropsRelative = path.relative(zeropsDir, file).split(path.sep).join("/");
        if (
          isTestFile(file) ||
          (!zeropsRelative.startsWith("..") && isStoreModule(zeropsRelative))
        ) {
          continue;
        }
        const source = yield* fs.readFileString(file);
        const report = (specifier: string, reason: string) =>
          violations.push({
            file: path.relative(root, file).split(path.sep).join("/"),
            specifier,
            reason,
          });
        const whole = "imports the whole knowledge/known module outside a store";

        for (const statement of collectImportStatements(source)) {
          if (!namesKnownModule(file, statement.specifier)) {
            continue;
          }
          // A side-effect or dynamic import has no clause; dynamic ones are
          // reported below, side-effect ones bind nothing.
          if (statement.clause === "" && !statement.reexport) {
            continue;
          }
          const names = importedNames(statement.clause);
          if (names === undefined) {
            report(statement.specifier, whole);
            continue;
          }
          for (const name of names) {
            if (STORE_PRIVATE_KNOWLEDGE.has(name)) {
              report(statement.specifier, `imports ${name} outside a store`);
            }
          }
        }
        for (const argument of collectDynamicImportArguments(source)) {
          if (isPlainStringLiteral(argument) && namesKnownModule(file, argument.slice(1, -1))) {
            report(argument.slice(1, -1), whole);
          }
        }
      }
    }

    return violations.sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.specifier.localeCompare(right.specifier) ||
        left.reason.localeCompare(right.reason),
    );
  });
}

// Rule 5, second half: a Known's `.value` is read only in `cr/zerops` — the
// knowledge kernel, the stores' selectors and the projections — so web and
// mobile render presentations and view models, never a raw value. Without
// types a Known is recognised by its narrowing: an expression compared with
// `.state === "known"` (or `!==`, or switched on with a `case "known"`) whose
// `.value` the same file reads. A Known destructured (`const { value } = …`),
// passed through a helper, or read in a file that never narrows it is a gap;
// inside `cr/zerops` a selector and its store share modules, so no file split
// is checked there.
const KNOWN_VALUE_SCAN_ROOTS = ["apps/web/src", "apps/mobile/src"];
const NARROWED_EXPRESSION = String.raw`[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*`;
const KNOWN_NARROWING_PATTERNS = [
  new RegExp(String.raw`(${NARROWED_EXPRESSION})\??\.state\s*[!=]==?\s*["']known["']`, "gu"),
  new RegExp(String.raw`["']known["']\s*[!=]==?\s*(${NARROWED_EXPRESSION})\??\.state`, "gu"),
];
const KNOWN_SWITCH_PATTERN = new RegExp(
  String.raw`switch\s*\(\s*(${NARROWED_EXPRESSION})\??\.state\s*\)`,
  "gu",
);
const KNOWN_CASE_PATTERN = /case\s*["']known["']/u;

// Known-value reads outside `cr/zerops` that a named slice removes. Each entry
// must still match a read, so a fixed site's entry goes with the fix.
const KNOWN_VALUE_READ_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  [
    "apps/web/src/components/zerops/ZeropsEnvironmentCreation.tsx deployment.value",
    "state-model 4.4: the deployment store answers which services run nothing as a selector",
  ],
]);

interface KnownValueRead {
  readonly file: string;
  readonly read: string;
}

function knownNarrowings(source: string): ReadonlySet<string> {
  const narrowed = new Set<string>();
  for (const pattern of KNOWN_NARROWING_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      narrowed.add(match[1]!.replaceAll("?.", "."));
    }
  }
  if (KNOWN_CASE_PATTERN.test(source)) {
    for (const match of source.matchAll(KNOWN_SWITCH_PATTERN)) {
      narrowed.add(match[1]!.replaceAll("?.", "."));
    }
  }
  return narrowed;
}

function collectKnownValueReads(
  root: string,
): Effect.Effect<ReadonlyArray<KnownValueRead>, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const reads: Array<KnownValueRead> = [];
    for (const scanRoot of KNOWN_VALUE_SCAN_ROOTS) {
      for (const file of yield* collectTsFiles(path.join(root, scanRoot))) {
        if (isTestFile(file)) {
          continue;
        }
        const source = yield* fs.readFileString(file);
        for (const expression of knownNarrowings(source)) {
          const segments = expression
            .split(".")
            .map((segment) => segment.replaceAll("$", String.raw`\$`));
          const valueRead = new RegExp(
            String.raw`(?<![\w$.])${segments.join(String.raw`\??\.`)}\??\.value(?![\w$])`,
            "u",
          );
          if (valueRead.test(source)) {
            reads.push({
              file: path.relative(root, file).split(path.sep).join("/"),
              read: `${expression}.value`,
            });
          }
        }
      }
    }
    return reads.sort(
      (left, right) => left.file.localeCompare(right.file) || left.read.localeCompare(right.read),
    );
  });
}

// Keep this list identical to t3code/no-infinite-motion's protected roots.
const PROTECTED_ROOTS = [
  "apps/web/src/components/zerops/ZeropsServiceMap.tsx",
  "apps/web/src/components/zerops/ZeropsLifecycleStrip.tsx",
  "apps/web/src/components/zerops/ZeropsOperationCard.tsx",
  "apps/web/src/components/zerops/ZeropsQuickActions.tsx",
] as const;

const FORBIDDEN_PROTECTED_MODULES = new Map<string, string>([
  ["apps/web/src/zerops/commands.ts", "reviewed Zerops RPC command atoms"],
  ["apps/web/src/state/zeropsCommands.ts", "application Zerops command atoms"],
  ["apps/web/src/state/use-atom-command.ts", "write-only atom command runner"],
  ["apps/web/src/zerops/useAgentLogin.ts", "starts a server-side agent login"],
  ["apps/web/src/zerops/useAgentLoginCancel.ts", "cancels a server-side agent login"],
  ["apps/web/src/zerops/ZeropsSessionProvider.tsx", "mutates the Zerops platform session"],
  ["apps/web/src/zerops/useZeropsProvisioning.ts", "creates a Zerops project"],
  [
    "apps/web/src/components/zerops/ZeropsProjectsPage.tsx",
    "creates projects and restarts services",
  ],
]);

const FORBIDDEN_PROTECTED_PACKAGE_SPECIFIERS = new Map<string, string>([
  ["@t3tools/client-runtime/zerops", "the Zerops platform REST client can mutate projects"],
]);

const FORBIDDEN_PROTECTED_BINDING_NAMES = new Map<string, string>([
  ["createEnvironmentRpcCommand", "constructs an environment RPC command"],
  ["runAtomCommand", "runs an atom command"],
  ["useAtomCommand", "runs an atom command from React"],
  ["ZeropsApiClient", "the Zerops platform REST client can mutate projects"],
]);

// Mirrors apps/server/src/auth/RpcAuthorization.ts:94–107. Mutability is
// authored there and is never inferred from a `subscribe` prefix or verb.
const PROTECTED_WS_READ_METHODS = new Set([
  "zeropsLifecycleGet",
  "subscribeZeropsLifecycle",
  "subscribeZeropsAgentAuth",
  "subscribeZeropsBrowserStream",
]);
const PROTECTED_WS_ALLOWED_COMMAND_METHODS = new Set([
  "zeropsAgentLoginStart",
  "zeropsAgentLoginCancel",
  "zeropsAgentLoginSubmitCode",
]);

const SHARED_RUNTIME_READ_SCOPE_METHODS = new Map<string, ReadonlySet<string>>([
  // The shared atom runtime installs this reporter. The server authors these methods as AuthOrchestrationReadScope in RpcAuthorization.ts:52,92,93.
  [
    "apps/web/src/lib/backgroundActivityReporter.ts",
    new Set(["subscribeResourceTelemetry", "subscribeVcsStatus", "serverReportClientActivity"]),
  ],
]);

const LATENCY_CLASSIFICATION_ONLY_OPERATE_METHODS = new Map<string, ReadonlySet<string>>([
  // These operate-scope tokens appear only as latency-classification Set members at requestLatencyState.ts:33–35, never as calls.
  [
    "apps/web/src/rpc/requestLatencyState.ts",
    new Set(["serverUpdateProvider", "serverRefreshProviders", "serverUpdateServer"]),
  ],
]);

interface ProtectedRootViolation {
  readonly root: string;
  readonly file: string;
  readonly reason: string;
}

function walkProtectedRoot(
  rootFile: string,
  webSrcDir: string,
): Effect.Effect<
  ReadonlyArray<ProtectedRootViolation>,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const rootDir = path.resolve(webSrcDir, "../../..");
    const clientRuntimeDir = path.join(rootDir, "packages/client-runtime");
    const clientRuntimeSrcDir = path.join(clientRuntimeDir, "src");
    const clientRuntimePackageJson = decodeUnknownJson(
      yield* fs.readFileString(path.join(clientRuntimeDir, "package.json")),
    );
    const packageExports = new Map<string, string>();
    if (
      typeof clientRuntimePackageJson === "object" &&
      clientRuntimePackageJson !== null &&
      "exports" in clientRuntimePackageJson &&
      typeof clientRuntimePackageJson.exports === "object" &&
      clientRuntimePackageJson.exports !== null
    ) {
      for (const [subpath, conditions] of Object.entries(clientRuntimePackageJson.exports)) {
        if (typeof conditions === "string") {
          packageExports.set(subpath, conditions);
          continue;
        }
        if (typeof conditions !== "object" || conditions === null) {
          continue;
        }
        const target =
          "default" in conditions && typeof conditions.default === "string"
            ? conditions.default
            : "import" in conditions && typeof conditions.import === "string"
              ? conditions.import
              : undefined;
        if (target !== undefined) {
          packageExports.set(subpath, target);
        }
      }
    }

    const moduleLabel = (file: string): string => path.relative(rootDir, file);
    const root = moduleLabel(rootFile);
    const scannedFiles = new Set<string>();
    const visitedTraversals = new Set<string>();
    const violations: Array<ProtectedRootViolation> = [];

    const resolveLocalModule = Effect.fn("resolveProtectedLocalModule")(function* (
      fromFile: string,
      specifier: string,
    ) {
      const unresolved = specifier.startsWith("~/")
        ? path.join(webSrcDir, specifier.slice(2))
        : specifier.startsWith(".")
          ? path.resolve(path.dirname(fromFile), specifier)
          : specifier.startsWith("@t3tools/client-runtime/")
            ? (() => {
                const subpath = `.${specifier.slice("@t3tools/client-runtime".length)}`;
                const target = packageExports.get(subpath);
                if (target === undefined) {
                  return undefined;
                }
                const targetPath = path.resolve(clientRuntimeDir, target);
                const relativeTarget = path.relative(clientRuntimeSrcDir, targetPath);
                return relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`)
                  ? undefined
                  : targetPath;
              })()
            : undefined;
      if (unresolved === undefined) {
        return undefined;
      }

      // Match the web resolver: source files precede directory indexes, and
      // `.ts` precedes `.tsx` when an extensionless specifier has both.
      const candidates = TS_EXTENSIONS.has(path.extname(unresolved))
        ? [unresolved]
        : [
            `${unresolved}.ts`,
            `${unresolved}.tsx`,
            path.join(unresolved, "index.ts"),
            path.join(unresolved, "index.tsx"),
          ];
      for (const candidate of candidates) {
        if (yield* fs.exists(candidate)) {
          return candidate;
        }
      }
      return undefined;
    });

    const exportProviderCache = new Map<string, boolean>();
    const moduleProvidesExport: (
      file: string,
      exportName: string,
      trail: ReadonlySet<string>,
    ) => Effect.Effect<boolean, PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fn(
      "protectedModuleProvidesExport",
    )(function* (file: string, exportName: string, trail: ReadonlySet<string>) {
      const cacheKey = `${file}\0${exportName}`;
      const cached = exportProviderCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
      if (trail.has(cacheKey)) {
        return false;
      }

      const nextTrail = new Set(trail);
      nextTrail.add(cacheKey);
      const source = yield* fs.readFileString(file);
      const escapedExportName = exportName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      if (
        new RegExp(
          `\\bexport\\s+(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${escapedExportName}\\b`,
          "u",
        ).test(source) ||
        (exportName === "default" && /\bexport\s+default\b/u.test(source))
      ) {
        exportProviderCache.set(cacheKey, true);
        return true;
      }

      for (const statement of collectImportStatements(source)) {
        if (!statement.reexport || statement.typeOnly) {
          continue;
        }
        const importedFile = yield* resolveLocalModule(file, statement.specifier);
        if (importedFile === undefined) {
          continue;
        }
        if (statement.clause === "*") {
          if (yield* moduleProvidesExport(importedFile, exportName, nextTrail)) {
            exportProviderCache.set(cacheKey, true);
            return true;
          }
          continue;
        }
        if (
          collectExportBindings(statement.clause).some(
            (binding) => !binding.typeOnly && binding.exported === exportName,
          )
        ) {
          exportProviderCache.set(cacheKey, true);
          return true;
        }
      }

      exportProviderCache.set(cacheKey, false);
      return false;
    });

    const visit: (
      file: string,
      requestedExports?: ReadonlySet<string>,
    ) => Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> = Effect.fn(
      "visitProtectedModule",
    )(function* (file: string, requestedExports?: ReadonlySet<string>) {
      const traversalKey = `${file}\0${
        requestedExports === undefined ? "*" : [...requestedExports].sort().join(",")
      }`;
      if (visitedTraversals.has(traversalKey)) {
        return;
      }
      visitedTraversals.add(traversalKey);

      const fileLabel = moduleLabel(file);
      const source = yield* fs.readFileString(file);
      if (!scannedFiles.has(file)) {
        scannedFiles.add(file);
        /**
         * Rule 6 applies the forbidden-binding and WS_METHODS checks to every
         * web file and every `packages/client-runtime/src/zerops/**` target.
         * The client-runtime core is trusted infrastructure that protected
         * roots reach only for subscriptions; host-literal, dynamic-import,
         * and import-assignment checks still apply to every core target and
         * relative edge.
         */
        const checksProtectedCommandVocabulary =
          fileLabel.startsWith("apps/web/src/") ||
          fileLabel.startsWith("packages/client-runtime/src/zerops/");
        const forbiddenModuleReason = FORBIDDEN_PROTECTED_MODULES.get(fileLabel);
        if (forbiddenModuleReason !== undefined) {
          violations.push({ root, file: fileLabel, reason: forbiddenModuleReason });
        }

        if (source.includes("zerops.io")) {
          violations.push({
            root,
            file: fileLabel,
            reason: "contains the Zerops API host literal zerops.io",
          });
        }

        for (const argument of collectDynamicImportArguments(source)) {
          if (!isPlainStringLiteral(argument)) {
            violations.push({
              root,
              file: fileLabel,
              reason: "dynamic import argument is not a plain string literal",
            });
          }
        }

        const importAssignmentCount = source.match(IMPORT_ASSIGNMENT_PATTERN)?.length ?? 0;
        for (let index = 0; index < importAssignmentCount; index += 1) {
          violations.push({
            root,
            file: fileLabel,
            reason: "TypeScript import assignments are not allowed in protected graphs",
          });
        }

        if (checksProtectedCommandVocabulary) {
          for (const [binding, reason] of FORBIDDEN_PROTECTED_BINDING_NAMES) {
            if (new RegExp(`\\b${binding}\\b`, "u").test(source)) {
              violations.push({ root, file: fileLabel, reason });
            }
          }

          for (const match of source.matchAll(/\bWS_METHODS\.([A-Za-z0-9_]+)/g)) {
            const method = match[1]!;
            if (
              !PROTECTED_WS_READ_METHODS.has(method) &&
              !PROTECTED_WS_ALLOWED_COMMAND_METHODS.has(method) &&
              !SHARED_RUNTIME_READ_SCOPE_METHODS.get(fileLabel)?.has(method) &&
              !LATENCY_CLASSIFICATION_ONLY_OPERATE_METHODS.get(fileLabel)?.has(method)
            ) {
              violations.push({
                root,
                file: fileLabel,
                reason: `WS_METHODS.${method} is not in the reviewed read or allowed-command set`,
              });
            }
          }
        }
      }

      for (const statement of collectImportStatements(source)) {
        const isClientRuntimePackageSpecifier = statement.specifier.startsWith(
          "@t3tools/client-runtime/",
        );
        const importedFile = yield* resolveLocalModule(file, statement.specifier);
        if (isClientRuntimePackageSpecifier && importedFile === undefined) {
          violations.push({ root, file: fileLabel, reason: "unresolved package subpath" });
          continue;
        }
        if (statement.typeOnly) {
          continue;
        }

        const forbiddenPackageReason = FORBIDDEN_PROTECTED_PACKAGE_SPECIFIERS.get(
          statement.specifier,
        );
        if (forbiddenPackageReason !== undefined) {
          violations.push({ root, file: fileLabel, reason: forbiddenPackageReason });
          continue;
        }

        if (importedFile !== undefined) {
          if (statement.reexport && requestedExports !== undefined) {
            if (statement.clause === "*") {
              const providedExports = new Set<string>();
              for (const exportName of requestedExports) {
                if (yield* moduleProvidesExport(importedFile, exportName, new Set())) {
                  providedExports.add(exportName);
                }
              }
              if (providedExports.size > 0) {
                yield* visit(importedFile, providedExports);
              }
            } else {
              const requestedSources = requestedReexportSources(statement.clause, requestedExports);
              if (requestedSources.size > 0) {
                yield* visit(importedFile, requestedSources);
              }
            }
          } else {
            yield* visit(
              importedFile,
              isClientRuntimePackageSpecifier
                ? requestedRuntimeExports(statement.clause)
                : undefined,
            );
          }
        }
      }
    });

    yield* visit(rootFile);
    return violations;
  });
}

const makeProtectedRootFixture = Effect.fn("makeProtectedRootFixture")(function* (
  files: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixtureRoot = yield* fs.makeTempDirectoryScoped({ prefix: "mate-protected-root-" });
  const webSrcDir = path.join(fixtureRoot, "apps/web/src");
  for (const [relativePath, source] of Object.entries(files)) {
    const file = path.join(webSrcDir, relativePath);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, source);
  }
  const packageJson = path.join(fixtureRoot, "packages/client-runtime/package.json");
  if (!(yield* fs.exists(packageJson))) {
    yield* fs.makeDirectory(path.dirname(packageJson), { recursive: true });
    yield* fs.writeFileString(packageJson, encodeUnknownJson({ exports: {} }));
  }
  return {
    rootFile: path.join(webSrcDir, "components/Root.tsx"),
    webSrcDir,
  };
});

const makeClientRuntimeZeropsFixture = Effect.fn("makeClientRuntimeZeropsFixture")(function* (
  files: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixtureRoot = yield* fs.makeTempDirectoryScoped({ prefix: "mate-zerops-zones-" });
  for (const [relativePath, source] of Object.entries(files)) {
    const file = path.join(fixtureRoot, CLIENT_RUNTIME_ZEROPS_DIR, relativePath);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, source);
  }
  return fixtureRoot;
});

const makeRepoFixture = Effect.fn("makeRepoFixture")(function* (
  files: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixtureRoot = yield* fs.makeTempDirectoryScoped({ prefix: "mate-repo-zones-" });
  for (const [relativePath, source] of Object.entries(files)) {
    const file = path.join(fixtureRoot, relativePath);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, source);
  }
  return fixtureRoot;
});

it.layer(NodeServices.layer)("mate zone architecture", (it) => {
  it.effect("collects UI imports from client-runtime Zerops fixtures", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* fs.makeTempDirectoryScoped({ prefix: "mate-ui-imports-" });
      const fixtureFile = path.join(fixtureRoot, "packages/client-runtime/src/zerops/probe.ts");
      yield* fs.makeDirectory(path.dirname(fixtureFile), { recursive: true });
      yield* fs.writeFileString(
        fixtureFile,
        'import { renderToStaticMarkup } from "react-dom/server";\n',
      );

      const files = yield* collectTsFiles(
        path.join(fixtureRoot, "packages/client-runtime/src/zerops"),
      );
      const sources = [];
      for (const file of files) {
        sources.push({
          file: path.relative(fixtureRoot, file),
          source: yield* fs.readFileString(file),
        });
      }

      assert.deepStrictEqual(collectUiImportViolations(sources), [
        {
          file: "packages/client-runtime/src/zerops/probe.ts",
          specifier: "react-dom/server",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("ported zone (imported + provider drivers) imports nothing matching zerops", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* repoRoot;

      const targets = [
        ...(yield* collectTsFiles(path.join(root, "apps/server/src/provider"))),
        ...(yield* collectTsFiles(path.join(root, "packages/effect-codex-app-server"))),
        ...(yield* collectTsFiles(path.join(root, "packages/effect-acp"))),
        ...(yield* collectProviderContractFiles(root)),
      ];
      // A silently empty scan would make this test vacuously pass — assert
      // the zone paths still resolve to real files instead of trusting an
      // empty diff.
      assert.isAbove(targets.length, 0, "the ported-zone scan found no files; did a path move?");

      const violations: Array<ImportViolation> = [];
      for (const file of targets) {
        const source = yield* fs.readFileString(file);
        for (const { specifier } of collectImportStatements(source)) {
          if (/zerops/i.test(specifier)) {
            violations.push({ file: path.relative(root, file), specifier });
          }
        }
      }

      assert.deepStrictEqual(violations, []);
    }),
  );

  it.effect("client-runtime zerops is UI-free and platform-free", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* repoRoot;
      const files = yield* collectTsFiles(path.join(root, "packages/client-runtime/src/zerops"));
      assert.isAbove(
        files.length,
        0,
        "the client-runtime Zerops scan found no files; did the directory move?",
      );

      const sources: Array<SourceFile> = [];
      for (const file of files) {
        sources.push({ file: path.relative(root, file), source: yield* fs.readFileString(file) });
      }

      assert.deepStrictEqual(collectUiImportViolations(sources), []);
    }),
  );

  it.effect(
    "owned product (apps/server/src/zerops) reaches provider internals only at the known pre-SPI violations",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        // Two ways in: a path into the provider directory (`~/provider/` or
        // `../provider/`, at any depth), or binding the `ProviderService`
        // identifier itself (e.g. if it were ever re-exported from
        // elsewhere). A bare text mention — a comment naming
        // `ProviderService.streamEvents` — must NOT trip this: only import
        // clauses are scanned, not prose.
        function importsProviderInternals(statement: ImportStatement): boolean {
          return (
            statement.specifier.includes("/provider/") ||
            /\bProviderService\b/.test(statement.clause)
          );
        }

        // Emptied by the SPI slice (methodology §3.2): the lifecycle/topology
        // feeds now reach providers only through
        // apps/server/src/spi/ProviderRuntimeEventBus.ts, and
        // ZeropsPolicy.test.ts's incidental ProviderRegistry dependency goes
        // through apps/server/src/spi/ProviderRegistryTest.ts. A new
        // violation anywhere in apps/server/src/zerops/** still fails here.
        const KNOWN_OWNED_PRODUCT_PROVIDER_VIOLATIONS: ReadonlyArray<string> = [];

        const zeropsDir = path.join(root, "apps/server/src/zerops");
        const files = yield* collectTsFiles(zeropsDir);
        assert.isAbove(
          files.length,
          0,
          "the owned-product scan found no files; did the zerops dir move?",
        );

        const violations = new Set<string>();
        for (const file of files) {
          const source = yield* fs.readFileString(file);
          if (collectImportStatements(source).some(importsProviderInternals)) {
            violations.add(path.relative(root, file));
          }
        }

        assert.deepStrictEqual([...violations].sort(), KNOWN_OWNED_PRODUCT_PROVIDER_VIOLATIONS);
      }),
  );

  it.effect(
    "textGeneration/ and usage/ reach provider internals only through spi/, never directly",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        // The sole sanctioned service-tag file (methodology §3.2, SPI-5):
        // `ProviderInstanceRegistry` is how `TextGeneration.ts` resolves a
        // `ProviderInstanceId` to its live instance — the same seam
        // `ProviderRuntimeEventBus`/`ProviderRegistryTest` are for
        // `apps/server/src/zerops/**`. Every other provider-internal need
        // (driver home/launch-arg resolution, ACP session surfaces, the
        // OpenCode runtime, the Claude model/effort catalog) is wrapped by
        // an owned, typed capability under `apps/server/src/spi/`. Listed
        // explicitly, no wildcard: a second file needing this exception is
        // a new decision, not an automatic grant.
        const ALLOWED_PROVIDER_IMPORT_FILES: ReadonlySet<string> = new Set([
          path.join(root, "apps/server/src/provider/Services/ProviderInstanceRegistry.ts"),
        ]);

        function isAllowedProviderImport(fromFile: string, specifier: string): boolean {
          if (!specifier.includes("/provider/")) {
            return true;
          }
          const resolved = path.resolve(path.dirname(fromFile), specifier);
          return ALLOWED_PROVIDER_IMPORT_FILES.has(resolved);
        }

        const targets = [
          ...(yield* collectTsFiles(path.join(root, "apps/server/src/textGeneration"))),
          ...(yield* collectTsFiles(path.join(root, "apps/server/src/usage"))),
        ];
        assert.isAbove(
          targets.length,
          0,
          "the textGeneration/usage scan found no files; did a path move?",
        );

        const violations: Array<ImportViolation> = [];
        for (const file of targets) {
          const source = yield* fs.readFileString(file);
          for (const { specifier } of collectImportStatements(source)) {
            if (!isAllowedProviderImport(file, specifier)) {
              violations.push({ file: path.relative(root, file), specifier });
            }
          }
        }

        assert.deepStrictEqual(violations, []);
      }),
  );

  it.effect(
    "owned product (apps/server/src/zerops) never reads payload.data — the SPI's toolCall enrichment is the only reader (SPI-4)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        // A literal text scan, not an import check: the whole point of the
        // SPI-4 boundary (`apps/server/src/spi/toolCall.ts`) is that
        // `payload.data` — a driver's raw, per-provider item shape — is read
        // in exactly ONE owned place. Every consumer under
        // `apps/server/src/zerops/**` reads `event.toolCall` instead
        // (`packages/contracts/src/providerRuntimeSpi.ts`). A hit here means
        // a new call site started shape-dispatching on `payload.data` again.
        const zeropsDir = path.join(root, "apps/server/src/zerops");
        const files = yield* collectTsFiles(zeropsDir);
        assert.isAbove(
          files.length,
          0,
          "the owned-product scan found no files; did the zerops dir move?",
        );

        const violations: Array<string> = [];
        for (const file of files) {
          const source = yield* fs.readFileString(file);
          if (source.includes("payload.data")) {
            violations.push(path.relative(root, file));
          }
        }

        assert.deepStrictEqual(violations, []);
      }),
  );

  it.effect("protected roots render only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* repoRoot;
      const webSrcDir = path.join(root, "apps/web/src");

      const violations: Array<ProtectedRootViolation> = [];
      for (const protectedRoot of PROTECTED_ROOTS) {
        const rootFile = path.join(root, protectedRoot);
        assert.isTrue(
          yield* fs.exists(rootFile),
          `protected root ${protectedRoot} does not exist; did it move?`,
        );
        violations.push(...(yield* walkProtectedRoot(rootFile, webSrcDir)));
      }

      assert.deepStrictEqual(violations, []);
    }),
  );

  it.effect("one status resolver", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* repoRoot;
      const consumers = [
        "apps/web/src/components/Sidebar.tsx",
        "apps/web/src/components/Sidebar.logic.ts",
        "apps/web/src/components/ThreadStatusIndicators.tsx",
        "apps/mobile/src/features/threads/thread-list-v2-items.tsx",
        "apps/mobile/src/features/threads/threadListV2.ts",
        "apps/mobile/src/features/agent-awareness/remoteRegistration.ts",
        "infra/relay/src/agentActivity/agentActivityAggregate.ts",
      ] as const;
      const violations: Array<{ readonly file: string; readonly reason: string }> = [];

      // AgentActivity.tsx is structurally exempt because its `"widget"`
      // function is serialized and must stay self-contained. Its inline
      // tables are kept aligned by AgentActivity.test.ts's shared vectors.
      for (const consumer of consumers) {
        const file = path.join(root, consumer);
        assert.isTrue(yield* fs.exists(file), `status consumer ${consumer} moved or was deleted`);
        const source = yield* fs.readFileString(file);
        const importsSharedStatus = collectImportStatements(source).some(
          ({ specifier }) =>
            specifier === "@t3tools/shared/threadStatus" ||
            specifier === "@t3tools/client-runtime/zerops/statusPresentation",
        );
        if (!importsSharedStatus) {
          violations.push({ file: consumer, reason: "does not import the shared status modules" });
        }

        for (const phrase of findLocalThreadStatusPhrases(source)) {
          violations.push({ file: consumer, reason: `contains local status phrase ${phrase}` });
        }
      }

      assert.deepStrictEqual(violations, []);
    }),
  );

  it.effect("status phrase scanner catches structural bypasses", () =>
    Effect.sync(() => {
      const fixtures = [
        ['const status = "Plan " + "Ready";', "Plan Ready"],
        ["const status = `Plan Ready`;", "Plan Ready"],
        ["const status = <span>\n  Plan Ready\n</span>;", "Plan Ready"],
      ] as const;

      for (const [source, phrase] of fixtures) {
        assert.deepStrictEqual(findLocalThreadStatusPhrases(source), [phrase]);
      }
      assert.deepStrictEqual(
        findLocalThreadStatusPhrases('// "Plan Ready"\nconst copy = "Plan Ready later";'),
        [],
      );
    }),
  );

  it.effect("protected root walker follows transitive write modules", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'import { hook } from "./hook";\nexport const Root = hook;\n',
        "components/hook.ts":
          'import { command } from "../zerops/commands";\nexport const hook = command;\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/zerops/commands.ts",
          reason: "reviewed Zerops RPC command atoms",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker accepts reviewed read WS methods", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": [
          "export const subscription = WS_METHODS.subscribeZeropsLifecycle;",
          "export const read = WS_METHODS.zeropsLifecycleGet;",
        ].join("\n"),
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects unreviewed WS methods", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": "export const write = WS_METHODS.terminalWrite;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "WS_METHODS.terminalWrite is not in the reviewed read or allowed-command set",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker skips type-only edges", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import type { command } from "../zerops/commands";\nexport type Root = typeof command;\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker resolves aliases and extensionless relative imports", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { x } from "~/lib/x";\nimport { y } from "../y";\nexport const Root = [x, y];\n',
        "lib/x.ts": 'export const x = "https://api.zerops.io";\n',
        "y.ts": 'export const y = "https://api.zerops.io";\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/lib/x.ts",
          reason: "contains the Zerops API host literal zerops.io",
        },
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/y.ts",
          reason: "contains the Zerops API host literal zerops.io",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects a transitive forbidden package specifier", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'import { hook } from "./hook";\nexport const Root = hook;\n',
        "components/hook.ts":
          'import { client } from "@t3tools/client-runtime/zerops";\nexport const hook = client;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./zerops": {
              default: "./src/zerops/index.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/zerops/index.ts": "export const client = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/hook.ts",
          reason: "the Zerops platform REST client can mutate projects",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "protected root walker follows a value import of a client-runtime subpath and applies the host-literal check there",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeProtectedRootFixture({
          "components/Root.tsx":
            'import { value } from "@t3tools/client-runtime/zerops/probe";\nexport const Root = value;\n',
          "../../../packages/client-runtime/package.json": encodeUnknownJson({
            exports: {
              "./zerops/probe": {
                default: "./src/zerops/probe.ts",
              },
            },
          }),
          "../../../packages/client-runtime/src/zerops/probe.ts":
            'export const value = "https://api.zerops.io";\n',
        });

        const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

        assert.deepStrictEqual(violations, [
          {
            root: "apps/web/src/components/Root.tsx",
            file: "packages/client-runtime/src/zerops/probe.ts",
            reason: "contains the Zerops API host literal zerops.io",
          },
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("protected root walker does not follow a type-only client-runtime subpath import", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import type { Value } from "@t3tools/client-runtime/zerops/probe";\nexport type Root = Value;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./zerops/probe": {
              default: "./src/zerops/probe.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/zerops/probe.ts":
          'export type Value = "https://api.zerops.io";\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects an unmapped type-only client-runtime subpath", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import type { Value } from "@t3tools/client-runtime/nope";\nexport type Root = Value;\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "unresolved package subpath",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker vets forbidden bindings in mapped Zerops targets", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { value } from "@t3tools/client-runtime/zerops/probe";\nexport const Root = value;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./zerops/probe": {
              default: "./src/zerops/probe.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/zerops/probe.ts":
          "export const value = ZeropsApiClient;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "packages/client-runtime/src/zerops/probe.ts",
          reason: "the Zerops platform REST client can mutate projects",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker trusts command vocabulary in mapped runtime core targets", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { environment } from "@t3tools/client-runtime/environment";\nexport const Root = environment;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./environment": {
              default: "./src/environment.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/environment.ts":
          "export const environment = createEnvironmentRpcCommand;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker applies host and dynamic-import checks in runtime core", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { environment } from "@t3tools/client-runtime/environment";\nexport const Root = environment;\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./environment": {
              default: "./src/environment.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/environment.ts":
          'export { environment } from "./environmentValue.ts";\n',
        "../../../packages/client-runtime/src/environmentValue.ts":
          'export const environment = "https://api.zerops.io";\nexport const lazy = import(`./${part}.ts`);\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "packages/client-runtime/src/environmentValue.ts",
          reason: "contains the Zerops API host literal zerops.io",
        },
        {
          root: "apps/web/src/components/Root.tsx",
          file: "packages/client-runtime/src/environmentValue.ts",
          reason: "dynamic import argument is not a plain string literal",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects every unmapped client-runtime subpath", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { value } from "@t3tools/client-runtime/zeropsX";\nexport const Root = value;\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "unresolved package subpath",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "protected root walker resolves client-runtime subpaths through the package exports map",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeProtectedRootFixture({
          "components/Root.tsx": [
            'import { mapped } from "@t3tools/client-runtime/zerops/mapped";',
            'import { missing } from "@t3tools/client-runtime/zerops/missing";',
            "export const Root = [mapped, missing];",
          ].join("\n"),
          "../../../packages/client-runtime/package.json": encodeUnknownJson({
            exports: {
              "./zerops/mapped": {
                import: "./src/zerops/mapped.ts",
              },
            },
          }),
          "../../../packages/client-runtime/src/zerops/mapped.ts":
            'export const mapped = "safe";\n',
        });

        const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

        assert.deepStrictEqual(violations, [
          {
            root: "apps/web/src/components/Root.tsx",
            file: "apps/web/src/components/Root.tsx",
            reason: "unresolved package subpath",
          },
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects forbidden namespace property access", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import * as Runtime from "@t3tools/client-runtime/state/runtime";\nexport const Root = Runtime.createEnvironmentRpcCommand(runtime, options);\n',
        "../../../packages/client-runtime/package.json": encodeUnknownJson({
          exports: {
            "./state/runtime": {
              default: "./src/state/runtime.ts",
            },
          },
        }),
        "../../../packages/client-runtime/src/state/runtime.ts": "export const safe = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "constructs an environment RPC command",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker follows export-star chains", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { command } from "./barrel";\nexport const Root = command;\n',
        "components/barrel.ts": 'export * from "../zerops/commands";\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/zerops/commands.ts",
          reason: "reviewed Zerops RPC command atoms",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker follows named re-export chains", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { renamed } from "./barrel";\nexport const Root = renamed;\n',
        "components/barrel.ts": 'export { command as renamed } from "../zerops/commands";\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/zerops/commands.ts",
          reason: "reviewed Zerops RPC command atoms",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker skips type-only re-export chains", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'export type { Command } from "../zerops/commands";\n',
        "zerops/commands.ts": "export interface Command { readonly value: string }\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects template-literal dynamic imports", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": "export const Root = import(`../zerops/${moduleName}`);\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "dynamic import argument is not a plain string literal",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker follows quoted dynamic imports", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'export const Root = import("../zerops/commands");\n',
        "zerops/commands.ts": "export const command = true;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/zerops/commands.ts",
          reason: "reviewed Zerops RPC command atoms",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker resolves alias directory indexes", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx": 'import { value } from "~/dir";\nexport const Root = value;\n',
        "dir/index.ts": 'export const value = "https://api.zerops.io";\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/dir/index.ts",
          reason: "contains the Zerops API host literal zerops.io",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker scopes WS token exceptions by file", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { tracked } from "../rpc/requestLatencyState";\nimport { invoked } from "../rpc/invoker";\nexport const Root = [tracked, invoked];\n',
        "rpc/requestLatencyState.ts": "export const tracked = WS_METHODS.serverUpdateProvider;\n",
        "rpc/invoker.ts": "export const invoked = WS_METHODS.serverUpdateProvider;\n",
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/rpc/invoker.ts",
          reason:
            "WS_METHODS.serverUpdateProvider is not in the reviewed read or allowed-command set",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker prefers a TypeScript sibling before TSX", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import { value } from "../lib/value";\nexport const Root = value;\n',
        "lib/value.ts": 'export const value = "static";\n',
        "lib/value.tsx": 'export const value = "https://api.zerops.io";\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, []);
    }).pipe(Effect.scoped),
  );

  it.effect("protected root walker rejects import assignments", () =>
    Effect.gen(function* () {
      const fixture = yield* makeProtectedRootFixture({
        "components/Root.tsx":
          'import Runtime = require("@t3tools/client-runtime/state/runtime");\nexport const Root = Runtime;\n',
      });

      const violations = yield* walkProtectedRoot(fixture.rootFile, fixture.webSrcDir);

      assert.deepStrictEqual(violations, [
        {
          root: "apps/web/src/components/Root.tsx",
          file: "apps/web/src/components/Root.tsx",
          reason: "TypeScript import assignments are not allowed in protected graphs",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "rule 2 fixture: machine and reducer files reach no Effect runtime, fetch or storage",
    () =>
      Effect.gen(function* () {
        const fixtureRoot = yield* makeClientRuntimeZeropsFixture({
          "knowledge/known.ts": [
            'import type * as Effect from "effect/Effect";',
            'import * as Option from "effect/Option";',
            'import * as Stream from "effect/Stream";',
            "// fetch and localStorage in a comment are prose, not calls.",
            'export const label = "sessionStorage";',
            "",
          ].join("\n"),
          "knowledge/invalidation.ts": 'import * as PubSub from "effect/PubSub";\n',
          "data/access/grant.ts": 'import { readUser } from "../../api.ts";\n',
          "api.ts": "export const readUser = () => fetch('/user');\n",
          "environments/containerMachine.ts":
            'import { settle } from "./settle.ts";\nexport const saved = localStorage.getItem("k");\n',
          "environments/settle.ts":
            'import { Duration } from "effect";\nexport const settle = 1;\n',
          "environments/containerMachine.test.ts": 'import * as Effect from "effect/Effect";\n',
          "environments/probeStore.ts": 'import * as Effect from "effect/Effect";\n',
          "environments/gate.ts":
            'import { type Stream } from "effect/Stream";\nimport { held } from "./held";\n',
          "environments/held/index.ts": 'export const held = sessionStorage.getItem("k");\n',
          "environments/reachability.ts": 'export const load = () => import("./nowhere.ts");\n',
        });

        const violations = yield* collectPureZoneViolations(fixtureRoot, MACHINE_ZONE);

        const zerops = CLIENT_RUNTIME_ZEROPS_DIR;
        assert.deepStrictEqual(violations, [
          {
            root: `${zerops}/data/access/grant.ts`,
            file: `${zerops}/api.ts`,
            reason: "uses fetch",
          },
          {
            root: `${zerops}/environments/containerMachine.ts`,
            file: `${zerops}/environments/containerMachine.ts`,
            reason: "uses localStorage",
          },
          {
            root: `${zerops}/environments/containerMachine.ts`,
            file: `${zerops}/environments/settle.ts`,
            reason: "imports effect, which is not a pure effect data module",
          },
          {
            root: `${zerops}/environments/gate.ts`,
            file: `${zerops}/environments/held/index.ts`,
            reason: "uses sessionStorage",
          },
          {
            root: `${zerops}/environments/reachability.ts`,
            file: `${zerops}/environments/reachability.ts`,
            reason: "imports ./nowhere.ts, which does not resolve to a module",
          },
          {
            root: `${zerops}/environments/reachability.ts`,
            file: `${zerops}/environments/reachability.ts`,
            reason: "uses a dynamic import",
          },
          {
            root: `${zerops}/knowledge/known.ts`,
            file: `${zerops}/knowledge/known.ts`,
            reason: "imports effect/Stream, which is not a pure effect data module",
          },
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("rule 2 fixture: machine and reducer files read no clock and set no timer", () =>
    Effect.gen(function* () {
      const fixtureRoot = yield* makeClientRuntimeZeropsFixture({
        "knowledge/known.ts": "export const at = () => Date.now();\n",
        "data/access/grant.ts": [
          'import { later } from "./later.ts";',
          "// Date.now() and performance.now() in a comment are prose, not reads.",
          'export const label = "new Date()";',
          "export const stamp = (wall: number) => new Date(wall);",
          "",
        ].join("\n"),
        "data/access/later.ts": "export const later = () => setTimeout(() => undefined, 0);\n",
        "environments/environmentMachine.ts": [
          "export const mono = () => globalThis.performance.now();",
          "export const wall = () => new Date( );",
          "",
        ].join("\n"),
        "environments/reachability.ts": "export const wall = () => new Date;\n",
        "environments/containerMachine.ts": "export const tick = () => setInterval(() => 0, 1);\n",
        "environments/probeStore.ts": "export const at = () => Date.now();\n",
      });

      const violations = yield* collectPureZoneViolations(fixtureRoot, MACHINE_ZONE);

      const zerops = CLIENT_RUNTIME_ZEROPS_DIR;
      assert.deepStrictEqual(violations, [
        {
          root: `${zerops}/data/access/grant.ts`,
          file: `${zerops}/data/access/later.ts`,
          reason: "uses setTimeout",
        },
        {
          root: `${zerops}/environments/containerMachine.ts`,
          file: `${zerops}/environments/containerMachine.ts`,
          reason: "uses setInterval",
        },
        {
          root: `${zerops}/environments/environmentMachine.ts`,
          file: `${zerops}/environments/environmentMachine.ts`,
          reason: "uses new Date()",
        },
        {
          root: `${zerops}/environments/environmentMachine.ts`,
          file: `${zerops}/environments/environmentMachine.ts`,
          reason: "uses performance.now",
        },
        {
          root: `${zerops}/environments/reachability.ts`,
          file: `${zerops}/environments/reachability.ts`,
          reason: "uses new Date()",
        },
        {
          root: `${zerops}/knowledge/known.ts`,
          file: `${zerops}/knowledge/known.ts`,
          reason: "uses Date.now",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("rule 2: machines and reducers reach no Effect runtime, I/O, clock or timer", () =>
    Effect.gen(function* () {
      const root = yield* repoRoot;
      assert.deepStrictEqual(yield* collectPureZoneViolations(root, MACHINE_ZONE), []);
    }),
  );

  it.effect("rule 3 fixture: projections and the named pure modules are pure", () =>
    Effect.gen(function* () {
      const fixtureRoot = yield* makeClientRuntimeZeropsFixture({
        "projections/sidebarRows.ts": [
          'import * as Option from "effect/Option";',
          "export const rows = () => setTimeout(() => undefined, 0);",
          "",
        ].join("\n"),
        "projections/banner.ts": 'import * as Stream from "effect/Stream";\n',
        "projections/candidates.ts": 'import { parseSemver } from "@t3tools/shared/semver";\n',
        "flow/groupFlow.ts": "export const read = () => localStorage.getItem('k');\n",
        "flow/deploymentStore.ts": "export const later = () => setInterval(() => undefined, 1);\n",
        "environments/reachability.ts":
          "export const settle = () => requestAnimationFrame(() => undefined);\n",
        "environments/gate.ts": "export const gate = () => fetch('/healthz');\n",
      });

      const violations = yield* collectPureZoneViolations(fixtureRoot, PURE_PROJECTION_ZONE);

      const zerops = CLIENT_RUNTIME_ZEROPS_DIR;
      assert.deepStrictEqual(violations, [
        {
          root: `${zerops}/environments/gate.ts`,
          file: `${zerops}/environments/gate.ts`,
          reason: "uses fetch",
        },
        {
          root: `${zerops}/environments/reachability.ts`,
          file: `${zerops}/environments/reachability.ts`,
          reason: "uses requestAnimationFrame",
        },
        {
          root: `${zerops}/flow/groupFlow.ts`,
          file: `${zerops}/flow/groupFlow.ts`,
          reason: "uses localStorage",
        },
        {
          root: `${zerops}/projections/banner.ts`,
          file: `${zerops}/projections/banner.ts`,
          reason: "imports effect/Stream, which is not a pure effect data module",
        },
        {
          root: `${zerops}/projections/sidebarRows.ts`,
          file: `${zerops}/projections/sidebarRows.ts`,
          reason: "uses setTimeout",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("rule 3 fixture: projections and the named pure modules read no clock", () =>
    Effect.gen(function* () {
      const fixtureRoot = yield* makeClientRuntimeZeropsFixture({
        "projections/sidebarRows.ts": [
          'import { age } from "./age.ts";',
          "export const rows = (now: number) => age(now);",
          "",
        ].join("\n"),
        "projections/age.ts": "export const age = (now: number) => Date.now() - now;\n",
        "projections/banner.ts": [
          "// performance.now() in a comment is prose, not a read.",
          "export const since = (wall: number) => new Date(wall);",
          "",
        ].join("\n"),
        "flow/groupFlow.ts": "export const at = () => performance.now();\n",
        "flow/deploymentStore.ts": "export const at = () => Date.now();\n",
        "environments/gate.ts": "export const wall = () => new Date().getTime();\n",
      });

      const violations = yield* collectPureZoneViolations(fixtureRoot, PURE_PROJECTION_ZONE);

      const zerops = CLIENT_RUNTIME_ZEROPS_DIR;
      assert.deepStrictEqual(violations, [
        {
          root: `${zerops}/environments/gate.ts`,
          file: `${zerops}/environments/gate.ts`,
          reason: "uses new Date()",
        },
        {
          root: `${zerops}/flow/groupFlow.ts`,
          file: `${zerops}/flow/groupFlow.ts`,
          reason: "uses performance.now",
        },
        {
          root: `${zerops}/projections/age.ts`,
          file: `${zerops}/projections/age.ts`,
          reason: "uses Date.now",
        },
        {
          root: `${zerops}/projections/sidebarRows.ts`,
          file: `${zerops}/projections/age.ts`,
          reason: "uses Date.now",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("rule 3: projections and the named pure modules are pure", () =>
    Effect.gen(function* () {
      const root = yield* repoRoot;
      assert.deepStrictEqual(yield* collectPureZoneViolations(root, PURE_PROJECTION_ZONE), []);
    }),
  );

  it.effect("rule 6 fixture: one-way dependencies; only account/ and testing/ use account/", () =>
    Effect.gen(function* () {
      const fixtureRoot = yield* makeClientRuntimeZeropsFixture({
        "data/runtime.ts": 'import type { Reach } from "../environments/reachability.ts";\n',
        "data/access/grant.ts": 'import { flow } from "../../flow/groupFlow.ts";\n',
        "data/commands.ts": 'import { forge } from "../forge";\n',
        "data/state.ts": 'import type { Known } from "../knowledge/known.ts";\n',
        "environments/gate.ts": [
          'import { runtime } from "../data/runtime.ts";',
          'import { flow } from "../flow/groupFlow.ts";',
          "",
        ].join("\n"),
        "forge/forgeStore.ts": 'export * from "../flow/release.ts";\n',
        "flow/groupFlow.ts": [
          'import { runtime } from "../data/runtime.ts";',
          'import { gate } from "../environments/gate.ts";',
          'import { store } from "../forge/forgeStore.ts";',
          "",
        ].join("\n"),
        "knowledge/known.ts": 'import type { Session } from "../account/session.ts";\n',
        "account/accountRuntime.ts": [
          'import { session } from "./session.ts";',
          'import { gate } from "../environments/gate.ts";',
          "",
        ].join("\n"),
        "environments/gate.test.ts": 'import { session } from "../account/session.ts";\n',
        "groupReach.ts": 'import { session } from "./account";\n',
      });

      const violations = yield* collectOneWayViolations(fixtureRoot);

      const zerops = CLIENT_RUNTIME_ZEROPS_DIR;
      assert.deepStrictEqual(violations, [
        {
          file: `${zerops}/data/access/grant.ts`,
          specifier: "../../flow/groupFlow.ts",
          reason: "data/ must not depend on flow/",
        },
        {
          file: `${zerops}/data/commands.ts`,
          specifier: "../forge",
          reason: "data/ must not depend on forge/",
        },
        {
          file: `${zerops}/data/runtime.ts`,
          specifier: "../environments/reachability.ts",
          reason: "data/ must not depend on environments/",
        },
        {
          file: `${zerops}/environments/gate.ts`,
          specifier: "../flow/groupFlow.ts",
          reason: "environments/ must not depend on flow/",
        },
        {
          file: `${zerops}/forge/forgeStore.ts`,
          specifier: "../flow/release.ts",
          reason: "forge/ must not depend on flow/",
        },
        {
          file: `${zerops}/groupReach.ts`,
          specifier: "./account",
          reason: "only account/ and testing/ may depend on account/",
        },
        {
          file: `${zerops}/knowledge/known.ts`,
          specifier: "../account/session.ts",
          reason: "only account/ and testing/ may depend on account/",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("rule 6 fixture: the test harness may depend on account/, nothing else may", () =>
    Effect.gen(function* () {
      const fixtureRoot = yield* makeClientRuntimeZeropsFixture({
        "testing/accountHarness.ts": 'import { session } from "../account/session.ts";\n',
        "testing/drivers/sessionDriver.ts": 'import type { Session } from "../../account";\n',
        "reconcilers/groupReach.ts": 'import { session } from "../account/session.ts";\n',
      });

      const violations = yield* collectOneWayViolations(fixtureRoot);

      const zerops = CLIENT_RUNTIME_ZEROPS_DIR;
      assert.deepStrictEqual(violations, [
        {
          file: `${zerops}/reconcilers/groupReach.ts`,
          specifier: "../account/session.ts",
          reason: "only account/ and testing/ may depend on account/",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("rule 6: one-way dependencies; only account/ and testing/ use account/", () =>
    Effect.gen(function* () {
      const root = yield* repoRoot;
      assert.deepStrictEqual(yield* collectOneWayViolations(root), []);
    }),
  );

  it.effect("rule 5 fixture: Cell, newCell, advance and read stay inside their store", () =>
    Effect.gen(function* () {
      const zerops = CLIENT_RUNTIME_ZEROPS_DIR;
      const fixtureRoot = yield* makeRepoFixture({
        [`${zerops}/forge/forgeStore.ts`]:
          'import { advance, newCell, type Cell } from "../knowledge/known.ts";\n',
        [`${zerops}/store/kit.ts`]: 'import { read } from "../knowledge/known";\n',
        [`${zerops}/data/resources.ts`]: 'import { advance } from "../knowledge/known.ts";\n',
        [`${zerops}/knowledge/presentation.ts`]: 'import type { Known } from "./known.ts";\n',
        [`${zerops}/forge/forgeStore.test.ts`]:
          'import { advance } from "../knowledge/known.ts";\n',
        [`${zerops}/flow/deployment.ts`]: [
          'import type { Cell, Known, Shown } from "../knowledge/known.ts";',
          'import { knownPresentation } from "../knowledge/presentation.ts";',
          "",
        ].join("\n"),
        [`${zerops}/projections/banner.ts`]: 'import { advance } from "../knowledge/known.ts";\n',
        [`${zerops}/environments/gate.ts`]: 'import * as Knowledge from "../knowledge/known.ts";\n',
        [`${zerops}/flow/release.ts`]: 'export { read } from "../knowledge/known.ts";\n',
        [`${zerops}/flow/groupFlow.ts`]:
          'export const load = () => import("../knowledge/known.ts");\n',
        "apps/web/src/zerops/useThing.ts":
          'import { newCell } from "@t3tools/client-runtime/zerops/knowledge/known";\n',
        "apps/mobile/src/features/zerops/thing.ts":
          'import { advance as step } from "@t3tools/client-runtime/zerops/knowledge/known.ts";\n',
      });

      const violations = yield* collectCellImportViolations(fixtureRoot);

      assert.deepStrictEqual(violations, [
        {
          file: "apps/mobile/src/features/zerops/thing.ts",
          specifier: "@t3tools/client-runtime/zerops/knowledge/known.ts",
          reason: "imports advance outside a store",
        },
        {
          file: "apps/web/src/zerops/useThing.ts",
          specifier: "@t3tools/client-runtime/zerops/knowledge/known",
          reason: "imports newCell outside a store",
        },
        {
          file: `${zerops}/environments/gate.ts`,
          specifier: "../knowledge/known.ts",
          reason: "imports the whole knowledge/known module outside a store",
        },
        {
          file: `${zerops}/flow/deployment.ts`,
          specifier: "../knowledge/known.ts",
          reason: "imports Cell outside a store",
        },
        {
          file: `${zerops}/flow/groupFlow.ts`,
          specifier: "../knowledge/known.ts",
          reason: "imports the whole knowledge/known module outside a store",
        },
        {
          file: `${zerops}/flow/release.ts`,
          specifier: "../knowledge/known.ts",
          reason: "imports read outside a store",
        },
        {
          file: `${zerops}/projections/banner.ts`,
          specifier: "../knowledge/known.ts",
          reason: "imports advance outside a store",
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("rule 5: Cell, newCell, advance and read stay inside their store", () =>
    Effect.gen(function* () {
      const root = yield* repoRoot;
      assert.deepStrictEqual(yield* collectCellImportViolations(root), []);
    }),
  );

  it.effect("rule 5 fixture: web and mobile never read a Known's value", () =>
    Effect.gen(function* () {
      const fixtureRoot = yield* makeRepoFixture({
        "apps/web/src/components/zerops/Stop.tsx": [
          "export const kind = (deployment) =>",
          '  deployment.state === "known" ? deployment.value.kind : undefined;',
          "",
        ].join("\n"),
        "apps/web/src/zerops/useRows.ts": [
          "export const rows = (read) =>",
          '  read.flow?.state !== "known" ? [] : read.flow?.value.rows;',
          "",
        ].join("\n"),
        "apps/mobile/src/features/zerops/rows.ts": [
          "export const rows = (shown) => {",
          "  switch (shown.state) {",
          '    case "known":',
          "      return shown.value;",
          "    default:",
          "      return undefined;",
          "  }",
          "};",
          "",
        ].join("\n"),
        "apps/web/src/zerops/listing.ts":
          "export const same = (left, right) => left.value === right.value;\n",
        "apps/web/src/zerops/useRows.test.ts": [
          'if (shown.state === "known") expect(shown.value).toEqual([]);',
          "",
        ].join("\n"),
        [`${CLIENT_RUNTIME_ZEROPS_DIR}/flow/deployment.ts`]: [
          "export const running = (deployment) =>",
          '  deployment.state === "known" && deployment.value.kind === "running";',
          "",
        ].join("\n"),
      });

      const violations = yield* collectKnownValueReads(fixtureRoot);

      assert.deepStrictEqual(violations, [
        { file: "apps/mobile/src/features/zerops/rows.ts", read: "shown.value" },
        { file: "apps/web/src/components/zerops/Stop.tsx", read: "deployment.value" },
        { file: "apps/web/src/zerops/useRows.ts", read: "read.flow.value" },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("rule 5: web and mobile never read a Known's value", () =>
    Effect.gen(function* () {
      const root = yield* repoRoot;
      const reads = (yield* collectKnownValueReads(root)).map(
        ({ file, read }) => `${file} ${read}`,
      );
      assert.deepStrictEqual(
        reads.filter((read) => !KNOWN_VALUE_READ_EXCEPTIONS.has(read)),
        [],
      );
      assert.deepStrictEqual(
        [...KNOWN_VALUE_READ_EXCEPTIONS.keys()].filter((exception) => !reads.includes(exception)),
        [],
        "an exception that no longer matches a read must be deleted",
      );
    }),
  );
});
