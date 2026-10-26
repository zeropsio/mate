// @effect-diagnostics nodeBuiltinImport:off -- worktree decision fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeEvents from "node:events";
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
  pool: "/wt/z3",
  landed: true,
  unpushed: false,
  clean: true,
  checkout: true,
  cwds: [] as string[],
  worktrees: ["/repo/z3", "/repo/z3-wt/done"],
};
it.each([
  { name: "landed clean idle worktree", worktree: candidate, evidence, prune: undefined },
  {
    name: "landed detached worktree",
    worktree: { ...candidate, branch: undefined },
    evidence,
    prune: undefined,
  },
  {
    name: "main checkout",
    worktree: { ...candidate, path: evidence.main },
    evidence,
    prune: "main checkout",
  },
  {
    name: "lane in the pool",
    worktree: { ...candidate, path: "/wt/z3/done" },
    evidence,
    prune: "in the pool",
    reuse: undefined,
  },
  {
    name: "dirty lane",
    worktree: candidate,
    evidence: { ...evidence, clean: false },
    prune: "dirty",
  },
  {
    name: "pushed lane not in origin/main",
    worktree: candidate,
    evidence: { ...evidence, landed: false },
    prune: "not in origin/main",
  },
  {
    name: "lane with commits on no remote",
    worktree: candidate,
    evidence: { ...evidence, unpushed: true },
    prune: "commits on no remote",
  },
  {
    name: "live process in nested directory",
    worktree: candidate,
    evidence: { ...evidence, cwds: ["/repo/z3-wt/done/apps/web"] },
    prune: "live process cwd",
  },
  {
    name: "live process at root",
    worktree: candidate,
    evidence: { ...evidence, cwds: [candidate.path] },
    prune: "live process cwd",
  },
  {
    name: "similar cwd is elsewhere",
    worktree: candidate,
    evidence: { ...evidence, cwds: ["/repo/z3-wt/done-other"] },
    prune: undefined,
  },
  { name: "locked worktree", worktree: { ...candidate, locked: true }, evidence, prune: "locked" },
  {
    name: "directory whose .git link leads elsewhere",
    worktree: candidate,
    evidence: { ...evidence, checkout: false },
    prune: "not a checkout of this repository",
  },
  {
    name: "worktree holding another worktree",
    worktree: candidate,
    evidence: { ...evidence, worktrees: [...evidence.worktrees, "/repo/z3-wt/done/.plans/x"] },
    prune: "holds another worktree",
  },
])("prune keeps $name safe", ({ worktree, evidence, prune, ...row }) => {
  expect(pruneDecision(worktree, evidence)).toBe(prune);
  // prepare-worktree reuses only lanes in the pool, never one prune would consider.
  expect(idleDecision(worktree, evidence)).toBe("reuse" in row ? row.reuse : "outside the pool");
});

it("reads worktree paths with spaces and lsof cwd records", () => {
  expect(
    parseWorktrees("worktree /repo/a b\0HEAD abc\0branch refs/heads/done\0locked maintainer\0\0"),
  ).toMatchObject([{ path: "/repo/a b", head: "abc", branch: "refs/heads/done", locked: true }]);
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

function fixture(root: string) {
  const main = NodePath.join(root, "z3");
  const git = (cwd: string, ...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  NodeFS.mkdirSync(main);
  git(main, "init", "-q");
  git(main, "config", "user.name", "Prune fixture");
  git(main, "config", "user.email", "prune@example.test");
  NodeFS.writeFileSync(NodePath.join(main, ".gitignore"), ".plans/\n");
  NodeFS.writeFileSync(NodePath.join(main, "file"), "initial");
  git(main, "add", ".");
  git(main, "commit", "-qm", "base");
  git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
  const add = (path: string, ...args: string[]) => {
    const target = NodePath.join(root, path);
    git(main, "worktree", "add", "-q", ...args, target);
    return target;
  };
  const run = (...args: string[]) =>
    NodeChildProcess.spawnSync(
      process.execPath,
      [NodePath.join(import.meta.dirname, "prune-worktrees.ts"), ...args],
      { cwd: main, encoding: "utf8", env: { ...process.env, WT_ROOT: NodePath.join(root, "wt") } },
    );
  return { main, git, add, run };
}

it("dry-run keeps eligible worktrees; apply removes only an unassigned clean merged worktree", () => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-prune-")),
  );
  const { main, git, add, run } = fixture(root);
  try {
    const merged = add("z3-wt/merged", "-b", "merged");
    const detached = add("z3-wt/detached", "--detach");
    const dirty = add("z3-wt/dirty", "-b", "dirty");
    const pooled = add("wt/z3/pooled", "-b", "pooled");
    NodeFS.writeFileSync(NodePath.join(dirty, "new"), "dirty");
    const preview = run();
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain(`would remove ${merged} (refs/heads/merged)`);
    expect(preview.stdout).toContain(`would remove ${detached} (detached)`);
    expect(preview.stdout).toContain(`keep ${dirty}: dirty`);
    expect(preview.stdout).toContain(`keep ${pooled}: in the pool`);
    expect(preview.stdout).toContain(`keep ${main}: main checkout`);
    expect(NodeFS.existsSync(merged)).toBe(true);
    expect(NodeFS.existsSync(detached)).toBe(true);
    const apply = run("--apply");
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain("Removed 2 worktrees");
    expect(NodeFS.existsSync(merged)).toBe(false);
    expect(NodeFS.existsSync(detached)).toBe(false);
    expect(NodeFS.existsSync(dirty)).toBe(true);
    expect(NodeFS.existsSync(pooled)).toBe(true);
    expect(NodeFS.existsSync(main)).toBe(true);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("prune removes a worktree outside WT_ROOT once its content landed in origin/main and keeps its branch", () => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-prune-")),
  );
  const { main, git, add, run } = fixture(root);
  try {
    const squashed = add("z3-wt/squashed", "-b", "squashed");
    NodeFS.writeFileSync(NodePath.join(squashed, "file"), "feature");
    git(squashed, "commit", "-qam", "feature");
    git(main, "update-ref", "refs/remotes/origin/squashed", "squashed");
    // origin/main gains the same content under another commit, then moves on.
    git(main, "switch", "-q", "--detach", "origin/main");
    NodeFS.writeFileSync(NodePath.join(main, "file"), "feature");
    NodeFS.writeFileSync(NodePath.join(main, "later"), "later");
    git(main, "add", ".");
    git(main, "commit", "-qm", "squash merge");
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    const apply = run("--apply");
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain(`removed ${squashed} (refs/heads/squashed)`);
    expect(NodeFS.existsSync(squashed)).toBe(false);
    expect(git(main, "log", "-1", "--format=%s", "squashed")).toBe("feature");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("prune never removes a locked, live, dirty, unpushed, unlanded or nesting worktree and lists each with its reason", async () => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-prune-")),
  );
  const { git, add, run } = fixture(root);
  let live: NodeChildProcess.ChildProcess | undefined;
  try {
    const locked = add("z3-wt/locked", "-b", "locked");
    git(locked, "worktree", "lock", "--reason", "lane lease", locked);
    const busy = add("z3-wt/busy", "-b", "busy");
    NodeFS.mkdirSync(NodePath.join(busy, "apps"));
    live = NodeChildProcess.spawn(
      process.execPath,
      ["-e", "process.stdout.write('ready'); process.stdin.resume()"],
      { cwd: NodePath.join(busy, "apps"), stdio: ["pipe", "pipe", "pipe"] },
    );
    await NodeEvents.EventEmitter.once(live.stdout!, "data");
    const dirty = add("z3-wt/dirty", "-b", "dirty");
    NodeFS.writeFileSync(NodePath.join(dirty, "file"), "edited");
    const unpushed = add(".claude/worktrees/unpushed", "-b", "unpushed");
    NodeFS.writeFileSync(NodePath.join(unpushed, "file"), "local only");
    git(unpushed, "commit", "-qam", "local only");
    const unlanded = add("z3-wt/unlanded", "-b", "unlanded");
    NodeFS.writeFileSync(NodePath.join(unlanded, "file"), "pushed");
    git(unlanded, "commit", "-qam", "pushed");
    git(unlanded, "update-ref", "refs/remotes/origin/unlanded", "HEAD");
    const holder = add("z3-wt/holder", "-b", "holder");
    const nested = add("z3-wt/holder/.plans/nested", "-b", "nested");
    const apply = run("--apply");
    expect(apply.status, apply.stderr).toBe(0);
    for (const [path, reason] of [
      [locked, "locked"],
      [busy, "live process cwd"],
      [dirty, "dirty"],
      [unpushed, "commits on no remote"],
      [unlanded, "not in origin/main"],
      [holder, "holds another worktree"],
    ] as const) {
      expect(apply.stdout).toContain(`keep ${path}: ${reason}`);
      expect(NodeFS.existsSync(path)).toBe(true);
    }
    // The nested worktree itself has nothing worth keeping and goes; its holder stays this run.
    expect(apply.stdout).toContain(`removed ${nested}`);
    expect(apply.stdout).toContain("Removed 1 worktrees");
  } finally {
    if (live) {
      const exited = NodeEvents.EventEmitter.once(live, "exit");
      live.stdin?.end();
      await exited;
    }
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  { name: "its remote branch present", remote: true },
  { name: "its remote branch deleted", remote: false },
  { name: "a pool reservation", remote: false, pooled: true },
])("prune releases a landed clean assigned lane with $name", ({ remote, pooled }) => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-prune-")),
  );
  const { main, git, add, run } = fixture(root);
  try {
    const lane = add(pooled ? "wt/z3/assigned" : "z3-wt/assigned", "-b", "assigned");
    git(main, "worktree", "lock", "--reason", "assigned", lane);
    NodeFS.writeFileSync(NodePath.join(lane, "file"), "finished");
    git(lane, "commit", "-qam", "finished job");
    git(main, "update-ref", "refs/remotes/origin/assigned", "assigned");
    NodeFS.writeFileSync(NodePath.join(main, "file"), "finished");
    git(main, "commit", "-qam", "squashed job");
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    if (!remote) git(main, "update-ref", "-d", "refs/remotes/origin/assigned");

    const preview = run();
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain(
      pooled ? `keep ${lane}: in the pool` : `would remove ${lane} (refs/heads/assigned)`,
    );
    expect(git(main, "worktree", "list", "--porcelain")).toContain("locked assigned");

    const apply = run("--apply");
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain(
      pooled ? `keep ${lane}: in the pool` : `removed ${lane} (refs/heads/assigned)`,
    );
    expect(NodeFS.existsSync(lane)).toBe(Boolean(pooled));
    expect(git(main, "worktree", "list", "--porcelain")).not.toContain("locked assigned");
    expect(git(main, "log", "-1", "--format=%s", "assigned")).toBe("finished job");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  { name: "a freshly assigned lane still at its starting commit", commit: false, landed: true },
  { name: "a landed assigned lane with dirty work", commit: true, landed: true, dirty: true },
  { name: "a pushed assigned lane that has not landed", commit: true, landed: false },
  { name: "a manually locked landed lane", commit: true, landed: true, manual: true },
  {
    name: "a freshly assigned lane after the base advances independently",
    commit: false,
    landed: true,
    advanceBase: true,
  },
  {
    name: "a landed assignment whose creation reflog expired",
    commit: true,
    landed: true,
    expired: true,
  },
  {
    name: "an unlanded assignment after its checkout switches to the base",
    commit: true,
    landed: false,
    detached: true,
  },
])(
  "prune keeps $name locked",
  ({ commit, landed, dirty, manual, detached, advanceBase, expired }) => {
    const root = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-prune-")),
    );
    const { main, git, add, run } = fixture(root);
    try {
      const lane = add("z3-wt/assigned", "-b", "assigned");
      const reason = manual ? "maintenance" : "assigned";
      git(main, "worktree", "lock", "--reason", reason, lane);
      if (commit) {
        NodeFS.writeFileSync(NodePath.join(lane, "file"), "finished");
        git(lane, "commit", "-qam", "job commit");
      }
      git(main, "update-ref", "refs/remotes/origin/assigned", "assigned");
      if (landed) git(main, "update-ref", "refs/remotes/origin/main", "assigned");
      if (advanceBase) {
        NodeFS.writeFileSync(NodePath.join(main, "file"), "unrelated progress");
        git(main, "commit", "-qam", "another job landed");
        git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
      }
      if (expired)
        git(
          main,
          "reflog",
          "expire",
          "--expire=all",
          "--expire-unreachable=all",
          "refs/heads/assigned",
        );
      if (detached) git(lane, "switch", "-q", "--detach", "origin/main");
      if (dirty) NodeFS.writeFileSync(NodePath.join(lane, "file"), "unfinished");

      const apply = run("--apply");
      expect(apply.status, apply.stderr).toBe(0);
      expect(apply.stdout).toContain(`keep ${lane}: locked`);
      expect(NodeFS.existsSync(lane)).toBe(true);
      expect(git(main, "worktree", "list", "--porcelain")).toContain(`locked ${reason}`);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);

it("prune keeps a worktree whose .git link broke instead of judging the repository around it", () => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-prune-")),
  );
  const { git, add, run } = fixture(root);
  try {
    // The lanes' parent is itself a repository, as ~/Documents/Zerops-MCP is.
    git(root, "init", "-q");
    const broken = add("z3-wt/broken", "--detach");
    NodeFS.rmSync(NodePath.join(broken, ".git"));
    const apply = run("--apply");
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain(`keep ${broken}: not a checkout of this repository`);
    expect(NodeFS.existsSync(NodePath.join(broken, "file"))).toBe(true);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  {
    name: "WT_ROOT set: lanes live only under $WT_ROOT/<repo>",
    wtRoot: "wt",
    pool: "wt/z3",
  },
  {
    name: "WT_ROOT unset: lanes live in ../z3-wt as before",
    wtRoot: undefined,
    pool: "z3-wt",
  },
])("worktree pool roots: $name", ({ wtRoot, pool }) => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-layout-")),
  );
  const main = NodePath.join(root, "z3");
  try {
    NodeFS.mkdirSync(main);
    NodeChildProcess.spawnSync("git", ["init", "-q"], { cwd: main });
    vi.stubEnv("WT_ROOT", wtRoot && NodePath.join(root, wtRoot));
    expect(worktreeLayout(main).pool).toBe(NodePath.join(root, pool));
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
