// @effect-diagnostics nodeBuiltinImport:off - real git fixtures, no network listeners.
import { describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { makeHqGit } from "../index.ts";
import type { HqGit } from "../api.ts";
import { PatchSections } from "./diff.ts";

const repo = { appId: "app", id: "repo" };
const fixture = (run: (git: HqGit, dir: string) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-commit-"))),
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
const native = (dir: string, args: string[], input?: string) =>
  new Promise<string>((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      "git",
      ["-C", dir, ...args],
      {
        maxBuffer: 64 * 1024 * 1024,
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
    // Without input nothing is written: git that never reads stdin may already have exited,
    // and a write to it raises an unhandled EPIPE.
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
const lines = (count: number, tag: string) =>
  Array.from({ length: count }, (_, i) => `${tag} line ${String(i)} ${"x".repeat(60)}\n`).join("");

describe("git browse commit", () => {
  it.effect("A commit's message, people and each changed file come with their counts", () =>
    fixture(async (git, dir) => {
      const first = await commit(dir, { "a.txt": "one\ntwo\n", "gone.txt": "bye\n" }, [], "Start");
      const sha = await commit(
        dir,
        { "a.txt": "one\n2\nthree\n", "new.txt": "hello\n", "logo.png": "\0PNG\0" },
        [first],
        "Count to three\n\nThe second line is a number now.\nAnd a third one came.",
      );
      const read = await value(git.browse.commit(repo, sha));
      expect(read).toMatchObject({
        sha,
        parents: [first],
        subject: "Count to three",
        body: "The second line is a number now.\nAnd a third one came.",
        messageCut: false,
        authorName: "Ada Author",
        committerName: "Cy Committer",
        totalFiles: 4,
        filesTruncated: false,
      });
      expect(
        read!.files.map(({ path, status, additions, deletions, binary, loadable }) => ({
          path,
          status,
          additions,
          deletions,
          binary,
          loadable,
        })),
      ).toEqual([
        {
          path: "a.txt",
          status: "modified",
          additions: 2,
          deletions: 1,
          binary: false,
          loadable: false,
        },
        {
          path: "gone.txt",
          status: "deleted",
          additions: 0,
          deletions: 1,
          binary: false,
          loadable: false,
        },
        {
          path: "logo.png",
          status: "added",
          additions: 0,
          deletions: 0,
          binary: true,
          loadable: false,
        },
        {
          path: "new.txt",
          status: "added",
          additions: 1,
          deletions: 0,
          binary: false,
          loadable: false,
        },
      ]);
      // Git writes UTC as `Z` or `+00:00` by its version: the moment is what counts.
      expect([Date.parse(read!.authoredAt), Date.parse(read!.committedAt)]).toEqual([
        1_700_000_000_000, 1_700_000_060_000,
      ]);
      expect(read!.files[0]!.hunks).toContain("@@ -1,2 +1,3 @@\n one\n-two\n+2\n+three\n");
      expect(read!.files[2]!.hunks).toBeNull();
      expect(JSON.stringify(read)).not.toContain("example.test");
    }),
  );

  it.effect("Files past the page's budget load one at a time on request", () =>
    fixture(async (git, dir) => {
      // About 150 KiB of patch each: six come with the page, the rest wait for their own read.
      const files: Record<string, string> = {};
      for (let i = 0; i < 8; i++) files[`f${String(i)}.txt`] = lines(2000, `f${String(i)}`);
      const sha = await commit(dir, files, [], "Many files");
      const read = (await value(git.browse.commit(repo, sha)))!;
      const shown = read.files.filter((file) => file.hunks !== null);
      const waiting = read.files.filter((file) => file.loadable);
      expect(shown.length).toBeGreaterThan(0);
      expect(waiting.length).toBeGreaterThan(0);
      expect(shown.length + waiting.length).toBe(8);
      // Every file the page shows comes before every file that waits.
      expect(read.files.slice(0, shown.length)).toEqual(shown);
      expect(shown.reduce((sum, file) => sum + file.hunks!.length, 0)).toBeLessThanOrEqual(
        1024 * 1024,
      );
      const later = waiting[0]!;
      const loaded = await value(git.browse.commitFile(repo, sha, later.path));
      expect(loaded!.hunks).toContain(`+${later.path.slice(0, 2)} line 1999 `);
      expect(loaded!.hunks).toMatch(new RegExp(`^diff --git a/${later.path} b/${later.path}\n`));
    }),
  );

  it.effect("A file too long to read here never keeps the files after it from the page", () =>
    fixture(async (git, dir) => {
      const sha = await commit(
        dir,
        { "a.txt": "a\n", "pnpm-lock.yaml": lines(20000, "lock"), "z.txt": "z\n" },
        [],
        "Lock",
      );
      const read = (await value(git.browse.commit(repo, sha)))!;
      expect(read.files.map((file) => [file.path, file.hunks !== null, file.loadable])).toEqual([
        ["a.txt", true, false],
        ["pnpm-lock.yaml", false, false],
        ["z.txt", true, false],
      ]);
      expect(read.files[1]!.additions).toBe(20000);
      expect(await value(git.browse.commitFile(repo, sha, "pnpm-lock.yaml"))).toEqual({
        hunks: null,
      });
    }),
  );

  it.effect("A merge commit shows what it brought against its first parent", () =>
    fixture(async (git, dir) => {
      const root = await commit(dir, { "a.txt": "1\n" }, [], "Root");
      const main = await commit(dir, { "a.txt": "2\n" }, [root], "Main moves");
      const side = await commit(dir, { "a.txt": "1\n", "b.txt": "side\n" }, [root], "Side adds");
      const merge = await commit(dir, { "a.txt": "2\n", "b.txt": "side\n" }, [main, side], "Merge");
      const read = (await value(git.browse.commit(repo, merge)))!;
      expect(read.parents).toEqual([main, side]);
      expect(read.files.map((file) => [file.path, file.status, file.additions])).toEqual([
        ["b.txt", "added", 1],
      ]);
      expect((await value(git.browse.commitFile(repo, merge, "b.txt")))!.hunks).toContain(
        "+side\n",
      );
    }),
  );

  it.effect("The first commit shows every file as added", () =>
    fixture(async (git, dir) => {
      const sha = await commit(dir, { "a.txt": "a\nb\n", "b.txt": "c\n" }, [], "First");
      const read = (await value(git.browse.commit(repo, sha)))!;
      expect(read.parents).toEqual([]);
      expect(read.files.map((file) => [file.path, file.status, file.additions])).toEqual([
        ["a.txt", "added", 2],
        ["b.txt", "added", 1],
      ]);
      expect(read.files[0]!.hunks).toContain("+a\n+b\n");
      expect((await value(git.browse.commitFile(repo, sha, "b.txt")))!.hunks).toContain("+c\n");
    }),
  );

  it.effect("A commit the repository does not hold reads as none", () =>
    fixture(async (git, dir) => {
      const sha = await commit(dir, { "a.txt": "a\n" }, [], "First");
      const tree = await native(dir, ["rev-parse", `${sha}^{tree}`]);
      for (const asked of ["f".repeat(40), tree, "main", sha.slice(0, 7)]) {
        expect(await value(git.browse.commit(repo, asked))).toBeNull();
        expect(await value(git.browse.commitFile(repo, asked, "a.txt"))).toBeNull();
      }
    }),
  );

  it("A patch read in any chunks splits into the same files", () => {
    const patch = Buffer.from(
      [
        "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-diff --git x\n+ diff --git y\n",
        "diff --git a/b b/b\nnew file mode 100644\n--- /dev/null\n+++ b/b\n@@ -0,0 +1 @@\n+b\n",
        "diff --git a/c b/c\nBinary files a/c and b/c differ\n",
      ].join(""),
    );
    const whole = new PatchSections();
    whole.feed(patch);
    whole.end();
    expect(whole.sections.map((section) => section.text)).toEqual([
      "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-diff --git x\n+ diff --git y\n",
      "diff --git a/b b/b\nnew file mode 100644\n--- /dev/null\n+++ b/b\n@@ -0,0 +1 @@\n+b\n",
      "diff --git a/c b/c\nBinary files a/c and b/c differ\n",
    ]);
    for (const size of [1, 2, 5, 11, 12, 13]) {
      const chunked = new PatchSections();
      for (let at = 0; at < patch.length; at += size) chunked.feed(patch.subarray(at, at + size));
      chunked.end();
      expect(chunked.sections, `chunks of ${String(size)}`).toEqual(whole.sections);
    }
  });
});
