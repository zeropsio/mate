// @effect-diagnostics nodeBuiltinImport:off -- real git pool fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeEvents from "node:events";
import { expect, it } from "vite-plus/test";
import { acquireWorktree, nodeVersionMatches, worktreeEntries } from "./prepare-worktree.ts";
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
