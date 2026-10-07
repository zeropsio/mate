#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off -- local lane setup.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { gateLogDirectory, runLogged } from "./gate-log.ts";

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
export function readinessFailures(root: string): string[] {
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
  if (
    ![
      process.env.MATE_CHROME_BIN,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
    ].some((path) => path !== undefined && executable(path))
  )
    failures.push(
      "Chrome missing; install Google Chrome/Chromium or set MATE_CHROME_BIN to its executable.",
    );
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

if (import.meta.main) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/prepare-worktree.ts");
  const root = NodePath.resolve(import.meta.dirname, "..");
  const started = Date.now();
  const logs = gateLogDirectory("prepare-worktree");
  const env = {
    ...process.env,
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
    console.log(`Dependencies ready (${((Date.now() - started) / 1000).toFixed(2)}s).`);
    const electronLog = NodePath.join(logs, "electron.log");
    const ready = runLogged(
      process.execPath,
      ["apps/desktop/scripts/ensure-electron-runtime.mjs", "--offline"],
      { cwd: root, env },
      electronLog,
    );
    if (ready !== 0)
      failures.push(
        `Electron runtime failed: ${NodeFS.readFileSync(electronLog, "utf8").trim().replace(/\s+/gu, " ")}; full log ${electronLog}.`,
      );
  }
  failures.push(...readinessFailures(root));
  for (const failure of failures) console.error(`FAIL ${failure}`);
  if (failures.length) process.exitCode = 1;
  else
    console.log(
      `Ready: node ${process.version}, pnpm ${output("pnpm", ["--version"])}, flock, Chrome, PostgreSQL, Electron (${((Date.now() - started) / 1000).toFixed(2)}s total).`,
    );
}
