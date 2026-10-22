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
const fixture = (run: (git: HqGit, dir: string) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-compare-"))),
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
const native = (dir: string, args: string[], input = "") =>
  new Promise<string>((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      "git",
      ["-C", dir, ...args],
      {
        env: {
          PATH: "/usr/bin:/bin:/usr/local/bin",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "Ada Author",
          GIT_AUTHOR_EMAIL: "ada@example.test",
          GIT_AUTHOR_DATE: "@1700000000 +0000",
          GIT_COMMITTER_NAME: "Cy Committer",
          GIT_COMMITTER_EMAIL: "cy@example.test",
          GIT_COMMITTER_DATE: "@1700000060 +0000",
        },
      },
      (err, out) => (err ? reject(err) : resolve(out.trim())),
    );
    child.stdin?.end(input);
  });
/** A commit holding exactly `files` (a flat folder), on `parents`. */
const commit = async (
  dir: string,
  files: Record<string, string>,
  parents: ReadonlyArray<string>,
  message: string,
) => {
  const lines = [];
  for (const [name, content] of Object.entries(files)) {
    const blob = await native(dir, ["hash-object", "-w", "--stdin"], content);
    lines.push(`100644 blob ${blob}\t${name}\n`);
  }
  const tree = await native(dir, ["mktree"], lines.join(""));
  return native(dir, ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message]);
};
const value = Effect.runPromise;

describe("git browse compare", () => {
  it.effect("Comparing two branches shows what head adds since they split", () =>
    fixture(async (git, dir) => {
      const split = await commit(dir, { "a.txt": "one\n", "b.txt": "bee\n" }, [], "Start");
      // main moves on after the split: none of it is what the branch adds.
      const main = await commit(
        dir,
        { "a.txt": "one\n", "b.txt": "bee\n", "m.txt": "m\n" },
        [split],
        "Main moves",
      );
      const first = await commit(dir, { "a.txt": "two\n", "b.txt": "bee\n" }, [split], "Change a");
      const head = await commit(
        dir,
        { "a.txt": "two\n", "c.txt": "sea\n" },
        [first],
        "Swap b for c",
      );
      const read = (await value(git.browse.compare(repo, main, head)))!;
      expect(read.mergeBase).toBe(split);
      expect(read.commits.map((item) => [item.sha, item.subject, item.authorName])).toEqual([
        [head, "Swap b for c", "Ada Author"],
        [first, "Change a", "Ada Author"],
      ]);
      expect(read.totalCommits).toBe(2);
      expect(
        read.files.map(({ path, status, additions, deletions }) => [
          path,
          status,
          additions,
          deletions,
        ]),
      ).toEqual([
        ["a.txt", "modified", 1, 1],
        ["b.txt", "deleted", 0, 1],
        ["c.txt", "added", 1, 0],
      ]);
      expect(read.files[0]!.hunks).toContain("+two\n");
      expect(read.totalFiles).toBe(3);
      expect(read.filesTruncated).toBe(false);
      // A file read on request is the same diff, from where they split.
      expect((await value(git.browse.compareFile(repo, split, head, "c.txt")))!.hunks).toContain(
        "+sea\n",
      );
      // The other way round, main adds its own commit.
      const back = (await value(git.browse.compare(repo, head, main)))!;
      expect(back.commits.map((item) => item.subject)).toEqual(["Main moves"]);
      expect(back.files.map((file) => file.path)).toEqual(["m.txt"]);
    }),
  );

  it.effect("More than 100 commits shows the first 100 and the total", () =>
    fixture(async (git, dir) => {
      const base = await commit(dir, { "n.txt": "0\n" }, [], "Start");
      let head = base;
      for (let n = 1; n <= 103; n++)
        head = await commit(dir, { "n.txt": `${n}\n` }, [head], `Count ${n}`);
      const read = (await value(git.browse.compare(repo, base, head)))!;
      expect(read.totalCommits).toBe(103);
      expect(read.commits).toHaveLength(100);
      expect(read.commits[0]!.subject).toBe("Count 103");
      expect(read.commits.at(-1)!.subject).toBe("Count 4");
    }),
  );

  it.effect("A commit compared with itself adds no commits and changes no files", () =>
    fixture(async (git, dir) => {
      const sha = await commit(dir, { "a.txt": "a\n" }, [], "Start");
      expect(await value(git.browse.compare(repo, sha, sha))).toEqual({
        mergeBase: sha,
        commits: [],
        totalCommits: 0,
        files: [],
        totalFiles: 0,
        filesTruncated: false,
      });
    }),
  );

  it.effect("Two histories that never met have nothing in common to compare from", () =>
    fixture(async (git, dir) => {
      const one = await commit(dir, { "a.txt": "a\n" }, [], "One");
      const other = await commit(dir, { "b.txt": "b\n" }, [], "Other");
      expect(await value(git.browse.compare(repo, one, other))).toEqual({
        mergeBase: null,
        commits: [],
        totalCommits: 0,
        files: [],
        totalFiles: 0,
        filesTruncated: false,
      });
    }),
  );

  it.effect("A commit the repository does not hold reads as none", () =>
    fixture(async (git, dir) => {
      const sha = await commit(dir, { "a.txt": "a\n" }, [], "Start");
      const absent = "f".repeat(40);
      expect(await value(git.browse.compare(repo, sha, absent))).toBeNull();
      expect(await value(git.browse.compare(repo, absent, sha))).toBeNull();
      expect(await value(git.browse.compareFile(repo, absent, sha, "a.txt"))).toBeNull();
      expect(await value(git.browse.compareFile(repo, sha, "--output=x", "a.txt"))).toBeNull();
    }),
  );
});
