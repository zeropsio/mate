#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- host worktree maintenance.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface Worktree {
  readonly path: string;
  readonly head?: string | undefined;
  readonly branch?: string | undefined;
  readonly locked: boolean;
}

export function parseWorktrees(output: string): Worktree[] {
  return output
    .split("\0\0")
    .filter(Boolean)
    .map((record) => {
      const fields = record.split("\0");
      const value = (key: string) =>
        fields.find((field) => field.startsWith(`${key} `))?.slice(key.length + 1);
      const path = value("worktree");
      if (!path) throw new Error("git worktree list returned a record without a path");
      return {
        path,
        head: value("HEAD"),
        branch: value("branch"),
        locked: fields.some((field) => /^locked(?: |$)/u.test(field)),
      };
    });
}

export function parseCwds(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

export const inside = (path: string, parent: string) =>
  path === parent || path.startsWith(`${parent}${NodePath.sep}`);

/** Undefined means clean, merged and idle; missing evidence never grants eligibility. */
export function idleDecision(
  worktree: Worktree,
  evidence: {
    readonly main: string;
    readonly roots: ReadonlyArray<string>;
    readonly merged: boolean;
    readonly clean: boolean;
    readonly cwds: ReadonlyArray<string>;
  },
): string | undefined {
  if (worktree.path === evidence.main) return "main checkout";
  if (!evidence.roots.some((root) => worktree.path !== root && inside(worktree.path, root)))
    return "outside managed roots";
  if (worktree.locked) return "locked";
  if (!evidence.merged) return "unmerged";
  if (!evidence.clean) return "dirty";
  if (evidence.cwds.some((cwd) => inside(cwd, worktree.path))) return "live process cwd";
  return undefined;
}

export function pruneDecision(
  worktree: Worktree,
  evidence: Parameters<typeof idleDecision>[1],
): string | undefined {
  return idleDecision(worktree, evidence) ?? (worktree.branch ? "idle pool member" : undefined);
}

export function worktreeLayout(cwd: string) {
  const common = NodeFS.realpathSync(
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(),
  );
  const main = NodePath.dirname(common);
  return {
    common,
    main,
    roots: [NodePath.resolve(main, "../z3-wt"), NodePath.join(main, ".claude/worktrees")],
  };
}

export function inspectWorktree(cwd: string, worktree: Worktree) {
  const head = git(worktree.path, ["rev-parse", "HEAD"]).trim();
  const merged = NodeChildProcess.spawnSync(
    "git",
    ["merge-base", "--is-ancestor", head, "origin/main"],
    { cwd, encoding: "utf8" },
  );
  if (merged.status !== 0 && merged.status !== 1)
    throw new Error(merged.stderr || "Cannot compare worktree to origin/main");
  const branch = NodeChildProcess.spawnSync("git", ["symbolic-ref", "--quiet", "HEAD"], {
    cwd: worktree.path,
    encoding: "utf8",
  });
  if (branch.status !== 0 && branch.status !== 1)
    throw new Error(branch.stderr || "Cannot inspect worktree branch");
  return {
    worktree: { ...worktree, head, branch: branch.status === 0 ? branch.stdout.trim() : undefined },
    merged: merged.status === 0,
    clean: git(worktree.path, ["status", "--porcelain=v1", "--untracked-files=all"]) === "",
  };
}

export function git(cwd: string, args: string[]): string {
  const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || `git ${args.join(" ")} failed`);
  return result.stdout;
}

export function liveCwds(): string[] {
  const result = NodeChildProcess.spawnSync("lsof", ["-nP", "-a", "-d", "cwd", "-Fpn"], {
    encoding: "utf8",
  });
  // lsof uses 1 for an empty selection. Any diagnostic means we cannot affirm process safety.
  if (
    result.error ||
    result.stderr.trim() ||
    (result.status !== 0 && !(result.status === 1 && result.stdout === ""))
  )
    throw new Error(
      `Cannot inspect live process cwd with lsof: ${result.error?.message ?? result.stderr}`,
    );
  return parseCwds(result.stdout);
}

function freeBytes(path: string): number {
  const stats = NodeFS.statfsSync(path);
  return stats.bavail * stats.bsize;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && arg !== "--locked"))
    throw new Error("Usage: node scripts/prune-worktrees.ts [--apply]");
  const cwd = process.cwd();
  const { common, main, roots } = worktreeLayout(cwd);
  if (args.includes("--apply") && !args.includes("--locked")) {
    const result = NodeChildProcess.spawnSync(
      "flock",
      [
        "-x",
        NodePath.join(common, "mate-worktree-pool.lock"),
        process.execPath,
        NodePath.join(import.meta.dirname, "prune-worktrees.ts"),
        "--apply",
        "--locked",
      ],
      { cwd, stdio: "inherit" },
    );
    process.exit(result.status ?? 1);
  }
  const worktrees = parseWorktrees(git(cwd, ["worktree", "list", "--porcelain", "-z"]));
  const apply = args.includes("--apply");
  const before = freeBytes(main);
  let count = 0;
  let cwds = liveCwds();
  for (const worktree of worktrees) {
    if (worktree.path === main || !roots.some((root) => inside(worktree.path, root))) continue;
    if (!NodeFS.existsSync(worktree.path)) {
      console.log(`keep ${worktree.path}: missing directory; registration retained`);
      continue;
    }
    const decision = (processCwds: ReadonlyArray<string>) => {
      const state = inspectWorktree(cwd, worktree);
      return pruneDecision(state.worktree, {
        main,
        roots,
        merged: state.merged,
        clean: state.clean,
        cwds: processCwds,
      });
    };
    const reason = decision(cwds);
    if (reason) {
      console.log(`keep ${worktree.path}: ${reason}`);
      continue;
    }
    if (apply) {
      // Refresh safety evidence at the destructive boundary; git remove independently rejects dirt.
      cwds = liveCwds();
      const refreshed = decision(cwds);
      if (refreshed) {
        console.log(`keep ${worktree.path}: ${refreshed}`);
        continue;
      }
      git(cwd, ["worktree", "remove", worktree.path]);
    }
    count += 1;
    console.log(
      `${apply ? "removed" : "would remove"} ${worktree.path} (${worktree.branch ?? "detached"})`,
    );
  }
  const freed = freeBytes(main) - before;
  console.log(
    apply
      ? `Removed ${count} worktrees; filesystem free-space change ${freed} bytes (${(freed / 1024 ** 3).toFixed(2)} GiB).`
      : `Dry run: ${count} eligible worktrees. Use --apply to remove them.`,
  );
}
