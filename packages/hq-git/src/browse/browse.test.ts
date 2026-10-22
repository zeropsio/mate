// @effect-diagnostics nodeBuiltinImport:off - real git fixtures, no network listeners.
import { describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { makeHqGit } from "../index.ts";
import type { HqGit } from "../api.ts";

const repo = { appId: "app", id: "repo" };
const author = { name: "Core", email: "core@example.test" };
const fixture = (run: (git: HqGit, dir: string) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-browse-"))),
        (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
      );
      const git = yield* makeHqGit({
        rootDir: root,
        authenticate: () => null,
        canRead: () => true,
        lookupChange: async () => null,
      });
      yield* git.create(repo);
      yield* Effect.promise(() => run(git, NodePath.join(root, "app/repo.git")));
    }),
  );
const native = (dir: string, args: string[], env: Record<string, string> = {}) =>
  new Promise<string>((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      "git",
      ["-C", dir, ...args],
      {
        env: {
          PATH: "/usr/bin:/bin:/usr/local/bin",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: author.name,
          GIT_AUTHOR_EMAIL: author.email,
          GIT_COMMITTER_NAME: author.name,
          GIT_COMMITTER_EMAIL: author.email,
          ...env,
        },
      },
      (err, out) => (err ? reject(err) : resolve(out.trim())),
    );
    child.stdin?.end();
  });
const value = Effect.runPromise;
const write = async (
  git: HqGit,
  files: Record<string, string | null>,
  expectedHead: string | null,
) => {
  const result = await value(
    git.commitFiles(repo, "refs/heads/main", {
      files,
      expectedHead,
      message: "Core write",
      author,
    }),
  );
  if (!("sha" in result)) throw new Error(`write refused: ${result.kind}`);
  return result.sha;
};
/** A commit of the empty tree made at `seconds`, named `ref`. */
const commitAt = async (dir: string, ref: string, seconds: number, subject: string) => {
  const tree = await native(dir, ["mktree"]);
  const date = `@${1_700_000_000 + seconds} +0000`;
  const sha = await native(dir, ["commit-tree", tree, "-m", subject], {
    GIT_COMMITTER_DATE: date,
    GIT_AUTHOR_DATE: date,
  });
  await native(dir, ["update-ref", ref, sha]);
  return sha;
};

describe("git browse reads", () => {
  it.live("A branch name resolves once to the commit every later read of the page uses", () =>
    fixture(async (git, dir) => {
      const first = await write(git, { "README.md": "first" }, null);
      const resolved = await value(git.browse.resolve(repo, "main"));
      expect(resolved).toEqual({
        kind: "commit",
        sha: first,
        ref: { name: "main", kind: "branch" },
      });
      // The branch moves after the page resolved it: the page's reads still read its commit.
      await write(git, { "README.md": "second" }, first);
      expect((await value(git.browse.readme(repo, first, 256 * 1024)))?.content).toBe("first");
      for (const [rev, ref] of [
        [undefined, { name: "main", kind: "branch" }],
        ["refs/heads/main", { name: "main", kind: "branch" }],
      ] as const) {
        const again = await value(git.browse.resolve(repo, rev));
        expect(again.kind === "commit" && again.ref).toEqual(ref);
      }
      expect(await value(git.browse.resolve(repo, first.slice(0, 7)))).toEqual({
        kind: "commit",
        sha: first,
        ref: { name: first, kind: "commit" },
      });
      // `refs/heads` wins a name both namespaces hold.
      await native(dir, ["update-ref", "refs/github/heads/main", first]);
      await native(dir, ["tag", "-a", "-m", "One", "v1", first]);
      const main = await value(git.browse.resolve(repo, "main"));
      expect(main.kind === "commit" && main.ref.kind).toBe("branch");
      expect(await value(git.browse.resolve(repo, "v1"))).toEqual({
        kind: "commit",
        sha: first,
        ref: { name: "v1", kind: "tag" },
      });
      expect(await value(git.browse.resolve(repo, "refs/github/heads/main"))).toEqual({
        kind: "commit",
        sha: first,
        ref: { name: "main", kind: "github-branch" },
      });
      for (const rev of ["nope", "refs/remotes/x", "-x", "0".repeat(40)])
        expect(await value(git.browse.resolve(repo, rev))).toEqual({ kind: "missing" });
    }),
  );

  it.live("An empty repository reads as having no commits yet", () =>
    fixture(async (git) => {
      expect(await value(git.browse.resolve(repo, undefined))).toEqual({ kind: "unborn" });
      expect(await value(git.browse.resolve(repo, "main"))).toEqual({ kind: "unborn" });
      expect(await value(git.browse.refCounts(repo))).toEqual({ branches: 0, tags: 0 });
      expect(await value(git.browse.refs(repo, { kind: "branch" }))).toEqual({
        items: [],
        next: null,
        total: 0,
      });
    }),
  );

  it.live(
    "Refs list main first, then by newest commit, and a cursor continues where the last page stopped",
    () =>
      fixture(async (git, dir) => {
        await commitAt(dir, "refs/heads/main", 1_000, "Main");
        await commitAt(dir, "refs/heads/old", 2_000, "Old");
        await commitAt(dir, "refs/heads/newer", 3_000, "Newer");
        await commitAt(dir, "refs/heads/newest", 4_000, "Newest");
        const first = await value(git.browse.refs(repo, { kind: "branch", limit: 2 }));
        expect(first.items.map((item) => item.name)).toEqual(["main", "newest"]);
        expect(first.items[1]).toMatchObject({
          ref: "refs/heads/newest",
          kind: "branch",
          subject: "Newest",
          committedAt: "2023-11-14T23:20:00.000Z",
          outsideMate: false,
        });
        expect("total" in first && first.total).toBe(4);
        expect(first.next).not.toBeNull();
        // A branch made between pages, newer than all: the next page still starts after `newest`.
        await commitAt(dir, "refs/heads/later", 5_000, "Later");
        const second = await value(
          git.browse.refs(repo, { kind: "branch", limit: 2, cursor: first.next! }),
        );
        expect(second.items.map((item) => item.name)).toEqual(["newer", "old"]);
        expect(second.next).toBeNull();
        await commitAt(dir, "refs/tags/v1", 6_000, "Tag one");
        await commitAt(dir, "refs/tags/v2", 7_000, "Tag two");
        const tags = await value(git.browse.refs(repo, { kind: "tag" }));
        expect(tags.items.map((item) => [item.name, item.kind])).toEqual([
          ["v2", "tag"],
          ["v1", "tag"],
        ]);
        expect(await value(git.browse.refCounts(repo))).toEqual({ branches: 5, tags: 2 });
      }),
  );

  it.live("A filter narrows refs on HQ before paging", () =>
    fixture(async (git, dir) => {
      await commitAt(dir, "refs/heads/main", 1_000, "Main");
      for (let i = 0; i < 5; i++) await commitAt(dir, `refs/heads/feature-${i}`, 2_000 + i, "F");
      await commitAt(dir, "refs/heads/Fix-Login", 9_000, "Fix");
      const page = await value(git.browse.refs(repo, { kind: "branch", q: "FIX", limit: 1 }));
      expect(page.items.map((item) => item.name)).toEqual(["Fix-Login"]);
      expect(page).toMatchObject({ next: null, total: 1 });
      const features = await value(
        git.browse.refs(repo, { kind: "branch", q: "feature", limit: 2 }),
      );
      expect(features.items.map((item) => item.name)).toEqual(["feature-4", "feature-3"]);
      expect("total" in features && features.total).toBe(5);
    }),
  );

  it.live(
    "A branch is listed by its name alone, a change's left to Core to mark, and GitHub's as outside Mate",
    () =>
      fixture(async (git, dir) => {
        await commitAt(dir, "refs/heads/main", 1_000, "Main");
        await commitAt(dir, "refs/heads/mate/P_MATE/7", 2_000, "Add login");
        await commitAt(dir, "refs/github/heads/release", 3_000, "From GitHub");
        const page = await value(git.browse.refs(repo, { kind: "branch" }));
        expect(
          page.items.map(({ name, kind, change, outsideMate }) => ({
            name,
            kind,
            change,
            outsideMate,
          })),
        ).toEqual([
          { name: "main", kind: "branch", change: undefined, outsideMate: false },
          { name: "release", kind: "github-branch", change: undefined, outsideMate: true },
          { name: "mate/P_MATE/7", kind: "branch", change: undefined, outsideMate: false },
        ]);
        const resolved = await value(git.browse.resolve(repo, "mate/P_MATE/7"));
        expect(resolved.kind === "commit" && resolved.ref.kind).toBe("branch");
      }),
  );

  it.live("A README in .github wins over one at the root, and one at the root over docs", () =>
    fixture(async (git) => {
      const docs = await write(git, { "docs/readme.MD": "docs", "src/a.ts": "a" }, null);
      expect(await value(git.browse.readme(repo, docs, 256 * 1024))).toEqual({
        path: "docs/readme.MD",
        content: "docs",
        truncated: false,
      });
      const root = await write(git, { "README.txt": "root text", "Readme.md": "root" }, docs);
      expect(await value(git.browse.readme(repo, root, 256 * 1024))).toMatchObject({
        path: "Readme.md",
        content: "root",
      });
      const github = await write(git, { ".github/README.md": "github" }, root);
      expect(await value(git.browse.readme(repo, github, 256 * 1024))).toMatchObject({
        path: ".github/README.md",
        content: "github",
      });
      const big = await write(git, { ".github/README.md": "x".repeat(300 * 1024) }, github);
      const cut = await value(git.browse.readme(repo, big, 256 * 1024));
      expect(cut?.truncated).toBe(true);
      expect(cut?.content.length).toBe(256 * 1024);
      const none = await write(
        git,
        {
          ".github/README.md": null,
          "Readme.md": null,
          "README.txt": null,
          "docs/readme.MD": null,
        },
        big,
      );
      expect(await value(git.browse.readme(repo, none, 256 * 1024))).toBeNull();
    }),
  );
});
