#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off -- host gate runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { chatGateStages, chatGateTestFiles, selectLaneChatStages } from "./chat-gate.ts";
import { failureSummary, gateLogDirectory, runLogged } from "./gate-log.ts";
import { parseSync } from "oxc-parser";
import { transform as parseCss } from "lightningcss";
import { parse as parseHtml, type DefaultTreeAdapterMap } from "parse5";

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

const sourceFile = /\.[cm]?[jt]sx?$/u;
const documentation = (path: string) => /^(?:docs|\.plans)\//u.test(path) || /\.md$/iu.test(path);

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
    key === "start" || key === "end" ? undefined : value,
  );
}

/** Compare parsed source, preserving syntax and literal content while ignoring comments. */
export function meaningfulChanges(root: string, base: string, paths: ReadonlyArray<string>) {
  const previous = new Map<string, string>();
  const tracked = NodeChildProcess.spawnSync(
    "git",
    ["ls-tree", "-r", "--name-only", "-z", base, "--", ...paths],
    { cwd: root, encoding: "utf8" },
  );
  if (tracked.status !== 0) throw new Error(tracked.stderr);
  const oldFiles = new Set(tracked.stdout.split("\0"));
  const meaningful = paths.filter((path) => {
    if (documentation(path)) return false;
    if (oldFiles.has(path)) {
      const old = NodeChildProcess.spawnSync("git", ["show", `${base}:${path}`], {
        cwd: root,
        encoding: "utf8",
      });
      if (old.status !== 0) throw new Error(old.stderr);
      previous.set(path, old.stdout);
    }
    if (
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
): string[] {
  const changed = new Set(paths.filter((path) => !documentation(path)));
  if (!changed.size) return [];
  const exists = (path: string) =>
    previous.has(path) ||
    (NodeFS.existsSync(NodePath.join(root, path)) &&
      NodeFS.statSync(NodePath.join(root, path)).isFile());
  const resolveFile = (path: string): string | undefined => {
    const variants = [
      path,
      ...[".ts", ".tsx", ".js", ".jsx", ".json"].map((extension) => path + extension),
      ...[".ts", ".tsx", ".js"].map((extension) => `${path}/index${extension}`),
    ];
    if (/\.[cm]?js$/u.test(path)) variants.push(path.replace(/\.[cm]?js$/u, ".ts"));
    return variants.find(exists);
  };
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
    return [manifest.path, ...(resolved ? [resolved] : [])];
  };
  const filesBelow = (directory: string): string[] => {
    const current = NodeFS.existsSync(NodePath.join(root, directory))
      ? NodeFS.readdirSync(NodePath.join(root, directory), { withFileTypes: true }).flatMap(
          (entry) => {
            const path = `${directory}/${entry.name}`;
            return entry.isDirectory() ? filesBelow(path) : entry.isFile() ? [path] : [];
          },
        )
      : [];
    return [
      ...new Set([
        ...current,
        ...[...previous.keys()].filter((path) => path.startsWith(`${directory}/`)),
      ]),
    ];
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
  const config = "apps/web/test/scenarios/vitest.config.ts";
  const setupDeclarations: { include: string[] | undefined; files: string[] }[] = [];
  for (const source of [
    previous.get(config),
    NodeFS.existsSync(NodePath.join(root, config))
      ? NodeFS.readFileSync(NodePath.join(root, config), "utf8")
      : undefined,
  ]) {
    if (source === undefined) continue;
    const parsed = parseSync(config, source);
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
  const executionInputs = (file: string): string[] => {
    if (file === "apps/server/src/spi/replay/goldens.test.ts") {
      // loadFixture and goldenCheck read recordings, metadata and expected JSON from this root.
      return filesBelow("apps/server/src/spi/fixtures");
    }
    return [];
  };
  const edges = new Map<string, string[]>();
  const imports = (file: string): string[] => {
    const cached = edges.get(file);
    if (cached) return cached;
    const dependencies = executionInputs(file);
    const sources = [
      previous.get(file),
      NodeFS.existsSync(NodePath.join(root, file))
        ? NodeFS.readFileSync(NodePath.join(root, file), "utf8")
        : undefined,
    ];
    for (const source of new Set(sources)) {
      if (source === undefined) continue;
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
      const parsed = parseSync(file, source);
      if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0]!.message}`);
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const child of value) visit(child);
          return;
        }
        if (typeof value !== "object" || value === null) return;
        const node = value as Record<string, unknown>;
        const literal =
          node.source ??
          (node.type === "TSImportType" ? node.argument : undefined) ??
          (node.type === "CallExpression" && (node.callee as { name?: string })?.name === "require"
            ? (node.arguments as unknown[])[0]
            : undefined);
        if (
          typeof literal === "object" &&
          literal !== null &&
          "value" in literal &&
          typeof literal.value === "string"
        )
          dependencies.push(...resolveImport(file, literal.value));
        for (const child of Object.values(node)) visit(child);
      };
      visit(parsed.program);
    }
    edges.set(file, dependencies);
    return dependencies;
  };
  return candidates
    .filter((test) => {
      const pending = [
        test,
        ...(test.startsWith("apps/web/test/scenarios/")
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
      const visited = new Set<string>();
      while (pending.length) {
        const file = pending.pop()!;
        if (visited.has(file)) continue;
        visited.add(file);
        if (changed.has(file)) return true;
        pending.push(...imports(file));
      }
      return false;
    })
    .sort();
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
  const result = NodeChildProcess.spawnSync("git", ["merge-base", base, "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || `Cannot compare ${base} with HEAD`);
  return result.stdout.trim();
}

export function changedPaths(root: string, base: string): string[] {
  const git = (args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd: root, encoding: "utf8" });
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
    };
    return [{ directory, name: pkg.name, typecheck: Boolean(pkg.scripts?.typecheck) }];
  });
}

// Each application and service owns its test configuration, even when the diff is in a
// shared dependency. Vitest's import graph decides which of its tests need to run.
export function relatedTestPackages(packages: ReadonlyArray<GatePackage>) {
  return packages.filter((pkg) => /^(?:apps|infra)\//u.test(pkg.directory));
}

interface GateStage {
  readonly name: string;
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
}

interface GateReceipt {
  readonly diffHash: string;
  readonly selectionHash: string;
  readonly selectedStages: GateStage[];
  readonly results: { name: string; status: number; durationMs: number }[];
  durationMs: number;
  completed: boolean;
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
function selectionHash(root: string, inventory: ReadonlyArray<string>): string {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(JSON.stringify([process.version, inventory]));
  const inputs = [
    "scripts/gate-changed.ts",
    "scripts/chat-gate.ts",
    "scripts/gate-log.ts",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "apps/web/test/scenarios/vitest.config.ts",
    ...inventory,
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

function reusableReceipt(
  path: string,
  hash: string,
  selection: string,
  stages: GateStage[],
): boolean {
  if (!NodeFS.existsSync(path)) return false;
  const content = NodeFS.readFileSync(path, "utf8");
  let receipt: GateReceipt | null;
  try {
    receipt = JSON.parse(content) as GateReceipt | null;
  } catch {
    return false;
  } // A partial or corrupt receipt cannot prove a passing run.
  return (
    receipt !== null &&
    receipt.completed === true &&
    receipt.diffHash === hash &&
    receipt.selectionHash === selection &&
    JSON.stringify(receipt.selectedStages) === JSON.stringify(stages) &&
    Number.isFinite(receipt.durationMs) &&
    receipt.durationMs >= 0 &&
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

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  let base = "origin/main";
  const namedScenarios: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--list" || arg === "--force") continue;
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
        "Usage: node scripts/gate-changed.ts [--base origin/main] [--list] [--force] [--scenarios <file...>]",
      );
    }
  }
  for (const file of namedScenarios) {
    if (
      !/^apps\/web\/test\/scenarios\/areas\/.+\.scenario\.ts$/u.test(file) ||
      NodePath.posix.normalize(file) !== file
    )
      throw new Error(`Expected a repository-relative scenario file: ${file}`);
  }
  validateSelectedFiles(root, namedScenarios);
  const comparison = comparisonBase(root, base);
  const paths = changedPaths(root, comparison);
  if (paths.length === 0 && namedScenarios.length === 0) {
    console.log("No changed files; no gates to run.");
    process.exit(0);
  }
  const existing = paths.filter((path) => NodeFS.existsSync(NodePath.join(root, path)));
  const meaningful = meaningfulChanges(root, comparison, paths);
  const hasScenarioInventory = NodeFS.existsSync(
    NodePath.join(root, "apps/web/test/scenarios/areas"),
  );
  const inventory =
    meaningful.paths.length &&
    (hasScenarioInventory || meaningful.paths.some((path) => path.startsWith("apps/web/src/")))
      ? scenarioFiles(root, scenarioAreas, []).map((file) => `apps/web/${file}`)
      : [];
  const imported = relatedFiles(
    root,
    meaningful.paths,
    [
      ...inventory,
      ...chatGateTestFiles(
        root,
        chatGateStages.filter((stage) => stage.id === "A" || stage.id === "E"),
      ),
    ],
    meaningful.previous,
  );
  const related = [...new Set([...imported, ...namedScenarios])].sort();
  const chatStages = selectLaneChatStages([...meaningful.paths, ...namedScenarios], related, root);
  const ownedFiles = chatGateTestFiles(root, chatStages);
  validateSelectedFiles(root, ownedFiles);
  const files = related
    .filter((file) => file.startsWith("apps/web/test/scenarios/") && !ownedFiles.includes(file))
    .map((file) => NodePath.posix.relative("apps/web", file));
  for (const stage of chatGateStages) {
    const selection = chatStages.find((selected) => selected.id === stage.id);
    console.log(
      `Selection ${stage.id}: ${selection ? `${selection.reason}${namedScenarios.length ? `; explicit --scenarios: ${namedScenarios.join(", ")}` : ""}` : "skip: no related tests in its owning seam"}`,
    );
  }
  console.log(
    `Scenario files: ${related.filter((file) => file.endsWith(".scenario.ts")).length}; reason: ${namedScenarios.length ? "explicit --scenarios and own imports" : meaningful.paths.length ? "own imports and harness inputs (including old inputs for removals)" : "documentation/comments only"}`,
  );
  for (const file of related.filter((file) => file.startsWith("apps/web/test/scenarios/")))
    console.log(
      `Scenario ${file}; reason: ${[
        ...(imported.includes(file)
          ? [meaningful.paths.includes(file) ? "changed file" : "own imports or harness inputs"]
          : []),
        ...(namedScenarios.includes(file) ? ["explicit --scenarios"] : []),
      ].join("; ")}`,
    );
  if (!files.length) console.log("Related scenarios: skip: no files outside selected chat stages");
  const typecheckCommands = chatStages.flatMap((stage) =>
    stage.commands.filter((command) => command.args.includes("tsc")),
  );
  const packages = touchedPackages(meaningful.paths, workspacePackages(root));
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
  if (existing.length)
    steps.push({
      name: "check touched files",
      command: "vp",
      args: ["check", "--no-error-on-unmatched-pattern", ...existing],
    });
  if (chatStages.length)
    steps.push({
      name: `chat contract gate (${chatStages.map((stage) => stage.id).join(" + ")})`,
      command: "node",
      args: [
        "scripts/chat-gate.ts",
        "--stages",
        chatStages.map((stage) => stage.id).join(","),
        ...(ownedFiles.length ? ["--files", JSON.stringify(ownedFiles)] : []),
      ],
    });
  for (const pkg of packages.filter(
    (pkg) =>
      pkg.typecheck &&
      !typecheckCommands.some(
        (command) => command.cwd === pkg.directory && !command.args.includes("-p"),
      ),
  ))
    steps.push({
      name: `typecheck ${pkg.name}`,
      command: "vp",
      args: ["exec", "tsc", "--noEmit", "--incremental"],
      cwd: pkg.directory,
    });
  if (meaningful.paths.some((path) => path.startsWith("apps/web/test/scenarios/")))
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
  const exclusions = (cwd: string) =>
    [...ownedFiles, ...files.map((file) => `apps/web/${file}`)].flatMap((file) =>
      file.startsWith(`${cwd}/`) || cwd === "."
        ? ["--exclude", NodePath.posix.relative(cwd, file)]
        : [],
    );
  // Run related tests with each consumer's real configuration, including web's wasm assets and
  // mobile's aliases. Consumers are cheap to discover; --changed selects their actual imports.
  if (
    meaningful.paths.some(
      (path) =>
        /\.(?:[cm]?[jt]sx?|wasm|css|sql|snap)$/u.test(path) ||
        /(?:package\.json|pnpm-lock\.yaml)$/u.test(path),
    )
  ) {
    steps.push({
      name: "related root tests",
      command: "vp",
      args: [
        "test",
        "run",
        "--changed",
        comparison,
        "--passWithNoTests",
        "scripts",
        "oxlint-plugin-t3code",
        "packages",
        ...exclusions("."),
      ],
    });
    for (const pkg of relatedTestPackages(workspacePackages(root)))
      steps.push({
        name: `related ${pkg.name}`,
        command: "vp",
        args: [
          "test",
          "run",
          "--changed",
          comparison,
          "--passWithNoTests",
          ...exclusions(pkg.directory),
        ],
        cwd: pkg.directory,
      });
  }
  if (
    paths.some(
      (path) =>
        !NodeFS.existsSync(NodePath.join(root, path)) ||
        /(?:surfaces\.json|surface-manifest)/u.test(path),
    )
  )
    steps.push({
      name: "surface manifest",
      command: "vp",
      args: ["test", "run", "scripts/surface-manifest.test.ts"],
    });
  // Exclude only files owned by selected contract commands; retain affected drivers here.
  if (files.length)
    steps.push({
      name: "related scenario files",
      cwd: "apps/web",
      command: "vp",
      args: ["test", "run", "--config", "test/scenarios/vitest.config.ts", ...files],
    });
  if (args.includes("--list")) {
    console.log(`Diff from ${base}: ${paths.length} files`);
    for (const step of steps) console.log(`${step.name}: ${step.command} ${step.args.join(" ")}`);
  } else {
    const receiptPath = NodePath.join(root, ".gate-receipt.json");
    const hash = diffHash(root, comparison);
    const selection = selectionHash(root, [...inventory, ...namedScenarios]);
    // The ancestor SHA may move on rebase while the lane patch and selected checks stay identical.
    const selectedStages = steps.map((step) => ({
      ...step,
      args: step.args.map((arg) => (arg === comparison ? "<comparison>" : arg)),
    }));
    if (
      !args.includes("--force") &&
      reusableReceipt(receiptPath, hash, selection, selectedStages)
    ) {
      console.log(`reused receipt: ${receiptPath} (${hash})`);
      process.exit(0);
    }
    const gateStarted = Date.now();
    const receipt: GateReceipt = {
      diffHash: hash,
      selectionHash: selection,
      selectedStages,
      results: [],
      durationMs: 0,
      completed: false,
    };
    // Invalidate the previous success before any check, including a forced run that gets interrupted.
    writeReceipt(receiptPath, receipt);
    const PATH = [NodePath.join(root, "node_modules/.bin"), process.env.PATH ?? ""].join(
      NodePath.delimiter,
    );
    const logs = gateLogDirectory("gate-changed");
    console.log(`Full logs: ${logs}`);
    for (const [index, step] of steps.entries()) {
      const logPath = NodePath.join(logs, `${index + 1}.log`);
      const started = Date.now();
      const env: typeof process.env = {
        ...process.env,
        MATE_TEST_JOBS: process.env.MATE_TEST_JOBS ?? "8",
        PATH,
      };
      // Keep the scenarios' configured serial PostgreSQL fixtures when unit workers are bounded.
      if (step.args.some((arg) => arg.endsWith("/scenarios/vitest.config.ts")))
        delete env.VITEST_MAX_WORKERS;
      const status = runLogged(
        step.command,
        step.args.map((arg) =>
          arg.startsWith("test/scenarios/areas/") || arg.startsWith("test/scenarios/fakes/")
            ? NodePath.resolve(root, step.cwd ?? ".", arg)
            : arg,
        ),
        { cwd: NodePath.join(root, step.cwd ?? "."), env },
        logPath,
      );
      receipt.results.push({ name: step.name, status, durationMs: Date.now() - started });
      receipt.durationMs = Date.now() - gateStarted;
      writeReceipt(receiptPath, receipt);
      console.log(
        `${status === 0 ? "ok" : "FAIL"} ${step.name} (${((Date.now() - started) / 1000).toFixed(2)}s)`,
      );
      if (status !== 0) {
        console.error(failureSummary(NodeFS.readFileSync(logPath, "utf8"), logPath));
        process.exit(status);
      }
    }
    if (
      diffHash(root, comparison) !== hash ||
      selectionHash(root, [...inventory, ...namedScenarios]) !== selection
    )
      throw new Error(
        "Lane diff or selection inputs changed during the gate; run again for the changed code.",
      );
    receipt.completed = true;
    receipt.durationMs = Date.now() - gateStarted;
    writeReceipt(receiptPath, receipt);
  }
}
