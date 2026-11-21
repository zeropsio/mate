#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalJsonInEffect:off -- host gate runner.
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { Jsonc } from "effect/encoding";
import { getOrThrow } from "effect/Result";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  guardScopePaths,
  runtimeCycleExcludes,
  runtimeCycleSourceRoots,
  sourceAliases,
  witnessOwners,
} from "./gate-input-scopes.ts";
import { fileReadInputs, hasFileReads } from "./gate-file-inputs.ts";
import { staleDependencies } from "./gate-installed-dependencies.ts";
import type { TimeoutRisk } from "./gate-timing-reporter.ts";
import {
  failureSummary,
  gateLogDirectory,
  removeGateLogs,
  runLoggedAsync,
  stageSummary,
  type StageRun,
} from "./gate-log.ts";
import { unitReplaySelection } from "./t1.ts";
import { parseSync, Visitor } from "oxc-parser";
import { transform as parseCss } from "lightningcss";
import { parse as parseHtml, type DefaultTreeAdapterMap } from "parse5";
import { parse as parseYaml } from "yaml";

export const repositoryInvariants = ["scripts/registry-release-policy.test.ts"];

const webTestRoot = "apps/web/test";
const sourceFile = /\.[cm]?[jt]sx?$/u;
const documentation = (path: string) => /^(?:docs|\.plans)\//u.test(path) || /\.md$/iu.test(path);
const packageManifest = (path: string) =>
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/u.test(path);
/** The root files every workspace package reads: a change to one changes every package. */
const rootManifests = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
];
const testFile = (path: string) => /\.(?:test|spec)\.[^/]*$/u.test(path);

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
export function meaningfulChanges(
  root: string,
  base: string,
  paths: ReadonlyArray<string>,
  entries = baseEntries(
    NodeChildProcess.execFileSync("git", baseTreeArgs(base), {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ),
) {
  const previous = new Map<string, string>();
  const oldFiles = new Set(
    [...entries].filter(([, entry]) => !entry.startsWith("040000 ")).map(([path]) => path),
  );
  // The web project declares which standalone test directories it excludes and which helpers it owns.
  const webTestSource = (path: string) =>
    path.startsWith(`${webTestRoot}/`) && sourceFile.test(path);
  const webConfig = paths.some(webTestSource)
    ? (getOrThrow(
        Jsonc.parse(NodeFS.readFileSync(NodePath.join(root, "apps/web/tsconfig.json"), "utf8")),
      ) as {
        exclude?: string[];
        files?: string[];
      })
    : undefined;
  const meaningful = paths.filter((path) => {
    if (webConfig && webTestSource(path)) {
      const relative = NodePath.posix.relative("apps/web", path);
      if (
        !webConfig.files?.includes(relative) &&
        webConfig.exclude?.some((dir) => relative.startsWith(`${dir}/`))
      )
        return false;
    }
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

  const edges = new Map<string, string[]>();
  const changedEdges = new Map<string, string[]>();
  const imports = (file: string): string[] => {
    const cached = edges.get(file);
    if (cached) return cached;
    const dependencies: string[] = [];
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
  const readers = new Map<string, Set<string>>();
  const changedReaders = new Map<string, Set<string>>();
  const edge = (graph: Map<string, Set<string>>, dependency: string, reader: string) => {
    const entries = graph.get(dependency) ?? new Set<string>();
    entries.add(reader);
    graph.set(dependency, entries);
  };
  const pending = candidates.map((file) => ({ file, depth: 0 }));
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
    // Receipt inputs traverse beyond lane edits; selection intentionally stops at them.
    inputFiles(files: ReadonlyArray<string>, inventory: ReadonlyArray<string>): string[] {
      const pending = [...files];
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
          const pending = [{ file: test, depth: 0 }];
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
  const global = paths.some((path) => rootManifests.includes(path));
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

// merge-base excludes changes made on main after the lane branched; include index, working tree,
// untracked additions, deletions and both sides of renames (no rename detection).
const laneReads = (ancestor: string) => [
  ["diff", "--name-only", "--no-renames", "-z", ancestor],
  ["ls-files", "--others", "--exclude-standard", "-z"],
];

const lanePaths = (outputs: ReadonlyArray<string>) =>
  [...new Set(outputs.flatMap((output) => output.split("\0").filter(Boolean)))]
    .filter((path) => path !== ".gate-receipt.json" && path !== ".gate-receipt.json.tmp")
    .sort();

export function changedPaths(root: string, base: string): string[] {
  const ancestor = comparisonBase(root, base);
  return lanePaths(
    laneReads(ancestor).map((args) => {
      const result = NodeChildProcess.spawnSync("git", args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
      return result.stdout;
    }),
  );
}

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const readGit = async (root: string, args: ReadonlyArray<string>) =>
  (await execFile("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))
    .stdout;

/** Everything a receipt reads from Git about the lane, read concurrently once per evaluation. */
async function laneSnapshot(root: string, comparison: string) {
  const [changes, inventory, head] = await Promise.all([
    Promise.all(laneReads(comparison).map((args) => readGit(root, args))),
    readGit(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]),
    readGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]),
  ]);
  return {
    headSha: head.trim(),
    paths: lanePaths(changes),
    inventory: inventory
      .split("\0")
      .filter((path) => path && !path.startsWith(".gate-receipt.json")),
  };
}

export function workspacePackages(root: string): GatePackage[] {
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

export interface GateStage {
  readonly name: string;
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
  /** Variables set over the gate's environment (`stageEnvironment`). */
  readonly env?: Readonly<Record<string, string>>;
}

interface GateReceipt {
  readonly version: 1;
  readonly context: "gate";
  readonly paths: ReadonlyArray<string>;
  readonly headSha: string;
  readonly baseSha: string;
  readonly stageHashes?: Readonly<Record<string, string>>;
  readonly diffHash: string;
  readonly selectionHash: string;
  readonly selectedStages: GateStage[];
  readonly selectionMs: number;
  results: { name: string; status: number; durationMs: number }[];
  durationMs: number;
  completed: boolean;
  atRisk: TimeoutRisk[];
}

const baseTreeArgs = (comparison: string) => ["ls-tree", "-r", "-t", "-z", comparison];

// Every blob and tree entry of the comparison commit by path; the commit is immutable, so one read
// serves every hash of a gate run.
function baseEntries(listing: string): ReadonlyMap<string, string> {
  return new Map(
    listing
      .split("\0")
      .filter(Boolean)
      .map((entry) => [entry.slice(entry.indexOf("\t") + 1), entry]),
  );
}

const baseIdentity = (base: ReadonlyMap<string, string>, paths: ReadonlyArray<string>) =>
  JSON.stringify(paths.flatMap((path) => base.get(path) ?? []));

// Hash before/after file identities, independent of whether additions are untracked, staged or committed.
// Only the lane's changed paths participate, so unchanged stages can be reused after a rebase.
function diffHash(
  root: string,
  base: ReadonlyMap<string, string>,
  paths: ReadonlyArray<string>,
): string {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(baseIdentity(base, paths));
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

/**
 * The gate's own selection inputs: the selector, its scopes and the configuration every stage's
 * choice and command read. A workspace package added or removed changes `pnpm-lock.yaml`, so the
 * list read from one tree names every change to it.
 */
function selectionInputs(root: string): string[] {
  return [
    "scripts/gate-changed.ts",
    "scripts/gate-input-scopes.ts",
    "scripts/gate-file-inputs.ts",
    "scripts/gate-timing-reporter.ts",
    "scripts/gate-log.ts",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    ".oxlintrc.json",
    ...[".", ...workspacePackages(root).map((pkg) => pkg.directory)].flatMap((directory) =>
      ["package.json", "vite.config.ts", "tsconfig.json"].map((file) =>
        NodePath.posix.join(directory, file),
      ),
    ),
  ];
}

// A rebase can update the selector or its configuration without changing the lane patch.
function selectionHash(root: string): string {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(process.version);
  for (const path of selectionInputs(root)) {
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

/**
 * Never a stage input wherever it sits under a scanned root: dependencies, Git's store and the
 * output of builds and test runs, which the stages themselves write (the server bundle builds
 * `apps/web/dist`), so hashing it would fail a run on its own output.
 */
const nonInputDirectories = new Set([
  "node_modules",
  ".git",
  ".tanstack",
  "dist",
  "build",
  "coverage",
]);

// The scanners walk the filesystem, including ignored source files that Git's inventory omits.
function scanned(root: string, roots: ReadonlyArray<string>): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    const absolute = NodePath.join(root, directory);
    if (!NodeFS.existsSync(absolute)) return;
    for (const entry of NodeFS.readdirSync(absolute, { withFileTypes: true })) {
      const path = NodePath.posix.join(directory, entry.name);
      if (entry.isDirectory() && !nonInputDirectories.has(entry.name)) visit(path);
      else if (
        entry.isSymbolicLink() ||
        /\.(?:[cm]?[jt]sx?|css)$/u.test(entry.name) ||
        /^(?:components\.json|package\.json|[jt]sconfig(?:\.[^/]*)?\.json|\.gitignore|\.ignore|\.oxlintignore)$/u.test(
          entry.name,
        )
      )
        files.push(path);
    }
  };
  roots.forEach(visit);
  return files;
}

/**
 * The files a stage reads: `files` by their content, `baseline` by their entry in the comparison
 * tree (a directory there stands for everything under it). An input-scoped stage reads its input
 * set; a typecheck reads its package and every workspace package it depends on; the guard ledgers
 * read their scopes, the lint plugin and the ignore and config files; every stage without an input
 * set but `check touched files` reads its files' import closure too. `universe` is every path the
 * caller names, deleted ones included where it lists them. The stage fingerprints (`stageHashes`)
 * and the selection against a commit this landing gated (`--passed`) read this one definition.
 */
function stageReads(
  root: string,
  stage: GateStage,
  {
    universe,
    paths,
    graph,
    inputSets,
  }: {
    readonly universe: ReadonlyArray<string>;
    /** The lane's changed paths: the witness replay reads the changed tests. */
    readonly paths: ReadonlyArray<string>;
    readonly graph: ReturnType<typeof buildGateGraph>;
    readonly inputSets: StageInputSets;
  },
): { readonly files: ReadonlyArray<string>; readonly baseline: ReadonlyArray<string> } {
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
  const inputSet = inputSets.get(stage.name);
  if (inputSet) {
    files = [...inputSet];
    if (stage.name === runtimeCycleStage)
      baseline = ["scripts/runtime-cycles.json", "scripts/check-runtime-cycles.ts"];
  } else if (stage.name === "check touched files") {
    files.push(...universe.filter((path) => path.startsWith("oxlint-plugin-t3code/")));
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
      ...universe.filter((path) =>
        directories.some((directory) => path.startsWith(`${directory}/`)),
      ),
    );
  } else if (stage.name === "guard ledgers") {
    files.push(
      ...scanned(root, ["apps/web", ...guardScopePaths]),
      ...universe.filter(
        (path) =>
          guardScopePaths.some((directory) => path.startsWith(`${directory}/`)) ||
          path.startsWith("oxlint-plugin-t3code/") ||
          /(?:^|\/)(?:\.gitignore|\.ignore|\.oxlintignore|components\.json|[jt]sconfig(?:\.[^/]*)?\.json)$/u.test(
            path,
          ),
      ),
    );
    baseline = [
      "oxlint-plugin-t3code/exceptions",
      "oxlint-plugin-t3code/failure-to-empty-enrollment.json",
      "oxlint-plugin-t3code/rules/no-failure-to-empty.ts",
    ];
  } else if (stage.name === "witness replay") {
    // Which witnesses are new depends on the base tests; replays read owners and configs too.
    const present = new Set(universe);
    const replayed = paths.filter((path) => /\.test\.tsx?$/u.test(path));
    files.push(...replayed);
    for (const [test, owners] of witnessOwners(root))
      if (replayed.includes(test)) files.push(...[...owners].filter((owner) => present.has(owner)));
    for (const placement of testStages(replayed, graph.workspace)) {
      const config = placement.args.indexOf("--config");
      files.push(
        NodePath.posix.join(
          placement.cwd ?? ".",
          config >= 0 ? placement.args[config + 1]! : "vite.config.ts",
        ),
      );
    }
    baseline = replayed;
  }
  // An input set is already whole; every other stage reads its files' import closure too.
  if (!inputSet && stage.name !== "check touched files")
    files = graph.files.inputFiles(files, universe);
  return { files, baseline };
}

/** Each stage proves its own inputs, rather than invalidating every success on a lane edit. */
function stageHashes(
  root: string,
  comparison: string,
  base: ReadonlyMap<string, string>,
  { paths, inventory }: Awaited<ReturnType<typeof laneSnapshot>>,
  stages: GateStage[],
  graph: ReturnType<typeof buildGateGraph>,
  inputSets: StageInputSets,
  selection: string,
): Record<string, string> {
  const digest = (paths: ReadonlyArray<string>, baseline: ReadonlyArray<string>) => {
    const hash = NodeCrypto.createHash("sha256");
    const files = [...new Set(paths)].sort();
    hash.update(baseIdentity(base, [...baseline].sort()));
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
  return Object.fromEntries(
    stages.map((stage) => {
      const { files, baseline } = stageReads(root, stage, {
        universe: inventory,
        paths,
        graph,
        inputSets,
      });
      const command = {
        ...stage,
        args: stage.args.map((arg) => (arg === comparison ? "<comparison>" : arg)),
      };
      return [
        stage.name,
        NodeCrypto.createHash("sha256")
          .update(JSON.stringify([selection, command, digest(files, baseline)]))
          .digest("hex"),
      ];
    }),
  );
}

/**
 * The repository checks every diff runs, each named as its step in CI's `Check Guards` job and
 * running the same command, so a push never meets one of them first in CI. CI keeps its steps: it
 * is the clean-machine witness the release reads.
 */
const ciGuardStages: ReadonlyArray<GateStage> = [
  { name: "imported lock", command: "node", args: ["scripts/imported-lock.ts", "--check"] },
  { name: "showcase scenes", command: "node", args: ["scripts/showcase-scenes.ts", "--check"] },
  { name: "css motion", command: "node", args: ["scripts/check-css-motion.ts"] },
  { name: "css theme tokens", command: "node", args: ["scripts/check-css-tokens.ts"] },
  {
    name: "generated theme tokens",
    command: "node",
    args: ["scripts/generate-theme-tokens.ts", "--check"],
  },
  { name: "doc paths", command: "node", args: ["scripts/check-doc-paths.ts"] },
];

const sharedStageNames = new Set(["guard ledgers", "runtime cycle ratchet"]);
// A stage is reused only when its fingerprint covers every input its verdict reads; a stage whose
// inputs the gate cannot name without repeating the stage always runs, and is never taken from or
// written to the shared stage cache. The CI guard stages cost under 2 s together, less than naming
// their inputs would.
const alwaysRunStages = new Set([
  "t1",
  "unit witness replay",
  "sentences",
  "check touched files",
  ...ciGuardStages.map((stage) => stage.name),
]);
// The stages that cost seconds and fail most often: one ending red stops every stage still
// running, so a landing holds its lock for seconds, not for the slowest stage, to report a red
// already known. A red anywhere else lets the rest run to their end, so one run shows each heavy
// stage's failure.
const stopsTheRestWhenRed = new Set(["sentences", "check touched files"]);
// A stopped stage gets SIGTERM, then SIGKILL after its grace. A signal to the gate gives the shorter
// one: `land.ts` SIGKILLs the gate's process group 2 s after its SIGTERM, which no longer reaches
// the stages' own groups, so the gate must have killed them before then (the guard ledgers stage
// takes longer than 2 s to end on SIGTERM).
const redStopGraceMs = 2_000;
const signalledStopGraceMs = 1_000;

/**
 * The stages that write state another stage reads. They run alone, one after another in list
 * order, once every other stage has ended:
 * - `unit witness replay` and `witness replay` rewrite each witness's owner source file in place
 *   while its tests run, and every other stage reads that source;
 * - `repository invariants` and the `related …` stages run Vitest in the packages `t1` runs it in,
 *   and Vitest writes each package's results cache (`node_modules/.vite/vitest`).
 * Every other stage reads the tree and writes only its own temporary directory or, for the two
 * builds, its own output (`apps/web/dist`, `apps/server/dist`, which no stage reads: the server
 * pack bundles sources, not the web client's output; the web build rewrites its route tree only
 * when it differs from the committed one, which fails the gate anyway), so they all run at once.
 */
const exclusiveStage = (name: string) =>
  name === "unit witness replay" ||
  name === "witness replay" ||
  name === "repository invariants" ||
  name.startsWith("related ");

/** Share only successful stages whose checkout inputs and local toolchain match. */
async function sharedStageCache(
  root: string,
  base: ReadonlyMap<string, string>,
  inventory: ReadonlyArray<string>,
  full: boolean,
) {
  if (
    full ||
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.NODE_OPTIONS ||
    process.env.NODE_PATH ||
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH ||
    process.env.NAPI_RS_FORCE_WASI ||
    process.env.NAPI_RS_WASI_FLAVOR ||
    process.env.VP_OVERRIDE_PACKAGES ||
    Object.keys(process.env).some((key) => /^T3CODE_.*LEDGER_DIRECTORY$/u.test(key))
  ) {
    return undefined;
  }

  // The checks can follow links, whereas Git inventories the link text, not its target.
  const hasLink = (directory: string): boolean => {
    const absolute = NodePath.join(root, directory);
    if (!NodeFS.existsSync(absolute)) return false;
    return NodeFS.readdirSync(absolute, { withFileTypes: true }).some((entry) => {
      if (nonInputDirectories.has(entry.name)) return false;
      return (
        entry.isSymbolicLink() ||
        (entry.isDirectory() && hasLink(NodePath.posix.join(directory, entry.name)))
      );
    });
  };
  if (
    ["apps/web", ...guardScopePaths, ...runtimeCycleReadRoots(root)].some(hasLink) ||
    inventory.some(
      (file) =>
        /^(?:scripts|oxlint-plugin-t3code|apps|packages)\//u.test(file) &&
        !/(?:^|\/)node_modules(?:\/|$)/u.test(file) &&
        NodeFS.lstatSync(NodePath.join(root, file), { throwIfNoEntry: false })?.isSymbolicLink(),
    )
  ) {
    return undefined;
  }

  const env = stageEnvironment(root);
  const snapshot = async () => {
    try {
      const { hashGuardContext, hashPackageTrees, makeGuardSourceHasher } =
        await import("./lib/guard-cache.ts");
      const node = NodeChildProcess.spawnSync("which", ["node"], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      if (
        node.status !== 0 ||
        NodeFS.realpathSync(node.stdout.trim()) !== NodeFS.realpathSync(process.execPath)
      ) {
        return undefined;
      }
      const tools = hashPackageTrees(
        ["vite-plus", "madge", "effect", "@effect/platform-node"].map((name) =>
          NodePath.join(root, "scripts/node_modules", name, "package.json"),
        ),
        true,
      );
      const runLint = (args: ReadonlyArray<string>) =>
        NodeChildProcess.spawnSync("vp", ["lint", ...args], {
          cwd: root,
          env,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        });
      const version = runLint(["--version"]);
      const config = runLint(["--print-config"]);
      const selection = runLint(["--debug=files", ...guardScopePaths]);
      if ([version, config, selection].some((result) => result.status !== 0)) {
        return undefined;
      }
      if (!/^Version: \S+/u.test(version.stdout.trim())) return undefined;
      const files = selection.stdout
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((file) =>
          (NodePath.isAbsolute(file) ? NodePath.relative(root, file) : file).replaceAll("\\", "/"),
        )
        .sort();
      if (files.some((file) => !guardScopePaths.some((scope) => file.startsWith(`${scope}/`))))
        return undefined;
      const context = hashGuardContext({
        cwd: root,
        config: config.stdout,
        version: version.stdout.trim(),
        ruleNames: [],
      });
      const source = makeGuardSourceHasher(root, files);
      const guard = NodeCrypto.createHash("sha256")
        .update(context)
        .update(JSON.stringify(files.map((file) => [file, source(file)])))
        .digest("hex");
      const executable = NodeFS.readFileSync(
        NodePath.join(root, "node_modules/.bin/vp"),
        "utf8",
      ).replaceAll(root, "<repo>");
      return { tools, guard, executable, jobs: env.MATE_TEST_JOBS };
    } catch {
      // An unidentifiable toolchain must run the checks rather than reuse a result.
      return undefined;
    }
  };
  const before = await snapshot();
  if (!before) return undefined;
  const directory = NodePath.join(
    process.env.XDG_CACHE_HOME || NodePath.join(NodeOS.homedir(), ".cache"),
    "mate-gate-stages",
  );
  const key = (stage: GateStage, fingerprint: string | undefined) => {
    if (!sharedStageNames.has(stage.name) || fingerprint === undefined) return undefined;
    // Before enrollment the guard also reads the lane's Git history, not just its base tree.
    if (
      stage.name === "guard ledgers" &&
      !base.has("oxlint-plugin-t3code/failure-to-empty-enrollment.json")
    )
      return undefined;
    return NodeCrypto.createHash("sha256")
      .update(
        JSON.stringify([
          fingerprint,
          HostProcessPlatform.defaultValue(),
          HostProcessArchitecture.defaultValue(),
          process.version,
          before,
        ]),
      )
      .digest("hex");
  };
  const has = (value: string) => {
    try {
      return NodeFS.readFileSync(NodePath.join(directory, `${value}.json`), "utf8") === value;
    } catch {
      return false;
    }
  };
  const put = (value: string) => {
    let temporary: string | undefined;
    try {
      NodeFS.mkdirSync(directory, { recursive: true });
      temporary = NodePath.join(directory, `${value}.${NodeCrypto.randomUUID()}.tmp`);
      NodeFS.writeFileSync(temporary, value, { flag: "wx" });
      NodeFS.renameSync(temporary, NodePath.join(directory, `${value}.json`));
    } catch {
      // An unavailable cache never prevents the actual checks from running.
    } finally {
      if (temporary) NodeFS.rmSync(temporary, { force: true });
    }
  };
  const unchanged = async () => JSON.stringify(await snapshot()) === JSON.stringify(before);
  return { key, has, put, unchanged };
}

function readReceipt(path: string): GateReceipt | undefined {
  try {
    const receipt = JSON.parse(NodeFS.readFileSync(path, "utf8")) as GateReceipt | null;
    return receipt &&
      receipt.version === 1 &&
      receipt.context === "gate" &&
      Array.isArray(receipt.paths) &&
      receipt.paths.every((path) => typeof path === "string") &&
      Number.isFinite(receipt.selectionMs) &&
      receipt.selectionMs >= 0 &&
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

function writeReceipt(path: string, receipt: GateReceipt): void {
  NodeFS.writeFileSync(`${path}.tmp`, `${JSON.stringify(receipt, null, 2)}\n`);
  NodeFS.renameSync(`${path}.tmp`, path);
}

/** Unit selection follows transitive imports and Vitest mocks. */
function unitFiles(root: string): string[] {
  const collect = (directory: string): string[] =>
    NodeFS.readdirSync(NodePath.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
      const path = NodePath.posix.join(directory, entry.name);
      if (entry.isDirectory())
        return path === webTestRoot ||
          ["node_modules", "dist", "dist-electron", ".plans", ".git"].includes(entry.name)
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
  // The CLI did not discover import readers for comments/docs or manifest-only edits.
  const related =
    stoppedAt && !stoppedAt.some((path) => !documentation(path) && !packageManifest(path))
      ? undefined
      : buildRelatedFileGraph(root, units, previous, Infinity, stoppedAt);
  // Stage inputs are read for every diff, a docs- or manifest-only one too: without unit roots the
  // graph parses only the files whose imports are asked for.
  const files = related ?? buildRelatedFileGraph(root, [], previous);
  return Object.freeze({ root, workspace, units, related, files });
}

const runtimeCycleStage = "runtime cycle ratchet";

/** The ratchet scans its source roots and follows every workspace alias into that package's `src`. */
function runtimeCycleReadRoots(root: string): string[] {
  return [
    ...new Set([
      ...runtimeCycleSourceRoots,
      ...Object.values(sourceAliases(root))
        .flat()
        .map((target) => target.slice(0, target.indexOf("/src/") + "/src".length)),
    ]),
  ];
}

/**
 * The two builds of the hosted product, run at once: the web client's and the server's pack (the
 * pack bundles sources, never the web client's output, so neither waits for the other).
 * `readsAsRoute` is what the build reads beyond imports: the web build's router plugin reads every
 * file under its routes directory whose name and directories do not start with `-` as a route, a
 * test file too.
 */
const buildStages: ReadonlyArray<{
  readonly packageName: string;
  readonly stage: GateStage;
  readonly readsAsRoute?: (path: string) => boolean;
  /** The build runs with the switches of the setup that deploys it (`deployedBuild`). */
  readonly deployed?: boolean;
}> = [
  {
    packageName: "@t3tools/web",
    stage: { name: "build web client", command: "vp", args: ["build"], cwd: "apps/web" },
    deployed: true,
    readsAsRoute: (path) =>
      path.startsWith("apps/web/src/routes/") &&
      !path
        .slice("apps/web/src/routes/".length)
        .split("/")
        .some((segment) => segment.startsWith("-")),
  },
  {
    packageName: "t3",
    stage: {
      name: "pack server",
      command: "node",
      args: ["scripts/cli.ts", "build"],
      cwd: "apps/server",
    },
  },
];

/** The file whose `prod` setup builds and deploys the hosted web client (mate.zerops.io). */
const deployFile = "zerops.yml";
const deploySetup = "prod";
/**
 * The variables of the `prod` build that change which entries and plugins are built: the app-shell
 * worker adds the service-worker build and `sw.js`. The setup's other `VITE_*` values are
 * constants baked into the output, which the gate's build leaves out.
 */
const deployedBuildSwitches = ["VITE_APP_SHELL_WORKER"] as const;

/**
 * The stage built the way the `prod` setup builds it, its switches read from the deploy file; a
 * setup without one becomes a stage that fails with the line that says so.
 */
function deployedBuild(root: string, stage: GateStage): GateStage {
  const fails = (line: string): GateStage => ({
    name: stage.name,
    command: "node",
    args: ["-e", `console.error(${JSON.stringify(line)}); process.exit(1)`],
  });
  const path = NodePath.join(root, deployFile);
  let document:
    | {
        zerops?: ReadonlyArray<{
          setup?: unknown;
          build?: { envVariables?: Readonly<Record<string, unknown>> };
        }>;
      }
    | null
    | undefined;
  try {
    document = NodeFS.existsSync(path) ? parseYaml(NodeFS.readFileSync(path, "utf8")) : undefined;
  } catch (error) {
    return fails(`${deployFile} is no YAML the gate can read: ${(error as Error).message}`);
  }
  const variables = document?.zerops?.find((setup) => setup.setup === deploySetup)?.build
    ?.envVariables;
  const env: Record<string, string> = {};
  for (const name of deployedBuildSwitches) {
    const value = variables?.[name];
    if (typeof value === "string" && value !== "") env[name] = value;
  }
  const missing = deployedBuildSwitches.filter((name) => !(name in env));
  if (!missing.length) return { ...stage, env };
  return fails(
    `${deployFile}'s ${deploySetup} setup sets no ${missing.join(", ")} in build.envVariables: the gate builds the web client the way that setup does.`,
  );
}

/** The files each input-scoped stage reads, by stage name: the one set that selects and fingerprints it. */
export type StageInputSets = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * The input sets of the builds and the runtime cycle ratchet. A stage runs only when the diff
 * touches its set: every other file it reads is the same as on `main`, which passed it.
 * `files` is the worktree's inventory with the diff's paths, so a deleted input still selects.
 */
export function stageInputSets(
  root: string,
  files: ReadonlyArray<string>,
  graph: ReturnType<typeof buildGateGraph>,
): StageInputSets {
  const universe = [...new Set(files)];
  const present = new Set(universe);
  const under = (directories: ReadonlyArray<string>) =>
    universe.filter((path) => directories.some((directory) => path.startsWith(`${directory}/`)));
  const manifests = rootManifests.filter((path) => present.has(path));
  // A source that imports a test file names it by its path, so its text holds a specifier ending in
  // `.test` or `.spec` (with or without its extension); only such sources are parsed for it.
  const namesTest = new Map<string, boolean>();
  const readsTest = (path: string) => {
    let names = namesTest.get(path);
    if (names === undefined) {
      const absolute = NodePath.join(root, path);
      names =
        NodeFS.existsSync(absolute) &&
        /\.(?:test|spec)(?:\.[cm]?[jt]sx?)?["'`]/u.test(NodeFS.readFileSync(absolute, "utf8"));
      namesTest.set(path, names);
    }
    return names;
  };
  const sets = new Map<string, ReadonlySet<string>>();
  for (const { packageName, stage, readsAsRoute, deployed } of buildStages) {
    // Every kind of workspace dependency, transitively: the server pack bundles its devDependencies.
    const owners = new Set([packageName]);
    for (const name of owners)
      graph.workspace
        .find((pkg) => pkg.name === name)
        ?.dependencies?.forEach((dependency) => owners.add(dependency));
    const directories = graph.workspace
      .filter((pkg) => owners.has(pkg.name))
      .map((pkg) => pkg.directory);
    const packageFiles = under(directories);
    // A test file is a build input only when a non-test source imports it.
    const testReaders = packageFiles.filter(
      (path) => sourceFile.test(path) && !testFile(path) && readsTest(path),
    );
    const closure = graph.files.inputFiles(
      [
        "vite.config.ts",
        NodePath.posix.join(stage.cwd!, "vite.config.ts"),
        // The stage's own command script, which may import beyond its package.
        ...stage.args
          .filter((arg) => sourceFile.test(arg))
          .map((arg) => NodePath.posix.join(stage.cwd!, arg)),
        ...testReaders,
      ].filter((path) => present.has(path) || NodeFS.existsSync(NodePath.join(root, path))),
      universe,
    );
    const imported = new Set(closure.filter(testFile));
    sets.set(
      stage.name,
      new Set(
        [
          ...packageFiles,
          ...manifests,
          ...closure,
          ...(deployed && present.has(deployFile) ? [deployFile] : []),
        ].filter(
          (path) =>
            !documentation(path) &&
            (!testFile(path) || imported.has(path) || Boolean(readsAsRoute?.(path))),
        ),
      ),
    );
  }
  const cycleRoots = runtimeCycleReadRoots(root);
  sets.set(
    runtimeCycleStage,
    new Set(
      [
        "scripts/runtime-cycles.json",
        ...manifests,
        ...graph.files.inputFiles(["scripts/check-runtime-cycles.ts"], universe),
        ...[...scanned(root, cycleRoots), ...under(cycleRoots)].filter((path) =>
          sourceFile.test(path),
        ),
        ...universe.filter((path) => /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(path)),
      ].filter(
        (path) =>
          !documentation(path) && !runtimeCycleExcludes.some((exclude) => exclude.test(path)),
      ),
    ),
  );
  return sets;
}

export function selectGateSteps(
  graph: ReturnType<typeof buildGateGraph>,
  {
    comparison,
    existing,
    paths,
    tests,
    touched,
    build = true,
    landing = false,
    unitReplays = [],
  }: {
    readonly comparison: string;
    readonly existing: ReadonlyArray<string>;
    readonly paths: ReadonlyArray<string>;
    /** Test suites and test machinery run only when asked (`--tests`); T1, lint, typecheck and build always. */
    readonly tests: boolean;
    /** The input-scoped stages (`stageInputSets`) whose input set holds one of `paths`. */
    readonly touched: ReadonlySet<string>;
    /** `false` (`--no-build`) drops only the two builds: the landing's gate runs them. */
    readonly build?: boolean;
    /**
     * `true` (`--landing`): the tree is a landing's numbered tip; the sentences stage applies the
     * landing rule instead of the branch rule, which the landing judged on each branch before
     * numbering it.
     */
    readonly landing?: boolean;
    /** Unit files whose witnesses the gate replays (`unitReplaySelection` in `t1.ts`). */
    readonly unitReplays?: ReadonlyArray<string>;
  },
) {
  const { workspace, units, related } = graph;
  const packages = typecheckPackages(paths, workspace);
  const steps: GateStage[] = [];
  steps.push({
    name: "guard ledgers",
    command: "node",
    args: ["scripts/check-guard-exceptions.ts", "--base", comparison],
  });
  if (touched.has(runtimeCycleStage))
    steps.push({
      name: runtimeCycleStage,
      command: "node",
      args: ["scripts/check-runtime-cycles.ts", "--base", comparison],
    });
  steps.push({
    name: "sentences",
    command: "node",
    args: ["scripts/check-sentences.ts", "--base", comparison, ...(landing ? ["--landing"] : [])],
  });
  steps.push(...ciGuardStages);
  steps.push({ name: "t1", command: "node", args: ["scripts/t1.ts"] });
  if (unitReplays.length)
    steps.push({
      name: "unit witness replay",
      command: "node",
      args: ["scripts/witness-replay.ts", ...unitReplays],
    });
  if (existing.length)
    steps.push({
      name: "check touched files",
      command: "vp",
      args: ["check", "--no-error-on-unmatched-pattern", ...existing],
    });
  if (tests && paths.length)
    steps.push({
      name: "repository invariants",
      command: "vp",
      args: ["test", "run", ...repositoryInvariants],
    });
  for (const pkg of packages.filter((pkg) => pkg.typecheck))
    steps.push({
      name: `typecheck ${pkg.name}`,
      command: "vp",
      args: ["exec", "effect-tsgo", "tsrs", "--noEmit", "--incremental"],
      cwd: pkg.directory,
    });
  const buildsSelected = buildStages.filter(({ stage }) => touched.has(stage.name));
  if (build)
    steps.push(
      ...buildsSelected.map(({ stage, deployed }) =>
        deployed ? deployedBuild(graph.root, stage) : stage,
      ),
    );
  const buildsSkipped = build ? [] : buildsSelected.map(({ stage }) => stage.name);
  if (!tests) return { steps, ownedUnits: [], buildsSkipped };
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
  if (existing.some((path) => /\.test\.tsx?$/u.test(path) && units.includes(path)))
    steps.push({
      name: "witness replay",
      command: "node",
      args: ["scripts/witness-replay.ts", "--changed", comparison],
    });
  steps.push(...testStages(ownedUnits, workspace));
  return { steps, ownedUnits, buildsSkipped };
}

/** Run each unit under its package and Vitest config. */
export function testStages(
  testFiles: ReadonlyArray<string>,
  workspace: ReadonlyArray<GatePackage>,
): GateStage[] {
  const steps: GateStage[] = [];
  const units = testFiles.filter((file) => !file.startsWith(`${webTestRoot}/`));
  const consumers = [
    { directory: ".", name: "root tests", typecheck: false },
    ...relatedTestPackages(workspace),
  ];
  for (const pkg of consumers) {
    const own = units.filter((file) =>
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
  return steps;
}

/** The environment a stage runs under; the witness replay runs its test files the same way. */
export function stageEnvironment(root: string, stage?: GateStage): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MATE_TEST_JOBS: process.env.MATE_TEST_JOBS ?? "8",
    PATH: [NodePath.join(root, "node_modules/.bin"), process.env.PATH ?? ""].join(
      NodePath.delimiter,
    ),
    ...stage?.env,
  };
}

/**
 * `--passed <commit>`: the selected stages a landing re-runs on HEAD after its own gate passed
 * `<commit>` (`scripts/land.ts`, under its lock, once `main` moved). The always-run stages run as
 * they would without it; every other stage runs only when a path that differs between the two
 * trees is one it reads (`stageReads`, deleted paths included), because a stage that reads none of
 * them gives HEAD the verdict it gave `<commit>`. When a selection input (`selectionInputs`)
 * differs, the selection itself may differ, so every selected stage runs.
 */
async function sinceGated(
  root: string,
  commit: string,
  selected: ReadonlyArray<GateStage>,
  {
    lane,
    graph,
  }: {
    readonly lane: Awaited<ReturnType<typeof laneSnapshot>>;
    readonly graph: ReturnType<typeof buildGateGraph>;
  },
): Promise<GateStage[]> {
  const differing = (
    await readGit(root, ["diff", "--name-only", "--no-renames", "-z", commit, "HEAD"])
  )
    .split("\0")
    .filter(Boolean);
  const differs = new Set(differing);
  const selector = selectionInputs(root).find((path) => differs.has(path));
  if (selector !== undefined) {
    console.log(`Passed ${commit}: ${selector} differs, a selection input, so every stage runs.`);
    return [...selected];
  }
  const universe = [...new Set([...lane.inventory, ...lane.paths, ...differing])];
  const inputSets = stageInputSets(root, universe, graph);
  const reads = (stage: GateStage) => {
    const { files, baseline } = stageReads(root, stage, {
      universe,
      paths: lane.paths,
      graph,
      inputSets,
    });
    return (
      files.some((path) => differs.has(path)) ||
      baseline.some((entry) =>
        differing.some((path) => path === entry || path.startsWith(`${entry}/`)),
      )
    );
  };
  const steps = selected.filter((stage) => alwaysRunStages.has(stage.name) || reads(stage));
  const left = selected.filter((stage) => !steps.includes(stage)).map((stage) => stage.name);
  console.log(
    `Passed ${commit}: ${differing.length} files differ from HEAD; ${
      left.length ? `not run, reading none of them: ${left.join(", ")}` : "every stage reads one"
    }.`,
  );
  return steps;
}

/** The CLI for one worktree; resolves to the exit status. */
export async function runGate(root: string, args: ReadonlyArray<string>): Promise<number> {
  if (args.includes("--help")) {
    console.log(
      "Usage: node scripts/gate-changed.ts [--base origin/main] [--list] [--verbose] [--full] [--force] [--no-build] [--tests] [--landing] [--passed <commit>]\n" +
        "Default: lint, typecheck and build of the changed packages. Tests run only when the owner asks:\n" +
        "--tests adds repository invariants, changed-test witness replay and related units.\n" +
        "--no-build leaves the builds (build web client, pack server) to the landing.\n" +
        "--full reuses no passed stage, from the worktree receipt or the shared cache; the landing passes it.\n" +
        "--landing judges the tree as a landing's numbered tip: the sentences stage applies the landing rule\n" +
        "instead of the branch rule; only scripts/land.ts passes it, after judging each branch by the branch\n" +
        "rule before numbering it.\n" +
        "--passed <commit>: this landing's own gate passed <commit>. The always-run stages run; every other\n" +
        "stage runs only when a file it reads differs between <commit> and HEAD, and every stage runs when a\n" +
        "selection input differs. It needs --full; only scripts/land.ts passes it, holding its lock.",
    );
    return 0;
  }
  const stale = staleDependencies(root);
  if (stale) {
    console.error(`gate refused: ${stale}`);
    return 1;
  }
  const selectionStarted = process.hrtime.bigint();
  const verbose = args.includes("--verbose");
  const tests = args.includes("--tests");
  const build = !args.includes("--no-build");
  let base = "origin/main";
  let passed: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (
      arg === "--list" ||
      arg === "--force" ||
      arg === "--full" ||
      arg === "--verbose" ||
      arg === "--no-build" ||
      arg === "--tests" ||
      arg === "--landing"
    )
      continue;
    if (arg === "--base") {
      const ref = args[++index];
      if (!ref || ref.startsWith("--")) throw new Error("--base needs a git ref");
      base = ref;
    } else if (arg === "--passed") {
      const commit = args[++index];
      if (!commit || commit.startsWith("--")) throw new Error("--passed needs a commit");
      passed = commit;
    } else {
      throw new Error(
        "Usage: node scripts/gate-changed.ts [--base origin/main] [--list] [--verbose] [--full] [--force] [--no-build] [--tests] [--landing] [--passed <commit>]",
      );
    }
  }
  // What `--passed` leaves out ran in the landing's own gate, never in a receipt or the shared cache.
  if (passed !== undefined && !args.includes("--full"))
    throw new Error(
      "--passed needs --full: the stages it leaves out ran in the landing's own gate",
    );
  const comparison = comparisonBase(root, base);
  const [lane, baseTree] = await Promise.all([
    laneSnapshot(root, comparison),
    readGit(root, baseTreeArgs(comparison)).then(baseEntries),
  ]);
  const paths = lane.paths;
  if (paths.length === 0) {
    console.log("No changed files; no gates to run.");
    return 0;
  }
  // A path removed from the index can stay on disk as an ignored file: only files still in the
  // workspace are the lane's to check.
  const workspace = new Set(lane.inventory);
  const existing = paths.filter(
    (path) => workspace.has(path) && NodeFS.existsSync(NodePath.join(root, path)),
  );
  const meaningful = meaningfulChanges(root, comparison, paths, baseTree);
  const graph = buildGateGraph(root, meaningful.previous, meaningful.paths);
  const inputSetsFor = (snapshot: typeof lane) =>
    stageInputSets(root, [...snapshot.inventory, ...snapshot.paths], graph);
  const inputSets = inputSetsFor(lane);
  const { steps: selected, buildsSkipped } = selectGateSteps(graph, {
    comparison,
    existing,
    paths: meaningful.paths,
    tests,
    touched: new Set(
      [...inputSets]
        .filter(([, files]) => meaningful.paths.some((path) => files.has(path)))
        .map(([name]) => name),
    ),
    build,
    landing: args.includes("--landing"),
    // Every change against the base counts, a comment-only owner edit too.
    unitReplays: unitReplaySelection(root, paths),
  });
  const steps =
    passed === undefined ? selected : await sinceGated(root, passed, selected, { lane, graph });
  const selectionMs = Number(process.hrtime.bigint() - selectionStarted) / 1_000_000;
  if (!tests)
    console.log(
      `Tests not selected: T1, lint, typecheck${build ? " and build" : ""} only (--tests runs them).`,
    );
  if (buildsSkipped.length)
    console.log(`Builds not selected (--no-build): the landing runs ${buildsSkipped.join(", ")}.`);
  if (args.includes("--list")) {
    console.log(`Diff from ${base}: ${paths.length} files`);
    for (const step of steps)
      console.log(
        `${step.name}: ${Object.entries(step.env ?? {})
          .map(([name, value]) => `${name}=${value} `)
          .join("")}${step.command} ${step.args.join(" ")}`,
      );
  } else {
    const receiptPath = NodePath.join(root, ".gate-receipt.json");
    const hash = diffHash(root, baseTree, paths);
    const selection = selectionHash(root);
    // Stage inputs normalize the ancestor so unchanged checks can survive a rebase.
    const selectedStages = steps.map((step) => ({
      ...step,
      args: step.args.map((arg) => (arg === comparison ? "<comparison>" : arg)),
    }));
    const full = args.includes("--full") || args.includes("--force");
    const shared = await sharedStageCache(root, baseTree, lane.inventory, full);
    const fingerprintsFor = (snapshot: typeof lane) => {
      const fingerprints = stageHashes(
        root,
        comparison,
        baseTree,
        snapshot,
        steps,
        graph,
        snapshot === lane ? inputSets : inputSetsFor(snapshot),
        selection,
      );
      if (shared)
        for (const step of steps) {
          const key = shared.key(step, fingerprints[step.name]);
          if (key) fingerprints[step.name] = key;
        }
      return fingerprints;
    };
    const fingerprints = fingerprintsFor(lane);
    // The base ref is shared with every worktree and moves on any fetch; the gate checks against
    // the ancestor it resolved at start, so only this worktree's own inputs can invalidate a run.
    const unchanged = async () => {
      const after = await laneSnapshot(root, comparison);
      return (
        after.headSha === lane.headSha &&
        diffHash(root, baseTree, after.paths) === hash &&
        selectionHash(root) === selection &&
        JSON.stringify(fingerprintsFor(after)) === JSON.stringify(fingerprints) &&
        (!shared || (await shared.unchanged()))
      );
    };
    const previousReceipt = full ? undefined : readReceipt(receiptPath);
    // The always-run stages (`alwaysRunStages`) run every time, so no receipt is reused whole; the
    // other stages are reused one by one.
    const reusable = new Map(
      steps
        .filter(
          (step) =>
            !alwaysRunStages.has(step.name) &&
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
    if (shared)
      for (const step of steps) {
        const key = shared.key(step, fingerprints[step.name]);
        if (!reusable.has(step.name) && key && shared.has(key))
          reusable.set(step.name, { name: step.name, status: 0, durationMs: 0 });
      }
    const gateStarted = Date.now();
    const receipt: GateReceipt = {
      version: 1,
      context: "gate",
      paths,
      headSha: lane.headSha,
      baseSha: comparison,
      diffHash: hash,
      stageHashes: fingerprints,
      selectionHash: selection,
      selectedStages,
      selectionMs,
      results: [...reusable.values()],
      durationMs: 0,
      completed: false,
      atRisk: [],
    };
    // Retain only proven unchanged successes; pending stages are invalidated before any check.
    writeReceipt(receiptPath, receipt);
    const logs = gateLogDirectory("gate-changed");
    if (verbose) console.log(`Full logs: ${logs}`);
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
    const running = new Set<StageRun>();
    let stopReason = "";
    let interrupted = 0;
    const stopRunning = (reason: string, graceMs: number) => {
      stopReason ||= reason;
      for (const run of running) run.stop(graceMs);
    };
    // The stages that ended red, named with their logs on the gate's last stderr line.
    const red: Array<{ readonly index: number; readonly name: string; readonly logPath: string }> =
      [];
    // One stage's run; its block is printed and its result recorded when it ends, so stages that
    // run at once still print one whole block each. A stopped stage records no result: it did not
    // run, and the next gate runs it.
    const runStage = async (index: number, step: GateStage): Promise<number | undefined> => {
      const logPath = NodePath.join(logs, `${index + 1}.log`);
      const started = Date.now();
      const timingPath = NodePath.join(logs, `${index + 1}.timings.jsonl`);
      const env: NodeJS.ProcessEnv = {
        ...stageEnvironment(root, step),
        MATE_GATE_TIMINGS: timingPath,
      };
      const run = runLoggedAsync(
        step.command,
        step.args,
        { cwd: NodePath.join(root, step.cwd ?? "."), env },
        logPath,
      );
      running.add(run);
      const status = await run.done;
      running.delete(run);
      if (status === "stopped") {
        console.log(`not run ${step.name} · stopped: ${stopReason}`);
        return undefined;
      }
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
      receipt.durationMs = Date.now() - gateStarted;
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
      if (step.name === "t1" && !verbose) {
        const line = /^T1 \d+ cases .*$/mu.exec(output)?.[0];
        if (line) console.log(line);
      }
      if (status !== 0) {
        console.error(failureSummary(output, logPath));
        red.push({ index, name: step.name, logPath });
      }
      return status;
    };
    const pending = steps.flatMap((step, index) => {
      if (!reusable.has(step.name)) return [{ index, step }];
      console.log(`reused stage: ${step.name}`);
      return [];
    });
    // Every stage must pass. The concurrent stages start at once and run to their end unless one
    // of `stopsTheRestWhenRed` ends red; the exclusive stages run only once all of them passed. A
    // signal to the gate stops the stages too: each runs in its own process group, out of reach
    // of a signal sent to the gate's. Only a SIGKILL of the gate leaves them running to their end.
    const forwarded = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const onSignal = (signal: NodeJS.Signals) => {
      interrupted ||= 128 + NodeOS.constants.signals[signal];
      stopRunning(`the gate got ${signal}`, signalledStopGraceMs);
    };
    for (const signal of forwarded) process.on(signal, onSignal);
    let status = 0;
    try {
      const concurrent = await Promise.all(
        pending
          .filter(({ step }) => !exclusiveStage(step.name))
          .map(async ({ index, step }) => {
            const code = await runStage(index, step);
            if (code !== undefined && code !== 0 && stopsTheRestWhenRed.has(step.name))
              stopRunning(`${step.name} is red`, redStopGraceMs);
            return code;
          }),
      );
      status = interrupted || (concurrent.find((code) => code !== undefined && code !== 0) ?? 0);
      for (const { index, step } of pending.filter(({ step }) => exclusiveStage(step.name))) {
        if (status !== 0) break;
        const code = await runStage(index, step);
        status = interrupted || (code ?? 0);
      }
    } finally {
      for (const signal of forwarded) process.off(signal, onSignal);
    }
    const stageMs = receipt.results.reduce((sum, result) => sum + result.durationMs, 0);
    console.log(
      `gate · ${((Date.now() - gateStarted) / 1000).toFixed(2)}s wall · ${(stageMs / 1000).toFixed(2)}s of stage time`,
    );
    if (status !== 0) {
      // The last stderr line: `land.ts` names these stages in its `gate` refusal.
      if (red.length > 0)
        console.error(
          `gate red: ${red
            .toSorted((left, right) => left.index - right.index)
            .map(({ name, logPath }) => `${name} (${logPath})`)
            .join("; ")}`,
        );
      return status;
    }
    if (!(await unchanged()))
      throw new Error(
        "Lane revision, diff or selection inputs changed during the gate; run again for the changed code.",
      );
    if (shared)
      for (const step of steps) {
        const key = shared.key(step, fingerprints[step.name]);
        if (key) shared.put(key);
      }
    receipt.completed = true;
    receipt.durationMs = Date.now() - gateStarted;
    writeReceipt(receiptPath, receipt);
    removeGateLogs(logs);
  }
  return 0;
}

if (import.meta.main)
  process.exit(await runGate(NodePath.resolve(import.meta.dirname, ".."), process.argv.slice(2)));
