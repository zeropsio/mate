#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- test runner CLI.
/**
 * T1: every unit's cases, whole, one `vp test run` per workspace package, one after another. The
 * gate runs it at every landing (a red case blocks); CI's `T1` job runs it with `--budget`, the one
 * place its wall time is enforced. The units come from `check-sentences.ts`; nothing selects them.
 *
 * `replay <base>` is CI's witness replay: the unit files the diff `<base>..HEAD` touches directly or
 * through a witness's owner, replayed in one `witness-replay.ts` call.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { readUnits } from "./check-sentences.ts";
import { witnessOwners } from "./gate-input-scopes.ts";
import { decodeVitestReport } from "./witness-replay.ts";

/** T1's wall-time budget in seconds; raising it is the owner's decision. */
export const budgetSeconds = 60;

/** Unit files changed in `paths`, or holding a witness whose owner is in `paths`. */
export function unitReplaySelection(root: string, paths: ReadonlyArray<string>): string[] {
  const changed = new Set(paths);
  const owners = witnessOwners(root);
  return readUnits(root)
    .flatMap((unit) => unit.files)
    .filter(
      (file) =>
        changed.has(file) || [...(owners.get(file) ?? [])].some((owner) => changed.has(owner)),
    );
}

/** The nearest directory above `file` holding a `package.json`, repository-relative. */
function packageOf(root: string, file: string): string {
  let directory = NodePath.posix.dirname(file);
  while (directory !== "." && !NodeFS.existsSync(NodePath.join(root, directory, "package.json")))
    directory = NodePath.posix.dirname(directory);
  return directory;
}

/** Runs every unit file; returns the case count and whether every run was green. */
function runUnits(root: string): { readonly cases: number; readonly green: boolean } {
  const packages = new Map<string, string[]>();
  for (const file of readUnits(root).flatMap((unit) => unit.files)) {
    const pkg = packageOf(root, file);
    packages.set(pkg, [...(packages.get(pkg) ?? []), NodePath.posix.relative(pkg, file)]);
  }
  if (!packages.size) return { cases: 0, green: true };
  const reports = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t1-"));
  let cases = 0;
  let green = true;
  try {
    for (const [index, [pkg, files]] of [...packages]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .entries()) {
      const report = NodePath.join(reports, `${index}.json`);
      const run = NodeChildProcess.spawnSync(
        "vp",
        [
          "test",
          "run",
          ...files,
          "--reporter=default",
          "--reporter=json",
          `--outputFile.json=${report}`,
        ],
        { cwd: NodePath.join(root, pkg), stdio: "inherit" },
      );
      if (run.error) console.error(`T1 ${pkg}: ${run.error.message}`);
      if (run.status !== 0) green = false;
      if (!NodeFS.existsSync(report)) {
        console.error(`T1 ${pkg}: Vitest wrote no report`);
        green = false;
        continue;
      }
      cases += decodeVitestReport(
        JSON.parse(NodeFS.readFileSync(report, "utf8")),
      ).testResults.reduce((sum, file) => sum + file.assertionResults.length, 0);
    }
  } finally {
    NodeFS.rmSync(reports, { recursive: true, force: true });
  }
  return { cases, green };
}

/** The diff `<base>..HEAD`'s unit replay; CI's checkout holds only the two commits, so no merge-base. */
function replay(root: string, base: string): number {
  const diff = NodeChildProcess.spawnSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", base, "HEAD"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (diff.status !== 0) {
    console.error(diff.stderr || diff.error?.message || `git diff ${base} HEAD failed`);
    return 1;
  }
  const files = unitReplaySelection(root, diff.stdout.split("\0").filter(Boolean));
  if (!files.length) {
    console.log("T1 replay: no unit file selected");
    return 0;
  }
  return (
    NodeChildProcess.spawnSync("node", ["scripts/witness-replay.ts", ...files], {
      cwd: root,
      stdio: "inherit",
    }).status ?? 1
  );
}

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  if (args[0] === "replay" && args.length === 2) process.exit(replay(root, args[1]!));
  if (args.length > 1 || (args.length === 1 && args[0] !== "--budget")) {
    console.error("Usage: node scripts/t1.ts [--budget] | node scripts/t1.ts replay <base sha>");
    process.exit(1);
  }
  const started = process.hrtime.bigint();
  const { cases, green } = runUnits(root);
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(`T1 ${cases} cases ${seconds.toFixed(1)} s (budget ${budgetSeconds} s)`);
  const over = args[0] === "--budget" && seconds > budgetSeconds;
  if (over) console.error("T1 over budget");
  process.exit(green && !over ? 0 : 1);
}
