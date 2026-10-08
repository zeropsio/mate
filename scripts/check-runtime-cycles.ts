#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- Repository dependency graph and Git baseline CLI.
import madge from "madge";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const BASELINE = "scripts/runtime-cycles.json";
const SOURCE_ROOTS = [
  "apps/web/src",
  "apps/server/src",
  "apps/hq/src",
  "apps/mobile/src",
  "apps/desktop/src",
  "packages/client-runtime/src",
  "packages/contracts/src",
  "packages/shared/src",
  "packages/hq-git/src",
];
const EXCLUDES = [/\.test\./, /\.spec\./, /\/__fixtures__\//, /\/testing\//, /routeTree\.gen/];

type Graph = Readonly<Record<string, readonly string[]>>;

/** Count strongly connected components, rather than Madge's overlapping circular paths. */
export function cyclicComponents(graph: Graph): string[][] {
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  function visit(node: string): void {
    const index = indices.size;
    indices.set(node, index);
    low.set(node, index);
    stack.push(node);
    active.add(node);
    for (const next of graph[node] ?? []) {
      if (!indices.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (active.has(next)) {
        low.set(node, Math.min(low.get(node)!, indices.get(next)!));
      }
    }
    if (low.get(node) !== index) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || graph[node]?.includes(node)) cycles.push(component.sort());
  }
  for (const node of Object.keys(graph).sort()) if (!indices.has(node)) visit(node);
  return cycles.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/** Use workspace exports as the source of package resolution, including subpath aliases. */
export function sourceAliases(root: string): Record<string, string[]> {
  const paths: Record<string, string[]> = { "~/*": ["apps/web/src/*"] };
  for (const group of ["packages", "apps"]) {
    if (!NodeFS.existsSync(NodePath.join(root, group))) continue;
    for (const entry of NodeFS.readdirSync(NodePath.join(root, group))) {
      const directory = NodePath.join(group, entry);
      const manifest = NodePath.join(root, directory, "package.json");
      if (!NodeFS.existsSync(manifest)) continue;
      const pkg = JSON.parse(NodeFS.readFileSync(manifest, "utf8")) as {
        name?: string;
        exports?: Record<string, unknown>;
      };
      if (!pkg.name || !pkg.exports) continue;
      for (const [subpath, target] of Object.entries(pkg.exports)) {
        const source =
          typeof target === "string"
            ? target
            : target !== null && typeof target === "object" && "types" in target
              ? target.types
              : undefined;
        if (typeof source !== "string" || !source.startsWith("./src/")) continue;
        paths[subpath === "." ? pkg.name : pkg.name + subpath.slice(1)] = [
          NodePath.join(directory, source),
        ];
      }
    }
  }
  return paths;
}

export async function scanRuntimeCycles(root: string, roots = SOURCE_ROOTS) {
  const result = await madge(
    roots.map((source) => NodePath.join(root, source)),
    {
      baseDir: root,
      fileExtensions: ["ts", "tsx"],
      excludeRegExp: EXCLUDES,
      tsConfig: {
        compilerOptions: {
          baseUrl: root,
          module: "ESNext",
          moduleResolution: "Bundler",
          paths: sourceAliases(root),
        },
      },
      detectiveOptions: { ts: { skipTypeImports: true }, tsx: { skipTypeImports: true } },
    },
  );
  const skipped = result.warnings().skipped;
  // Bundler assets/query imports are outside this runtime TS graph. Missing local TS targets
  // and workspace aliases must fail, rather than silently making the graph look smaller.
  const unresolved = skipped.filter(
    (target) =>
      !target.includes("?") &&
      (target.startsWith("@t3tools/") ||
        target.startsWith("~/") ||
        ((target.startsWith(".") || target.startsWith("/")) &&
          (NodePath.extname(target) === "" || /\.[cm]?[jt]sx?$/.test(target)))),
  );
  if (unresolved.length)
    throw new Error(`Unresolved local runtime dependencies:\n${unresolved.join("\n")}`);
  return {
    components: cyclicComponents(result.obj()),
    nodes: Object.keys(result.obj()).length,
    skipped,
  };
}

export function assertCycleBudget(actual: number, baseline: number, previous: number): void {
  if (baseline > previous)
    throw new Error(`Runtime cycle baseline grew: ${previous} → ${baseline}`);
  if (actual > baseline) throw new Error(`Runtime cyclic components grew: ${baseline} → ${actual}`);
  if (actual < baseline)
    throw new Error(`Lower runtime cycle baseline to ${actual} (currently ${baseline}).`);
}

function decodeBaseline(raw: string): number {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid runtime cycle baseline");
  return value;
}

function previousBudget(root: string, base: string): number {
  const git = (...args: string[]): string =>
    NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  let comparison = base;
  if (process.env.GITHUB_ACTIONS === "true") {
    const event = JSON.parse(NodeFS.readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")) as {
      before?: string;
      pull_request?: { base: { sha: string } };
    };
    comparison = event.pull_request?.base.sha ?? event.before ?? "";
    if (!/^[a-f0-9]{40}$/.test(comparison) || /^0+$/.test(comparison))
      throw new Error("Missing GitHub cycle ratchet base");
    if (git("rev-parse", "--is-shallow-repository") === "true")
      git("fetch", "--no-tags", "--unshallow", "origin", comparison);
    else if (
      NodeChildProcess.spawnSync("git", ["cat-file", "-e", `${comparison}^{commit}`], { cwd: root })
        .status !== 0
    )
      git("fetch", "--no-tags", "origin", comparison);
  }
  const revision = git("merge-base", comparison, "HEAD");
  if (
    NodeChildProcess.spawnSync("git", ["cat-file", "-e", `${revision}:${BASELINE}`], { cwd: root })
      .status !== 0
  ) {
    // First installation: the audited graph had 14 cyclic components. A later deletion is an error.
    if (
      NodeChildProcess.spawnSync(
        "git",
        ["cat-file", "-e", `${revision}:scripts/check-runtime-cycles.ts`],
        { cwd: root },
      ).status === 0
    )
      throw new Error("Base revision has no runtime cycle baseline");
    return 14;
  }
  return decodeBaseline(git("show", `${revision}:${BASELINE}`));
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--base"))
    throw new Error("Usage: node scripts/check-runtime-cycles.ts [--base <ref>]");
  const baseline = decodeBaseline(NodeFS.readFileSync(NodePath.join(ROOT, BASELINE), "utf8"));
  const previous = previousBudget(ROOT, args[1] ?? "origin/main");
  const scan = await scanRuntimeCycles(ROOT);
  console.log(
    `Runtime cycles: ${scan.components.length} components, ${scan.nodes} nodes; ${scan.skipped.length} external/bundler targets skipped.`,
  );
  for (const component of scan.components) console.log(component.join(" ↔ "));
  assertCycleBudget(scan.components.length, baseline, previous);
}
