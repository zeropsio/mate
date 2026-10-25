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
  readonly lockReason?: string | undefined;
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
        lockReason: value("locked"),
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

export interface Evidence {
  readonly main: string;
  readonly pool: string;
  /** HEAD's content is already in origin/main: an ancestor, or every file it changed matches there. */
  readonly landed: boolean;
  /** HEAD has commits that no remote-tracking ref holds. */
  readonly unpushed: boolean;
  readonly clean: boolean;
  /** The directory's .git link leads to this repository; a broken link makes git read the repository around it. */
  readonly checkout: boolean;
  readonly cwds: ReadonlyArray<string>;
  readonly worktrees: ReadonlyArray<string>;
}

/** Why the worktree must stay as it is; undefined means its work is safe elsewhere and nothing uses it. */
export function keepReason(worktree: Worktree, evidence: Evidence): string | undefined {
  if (worktree.path === evidence.main) return "main checkout";
  if (!evidence.checkout) return "not a checkout of this repository";
  if (worktree.locked) return "locked";
  if (evidence.cwds.some((cwd) => inside(cwd, worktree.path))) return "live process cwd";
  if (!evidence.clean) return "dirty";
  if (evidence.unpushed) return "commits on no remote";
  if (!evidence.landed) return "not in origin/main";
  if (evidence.worktrees.some((path) => path !== worktree.path && inside(path, worktree.path)))
    return "holds another worktree";
  return undefined;
}

/** A lane prepare-worktree may switch to a new job: only inside the pool. */
export function idleDecision(worktree: Worktree, evidence: Evidence): string | undefined {
  if (worktree.path === evidence.pool || !inside(worktree.path, evidence.pool))
    return "outside the pool";
  return keepReason(worktree, evidence);
}

/** A worktree prune removes: only outside the pool, which prepare-worktree reuses instead. */
export function pruneDecision(worktree: Worktree, evidence: Evidence): string | undefined {
  if (inside(worktree.path, evidence.pool)) return "in the pool";
  return keepReason(worktree, evidence);
}

export function worktreeLayout(cwd: string) {
  const common = NodeFS.realpathSync(
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(),
  );
  const main = NodePath.dirname(common);
  // Lanes live in one place: $WT_ROOT/<repo> (kept out of backup and Spotlight), else ../z3-wt.
  const wtRoot = process.env.WT_ROOT;
  const pool = wtRoot
    ? NodePath.resolve(wtRoot, NodePath.basename(main))
    : NodePath.resolve(main, "../z3-wt");
  return { common, main, pool };
}

const exit = (cwd: string, args: string[], meaning: string) => {
  const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0 && result.status !== 1)
    throw new Error(result.stderr || result.error?.message || `Cannot ${meaning}`);
  return result;
};

function landed(cwd: string, head: string): boolean {
  if (
    exit(cwd, ["merge-base", "--is-ancestor", head, "origin/main"], "compare to origin/main")
      .status === 0
  )
    return true;
  // Squash and rebase merges land the content under other commits.
  const base = exit(cwd, ["merge-base", head, "origin/main"], "find the merge base");
  if (base.status !== 0) return false;
  const names = (from: string, to: string) =>
    git(cwd, ["diff", "--no-renames", "--name-only", "-z", from, to]).split("\0").filter(Boolean);
  const differs = new Set(names(head, "origin/main"));
  return names(base.stdout.trim(), head).every((path) => !differs.has(path));
}

export function inspectWorktree(cwd: string, worktree: Worktree) {
  const common = (path: string) =>
    NodeFS.realpathSync(
      git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(),
    );
  if (common(worktree.path) !== common(cwd))
    return { worktree, checkout: false, landed: false, unpushed: true, clean: false };
  const head = git(worktree.path, ["rev-parse", "HEAD"]).trim();
  const branch = exit(
    worktree.path,
    ["symbolic-ref", "--quiet", "HEAD"],
    "inspect worktree branch",
  );
  const clean = git(worktree.path, ["status", "--porcelain=v1", "--untracked-files=all"]) === "";
  const headLanded = landed(cwd, head);
  let releaseLock = false;
  if (worktree.locked && worktree.lockReason && clean && headLanded) {
    const assigned = `refs/heads/${worktree.lockReason}`;
    const exists = exit(
      cwd,
      ["show-ref", "--verify", "--quiet", assigned],
      "inspect assigned branch",
    );
    if (exists.status === 0) {
      const tip = git(cwd, ["rev-parse", "--verify", assigned]).trim();
      const history = git(cwd, ["reflog", "show", "--format=%H%x00%gs", assigned])
        .trim()
        .split("\n");
      const creation = history.findLast((entry) =>
        entry.split("\0")[1]?.startsWith("branch: Created from "),
      );
      // A newly assigned branch is already at the base. Only work after its creation can have landed.
      // Missing/expired creation evidence and manual lock reasons leave the reservation intact.
      releaseLock = creation !== undefined && creation.split("\0")[0] !== tip && landed(cwd, tip);
    }
  }
  return {
    worktree: {
      ...worktree,
      head,
      branch: branch.status === 0 ? branch.stdout.trim() : undefined,
      locked: worktree.locked && !releaseLock,
    },
    checkout: true,
    landed: headLanded,
    // Squash landing protects the content even if the job's remote branch has been deleted.
    unpushed:
      !releaseLock && git(cwd, ["rev-list", "--count", head, "--not", "--remotes"]).trim() !== "0",
    clean,
  };
}

export function git(cwd: string, args: string[]): string {
  const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || `git ${args.join(" ")} failed`);
  return result.stdout;
}

const unreachableMount = /^lsof: WARNING: can't stat\(\) \S+ file system (.+)$/;

/** Diagnostics that can hide a process inside a lane root; a warning about another mount cannot. */
export function lsofBlockers(stderr: string, roots: readonly string[]): string[] {
  const blockers: string[] = [];
  let skipping = false;
  for (const line of stderr.split("\n")) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) && skipping) continue;
    const mount = unreachableMount.exec(line)?.[1];
    skipping = mount !== undefined && !roots.some((root) => inside(root, mount));
    if (!skipping) blockers.push(line);
  }
  return blockers;
}

export function liveCwds(roots: readonly string[]): string[] {
  const result = NodeChildProcess.spawnSync("lsof", ["-nP", "-a", "-d", "cwd", "-Fpn"], {
    encoding: "utf8",
  });
  // lsof uses 1 for an empty selection. Any diagnostic that can hide a lane means we cannot affirm process safety.
  const blockers = result.error ? [] : lsofBlockers(result.stderr, roots);
  if (
    result.error ||
    blockers.length > 0 ||
    (result.status !== 0 && !(result.status === 1 && result.stdout === ""))
  )
    throw new Error(
      `Cannot inspect live process cwd with lsof: ${result.error?.message ?? blockers.join("\n")}`,
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
  const { common, main, pool } = worktreeLayout(cwd);
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
  const paths = worktrees.map((worktree) => worktree.path);
  const before = freeBytes(main);
  let count = 0;
  let cwds = liveCwds(paths);
  for (const worktree of worktrees) {
    if (!NodeFS.existsSync(worktree.path)) {
      console.log(`keep ${worktree.path}: missing directory; registration retained`);
      continue;
    }
    let releaseLock = false;
    const decision = (processCwds: ReadonlyArray<string>) => {
      const { worktree: inspected, ...facts } = inspectWorktree(cwd, worktree);
      releaseLock = worktree.locked && !inspected.locked;
      return pruneDecision(inspected, {
        main,
        pool,
        ...facts,
        cwds: processCwds,
        worktrees: paths,
      });
    };
    const reason = worktree.path === main ? "main checkout" : decision(cwds);
    if (reason) {
      if (apply && reason === "in the pool" && releaseLock) {
        decision(cwds);
        if (releaseLock) git(cwd, ["worktree", "unlock", worktree.path]);
      }
      console.log(`keep ${worktree.path}: ${reason}`);
      continue;
    }
    if (apply) {
      // Refresh safety evidence at the destructive boundary; git remove independently rejects dirt.
      cwds = liveCwds(paths);
      const refreshed = decision(cwds);
      if (refreshed) {
        console.log(`keep ${worktree.path}: ${refreshed}`);
        continue;
      }
      if (releaseLock) git(cwd, ["worktree", "unlock", worktree.path]);
      // Removing the worktree keeps its branch and commits in the main repository.
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
