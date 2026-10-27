#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off -- host gate runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  guardScopePaths,
  runtimeCycleSourceRoots,
  retainedTestFile,
  testClockFile,
  testClockLedger,
} from "./gate-input-scopes.ts";
import { fileReadInputs, hasFileReads } from "./gate-file-inputs.ts";
import { staleDependencies } from "./gate-installed-dependencies.ts";
import { stateOnlySmoke } from "./state-smoke-cases.ts";
export { stateOnlySmoke } from "./state-smoke-cases.ts";
import type { TimeoutRisk } from "./gate-timing-reporter.ts";
import {
  failureSummary,
  gateLogDirectory,
  removeGateLogs,
  runLogged,
  stageSummary,
} from "./gate-log.ts";
import { acquireGateSlot, gateSlotCount, gateSlotDirectory } from "./gate-slots.ts";
import { parseSync, Visitor } from "oxc-parser";
import { transform as parseCss } from "lightningcss";
import { parse as parseHtml, type DefaultTreeAdapterMap } from "parse5";

export const repositoryInvariants = [
  "scripts/gate-file-inputs.test.ts",
  "scripts/surface-manifest.test.ts",
  "scripts/mate-zone-architecture.test.ts",
  "scripts/mate-boundaries.test.ts",
  "scripts/product-name.test.ts",
  "scripts/route-nesting.test.ts",
  "scripts/turn-start-sites.test.ts",
  "scripts/tsconfig-basename-collisions.test.ts",
  "scripts/registry-release-policy.test.ts",
  "scripts/legend-list-initial-reveal.test.ts",
  "scripts/generate-theme-tokens.test.ts",
  "scripts/check-runtime-cycles.test.ts",
  "scripts/mate-readiness.test.ts",
];

// Opt-in local witnesses are bounded; required CI witnesses use the full affected selection.
// Full related scenario files, nearest first; edited and explicitly named files are uncapped.
export const relatedScenarioLimit = 8;

export const scenarioAreas = [
  "a-signin",
  "b-menu",
  "c-mate",
  "d-change",
  "e-env",
  "f-create",
  "g-outage",
  "h-budget",
  "foundation",
  "harness",
  "lifecycle-mutations",
] as const;

// Native runtimes are outside the hosted browser scenario harness.
const browserPath = (path: string) => !/^apps\/(?:mobile|desktop)(?:\/|$)/u.test(path);

const sourceFile = /\.[cm]?[jt]sx?$/u;
const documentation = (path: string) => /^(?:docs|\.plans)\//u.test(path) || /\.md$/iu.test(path);
const packageManifest = (path: string) =>
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/u.test(path);

function sourceShape(path: string, text: string): string | undefined {
  if (path === "apps/web/index.html") {
    let invalid = false;
    const document = parseHtml(text, {
      sourceCodeLocationInfo: true,
      onParseError: () => {
        invalid = true;
      },
    });
    if (invalid) return undefined;
    const edits: { startOffset: number; endOffset: number; replacement: string }[] = [];
    const visit = (node: DefaultTreeAdapterMap["node"]): void => {
      if (node.nodeName === "#comment" && node.sourceCodeLocation)
        edits.push({ ...node.sourceCodeLocation, replacement: "" });
      if ("tagName" in node) {
        const type = node.attrs.find((attribute) => attribute.name === "type")?.value;
        const inline =
          node.tagName === "style" && !type
            ? "inline.css"
            : node.tagName === "script" && (!type || type === "module")
              ? "inline.js"
              : undefined;
        if (inline)
          for (const child of node.childNodes) {
            if (!("value" in child) || !child.sourceCodeLocation) continue;
            const shape = sourceShape(inline, child.value);
            if (shape === undefined) invalid = true;
            else edits.push({ ...child.sourceCodeLocation, replacement: shape });
          }
      }
      if ("childNodes" in node) node.childNodes.forEach(visit);
      if ("content" in node) visit(node.content);
    };
    visit(document);
    if (invalid) return undefined;
    for (const { startOffset, endOffset, replacement } of edits.sort(
      (left, right) => right.startOffset - left.startOffset,
    ))
      text = text.slice(0, startOffset) + replacement + text.slice(endOffset);
    return text.trim();
  }
  if (path.endsWith(".css")) {
    let shape: string | undefined;
    try {
      parseCss({
        filename: path,
        code: Buffer.from(text),
        visitor: {
          StyleSheet(stylesheet) {
            shape = JSON.stringify(stylesheet, (key, value: unknown) =>
              ["loc", "sources", "sourceMapUrls", "licenseComments"].includes(key)
                ? undefined
                : value,
            );
          },
        },
      });
    } catch {
      // Invalid syntax must remain meaningful rather than silently dropping coverage.
      return undefined;
    }
    return shape;
  }
  const parsed = parseSync(path, text);
  if (parsed.errors.length) return undefined;
  return JSON.stringify(parsed.program, (key, value: unknown) =>
    key === "start" || key === "end"
      ? undefined
      : typeof value === "bigint"
        ? value.toString()
        : value,
  );
}

/** Compare parsed source, preserving syntax and literal content while ignoring comments. */
export function meaningfulChanges(root: string, base: string, paths: ReadonlyArray<string>) {
  const previous = new Map<string, string>();
  const tracked = NodeChildProcess.spawnSync("git", ["ls-tree", "-r", "--name-only", "-z", base], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (tracked.error) throw tracked.error;
  if (tracked.status !== 0) throw new Error(tracked.stderr);
  const oldFiles = new Set(tracked.stdout.split("\0"));
  const meaningful = paths.filter((path) => {
    if (documentation(path)) return false;
    if (oldFiles.has(path)) {
      const old = NodeChildProcess.spawnSync("git", ["show", `${base}:${path}`], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (old.error) throw old.error;
      if (old.status !== 0) throw new Error(old.stderr);
      previous.set(path, old.stdout);
    }
    if (
      !oldFiles.has(path) ||
      (!sourceFile.test(path) && !path.endsWith(".css") && path !== "apps/web/index.html") ||
      !NodeFS.existsSync(NodePath.join(root, path))
    )
      return true;
    const current = sourceShape(path, NodeFS.readFileSync(NodePath.join(root, path), "utf8"));
    const before = previous.get(path);
    return current === undefined || current !== sourceShape(path, before ?? "");
  });
  return { paths: meaningful, previous };
}

/** Follow each test's imports and harness inputs, excluding the shared app bundle. */
export function relatedFiles(
  root: string,
  paths: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>,
  previous: ReadonlyMap<string, string> = new Map(),
  maxDepth = Infinity,
): string[] {
  if (!paths.some((path) => !documentation(path))) return [];
  return buildRelatedFileGraph(root, candidates, previous, maxDepth, paths).select(paths);
}

/** A source snapshot; selections below never read or mutate its graph. */
export function buildRelatedFileGraph(
  root: string,
  candidates: ReadonlyArray<string>,
  previous: ReadonlyMap<string, string> = new Map(),
  maxDepth = Infinity,
  stoppedAt: ReadonlyArray<string> = [],
) {
  const stopped = new Set(stoppedAt.filter((path) => !documentation(path)));
  candidates = [...candidates];
  // Node 24 on our 64-bit hosts supports Oxc's binary transfer, avoiding AST JSON serialization.
  const parserOptions = { experimentalRawTransfer: true, preserveParens: true };
  const sourceTexts = new Map<string, string[]>();
  const sources = (file: string): string[] => {
    const cached = sourceTexts.get(file);
    if (cached) return cached;
    const texts = [
      ...new Set([
        previous.get(file),
        NodeFS.existsSync(NodePath.join(root, file))
          ? NodeFS.readFileSync(NodePath.join(root, file), "utf8")
          : undefined,
      ]),
    ].filter((source) => source !== undefined);
    sourceTexts.set(file, texts);
    return texts;
  };
  const resolvedFiles = new Map<string, string | undefined>();
  const exists = (path: string) =>
    previous.has(path) ||
    (NodeFS.existsSync(NodePath.join(root, path)) &&
      NodeFS.statSync(NodePath.join(root, path)).isFile());
  const resolveFile = (path: string): string | undefined => {
    if (resolvedFiles.has(path)) return resolvedFiles.get(path);
    const variants = [
      path,
      ...[".ts", ".tsx", ".js", ".jsx", ".json"].map((extension) => path + extension),
      ...[".ts", ".tsx", ".js"].map((extension) => `${path}/index${extension}`),
    ];
    if (/\.[cm]?js$/u.test(path)) variants.push(path.replace(/\.[cm]?js$/u, ".ts"));
    const resolved = variants.find(exists);
    resolvedFiles.set(path, resolved);
    return resolved;
  };
  const publicEntries = new Set<string>();
  const manifests = new Map<
    string,
    {
      path: string;
      exports: Record<string, string | { types?: string; import?: string; default?: string }>;
    }
  >();
  for (const parent of ["apps", "packages", "infra"]) {
    if (!NodeFS.existsSync(NodePath.join(root, parent))) continue;
    for (const entry of NodeFS.readdirSync(NodePath.join(root, parent), { withFileTypes: true })) {
      const path = `${parent}/${entry.name}/package.json`;
      if (!entry.isDirectory() || !exists(path)) continue;
      const manifest = JSON.parse(
        NodeFS.existsSync(NodePath.join(root, path))
          ? NodeFS.readFileSync(NodePath.join(root, path), "utf8")
          : previous.get(path)!,
      ) as {
        name?: string;
        exports?: Record<string, string | { types?: string; import?: string; default?: string }>;
      };
      if (manifest.name && manifest.exports)
        manifests.set(manifest.name, { path, exports: manifest.exports });
    }
  }
  const resolveImport = (file: string, request: string): string[] => {
    const specifier = request.split("?")[0]!;
    if (specifier.startsWith(".")) {
      const resolved = resolveFile(
        NodePath.posix.normalize(NodePath.posix.join(NodePath.posix.dirname(file), specifier)),
      );
      return resolved ? [resolved] : [];
    }
    if (specifier.startsWith("~/") && file.startsWith("apps/web/")) {
      const resolved = resolveFile(`apps/web/src/${specifier.slice(2)}`);
      return resolved ? [resolved] : [];
    }
    const pkg = [...manifests].find(
      ([name]) => specifier === name || specifier.startsWith(`${name}/`),
    );
    if (!pkg) return [];
    const [name, manifest] = pkg;
    const exported =
      manifest.exports[specifier === name ? "." : `.${specifier.slice(name.length)}`];
    const target =
      typeof exported === "string"
        ? exported
        : (exported?.types ?? exported?.import ?? exported?.default);
    const resolved =
      target && resolveFile(NodePath.posix.join(NodePath.posix.dirname(manifest.path), target));
    if (resolved) publicEntries.add(resolved);
    return [manifest.path, ...(resolved ? [resolved] : [])];
  };
  const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const field = (node: Record<string, unknown>, name: string): unknown => {
    if (!Array.isArray(node.properties)) return undefined;
    for (const property of node.properties) {
      const item = record(property);
      const key = record(item?.key);
      if ((key?.name ?? key?.value) === name) return item?.value;
    }
    return undefined;
  };
  const strings = (value: unknown): string[] => {
    const node = record(value);
    if (typeof node?.value === "string") return [node.value];
    if (Array.isArray(node?.elements)) return node.elements.flatMap(strings);
    throw new Error("Scenario execution dependencies need literal globalSetup/include paths");
  };
  // A pure re-export barrel is an ownership map, not a dependency on every exported domain.
  // Cache that map for this graph walk, preserving both old and current export owners.
  const exportOwners = new Map<
    string,
    { barrel: boolean; names: Map<string, string[]>; barrels: Map<string, string[]> }
  >();
  const symbolName = (value: unknown): string | undefined => {
    const node = record(value);
    return typeof node?.name === "string"
      ? node.name
      : typeof node?.value === "string"
        ? node.value
        : undefined;
  };
  const owners = (
    file: string,
  ): { barrel: boolean; names: Map<string, string[]>; barrels: Map<string, string[]> } => {
    const cached = exportOwners.get(file);
    if (cached) return cached;
    const result = {
      barrel: false,
      names: new Map<string, string[]>(),
      barrels: new Map<string, string[]>(),
    };
    exportOwners.set(file, result);
    const bodies = sources(file).map((source) => {
      const parsed = parseSync(file, source, parserOptions);
      if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0]!.message}`);
      return parsed.program.body;
    });
    result.barrel =
      bodies.length > 0 &&
      bodies.every(
        (body) =>
          body.length > 0 &&
          body.every((item) => {
            const node = record(item)!;
            return (
              (node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") &&
              record(node.source)?.value !== undefined
            );
          }),
      );
    const add = (name: string | undefined, files: string[], barrels: string[] = []) => {
      if (!name) return;
      result.names.set(name, [...new Set([...(result.names.get(name) ?? []), ...files])]);
      result.barrels.set(name, [...new Set([...(result.barrels.get(name) ?? []), ...barrels])]);
    };
    for (const item of bodies.flat()) {
      const node = record(item)!;
      const request = record(node.source)?.value;
      const targets =
        typeof request === "string"
          ? resolveImport(file, request).filter((target) => sourceFile.test(target))
          : [];
      if (node.type === "ExportAllDeclaration") {
        const namespace = symbolName(node.exported);
        if (namespace) add(namespace, targets);
        else
          for (const target of targets)
            for (const [name, files] of owners(target).names)
              add(name, files, [target, ...(owners(target).barrels.get(name) ?? [])]);
      }
      if (node.type !== "ExportNamedDeclaration") continue;
      const declaration = record(node.declaration);
      if (declaration) {
        add(symbolName(declaration.id), [file]);
        if (Array.isArray(declaration.declarations))
          for (const binding of declaration.declarations)
            add(symbolName(record(binding)?.id), [file]);
      }
      if (Array.isArray(node.specifiers))
        for (const value of node.specifiers) {
          const specifier = record(value)!;
          const local = symbolName(specifier.local);
          add(
            symbolName(specifier.exported),
            targets.length
              ? targets.flatMap((target) => [
                  ...(local ? (owners(target).names.get(local) ?? [target]) : [target]),
                ])
              : [file],
            targets.flatMap((target) => [
              target,
              ...(local ? (owners(target).barrels.get(local) ?? []) : []),
            ]),
          );
        }
    }
    return result;
  };
  const importOwners = (
    target: string,
    conditional: string[],
    names?: ReadonlyArray<string>,
  ): string[] => {
    if (
      (!publicEntries.has(target) &&
        !/^index\.[cm]?[jt]sx?$/u.test(NodePath.posix.basename(target))) ||
      !sourceFile.test(target)
    )
      return [target];
    const exports = owners(target);
    if (!exports.barrel) return [target];
    if (!names?.length) {
      if (maxDepth === 1) conditional.push(...[...exports.barrels.values()].flat());
      return maxDepth === 1 ? [target, ...new Set([...exports.names.values()].flat())] : [target];
    }
    if (names.some((name) => !exports.names.has(name))) return [target];
    // Named imports observe a barrel edit without traversing its unrelated exports.
    conditional.push(target, ...names.flatMap((name) => exports.barrels.get(name) ?? []));
    return [...new Set(names.flatMap((name) => exports.names.get(name)!))];
  };

  const config = "apps/web/test/scenarios/vitest.config.ts";
  const setupDeclarations: { include: string[] | undefined; files: string[] }[] = [];
  for (const source of sources(config)) {
    const parsed = parseSync(config, source, parserOptions);
    if (parsed.errors.length) throw new Error(`${config}: ${parsed.errors[0]!.message}`);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
        return;
      }
      const node = record(value);
      if (!node) return;
      const setups = field(node, "globalSetup");
      if (setups !== undefined) {
        const include = field(node, "include");
        setupDeclarations.push({
          include: include === undefined ? undefined : strings(include),
          files: strings(setups).map((path) =>
            NodePath.posix.normalize(NodePath.posix.join("apps/web", path)),
          ),
        });
      }
      for (const child of Object.values(node)) visit(child);
    };
    visit(parsed.program);
  }
  const edges = new Map<string, string[]>();
  const changedEdges = new Map<string, string[]>();
  const imports = (file: string): string[] => {
    const cached = edges.get(file);
    if (cached) return cached;
    // These helpers read this page's environment buttons through the browser, not a JS import.
    const dependencies: string[] =
      file === "apps/web/test/scenarios/areas/b-menu/dsl.ts"
        ? ["apps/web/src/components/zerops/ZeropsGroupDetail.tsx"]
        : [];
    const conditional: string[] = [];
    changedEdges.set(file, conditional);
    // Data assets are terminal graph nodes: matching their path is enough, not reading their bytes.
    if (!sourceFile.test(file) && !file.endsWith(".css") && file !== "apps/web/index.html") {
      edges.set(file, dependencies);
      return dependencies;
    }
    for (const source of sources(file)) {
      if (file === "apps/web/index.html") {
        for (const match of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gu)) {
          const path = match[1]!;
          const resolved = path.startsWith("/")
            ? resolveFile(`apps/web${path}`)
            : resolveFile(NodePath.posix.join("apps/web", path));
          if (resolved) dependencies.push(resolved);
        }
      }
      if (file.endsWith(".css")) {
        const parsed = parseCss({
          filename: file,
          code: Buffer.from(source),
          analyzeDependencies: true,
        });
        for (const dependency of parsed.dependencies ?? []) {
          if (dependency.type === "import")
            dependencies.push(...resolveImport(file, dependency.url));
        }
      }
      if (!sourceFile.test(file)) continue;
      const parsed = parseSync(file, source, parserOptions);
      if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0]!.message}`);
      // A test the lane deleted never runs again; only its base text is read, for its edges.
      if (
        /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file) &&
        NodeFS.existsSync(NodePath.join(root, file)) &&
        hasFileReads(parsed.program) &&
        !Object.hasOwn(fileReadInputs, file)
      )
        throw new Error(
          `${file}: filesystem reads need a declaration in scripts/gate-file-inputs.ts (use [] only for disposable files)`,
        );
      const add = (request: string, names?: ReadonlyArray<string>) =>
        dependencies.push(
          ...resolveImport(file, request).flatMap((target) =>
            importOwners(target, conditional, names),
          ),
        );
      const visit = (value: unknown): void => {
        const node = record(value)!;
        const callee = record(node.callee);
        const mock =
          node.type === "CallExpression" &&
          callee?.type === "MemberExpression" &&
          ["vi", "vitest"].includes(symbolName(callee.object) ?? "") &&
          ["mock", "doMock", "unmock", "doUnmock"].includes(symbolName(callee.property) ?? "");
        const literal =
          node.source ??
          (node.type === "TSImportType" ? node.argument : undefined) ??
          (node.type === "CallExpression" && (callee?.name === "require" || mock)
            ? (node.arguments as unknown[])[0]
            : undefined);
        if (
          typeof literal === "object" &&
          literal !== null &&
          "value" in literal &&
          typeof literal.value === "string"
        )
          add(
            literal.value,
            node.type === "ImportDeclaration" &&
              Array.isArray(node.specifiers) &&
              node.specifiers.every((specifier) => record(specifier)?.type === "ImportSpecifier")
              ? node.specifiers.map((specifier) => symbolName(record(specifier)?.imported)!)
              : undefined,
          );
      };
      new Visitor({
        ImportDeclaration: visit,
        ExportNamedDeclaration: visit,
        ExportAllDeclaration: visit,
        ImportExpression: visit,
        TSImportType: visit,
        CallExpression: visit,
      }).visit(parsed.program);
    }
    edges.set(file, dependencies);
    return dependencies;
  };
  const roots = (test: string) => [
    test,
    ...(maxDepth === Infinity && test.startsWith("apps/web/test/scenarios/")
      ? [
          config,
          ...setupDeclarations
            .filter(
              (setup) =>
                !setup.include ||
                setup.include.some((pattern) =>
                  NodePath.matchesGlob(NodePath.posix.relative("apps/web", test), pattern),
                ),
            )
            .flatMap((setup) => setup.files),
        ]
      : []),
  ];
  const inputs = new Map(candidates.map((test) => [test, roots(test)]));
  const readers = new Map<string, Set<string>>();
  const changedReaders = new Map<string, Set<string>>();
  const edge = (graph: Map<string, Set<string>>, dependency: string, reader: string) => {
    const entries = graph.get(dependency) ?? new Set<string>();
    entries.add(reader);
    graph.set(dependency, entries);
  };
  const pending = [...inputs].flatMap(([test, roots]) => {
    for (const input of roots.slice(1)) edge(readers, input, test);
    return roots.map((file) => ({ file, depth: 0 }));
  });
  const visited = new Map<string, number>();
  while (pending.length) {
    const { file, depth } = pending.pop()!;
    const priorDepth = visited.get(file);
    if (priorDepth !== undefined && (maxDepth === Infinity || priorDepth <= depth)) continue;
    visited.set(file, depth);
    if (stopped.has(file)) {
      // A changed test is still checked for undeclared reads, even when traversal stops here.
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file)) imports(file);
      continue;
    }
    if (depth >= maxDepth) continue;
    for (const dependency of imports(file)) {
      edge(readers, dependency, file);
      pending.push({ file: dependency, depth: depth + 1 });
    }
    for (const dependency of changedEdges.get(file) ?? []) edge(changedReaders, dependency, file);
  }
  const rank = (paths: ReadonlyArray<string>) => {
    const changed = new Set(paths.filter((path) => !documentation(path)));
    const distances = new Map([...changed].map((file) => [file, 0]));
    const offer = (file: string, distance: number) => {
      if (distance < (distances.get(file) ?? Infinity)) distances.set(file, distance);
    };
    for (const file of changed)
      for (const reader of changedReaders.get(file) ?? []) offer(reader, 1);
    // Declared reads are terminal edges: reading a source's bytes does not read its imports.
    for (const file of visited.keys())
      if (
        fileReadInputs[file]?.some((pattern) =>
          [...changed].some((path) => NodePath.matchesGlob(path, pattern)),
        )
      )
        offer(file, 1);
    const queue = [...distances.keys()];
    for (let i = 0; i < queue.length; i++) {
      const file = queue[i]!;
      const distance = distances.get(file)! + 1;
      for (const reader of readers.get(file) ?? []) {
        if (distance >= (distances.get(reader) ?? Infinity)) continue;
        offer(reader, distance);
        queue.push(reader);
      }
    }
    return candidates
      .filter((file) => distances.has(file))
      .map((file) => ({ file, distance: distances.get(file)! }))
      .sort((left, right) => left.distance - right.distance || left.file.localeCompare(right.file));
  };
  return Object.freeze({
    rank,
    // Receipt inputs traverse beyond lane edits; selection intentionally stops at them.
    inputFiles(files: ReadonlyArray<string>, inventory: ReadonlyArray<string>): string[] {
      const pending = files.flatMap(roots);
      const visited = new Set<string>();
      const reads = new Set<string>();
      while (pending.length) {
        const file = pending.pop()!;
        if (visited.has(file)) continue;
        visited.add(file);
        pending.push(...imports(file), ...(changedEdges.get(file) ?? []));
        if (/^vite(?:st)?\.config\.[cm]?[jt]s$/u.test(NodePath.posix.basename(file))) {
          const setupPaths = (value: unknown): string[] => {
            const node = record(value);
            if (typeof node?.value === "string")
              return [NodePath.posix.join(NodePath.posix.dirname(file), node.value)];
            if (Array.isArray(node?.elements)) return node.elements.flatMap(setupPaths);
            if (
              (node?.type === "NewExpression" || node?.type === "CallExpression") &&
              Array.isArray(node.arguments)
            )
              return setupPaths(node.arguments[0]);
            throw new Error(`${file}: execution setup paths must be statically readable`);
          };
          const visit = (value: unknown): void => {
            if (Array.isArray(value)) {
              value.forEach(visit);
              return;
            }
            const node = record(value);
            if (!node) return;
            for (const key of ["setupFiles", "globalSetup"]) {
              const setups = field(node, key);
              if (setups !== undefined) pending.push(...setupPaths(setups));
            }
            Object.values(node).forEach(visit);
          };
          for (const source of sources(file)) visit(parseSync(file, source, parserOptions).program);
        }
        for (const pattern of fileReadInputs[file] ?? [])
          for (const input of inventory) if (NodePath.matchesGlob(input, pattern)) reads.add(input);
      }
      return [...new Set([...visited, ...reads])].sort();
    },
    select(paths: ReadonlyArray<string>): string[] {
      const changed = new Set(paths.filter((path) => !documentation(path)));
      if (!changed.size) return [];
      if (maxDepth === Infinity)
        return rank(paths)
          .map(({ file }) => file)
          .sort();
      return candidates
        .filter((test) => {
          const pending = inputs.get(test)!.map((file) => ({ file, depth: 0 }));
          const visited = new Set<string>();
          while (pending.length) {
            const { file, depth } = pending.pop()!;
            if (visited.has(file)) continue;
            visited.add(file);
            if (changed.has(file)) return true;
            if (depth < maxDepth) {
              if (changedEdges.get(file)?.some((path) => changed.has(path))) return true;
              pending.push(...(edges.get(file) ?? []).map((file) => ({ file, depth: depth + 1 })));
            }
          }
          return false;
        })
        .sort();
    },
  });
}

/** Explicit files relative to the web root, matching the scenario config's include paths. */
export function scenarioFiles(
  root: string,
  areas: ReadonlyArray<string>,
  ownedFiles: ReadonlyArray<string>,
): string[] {
  const web = NodePath.join(root, "apps/web");
  const collect = (directory: string, suffix: string): string[] =>
    NodeFS.readdirSync(NodePath.join(web, directory), { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? collect(path, suffix)
        : entry.isFile() && path.endsWith(suffix)
          ? [path]
          : [];
    });
  const files = areas.flatMap((area) => {
    const path = `test/scenarios/areas/${area}`;
    if (!NodeFS.existsSync(NodePath.join(web, path)))
      throw new Error(`Missing selected scenario path: ${path}`);
    const tests = collect(path, ".scenario.ts");
    if (tests.length === 0) throw new Error(`No scenario files in selected path: ${path}`);
    return tests.filter((file) => !ownedFiles.includes(`apps/web/${file}`));
  });
  if (areas.length) {
    // Root fakes serve multiple areas; area-specific fake directories are optional.
    const fakes = collect("test/scenarios/fakes", ".test.ts");
    files.push(
      ...fakes.filter((path) => {
        const own = /^test\/scenarios\/fakes\/([^/]+)\//u.exec(path)?.[1];
        return own === undefined || areas.includes(own);
      }),
    );
  }
  validateSelectedFiles(web, files);
  return files.sort();
}

export function validateSelectedFiles(root: string, files: ReadonlyArray<string>): void {
  for (const file of files) {
    if (
      !NodeFS.existsSync(NodePath.join(root, file)) ||
      !NodeFS.statSync(NodePath.join(root, file)).isFile()
    )
      throw new Error(`Missing selected file: ${file}`);
  }
}

export interface GatePackage {
  readonly directory: string;
  readonly name: string;
  readonly typecheck: boolean;
  readonly dependencies?: ReadonlyArray<string>;
}

export function touchedPackages(
  paths: ReadonlyArray<string>,
  packages: ReadonlyArray<GatePackage>,
) {
  const global = paths.some((path) =>
    /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json)$/u.test(path),
  );
  return packages.filter(
    (pkg) => global || paths.some((path) => path.startsWith(`${pkg.directory}/`)),
  );
}

export function comparisonBase(root: string, base: string): string {
  // A new branch has no previous commit: CI conservatively compares its whole tree.
  if (base === "4b825dc642cb6eb9a060e54bf8d69288fbee4904") return base;
  const result = NodeChildProcess.spawnSync("git", ["merge-base", base, "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || `Cannot compare ${base} with HEAD`);
  return result.stdout.trim();
}

export function changedPaths(root: string, base: string): string[] {
  const git = (args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
    return result.stdout.split("\0").filter(Boolean);
  };
  // merge-base excludes changes made on main after the lane branched; include index, working tree,
  // untracked additions, deletions and both sides of renames (no rename detection).
  const ancestor = comparisonBase(root, base);
  return [
    ...new Set([
      ...git(["diff", "--name-only", "--no-renames", "-z", ancestor]),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]),
  ]
    .filter((path) => path !== ".gate-receipt.json" && path !== ".gate-receipt.json.tmp")
    .sort();
}

function workspacePackages(root: string): GatePackage[] {
  const directories = [
    "scripts",
    "oxlint-plugin-t3code",
    ...["apps", "packages", "infra"].flatMap((parent) =>
      NodeFS.readdirSync(NodePath.join(root, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`),
    ),
  ];
  return directories.flatMap((directory) => {
    const manifest = NodePath.join(root, directory, "package.json");
    if (!NodeFS.existsSync(manifest)) return [];
    const pkg = JSON.parse(NodeFS.readFileSync(manifest, "utf8")) as {
      name: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    return [
      {
        directory,
        name: pkg.name,
        typecheck: Boolean(pkg.scripts?.typecheck),
        dependencies: Object.keys({
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
          ...pkg.optionalDependencies,
        }),
      },
    ];
  });
}

// Transitive consumers are checked by their package's typecheck, not promoted to unit suites.
function typecheckPackages(paths: ReadonlyArray<string>, packages: ReadonlyArray<GatePackage>) {
  const affected = new Set(touchedPackages(paths, packages).map((pkg) => pkg.name));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const pkg of packages) {
      if (!affected.has(pkg.name) && pkg.dependencies?.some((name) => affected.has(name))) {
        affected.add(pkg.name);
        expanded = true;
      }
    }
  }
  return packages.filter((pkg) => affected.has(pkg.name));
}

// Each application and service owns the configuration used for its selected test files.
export function relatedTestPackages(packages: ReadonlyArray<GatePackage>) {
  return packages.filter((pkg) => /^(?:apps|infra)\//u.test(pkg.directory));
}

interface GateStage {
  readonly name: string;
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
  readonly slot?: true;
}

interface GateReceipt {
  readonly stageHashes?: Readonly<Record<string, string>>;
  readonly diffHash: string;
  readonly selectionHash: string;
  readonly selectedStages: GateStage[];
  results: { name: string; status: number; durationMs: number }[];
  durationMs: number;
  queueWaitMs: number;
  completed: boolean;
  atRisk: TimeoutRisk[];
}

// Hash before/after file identities, independent of whether additions are untracked, staged or committed.
// Only the lane's changed paths participate, so unrelated main changes preserve the receipt on rebase.
function diffHash(root: string, comparison: string): string {
  const paths = changedPaths(root, comparison);
  const hash = NodeCrypto.createHash("sha256");
  if (paths.length)
    hash.update(
      NodeChildProcess.execFileSync(
        "git",
        ["--literal-pathspecs", "ls-tree", "-z", comparison, "--", ...paths],
        { cwd: root, maxBuffer: 64 * 1024 * 1024 },
      ),
    );
  for (const path of paths) {
    const absolute = NodePath.join(root, path);
    const stat = NodeFS.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) {
      hash.update(JSON.stringify([path, "deleted"]));
      continue;
    }
    const bytes = stat.isSymbolicLink()
      ? Buffer.from(NodeFS.readlinkSync(absolute))
      : NodeFS.readFileSync(absolute);
    hash.update(
      JSON.stringify([
        path,
        stat.isSymbolicLink() ? "symlink" : "file",
        Boolean(stat.mode & 0o111),
        bytes.length,
      ]),
    );
    hash.update(bytes);
  }
  return hash.digest("hex");
}

// A rebase can update the selector or its configuration without changing the lane patch.
function selectionHash(root: string): string {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(process.version);
  const inputs = [
    "scripts/gate-changed.ts",
    "scripts/gate-input-scopes.ts",
    "scripts/state-smoke-cases.ts",
    "scripts/gate-file-inputs.ts",
    "scripts/gate-timing-reporter.ts",
    "scripts/gate-smoke-reporter.ts",
    "scripts/gate-log.ts",
    "scripts/gate-slots.ts",
    "scripts/test-process-lock.ts",
    "scripts/test-process-lock-holder.ts",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "apps/web/test/scenarios/vitest.config.ts",
    ".oxlintrc.json",
    ...[".", ...workspacePackages(root).map((pkg) => pkg.directory)].flatMap((directory) =>
      ["package.json", "vite.config.ts", "tsconfig.json"].map((file) =>
        NodePath.posix.join(directory, file),
      ),
    ),
  ];
  for (const path of inputs) {
    const absolute = NodePath.join(root, path);
    hash.update(
      JSON.stringify([
        path,
        NodeFS.existsSync(absolute) ? NodeFS.readFileSync(absolute, "utf8") : null,
      ]),
    );
  }
  return hash.digest("hex");
}

/** Each stage proves its own inputs, rather than invalidating every success on a lane edit. */
function stageHashes(
  root: string,
  comparison: string,
  stages: GateStage[],
  graph: ReturnType<typeof buildGateGraph>,
  selection: string,
): Record<string, string> {
  const inventory = NodeChildProcess.execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((path) => path && !path.startsWith(".gate-receipt.json"));
  const inputs = graph.related ?? buildRelatedFileGraph(root, []);
  const digest = (paths: ReadonlyArray<string>, baseline: ReadonlyArray<string>) => {
    const hash = NodeCrypto.createHash("sha256");
    const files = [...new Set(paths)].sort();
    if (baseline.length)
      hash.update(
        NodeChildProcess.execFileSync(
          "git",
          ["--literal-pathspecs", "ls-tree", "-z", comparison, "--", ...baseline],
          { cwd: root, maxBuffer: 64 * 1024 * 1024 },
        ),
      );
    for (const path of files) {
      const absolute = NodePath.join(root, path);
      const stat = NodeFS.lstatSync(absolute, { throwIfNoEntry: false });
      const bytes = !stat
        ? Buffer.alloc(0)
        : stat.isSymbolicLink()
          ? Buffer.from(NodeFS.readlinkSync(absolute))
          : NodeFS.readFileSync(absolute);
      hash.update(
        JSON.stringify([
          path,
          stat ? (stat.isSymbolicLink() ? "symlink" : "file") : "deleted",
          Boolean(stat && stat.mode & 0o111),
          bytes.length,
        ]),
      );
      hash.update(bytes);
    }
    return hash.digest("hex");
  };
  const laneTests = changedPaths(root, comparison).filter((path) => retainedTestFile.test(path));
  return Object.fromEntries(
    stages
      .filter((stage) => !stage.slot)
      .map((stage) => {
        let files = stage.args
          .filter((arg) => /\.[cm]?[jt]sx?$|\.md$/u.test(arg) && !arg.startsWith("--"))
          .map((arg) => NodePath.posix.join(stage.cwd ?? ".", arg));
        if (stage.command === "vp" && stage.args[0] === "test") {
          const explicitConfig = stage.args.indexOf("--config");
          files.push(
            NodePath.posix.join(
              stage.cwd ?? ".",
              explicitConfig >= 0 ? stage.args[explicitConfig + 1]! : "vite.config.ts",
            ),
          );
        }
        let baseline: string[] = [];
        let trailers = "";
        if (stage.name === "check touched files") {
          files.push(...inventory.filter((path) => path.startsWith("oxlint-plugin-t3code/")));
        } else if (stage.name.startsWith("typecheck ")) {
          const owners = new Set(
            graph.workspace.filter((pkg) => pkg.directory === stage.cwd).map((pkg) => pkg.name),
          );
          for (const name of owners)
            graph.workspace
              .find((pkg) => pkg.name === name)
              ?.dependencies?.forEach((dependency) => owners.add(dependency));
          const directories = graph.workspace
            .filter((pkg) => owners.has(pkg.name))
            .map((pkg) => pkg.directory);
          files.push(
            ...inventory.filter((path) =>
              directories.some((directory) => path.startsWith(`${directory}/`)),
            ),
          );
          // Root-configured scenario/oracle typechecks have an explicit project path.
          if (!stage.cwd)
            files.push(
              ...inventory.filter(
                (path) => path.startsWith("apps/web/") || path.startsWith("packages/"),
              ),
            );
        } else if (stage.name === "guard ledgers") {
          files.push(
            ...inventory.filter(
              (path) =>
                guardScopePaths.some((directory) => path.startsWith(`${directory}/`)) ||
                path.startsWith("oxlint-plugin-t3code/"),
            ),
          );
          baseline = [
            "oxlint-plugin-t3code/exceptions",
            "oxlint-plugin-t3code/failure-to-empty-enrollment.json",
            "oxlint-plugin-t3code/rules/no-failure-to-empty.ts",
          ];
        } else if (stage.name === "runtime cycle ratchet") {
          files.push(
            "scripts/runtime-cycles.json",
            ...inventory.filter(
              (path) =>
                runtimeCycleSourceRoots.some((directory) => path.startsWith(`${directory}/`)) ||
                /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(path),
            ),
          );
          baseline = ["scripts/runtime-cycles.json", "scripts/check-runtime-cycles.ts"];
        } else if (stage.name === "test clock ratchet") {
          // The check reads its scanned files, never their imports.
          files = [
            ...inputs.inputFiles(["scripts/check-test-clock.ts"], inventory),
            testClockLedger,
            ...(stage.args.length === 3 ? inventory.filter(testClockFile) : files),
          ];
          baseline = [testClockLedger];
        } else if (stage.name === "test sentence retention") {
          files.push(...laneTests);
          baseline = laneTests;
          trailers = NodeChildProcess.execFileSync(
            "git",
            ["log", "--format=%(trailers)", `${comparison}..HEAD`],
            { cwd: root, encoding: "utf8" },
          )
            .split("\n")
            .filter((line) => line.startsWith("Drops-test:"))
            .sort()
            .join("\n");
        }
        if (stage.name !== "check touched files" && stage.name !== "test clock ratchet")
          files = inputs.inputFiles(files, inventory);
        const command = {
          ...stage,
          args: stage.args.map((arg) => (arg === comparison ? "<comparison>" : arg)),
        };
        // A receipt from the in-process Core cannot prove scenarios against an external HQ.
        const hqCommand = stage.args.some((arg) => arg.endsWith("/scenarios/vitest.config.ts"))
          ? (process.env.MATE_HQ_TEST_COMMAND ?? null)
          : null;
        return [
          stage.name,
          NodeCrypto.createHash("sha256")
            .update(
              JSON.stringify([selection, command, digest(files, baseline), trailers, hqCommand]),
            )
            .digest("hex"),
        ];
      }),
  );
}

function readReceipt(path: string): GateReceipt | undefined {
  try {
    const receipt = JSON.parse(NodeFS.readFileSync(path, "utf8")) as GateReceipt | null;
    return receipt &&
      Array.isArray(receipt.selectedStages) &&
      Array.isArray(receipt.results) &&
      receipt.selectedStages.every((stage) => stage && typeof stage.name === "string") &&
      receipt.results.every((result) => result && typeof result.name === "string")
      ? receipt
      : undefined;
  } catch {
    return undefined;
  }
}

function reusableReceipt(
  receipt: GateReceipt | undefined,
  hash: string,
  selection: string,
  stages: GateStage[],
): boolean {
  return (
    receipt !== undefined &&
    receipt.completed === true &&
    receipt.diffHash === hash &&
    receipt.selectionHash === selection &&
    JSON.stringify(receipt.selectedStages) === JSON.stringify(stages) &&
    Number.isFinite(receipt.durationMs) &&
    receipt.durationMs >= 0 &&
    Number.isFinite(receipt.queueWaitMs) &&
    receipt.queueWaitMs >= 0 &&
    Array.isArray(receipt.results) &&
    receipt.results.length === stages.length &&
    receipt.results.every(
      (result, index) =>
        result !== null &&
        result.name === stages[index]?.name &&
        result.status === 0 &&
        Number.isFinite(result.durationMs) &&
        result.durationMs >= 0,
    )
  );
}

function writeReceipt(path: string, receipt: GateReceipt): void {
  NodeFS.writeFileSync(`${path}.tmp`, `${JSON.stringify(receipt, null, 2)}\n`);
  NodeFS.renameSync(`${path}.tmp`, path);
}

/** Unit selection follows transitive imports and Vitest mocks, never the browser scenario graph. */
function unitFiles(root: string): string[] {
  const collect = (directory: string): string[] =>
    NodeFS.readdirSync(NodePath.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
      const path = NodePath.posix.join(directory, entry.name);
      if (entry.isDirectory())
        return ["node_modules", "dist", "dist-electron", ".plans", ".git"].includes(entry.name)
          ? []
          : collect(path);
      return /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path) ? [path] : [];
    });
  return ["scripts", "oxlint-plugin-t3code", "packages", "apps", "infra"].flatMap((directory) =>
    NodeFS.existsSync(NodePath.join(root, directory)) ? collect(directory) : [],
  );
}

/** Discovery is shared by selector tables; the CLI still builds a fresh snapshot per run. */
export function buildGateGraph(
  root: string,
  previous: ReadonlyMap<string, string> = new Map(),
  stoppedAt?: ReadonlyArray<string>,
) {
  const workspace = Object.freeze(
    workspacePackages(root).map((pkg) =>
      Object.freeze({
        ...pkg,
        ...(pkg.dependencies ? { dependencies: Object.freeze([...pkg.dependencies]) } : {}),
      }),
    ),
  );
  const units = Object.freeze(unitFiles(root));
  const collectScenarios = (directory: string): string[] =>
    NodeFS.existsSync(NodePath.join(root, directory))
      ? NodeFS.readdirSync(NodePath.join(root, directory), { withFileTypes: true }).flatMap(
          (entry) => {
            const file = NodePath.posix.join(directory, entry.name);
            return entry.isDirectory()
              ? collectScenarios(file)
              : entry.isFile() && file.endsWith(".scenario.ts")
                ? [file]
                : [];
          },
        )
      : [];
  const scenarios = Object.freeze(collectScenarios("apps/web/test/scenarios/areas"));
  // The CLI did not discover import readers for comments/docs or manifest-only edits.
  const related =
    stoppedAt && !stoppedAt.some((path) => !documentation(path) && !packageManifest(path))
      ? undefined
      : buildRelatedFileGraph(root, [...units, ...scenarios], previous, Infinity, stoppedAt);
  return Object.freeze({ workspace, units, scenarios, related });
}

function selectScenarioFiles(
  graph: ReturnType<typeof buildGateGraph>,
  paths: ReadonlyArray<string>,
  existing: ReadonlyArray<string>,
  namedScenarios: ReadonlyArray<string>,
  limit: number,
) {
  const scenarioPaths = paths.filter(browserPath);
  const explicit = new Set([
    ...namedScenarios,
    ...scenarioPaths.filter((file) => file.endsWith(".scenario.ts") && existing.includes(file)),
  ]);
  const ranked =
    graph.related
      ?.rank(scenarioPaths)
      .filter(({ file }) => graph.scenarios.includes(file) && !explicit.has(file)) ?? [];
  const selectedScenarios = ranked.slice(0, limit);
  return {
    selectedScenarios,
    overflowScenarios: ranked.slice(limit),
    inventory: [...new Set([...explicit, ...selectedScenarios.map(({ file }) => file)])].sort(),
  };
}

function validateNamedScenarios(root: string, files: ReadonlyArray<string>): void {
  for (const file of files) {
    if (
      !/^apps\/web\/test\/scenarios\/areas\/.+\.scenario\.ts$/u.test(file) ||
      NodePath.posix.normalize(file) !== file
    )
      throw new Error(`Expected a repository-relative scenario file: ${file}`);
  }
  validateSelectedFiles(root, files);
}

/** Required CI witnesses use the same import graph as the gate, without its local cap. */
export function affectedScenarioFiles(
  root: string,
  base: string,
  namedScenarios: ReadonlyArray<string> = [],
): string[] {
  validateNamedScenarios(root, namedScenarios);
  const comparison = comparisonBase(root, base);
  const paths = changedPaths(root, comparison);
  const meaningful = meaningfulChanges(root, comparison, paths);
  const graph = buildGateGraph(root, meaningful.previous, meaningful.paths);
  const { inventory } = selectScenarioFiles(
    graph,
    meaningful.paths,
    paths.filter((path) => NodeFS.existsSync(NodePath.join(root, path))),
    namedScenarios,
    Infinity,
  );
  validateSelectedFiles(root, inventory);
  return inventory;
}

export function selectGateSteps(
  graph: ReturnType<typeof buildGateGraph>,
  {
    comparison,
    existing,
    paths,
    inventory,
    smokeFiles,
    slots,
    withScenarios = false,
  }: {
    readonly comparison: string;
    readonly existing: ReadonlyArray<string>;
    readonly paths: ReadonlyArray<string>;
    readonly inventory: ReadonlyArray<string>;
    readonly smokeFiles: ReadonlyArray<string>;
    readonly slots: number;
    readonly withScenarios?: boolean;
  },
) {
  const { workspace, units, related } = graph;
  const files = (withScenarios ? inventory : []).map((file) =>
    NodePath.posix.relative("apps/web", file),
  );
  const packages = typecheckPackages(paths, workspace);
  const steps: GateStage[] = [];
  steps.push({
    name: "guard ledgers",
    command: "node",
    args: ["scripts/check-guard-exceptions.ts", "--base", comparison],
  });
  steps.push({
    name: "runtime cycle ratchet",
    command: "node",
    args: ["scripts/check-runtime-cycles.ts", "--base", comparison],
  });
  steps.push({
    name: "test sentence retention",
    command: "node",
    args: ["scripts/check-test-sentences.ts", "--base", comparison],
  });
  const clockFiles = paths.filter(testClockFile);
  // A ledger or check edit scans every test file; otherwise only the touched ones.
  const clockScan = paths.some((path) =>
    [testClockLedger, "scripts/check-test-clock.ts"].includes(path),
  );
  if (clockScan || clockFiles.length)
    steps.push({
      name: "test clock ratchet",
      command: "node",
      args: ["scripts/check-test-clock.ts", "--base", comparison, ...(clockScan ? [] : clockFiles)],
    });
  if (existing.length)
    steps.push({
      name: "check touched files",
      command: "vp",
      args: ["check", "--no-error-on-unmatched-pattern", ...existing],
    });
  if (paths.length)
    steps.push({
      name: "repository invariants",
      command: "vp",
      args: ["test", "run", ...repositoryInvariants],
    });
  for (const pkg of packages.filter((pkg) => pkg.typecheck))
    steps.push({
      name: `typecheck ${pkg.name}`,
      command: "vp",
      args: ["exec", "tsc", "--noEmit", "--incremental"],
      cwd: pkg.directory,
    });
  if (paths.some((path) => path.startsWith("apps/web/test/engine-oracle/")))
    steps.push({
      name: "typecheck engine oracle",
      command: "vp",
      args: [
        "exec",
        "tsc",
        "--noEmit",
        "--incremental",
        "-p",
        "apps/web/test/engine-oracle/tsconfig.json",
      ],
    });
  if (paths.some((path) => path.startsWith("apps/web/test/scenarios/")))
    steps.push({
      name: "typecheck scenarios",
      command: "vp",
      args: [
        "exec",
        "tsc",
        "--noEmit",
        "--incremental",
        "-p",
        "apps/web/test/scenarios/tsconfig.json",
      ],
    });
  // Explicit owned files avoid Vitest's manifest/lockfile fallback to full suites.
  const manifestPaths = new Set(paths.filter(packageManifest));
  // A lockfile has no package-local owner. It never promotes the entire workspace's units;
  // tests owned by accompanying source edits and repository invariants still run.
  const manifestOwners = workspace.filter((pkg) =>
    manifestPaths.has(`${pkg.directory}/package.json`),
  );
  const moduleName = (file: string) =>
    NodePath.posix.basename(file).replace(/(?:\.(?:test|spec))?\.[cm]?[jt]sx?$/u, "");
  const packageOwner = (file: string) =>
    workspace.find((pkg) => file.startsWith(`${pkg.directory}/`))?.directory ?? ".";
  const changedModules = paths.filter(
    (file) => sourceFile.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file),
  );
  const ownedUnits = [
    ...new Set([
      ...(related
        ?.select(paths.filter((path) => !manifestPaths.has(path)))
        .filter((file) => units.includes(file)) ?? []),
      ...units.filter((file) =>
        changedModules.some(
          (module) =>
            packageOwner(file) === packageOwner(module) && moduleName(file) === moduleName(module),
        ),
      ),
      ...units.filter((file) => manifestOwners.some((pkg) => file.startsWith(`${pkg.directory}/`))),
    ]),
  ].filter((file) => !repositoryInvariants.includes(file));
  const driverUnits = ownedUnits.filter((file) =>
    file.startsWith("apps/web/test/scenarios/fakes/"),
  );
  const consumerUnits = ownedUnits.filter((file) => !driverUnits.includes(file));
  const consumers = [
    { directory: ".", name: "root tests", typecheck: false },
    ...relatedTestPackages(workspace),
  ];
  for (const pkg of consumers) {
    const own = consumerUnits.filter((file) =>
      pkg.directory === "."
        ? !consumers.slice(1).some((consumer) => file.startsWith(`${consumer.directory}/`))
        : file.startsWith(`${pkg.directory}/`),
    );
    if (own.length)
      steps.push({
        name: `related ${pkg.name}`,
        command: "vp",
        cwd: pkg.directory,
        args: [
          "test",
          "run",
          // L2's selected server files use the existing worker budget rather than full-suite serialization.
          ...(pkg.directory === "apps/server" ? ["--fileParallelism"] : []),
          ...own.map((file) => NodePath.posix.relative(pkg.directory, file)),
        ],
      });
  }
  if (driverUnits.length)
    steps.push({
      name: "related scenario-driver units",
      cwd: "apps/web",
      command: "vp",
      args: [
        "test",
        "run",
        "--config",
        "test/scenarios/vitest.config.ts",
        ...driverUnits.map((file) => NodePath.posix.relative("apps/web", file)),
      ],
    });
  if (files.length)
    steps.push({
      name: "edited scenario files",
      cwd: "apps/web",
      command: "vp",
      args: ["test", "run", "--config", "test/scenarios/vitest.config.ts", ...files],
    });
  // Edited smoke files already ran in full, so do not run their cases a second time.
  const smoke = withScenarios ? smokeFiles.filter((file) => !inventory.includes(file)) : [];
  for (const [name, configArgs, files] of [
    [
      "state-only smoke",
      ["--config", "test/scenarios/vitest.config.ts"],
      smoke.filter((file) => file.endsWith(".scenario.ts")),
    ],
    [
      "state-only oracle smoke",
      ["--project", "engine-oracle"],
      smoke.filter((file) => file.startsWith("apps/web/test/engine-oracle/")),
    ],
  ] as const) {
    if (!files.length) continue;
    steps.push({
      name,
      cwd: "apps/web",
      command: "vp",
      args: [
        "test",
        "run",
        ...configArgs,
        ...files.map((file) => NodePath.posix.relative("apps/web", file)),
        "--testNamePattern",
        files
          .flatMap((file) => stateOnlySmoke[file as keyof typeof stateOnlySmoke])
          .map((title) => `(?:${title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")})$`)
          .join("|"),
      ],
    });
  }
  const browserStage = steps.findIndex((step) =>
    step.args.some(
      (arg) =>
        arg.endsWith("/scenarios/vitest.config.ts") ||
        arg.includes("test/engine-oracle/") ||
        arg === "engine-oracle" ||
        /\.(?:browser|scenario)\.[cm]?[jt]sx?$/u.test(arg),
    ),
  );
  if (browserStage >= 0)
    steps.splice(browserStage, 0, {
      name: "browser/scenario slot",
      command: "acquire",
      args: [`GATE_SLOTS=${slots}`, gateSlotDirectory()],
      slot: true,
    });
  return { steps, ownedUnits };
}

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: node scripts/gate-changed.ts [--base origin/main] [--list] [--verbose] [--full] [--force] [--with-scenarios] [--scenarios <file...>]\n" +
        "GATE_SLOTS: positive integer, default 3. Machine-wide slots for browser/scenario stages.\n" +
        `Slots: ${gateSlotDirectory()}. Queue waits have no timeout and are reported separately from stage timings.`,
    );
    process.exit(0);
  }
  const stale = staleDependencies(root);
  if (stale) {
    console.error(`gate refused: ${stale}`);
    process.exit(1);
  }
  const slots = gateSlotCount();
  const verbose = args.includes("--verbose");
  const withScenarios = args.includes("--with-scenarios") || args.includes("--scenarios");
  let base = "origin/main";
  const namedScenarios: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (
      arg === "--list" ||
      arg === "--force" ||
      arg === "--full" ||
      arg === "--verbose" ||
      arg === "--with-scenarios"
    )
      continue;
    if (arg === "--base") {
      const ref = args[++index];
      if (!ref || ref.startsWith("--")) throw new Error("--base needs a git ref");
      base = ref;
    } else if (arg === "--scenarios") {
      const start = namedScenarios.length;
      while (args[index + 1] && !args[index + 1]!.startsWith("--"))
        namedScenarios.push(args[++index]!);
      if (namedScenarios.length === start) throw new Error("--scenarios needs scenario file paths");
    } else {
      throw new Error(
        "Usage: node scripts/gate-changed.ts [--base origin/main] [--list] [--verbose] [--full] [--force] [--with-scenarios] [--scenarios <file...>]",
      );
    }
  }
  validateNamedScenarios(root, namedScenarios);
  const comparison = comparisonBase(root, base);
  const paths = changedPaths(root, comparison);
  if (paths.length === 0 && namedScenarios.length === 0) {
    console.log("No changed files; no gates to run.");
    process.exit(0);
  }
  const existing = paths.filter((path) => NodeFS.existsSync(NodePath.join(root, path)));
  const meaningful = meaningfulChanges(root, comparison, paths);
  const scenarioPaths = meaningful.paths.filter(browserPath);
  const smokeFiles = scenarioPaths.length ? Object.keys(stateOnlySmoke) : [];
  validateSelectedFiles(root, smokeFiles);
  const graph = buildGateGraph(root, meaningful.previous, meaningful.paths);
  const { inventory, selectedScenarios, overflowScenarios } = selectScenarioFiles(
    graph,
    meaningful.paths,
    existing,
    namedScenarios,
    relatedScenarioLimit,
  );
  validateSelectedFiles(root, inventory);
  if (verbose || args.includes("--list")) {
    console.log(
      `Scenario files: ${inventory.length}; reason: ${meaningful.paths.length || namedScenarios.length ? "edited files, explicit --scenarios or import graph" : "documentation/comments only"}`,
    );
    for (const file of inventory)
      console.log(
        `Scenario ${file}; reason: ${[
          ...(meaningful.paths.includes(file) ? ["changed file"] : []),
          ...(namedScenarios.includes(file) ? ["explicit --scenarios"] : []),
          ...selectedScenarios
            .filter((selected) => selected.file === file)
            .map(({ distance }) => `import graph distance ${distance}`),
        ].join("; ")}`,
      );
  }
  console.log(
    `Related scenario cap: ${relatedScenarioLimit}; selected ${selectedScenarios.length}; overflow ${overflowScenarios.length} (deferred, no full-suite fallback)`,
  );
  for (const { file, distance } of overflowScenarios)
    console.log(`Deferred scenario ${file}; import graph distance ${distance}`);
  const { steps } = selectGateSteps(graph, {
    comparison,
    existing,
    paths: meaningful.paths,
    inventory,
    smokeFiles,
    slots,
    withScenarios,
  });
  if (args.includes("--list")) {
    console.log(`Diff from ${base}: ${paths.length} files`);
    for (const step of steps) console.log(`${step.name}: ${step.command} ${step.args.join(" ")}`);
  } else {
    const receiptPath = NodePath.join(root, ".gate-receipt.json");
    const hash = diffHash(root, comparison);
    const selection = selectionHash(root);
    // The ancestor SHA may move on rebase while the lane patch and selected checks stay identical.
    const selectedStages = steps.map((step) => ({
      ...step,
      args: step.args.map((arg) => (arg === comparison ? "<comparison>" : arg)),
    }));
    const full = args.includes("--full") || args.includes("--force");
    const fingerprints = stageHashes(root, comparison, steps, graph, selection);
    const previousReceipt = full ? undefined : readReceipt(receiptPath);
    if (
      !full &&
      reusableReceipt(previousReceipt, hash, selection, selectedStages) &&
      JSON.stringify(previousReceipt?.stageHashes) === JSON.stringify(fingerprints)
    ) {
      console.log(`reused receipt: ${receiptPath} (${hash})`);
      process.exit(0);
    }
    const reusable = new Map(
      steps
        .filter(
          (step) =>
            !step.slot &&
            previousReceipt?.selectionHash === selection &&
            previousReceipt.stageHashes?.[step.name] === fingerprints[step.name] &&
            previousReceipt.selectedStages?.some((prior) => prior.name === step.name) &&
            previousReceipt.results?.some(
              (result) =>
                result.name === step.name &&
                result.status === 0 &&
                Number.isFinite(result.durationMs) &&
                result.durationMs >= 0,
            ),
        )
        .map((step) => [step.name, { name: step.name, status: 0, durationMs: 0 }]),
    );
    const gateStarted = Date.now();
    const receipt: GateReceipt = {
      diffHash: hash,
      stageHashes: fingerprints,
      selectionHash: selection,
      selectedStages,
      results: [...reusable.values()],
      durationMs: 0,
      queueWaitMs: 0,
      completed: false,
      atRisk: [],
    };
    // Retain only proven unchanged successes; pending stages are invalidated before any check.
    writeReceipt(receiptPath, receipt);
    const PATH = [NodePath.join(root, "node_modules/.bin"), process.env.PATH ?? ""].join(
      NodePath.delimiter,
    );
    const logs = gateLogDirectory("gate-changed");
    if (verbose) console.log(`Full logs: ${logs}`);
    let slot: Awaited<ReturnType<typeof acquireGateSlot>> | undefined;
    const record = (result: GateReceipt["results"][number]) => {
      receipt.results = [
        ...receipt.results.filter((prior) => prior.name !== result.name),
        result,
      ].sort(
        (left, right) =>
          steps.findIndex((stage) => stage.name === left.name) -
          steps.findIndex((stage) => stage.name === right.name),
      );
    };
    for (const [index, step] of steps.entries()) {
      const reused = reusable.get(step.name);
      if (reused) {
        console.log(`reused stage: ${step.name}`);
        continue;
      }
      if (step.slot && steps.slice(index + 1).every((next) => reusable.has(next.name))) {
        record({ name: step.name, status: 0, durationMs: 0 });
        continue;
      }
      if (step.slot) {
        slot = await acquireGateSlot({
          slots,
          worktree: root,
          onWaiting: (holders, waitMs) =>
            console.log(
              `queued for browser/scenario slot · waited ${(waitMs / 1000).toFixed(2)}s · ` +
                holders
                  .map((holder) => `${holder.worktree} PID ${holder.pid} since ${holder.since}`)
                  .join("; "),
            ),
        });
        receipt.queueWaitMs = slot.waitMs;
        record({ name: step.name, status: 0, durationMs: 0 });
        receipt.durationMs = Date.now() - gateStarted - receipt.queueWaitMs;
        writeReceipt(receiptPath, receipt);
        console.log(
          `acquired browser/scenario slot · queue wait ${(slot.waitMs / 1000).toFixed(2)}s`,
        );
        continue;
      }
      const logPath = NodePath.join(logs, `${index + 1}.log`);
      const started = Date.now();
      const timingPath = NodePath.join(logs, `${index + 1}.timings.jsonl`);
      const env: typeof process.env = {
        ...process.env,
        MATE_TEST_JOBS: process.env.MATE_TEST_JOBS ?? "8",
        MATE_GATE_TIMINGS: timingPath,
        PATH,
      };
      const selectedSmoke = smokeFiles.filter(
        (file) =>
          step.cwd === "apps/web" && step.args.includes(NodePath.posix.relative("apps/web", file)),
      );
      if (selectedSmoke.length)
        env.MATE_GATE_SMOKE_CASES = JSON.stringify(
          Object.fromEntries(
            selectedSmoke.map((file) => [
              file,
              stateOnlySmoke[file as keyof typeof stateOnlySmoke],
            ]),
          ),
        );
      // Keep the scenarios' configured serial PostgreSQL fixtures when unit workers are bounded.
      if (step.args.some((arg) => arg.endsWith("/scenarios/vitest.config.ts")))
        delete env.VITEST_MAX_WORKERS;
      const status = runLogged(
        step.command,
        [
          ...step.args,
          ...(selectedSmoke.length
            ? [
                "--reporter",
                "default",
                "--reporter",
                NodePath.join(root, "scripts/gate-timing-reporter.ts"),
                "--reporter",
                NodePath.join(root, "scripts/gate-smoke-reporter.ts"),
              ]
            : []),
        ].map((arg) =>
          arg.startsWith("test/scenarios/areas/") || arg.startsWith("test/scenarios/fakes/")
            ? NodePath.resolve(root, step.cwd ?? ".", arg)
            : arg,
        ),
        { cwd: NodePath.join(root, step.cwd ?? "."), env },
        logPath,
      );
      if (NodeFS.existsSync(timingPath)) {
        const risks = NodeFS.readFileSync(timingPath, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as TimeoutRisk);
        receipt.atRisk.push(...risks);
        for (const risk of risks)
          console.log(
            `at-risk: ${risk.file} > ${risk.test}: ${risk.durationMs}ms / ${risk.timeoutMs}ms`,
          );
      }
      record({ name: step.name, status, durationMs: Date.now() - started });
      receipt.durationMs = Date.now() - gateStarted - receipt.queueWaitMs;
      writeReceipt(receiptPath, receipt);
      const output = NodeFS.readFileSync(logPath, "utf8");
      if (verbose) process.stdout.write(output);
      console.log(
        stageSummary(
          step.name,
          status,
          Date.now() - started,
          output,
          step.args.filter((arg) => /\.[cm]?[jt]sx?$|\.md$/u.test(arg)).length,
        ),
      );
      if (status !== 0) {
        console.error(failureSummary(NodeFS.readFileSync(logPath, "utf8"), logPath));
        process.exit(status);
      }
    }
    slot?.release();
    if (
      diffHash(root, comparison) !== hash ||
      selectionHash(root) !== selection ||
      JSON.stringify(stageHashes(root, comparison, steps, graph, selection)) !==
        JSON.stringify(fingerprints)
    )
      throw new Error(
        "Lane diff or selection inputs changed during the gate; run again for the changed code.",
      );
    receipt.completed = true;
    receipt.durationMs = Date.now() - gateStarted - receipt.queueWaitMs;
    writeReceipt(receiptPath, receipt);
    removeGateLogs(logs);
  }
}
