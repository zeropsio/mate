#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off -- host gate runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { chatGateTestFiles, selectLaneChatStages } from "./chat-gate.ts";
import { failureSummary, gateLogDirectory, runLogged } from "./gate-log.ts";

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

// An area owns these paths. Shared transport, data and shell changes reach every area.
const areaPaths: ReadonlyArray<readonly [string, RegExp]> = [
  ["a-signin", /(?:auth|account|signIn|organization)/iu],
  ["b-menu", /(?:Sidebar|menu|overview|mateRow)/iu],
  ["c-mate", /(?:chat|conversation|composer|thread|terminal)/iu],
  ["d-change", /(?:review|change|merge|git)/iu],
  ["e-env", /(?:deploy|operation|environment|appDetail|service)/iu],
  ["f-create", /(?:creat|provision|pool|import)/iu],
  ["g-outage", /(?:connect|retry|outage|lease|network)/iu],
];

export function selectScenarioAreas(paths: ReadonlyArray<string>): string[] {
  const selected = new Set<string>();
  for (const path of paths) {
    if (path.endsWith(".md")) continue;
    const boundaries = selectLaneChatStages([path], []);
    if (boundaries.length && boundaries.every((stage) => stage.id === "A" || stage.id === "E"))
      continue;
    if (
      boundaries.some((stage) => stage.id === "E") &&
      !boundaries.some((stage) => stage.id === "A")
    ) {
      selected.add("c-mate");
      continue;
    }
    if (!path.startsWith("apps/web/") && boundaries.some((stage) => stage.id === "C"))
      selected.add("c-mate");
    if (path.startsWith("apps/server/src/")) continue;
    const own = /^apps\/web\/test\/scenarios\/(?:areas|fakes)\/([^/]+)\//u.exec(path)?.[1];
    if (own && scenarioAreas.some((area) => area === own)) {
      selected.add(own);
      continue;
    }
    if (
      /^(?:apps\/web\/test\/scenarios\/|apps\/hq\/|packages\/hq-git\/)/u.test(path) ||
      /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|vite\.config\.ts|apps\/web\/vite\.config\.ts)$/u.test(
        path,
      )
    )
      return [...scenarioAreas];
    if (!/^(?:apps\/web\/src\/|packages\/(?:client-runtime|shared|contracts)\/src\/)/u.test(path))
      continue;
    if (/\.test\.[cm]?[jt]sx?$/u.test(path)) continue;
    if (
      path.startsWith("packages/") ||
      /\/components\/Sidebar[^/]*\.tsx$/u.test(path) ||
      /apps\/web\/src\/(?:zerops\/(?:.*[Aa]uth|.*[Aa]ccount|.*[Dd]ata)|auth|runtime|store)/u.test(
        path,
      )
    )
      return [...scenarioAreas];
    const matches = areaPaths.filter(([, pattern]) => pattern.test(path));
    if (matches.length === 0 || /\/(?:data|connection|state)\//u.test(path))
      return [...scenarioAreas];
    for (const [area] of matches) selected.add(area);
    selected.add("h-budget");
    selected.add("foundation");
  }
  return scenarioAreas.filter((area) => selected.has(area));
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
  ].sort();
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

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) => arg !== "--list" && arg !== "--base" && args[args.indexOf(arg) - 1] !== "--base",
    )
  )
    throw new Error("Usage: node scripts/gate-changed.ts [--base origin/main] [--list]");
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";
  if (!base) throw new Error("--base needs a git ref");
  const comparison = comparisonBase(root, base);
  const paths = changedPaths(root, comparison);
  if (paths.length === 0) {
    console.log("No changed files; no gates to run.");
    process.exit(0);
  }
  const existing = paths.filter((path) => NodeFS.existsSync(NodePath.join(root, path)));
  // Validate selection before any check, including --list.
  const areas = selectScenarioAreas(paths);
  const chatStages = selectLaneChatStages(paths, areas);
  const ownedFiles = chatGateTestFiles(root, chatStages);
  validateSelectedFiles(root, ownedFiles);
  const files = scenarioFiles(root, areas, ownedFiles);
  const contractTypechecks = chatStages.flatMap((stage) =>
    stage.commands.filter((command) => command.args.includes("tsc")),
  );
  const packages = touchedPackages(paths, workspacePackages(root));
  const steps: { name: string; command: string; args: string[]; cwd?: string }[] = [];
  steps.push({
    name: "guard ledgers",
    command: "node",
    args: ["scripts/check-guard-exceptions.ts", "--base", comparison],
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
      args: ["scripts/chat-gate.ts", "--stages", chatStages.map((stage) => stage.id).join(",")],
    });
  for (const pkg of packages.filter(
    (pkg) =>
      pkg.typecheck &&
      !contractTypechecks.some(
        (command) => command.cwd === pkg.directory && !command.args.includes("-p"),
      ),
  ))
    steps.push({
      name: `typecheck ${pkg.name}`,
      command: "vp",
      args: ["exec", "tsc", "--noEmit", "--incremental"],
      cwd: pkg.directory,
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
  const exclusions = (cwd: string) =>
    [...ownedFiles, ...files.map((file) => `apps/web/${file}`)].flatMap((file) =>
      file.startsWith(`${cwd}/`) || cwd === "."
        ? ["--exclude", NodePath.posix.relative(cwd, file)]
        : [],
    );
  // Run related tests with each consumer's real configuration, including web's wasm assets and
  // mobile's aliases. Consumers are cheap to discover; --changed selects their actual imports.
  if (
    paths.some(
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
      name: `scenarios ${areas.join(",")}`,
      cwd: "apps/web",
      command: "vp",
      args: ["test", "run", "--config", "test/scenarios/vitest.config.ts", ...files],
    });
  if (args.includes("--list")) {
    console.log(`Diff from ${base}: ${paths.length} files`);
    for (const step of steps) console.log(`${step.name}: ${step.command} ${step.args.join(" ")}`);
  } else {
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
        step.args,
        { cwd: NodePath.join(root, step.cwd ?? "."), env },
        logPath,
      );
      console.log(
        `${status === 0 ? "ok" : "FAIL"} ${step.name} (${((Date.now() - started) / 1000).toFixed(2)}s)`,
      );
      if (status !== 0) {
        console.error(failureSummary(NodeFS.readFileSync(logPath, "utf8"), logPath));
        process.exit(status);
      }
    }
  }
}
