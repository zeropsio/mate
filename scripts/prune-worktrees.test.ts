// @effect-diagnostics nodeBuiltinImport:off -- worktree decision fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  idleDecision,
  lsofBlockers,
  parseCwds,
  parseWorktrees,
  pruneDecision,
  worktreeLayout,
} from "./prune-worktrees.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

const candidate = { path: "/repo/z3-wt/done", branch: "refs/heads/done", locked: false };
const evidence = {
  main: "/repo/z3",
  roots: ["/repo/z3-wt", "/repo/z3/.claude/worktrees"],
  merged: true,
  clean: true,
  cwds: [] as string[],
};
it.each([
  { name: "merged clean idle lane", worktree: candidate, evidence, reason: "idle pool member" },
  { name: "no commits beyond main", worktree: candidate, evidence, reason: "idle pool member" },
  {
    name: "main checkout",
    worktree: { ...candidate, path: evidence.main },
    evidence,
    reason: "main checkout",
  },
  {
    name: "outside managed roots",
    worktree: { ...candidate, path: "/repo/z3-wt-other/lane" },
    evidence,
    reason: "outside managed roots",
  },
  {
    name: "dirty lane",
    worktree: candidate,
    evidence: { ...evidence, clean: false },
    reason: "dirty",
  },
  {
    name: "unmerged lane",
    worktree: candidate,
    evidence: { ...evidence, merged: false },
    reason: "unmerged",
  },
  {
    name: "live process in nested directory",
    worktree: candidate,
    evidence: { ...evidence, cwds: ["/repo/z3-wt/done/apps/web"] },
    reason: "live process cwd",
  },
  {
    name: "live process at root",
    worktree: candidate,
    evidence: { ...evidence, cwds: [candidate.path] },
    reason: "live process cwd",
  },
  {
    name: "similar cwd is elsewhere",
    worktree: candidate,
    evidence: { ...evidence, cwds: ["/repo/z3-wt/done-other"] },
    reason: "idle pool member",
  },
  { name: "locked worktree", worktree: { ...candidate, locked: true }, evidence, reason: "locked" },
  {
    name: "detached worktree",
    worktree: { ...candidate, branch: undefined },
    evidence,
    reason: undefined,
  },
])("prune keeps $name safe", ({ worktree, evidence, reason }) => {
  expect(pruneDecision(worktree, evidence)).toBe(reason);
  expect(idleDecision(worktree, evidence)).toBe(reason === "idle pool member" ? undefined : reason);
});

it("reads worktree paths with spaces and lsof cwd records", () => {
  expect(
    parseWorktrees("worktree /repo/a b\0HEAD abc\0branch refs/heads/done\0locked maintainer\0\0"),
  ).toEqual([{ path: "/repo/a b", head: "abc", branch: "refs/heads/done", locked: true }]);
  expect(parseCwds("p123\nfcwd\nn/repo/a b\np456\nfcwd\nn/repo/other\n")).toEqual([
    "/repo/a b",
    "/repo/other",
  ]);
});

const unreachableMount = [
  "lsof: WARNING: can't stat() smbfs file system /Volumes/.timemachine/nas/backup",
  "      Output information may be incomplete.",
  '      assuming "dev=36000006" from mount table',
].join("\n");
it.each([
  {
    name: "a mount that holds no lane",
    stderr: unreachableMount,
    roots: ["/repo/z3-wt"],
    blocks: false,
  },
  {
    name: "a mount that holds a lane",
    stderr: unreachableMount,
    roots: ["/Volumes/.timemachine/nas/backup/z3-wt"],
    blocks: true,
  },
  {
    name: "any other diagnostic",
    stderr: "lsof: status error on /repo: Permission denied",
    roots: ["/repo/z3-wt"],
    blocks: true,
  },
])(
  "an lsof warning blocks lane safety only when it can hide a lane: $name",
  ({ stderr, roots, blocks }) => {
    expect(lsofBlockers(stderr, roots).length > 0).toBe(blocks);
  },
);

it("dry-run keeps eligible worktrees; apply removes only an unassigned clean merged worktree", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-prune-"));
  const main = NodePath.join(root, "z3");
  const git = (cwd: string, ...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout;
  };
  try {
    NodeFS.mkdirSync(main);
    git(main, "init", "-q");
    git(main, "config", "user.name", "Prune fixture");
    git(main, "config", "user.email", "prune@example.test");
    NodeFS.writeFileSync(NodePath.join(main, "file"), "initial");
    git(main, "add", ".");
    git(main, "commit", "-qm", "base");
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    for (const name of ["merged", "dirty", "unmerged"])
      git(main, "worktree", "add", "-qb", name, NodePath.join(root, "z3-wt", name));
    const merged = NodePath.join(root, "z3-wt/merged");
    const detached = NodePath.join(root, "z3-wt/detached");
    git(main, "worktree", "add", "--detach", detached);
    const dirty = NodePath.join(root, "z3-wt/dirty");
    const unmerged = NodePath.join(root, "z3-wt/unmerged");
    NodeFS.writeFileSync(NodePath.join(dirty, "new"), "dirty");
    NodeFS.writeFileSync(NodePath.join(unmerged, "file"), "unmerged");
    git(unmerged, "commit", "-qam", "lane");
    const script = NodePath.join(import.meta.dirname, "prune-worktrees.ts");
    const run = (...args: string[]) =>
      NodeChildProcess.spawnSync(process.execPath, [script, ...args], {
        cwd: main,
        encoding: "utf8",
        env: { ...process.env, WT_ROOT: undefined },
      });
    const preview = run();
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain(`would remove ${detached}`);
    expect(preview.stdout).toContain(`keep ${merged}: idle pool member`);
    expect(NodeFS.existsSync(merged)).toBe(true);
    const apply = run("--apply");
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain("Removed 1 worktrees");
    expect(NodeFS.existsSync(merged)).toBe(true);
    expect(NodeFS.existsSync(detached)).toBe(false);
    expect(NodeFS.existsSync(dirty)).toBe(true);
    expect(NodeFS.existsSync(unmerged)).toBe(true);
    expect(NodeFS.existsSync(main)).toBe(true);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  {
    name: "WT_ROOT set: new lanes go to $WT_ROOT/<repo>; ../z3-wt and .claude/worktrees stay managed",
    wtRoot: "wt",
    roots: ["wt/z3", "z3-wt", "z3/.claude/worktrees"],
  },
  {
    name: "WT_ROOT unset: new lanes go to ../z3-wt as before",
    wtRoot: undefined,
    roots: ["z3-wt", "z3/.claude/worktrees"],
  },
])("worktree pool roots: $name", ({ wtRoot, roots }) => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-layout-")),
  );
  const main = NodePath.join(root, "z3");
  try {
    NodeFS.mkdirSync(main);
    NodeChildProcess.spawnSync("git", ["init", "-q"], { cwd: main });
    vi.stubEnv("WT_ROOT", wtRoot && NodePath.join(root, wtRoot));
    expect(worktreeLayout(main).roots).toEqual(roots.map((path) => NodePath.join(root, path)));
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
