#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off -- local lane setup.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { failureSummary, gateLogDirectory, runLogged } from "./gate-log.ts";
import {
  git,
  idleDecision,
  inside,
  inspectWorktree,
  liveCwds,
  parseWorktrees,
  worktreeLayout,
} from "./prune-worktrees.ts";

const executable = (path: string) => {
  try {
    NodeFS.accessSync(path, NodeFS.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
const output = (command: string, args: string[]) => {
  const result = NodeChildProcess.spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
};

export function nodeVersionMatches(actual: string, range: string): boolean {
  const required = /^(\^?)(\d+)\.(\d+)\.(\d+)$/u.exec(range);
  const current = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(actual);
  if (!required || !current) return false;
  const minimum = required.slice(2).map(Number);
  const version = current.slice(1).map(Number);
  if (required[1] === "") return version.every((part, index) => part === minimum[index]);
  return (
    version[0] === minimum[0] &&
    (version[1]! > minimum[1]! || (version[1] === minimum[1] && version[2]! >= minimum[2]!))
  );
}

/** Presence checks only: no browser, database, daemon or remote probe is started. */
export async function readinessFailures(root: string): Promise<string[]> {
  const manifest = JSON.parse(NodeFS.readFileSync(NodePath.join(root, "package.json"), "utf8")) as {
    engines: { node: string };
    packageManager: string;
  };
  const failures: string[] = [];
  if (!nodeVersionMatches(process.version, manifest.engines.node))
    failures.push(
      `node ${process.version} does not match ${manifest.engines.node}; install Node ${manifest.engines.node}.`,
    );
  const pnpm = output("pnpm", ["--version"]);
  const requiredPnpm = manifest.packageManager.split("@")[1];
  if (pnpm !== requiredPnpm)
    failures.push(
      `pnpm ${pnpm ?? "missing"}, expected ${requiredPnpm}; run corepack prepare ${manifest.packageManager} --activate.`,
    );
  const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-flock-check-"));
  try {
    const lock = NodeChildProcess.spawnSync(
      "flock",
      ["-n", NodePath.join(temporary, "lock"), process.execPath, "-e", ""],
      { encoding: "utf8" },
    );
    if (lock.status !== 0)
      failures.push(
        "flock missing or unusable; install flock (brew install flock on macOS, util-linux on Linux).",
      );
  } finally {
    NodeFS.rmSync(temporary, { recursive: true, force: true });
  }
  try {
    const browser = await import(NodePath.join(root, "apps/web/test/testBrowser.ts"));
    await browser.resolveTestBrowser(process.env.MATE_CHROME_BIN);
  } catch (error) {
    failures.push(
      `Chrome for Testing missing; run vp run test:browser on this host. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const fromConfig = output("pg_config", ["--bindir"]);
  const debian = "/usr/lib/postgresql";
  const clusters = NodeFS.existsSync(debian)
    ? NodeFS.readdirSync(debian)
        .sort((a, b) => Number(b) - Number(a))
        .map((major) => NodePath.join(debian, major, "bin"))
    : [];
  const pgDir =
    process.env.MATE_PG_BIN ??
    [fromConfig, ...clusters, "/opt/homebrew/bin"].find(
      (path) => path !== undefined && executable(NodePath.join(path, "initdb")),
    );
  for (const binary of ["initdb", "pg_ctl", "postgres", "psql", "createdb"]) {
    if (!pgDir || !executable(NodePath.join(pgDir, binary)))
      failures.push(
        `PostgreSQL ${binary} missing; install local PostgreSQL binaries or set MATE_PG_BIN to their bin directory.`,
      );
  }
  return failures;
}

export function acquireWorktree(
  cwd: string,
  job: string,
): { path: string; reused: boolean; before: Set<string> } {
  git(cwd, ["check-ref-format", "--branch", job]);
  const exists = NodeChildProcess.spawnSync(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${job}`],
    { cwd },
  );
  if (exists.status === 0) throw new Error(`Branch ${job} already exists; choose a new job name.`);
  if (exists.status !== 1) throw new Error(`Cannot inspect branch ${job}`);
  git(cwd, ["rev-parse", "--verify", "origin/main"]);
  const layout = worktreeLayout(cwd);
  const cwds = liveCwds();
  for (const candidate of parseWorktrees(git(cwd, ["worktree", "list", "--porcelain", "-z"]))) {
    if (
      candidate.path === layout.main ||
      candidate.locked ||
      !layout.roots.some((root) => inside(candidate.path, root)) ||
      !NodeFS.existsSync(candidate.path)
    )
      continue;
    const state = inspectWorktree(cwd, candidate);
    if (
      idleDecision(state.worktree, {
        ...layout,
        merged: state.merged,
        clean: state.clean,
        cwds,
      }) !== undefined
    )
      continue;
    const before = worktreeEntries(candidate.path);
    // Refresh all safety evidence after inventory, immediately before switching the lane.
    const refreshed = inspectWorktree(cwd, candidate);
    if (
      idleDecision(refreshed.worktree, {
        ...layout,
        merged: refreshed.merged,
        clean: refreshed.clean,
        cwds: liveCwds(),
      }) !== undefined
    )
      continue;
    git(candidate.path, ["switch", "--no-track", "--create", job, "origin/main"]);
    return { path: candidate.path, reused: true, before };
  }
  const path = NodePath.resolve(layout.roots[0]!, job);
  if (path === layout.roots[0] || !inside(path, layout.roots[0]!))
    throw new Error(`Job name escapes the pool: ${job}`);
  git(cwd, ["worktree", "add", "--no-track", "-b", job, path, "origin/main"]);
  return { path, reused: false, before: new Set() };
}

export function worktreeEntries(root: string): Set<string> {
  const entries = new Set<string>();
  if (!NodeFS.existsSync(root)) return entries;
  const directories = [""];
  for (const directory of directories) {
    for (const entry of NodeFS.readdirSync(NodePath.join(root, directory), {
      withFileTypes: true,
    })) {
      const path = NodePath.join(directory, entry.name);
      entries.add(path);
      if (entry.isDirectory()) directories.push(path);
    }
  }
  return entries;
}

async function prepare(root: string): Promise<void> {
  const started = Date.now();
  const logs = gateLogDirectory("prepare-worktree");
  const env = {
    ...process.env,
    ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
    PATH: [NodePath.join(root, "node_modules/.bin"), process.env.PATH ?? ""].join(
      NodePath.delimiter,
    ),
  };
  const installLog = NodePath.join(logs, "install.log");
  const installed = runLogged(
    "pnpm",
    ["install", "--frozen-lockfile", "--prefer-offline"],
    { cwd: root, env },
    installLog,
  );
  const failures: string[] = [];
  if (installed !== 0)
    failures.push(
      `dependency install failed; fix the first error in ${installLog}, then run pnpm install --frozen-lockfile --prefer-offline.`,
    );
  if (installed === 0) {
    console.error(`Dependencies ready (${((Date.now() - started) / 1000).toFixed(2)}s).`);
    const electronLog = NodePath.join(logs, "electron.log");
    const ready = runLogged(
      process.execPath,
      [
        NodePath.resolve(
          import.meta.dirname,
          "../apps/desktop/scripts/ensure-electron-runtime.mjs",
        ),
        "--workspace",
        root,
      ],
      { cwd: root, env },
      electronLog,
    );
    if (ready !== 0)
      failures.push(
        `Electron runtime failed; ${failureSummary(NodeFS.readFileSync(electronLog, "utf8"), electronLog).split("\n")[0]}; full log ${electronLog}.`,
      );
  }
  failures.push(...(await readinessFailures(root)));
  for (const failure of failures) console.error(`FAIL ${failure}`);
  if (failures.length) throw new Error("Worktree is not ready; fix the prerequisites above.");
}

if (import.meta.main) {
  const started = Date.now();
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--acquire" && args.length === 3) {
      const cwd = args[1]!;
      const acquired = acquireWorktree(cwd, args[2]!);
      console.error(`${acquired.reused ? "Reusing" : "Creating"} ${acquired.path}.`);
      const before = acquired.before;
      await prepare(acquired.path);
      const added = [...worktreeEntries(acquired.path)].filter(
        (entry) => !before.has(entry),
      ).length;
      console.error(
        `${acquired.reused ? "Reused" : "Created"} ${acquired.path}; ${added} new entries.`,
      );
      console.log(acquired.path);
    } else {
      if (args.length !== 1 || args[0]!.startsWith("--"))
        throw new Error("Usage: node scripts/prepare-worktree.ts <job>");
      const cwd = process.cwd();
      const { common } = worktreeLayout(cwd);
      const result = NodeChildProcess.spawnSync(
        "flock",
        [
          "-x",
          NodePath.join(common, "mate-worktree-pool.lock"),
          process.execPath,
          NodePath.join(import.meta.dirname, "prepare-worktree.ts"),
          "--acquire",
          cwd,
          args[0]!,
        ],
        { encoding: "utf8" },
      );
      process.stderr.write(result.stderr ?? "");
      if (result.status !== 0)
        throw new Error(result.error?.message ?? "Worktree preparation failed.");
      console.error(`Acquire + ready: ${((Date.now() - started) / 1000).toFixed(2)}s.`);
      process.stdout.write(result.stdout);
    }
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
