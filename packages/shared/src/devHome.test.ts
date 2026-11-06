// @effect-diagnostics nodeBuiltinImport:off - builds real worktree layouts on disk.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { afterAll, beforeAll } from "vite-plus/test";

import { resolveGitWorktreePath, resolveWorktreeT3Home } from "./devHome.ts";

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-devhome-"));
  for (const kind of ["file", "checkout", "bare"]) {
    const root = NodePath.join(fixtureRoot, kind);
    NodeFS.mkdirSync(NodePath.join(root, "apps", "web", "src"), { recursive: true });
  }
  NodeFS.writeFileSync(NodePath.join(fixtureRoot, "file", ".git"), "");
  NodeFS.mkdirSync(NodePath.join(fixtureRoot, "checkout", ".git"));
});

afterAll(() => {
  NodeFS.rmSync(fixtureRoot, { recursive: true, force: true });
});

const makeRepo = (
  kind:
    | "worktree"
    | "checkout"
    | "bare"
    | "submodule"
    | "unreadable-git-file"
    | "bare-repo-worktree"
    | "custom-common-dir-worktree",
) =>
  Effect.sync(() => {
    const fixture = kind === "checkout" || kind === "bare" ? kind : "file";
    const root = NodePath.join(fixtureRoot, fixture);
    if (fixture === "file") {
      const pointer = {
        worktree: "gitdir: /elsewhere/.git/worktrees/x\n",
        "bare-repo-worktree": "gitdir: /srv/myrepo.git/worktrees/x\n",
        "custom-common-dir-worktree": "gitdir: /srv/store/worktrees/x\n",
        submodule: "gitdir: ../.git/modules/sub\n",
        "unreadable-git-file": "not a gitdir pointer\n",
      } as const;
      if (kind !== "checkout" && kind !== "bare") {
        NodeFS.writeFileSync(NodePath.join(root, ".git"), pointer[kind]);
      }
    }
    return { root, nested: NodePath.join(root, "apps", "web", "src") };
  });

describe("resolveGitWorktreePath", () => {
  it.effect("finds a worktree root from a nested directory", () =>
    Effect.gen(function* () {
      const { root, nested } = yield* makeRepo("worktree");
      assert.equal(yield* resolveGitWorktreePath(nested), NodePath.resolve(root));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a main checkout as not a linked worktree", () =>
    Effect.gen(function* () {
      const { nested } = yield* makeRepo("checkout");
      assert.equal(yield* resolveGitWorktreePath(nested), undefined);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a directory outside a repository", () =>
    Effect.gen(function* () {
      const { nested } = yield* makeRepo("bare");
      assert.equal(yield* resolveGitWorktreePath(nested), undefined);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a submodule as not a linked worktree", () =>
    Effect.gen(function* () {
      const { nested } = yield* makeRepo("submodule");
      assert.equal(yield* resolveGitWorktreePath(nested), undefined);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a .git file without a usable gitdir pointer", () =>
    Effect.gen(function* () {
      const { nested } = yield* makeRepo("unreadable-git-file");
      assert.equal(yield* resolveGitWorktreePath(nested), undefined);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("finds a worktree of a bare repository", () =>
    Effect.gen(function* () {
      const { root, nested } = yield* makeRepo("bare-repo-worktree");
      assert.equal(yield* resolveGitWorktreePath(nested), NodePath.resolve(root));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("finds a worktree whose common dir is not named .git", () =>
    Effect.gen(function* () {
      const { root, nested } = yield* makeRepo("custom-common-dir-worktree");
      assert.equal(yield* resolveGitWorktreePath(nested), NodePath.resolve(root));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("resolveWorktreeT3Home", () => {
  it.effect("answers with .t3 before the dev runner creates it", () =>
    Effect.gen(function* () {
      const { root, nested } = yield* makeRepo("worktree");
      const home = yield* resolveWorktreeT3Home(nested);
      assert.equal(home, NodePath.join(NodePath.resolve(root), ".t3"));
      assert.isFalse(NodeFS.existsSync(home ?? ""));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
