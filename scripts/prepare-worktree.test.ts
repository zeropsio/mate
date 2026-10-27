// @effect-diagnostics nodeBuiltinImport:off -- real git pool fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeEvents from "node:events";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { acquireWorktree, nodeVersionMatches, worktreeEntries } from "./prepare-worktree.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});
it.each([
  ["v24.19.0", "^24.13.1", true],
  ["v24.13.1", "^24.13.1", true],
  ["v24.13.0", "^24.13.1", false],
  ["v25.0.0", "^24.13.1", false],
  ["v24.19.0", "24.19.0", true],
  ["v24.19.1", "24.19.0", false],
])("Node %s matches required %s: %s", (actual, required, expected) => {
  expect(nodeVersionMatches(actual, required)).toBe(expected);
});

it("acquires an idle lane without replacing dependencies; skips dirty, unmerged and live lanes", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pool-test-"));
  const main = NodePath.join(root, "z3");
  const git = (cwd: string, ...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  let live: NodeChildProcess.ChildProcess | undefined;
  vi.stubEnv("WT_ROOT", undefined);
  try {
    NodeFS.mkdirSync(main);
    git(main, "init", "-q");
    git(main, "config", "user.name", "Pool fixture");
    git(main, "config", "user.email", "pool@example.test");
    NodeFS.writeFileSync(NodePath.join(main, ".gitignore"), "node_modules/\n");
    NodeFS.writeFileSync(NodePath.join(main, "file"), "base");
    git(main, "add", ".");
    git(main, "commit", "-qm", "base");
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    const paths = Object.fromEntries(
      ["a-dirty", "b-unmerged", "c-live", "d-idle"].map((name) => {
        const path = NodePath.join(root, "z3-wt", name);
        git(main, "worktree", "add", "-qb", name, path);
        return [name, path];
      }),
    );
    NodeFS.writeFileSync(NodePath.join(paths["a-dirty"]!, "file"), "dirty");
    NodeFS.writeFileSync(NodePath.join(paths["b-unmerged"]!, "file"), "own commit");
    git(paths["b-unmerged"]!, "commit", "-qam", "own");
    live = NodeChildProcess.spawn(
      process.execPath,
      ["-e", "process.stdout.write('ready'); process.stdin.resume()"],
      { cwd: paths["c-live"], stdio: ["pipe", "pipe", "pipe"] },
    );
    await NodeEvents.EventEmitter.once(live.stdout!, "data");
    const dependencies = NodePath.join(paths["d-idle"]!, "node_modules");
    NodeFS.mkdirSync(dependencies);
    NodeFS.writeFileSync(NodePath.join(dependencies, "sentinel"), "keep dependencies");
    const acquired = acquireWorktree(main, "new-job");
    expect(acquired.path).toBe(paths["d-idle"]);
    expect(acquired.reused).toBe(true);
    expect(git(acquired.path, "branch", "--show-current")).toBe("new-job");
    expect(git(acquired.path, "rev-parse", "HEAD")).toBe(git(main, "rev-parse", "origin/main"));
    expect(NodeFS.readFileSync(NodePath.join(dependencies, "sentinel"), "utf8")).toBe(
      "keep dependencies",
    );
    expect(git(paths["c-live"]!, "branch", "--show-current")).toBe("c-live");
    expect(() => acquireWorktree(main, "b-unmerged")).toThrow("already exists");
    // With the acquired lane now occupied, no eligible worktree remains.
    NodeFS.writeFileSync(NodePath.join(acquired.path, "file"), "in progress");
    const created = acquireWorktree(main, "next-job");
    expect(created).toMatchObject({ path: NodePath.join(root, "z3-wt/next-job"), reused: false });
    expect(created.before.size).toBe(0);
    expect(git(paths["b-unmerged"]!, "log", "-1", "--format=%s")).toBe("own");
    expect(NodeFS.readFileSync(NodePath.join(paths["a-dirty"]!, "file"), "utf8")).toBe("dirty");
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
  { name: "WT_ROOT unset creates it in ../z3-wt", wtRoot: undefined, created: "z3-wt/next-job" },
])("reuses an idle lane in ../z3-wt; a new lane with $name", ({ wtRoot, created }) => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pool-root-")),
  );
  const main = NodePath.join(root, "z3");
  const git = (cwd: string, ...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  vi.stubEnv("WT_ROOT", wtRoot && NodePath.join(root, wtRoot));
  try {
    NodeFS.mkdirSync(main);
    git(main, "init", "-q");
    git(main, "config", "user.name", "Pool fixture");
    git(main, "config", "user.email", "pool@example.test");
    NodeFS.writeFileSync(NodePath.join(main, "file"), "base");
    git(main, "add", ".");
    git(main, "commit", "-qm", "base");
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    const idle = NodePath.join(root, "z3-wt", "idle");
    git(main, "worktree", "add", "-qb", "idle", idle);
    expect(acquireWorktree(main, "new-job")).toMatchObject({ path: idle, reused: true });
    NodeFS.writeFileSync(NodePath.join(idle, "file"), "in progress");
    expect(acquireWorktree(main, "next-job")).toMatchObject({
      path: NodePath.join(root, created),
      reused: false,
    });
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("with WT_ROOT set, prepare reuses and creates lanes only under $WT_ROOT/<repo>, never an idle lane outside it", () => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pool-root-")),
  );
  const main = NodePath.join(root, "z3");
  const git = (cwd: string, ...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  vi.stubEnv("WT_ROOT", NodePath.join(root, "wt"));
  try {
    NodeFS.mkdirSync(main);
    git(main, "init", "-q");
    git(main, "config", "user.name", "Pool fixture");
    git(main, "config", "user.email", "pool@example.test");
    NodeFS.writeFileSync(NodePath.join(main, "file"), "base");
    git(main, "add", ".");
    git(main, "commit", "-qm", "base");
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    for (const path of ["z3-wt/old-idle", "z3/.claude/worktrees/claude-idle"])
      git(main, "worktree", "add", "-q", "--detach", NodePath.join(root, path));
    const created = acquireWorktree(main, "first-job");
    expect(created).toMatchObject({ path: NodePath.join(root, "wt/z3/first-job"), reused: false });
    NodeFS.writeFileSync(NodePath.join(created.path, "file"), "finished job");
    git(created.path, "commit", "-qam", "finished job");
    git(main, "update-ref", "refs/remotes/origin/main", "first-job");
    git(created.path, "switch", "-q", "--detach", "origin/main");
    expect(acquireWorktree(main, "second-job")).toMatchObject({
      path: created.path,
      reused: true,
    });
    expect(git(NodePath.join(root, "z3-wt/old-idle"), "branch", "--show-current")).toBe("");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "two preparations reserve different lanes before either builder writes (reuse first: %s)",
  (reuseFirst) => {
    const root = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-lane-lock-")),
    );
    const main = NodePath.join(root, "z3");
    const git = (cwd: string, ...args: string[]) => {
      const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    vi.stubEnv("WT_ROOT", undefined);
    try {
      NodeFS.mkdirSync(main);
      git(main, "init", "-q");
      git(main, "config", "user.name", "Pool fixture");
      git(main, "config", "user.email", "pool@example.test");
      NodeFS.writeFileSync(NodePath.join(main, "file"), "base");
      git(main, "add", ".");
      git(main, "commit", "-qm", "base");
      git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
      if (reuseFirst)
        git(main, "worktree", "add", "-qb", "idle", NodePath.join(root, "z3-wt/idle"));
      const first = acquireWorktree(main, "first-job");
      const second = acquireWorktree(main, "second-job");
      expect(second.path).not.toBe(first.path);
      expect(git(first.path, "branch", "--show-current")).toBe("first-job");
      expect(git(second.path, "branch", "--show-current")).toBe("second-job");
      expect(git(main, "worktree", "list", "--porcelain")).toContain("locked first-job");
      expect(git(main, "worktree", "list", "--porcelain")).toContain("locked second-job");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);

it.each([false, true])(
  "preparation reclaims a landed clean locked lane regardless of its remote branch (present: %s)",
  (remotePresent) => {
    const root = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-lane-reclaim-")),
    );
    const main = NodePath.join(root, "z3");
    const git = (cwd: string, ...args: string[]) => {
      const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    vi.stubEnv("WT_ROOT", undefined);
    try {
      NodeFS.mkdirSync(main);
      git(main, "init", "-q");
      git(main, "config", "user.name", "Pool fixture");
      git(main, "config", "user.email", "pool@example.test");
      NodeFS.writeFileSync(NodePath.join(main, "file"), "base");
      git(main, "add", ".");
      git(main, "commit", "-qm", "base");
      git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
      const first = { path: NodePath.join(root, "z3-wt/first-job") };
      git(main, "worktree", "add", "-qb", "first-job", first.path);
      git(main, "worktree", "lock", "--reason", "first-job", first.path);
      NodeFS.writeFileSync(NodePath.join(first.path, "file"), "landed work");
      git(first.path, "commit", "-qam", "work");
      if (remotePresent) git(main, "update-ref", "refs/remotes/origin/first-job", "first-job");
      git(main, "update-ref", "refs/remotes/origin/main", "first-job");
      const second = acquireWorktree(main, "second-job");
      expect(second.path).toBe(first.path);
      expect(second.reused).toBe(true);
      expect(git(main, "worktree", "list", "--porcelain")).toContain("locked second-job");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);

it.each([
  { held: "a live process cwd inside it", cwd: "src", change: undefined },
  { held: "an edited tracked file", cwd: undefined, change: "file" },
  { held: "an untracked file", cwd: undefined, change: "notes" },
])("preparation never hands out a landed locked lane held by $held", async ({ cwd, change }) => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-lane-held-")),
  );
  const main = NodePath.join(root, "z3");
  const git = (cwd: string, ...args: string[]) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  let live: NodeChildProcess.ChildProcess | undefined;
  vi.stubEnv("WT_ROOT", undefined);
  try {
    NodeFS.mkdirSync(main);
    git(main, "init", "-q");
    git(main, "config", "user.name", "Pool fixture");
    git(main, "config", "user.email", "pool@example.test");
    NodeFS.mkdirSync(NodePath.join(main, "src"));
    NodeFS.writeFileSync(NodePath.join(main, "src/index"), "base");
    NodeFS.writeFileSync(NodePath.join(main, "file"), "base");
    git(main, "add", ".");
    git(main, "commit", "-qm", "base");
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    const lane = NodePath.join(root, "z3-wt/held-job");
    git(main, "worktree", "add", "-qb", "held-job", lane);
    git(main, "worktree", "lock", "--reason", "held-job", lane);
    NodeFS.writeFileSync(NodePath.join(lane, "file"), "landed work");
    git(lane, "commit", "-qam", "work");
    git(main, "update-ref", "refs/remotes/origin/main", "held-job");
    if (change) NodeFS.writeFileSync(NodePath.join(lane, change), "in progress");
    if (cwd) {
      live = NodeChildProcess.spawn(
        process.execPath,
        ["-e", "process.stdout.write('ready'); process.stdin.resume()"],
        { cwd: NodePath.join(lane, cwd), stdio: ["pipe", "pipe", "pipe"] },
      );
      await NodeEvents.EventEmitter.once(live.stdout!, "data");
    }
    const acquired = acquireWorktree(main, "next-job");
    expect(acquired).toMatchObject({ path: NodePath.join(root, "z3-wt/next-job"), reused: false });
    expect(git(lane, "branch", "--show-current")).toBe("held-job");
    expect(git(main, "worktree", "list", "--porcelain")).toContain("locked held-job");
  } finally {
    if (live) {
      const exited = NodeEvents.EventEmitter.once(live, "exit");
      live.stdin?.end();
      await exited;
    }
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("counts new filesystem entries without following dependency symlinks", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-entry-test-"));
  try {
    NodeFS.mkdirSync(NodePath.join(root, "lane"));
    NodeFS.mkdirSync(NodePath.join(root, "store"));
    NodeFS.writeFileSync(NodePath.join(root, "store/package"), "package");
    NodeFS.symlinkSync(NodePath.join(root, "store"), NodePath.join(root, "lane/dependency"), "dir");
    expect([...worktreeEntries(NodePath.join(root, "lane"))]).toEqual(["dependency"]);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
