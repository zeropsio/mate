// @effect-diagnostics nodeBuiltinImport:off - exercises a real repository and filesystem fixture.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { restoreFixture } from "./testFixture.ts";
import { testTempDir } from "./testTempDir.ts";

it("a reused repository starts with its template's refs, configuration, files and hooks", () => {
  const source = testTempDir("fixture-source-");
  const target = testTempDir("fixture-target-");
  const git = (cwd: string, ...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  git(source, "init", "-q", "--initial-branch=main");
  git(source, "config", "user.name", "Test User");
  git(source, "config", "user.email", "test@example.com");
  NodeFS.writeFileSync(NodePath.join(source, "README.md"), "initial\n");
  git(source, "add", "README.md");
  git(source, "commit", "-q", "-m", "initial");

  restoreFixture(source, target);
  const rootInode = NodeFS.statSync(target).ino;
  const gitInode = NodeFS.statSync(NodePath.join(target, ".git")).ino;
  git(target, "checkout", "-q", "-b", "feature");
  git(target, "config", "remote.origin.url", "https://example.com/changed.git");
  git(target, "worktree", "add", "-q", "-b", "crew/backend", ".crew/backend");
  NodeFS.writeFileSync(NodePath.join(target, "README.md"), "changed\n");
  NodeFS.writeFileSync(NodePath.join(target, ".git", "hooks", "pre-commit"), "changed\n");
  NodeFS.writeFileSync(NodePath.join(target, "untracked"), "changed\n");

  restoreFixture(source, target);

  expect(NodeFS.statSync(target).ino).toBe(rootInode);
  expect(NodeFS.statSync(NodePath.join(target, ".git")).ino).toBe(gitInode);
  expect(git(target, "branch", "--list", "--format=%(refname:short)")).toBe("main");
  expect(git(target, "status", "--porcelain")).toBe("");
  expect(NodeFS.readFileSync(NodePath.join(target, "README.md"), "utf8")).toBe("initial\n");
  expect(NodeFS.existsSync(NodePath.join(target, ".crew"))).toBe(false);
  expect(NodeFS.existsSync(NodePath.join(target, ".git", "hooks", "pre-commit"))).toBe(false);
  expect(
    NodeChildProcess.spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: target })
      .status,
  ).toBe(1);
});
