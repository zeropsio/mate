// @effect-diagnostics nodeBuiltinImport:off - real git fixtures, no network listeners.
import { describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { makeHqGit } from "../index.ts";
import type { HqGit } from "../api.ts";
import { parseBlame, unquotePath } from "./blame.ts";

const repo = { appId: "app", id: "repo" };
const fixture = (run: (git: HqGit, dir: string) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-blame-"))),
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
interface Author {
  readonly name: string;
  readonly at: number;
}
const native = (dir: string, args: string[], input?: string, author?: Author) =>
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
          GIT_AUTHOR_NAME: author?.name ?? "Ada Author",
          GIT_AUTHOR_EMAIL: "author@example.test",
          GIT_AUTHOR_DATE: `@${String(author?.at ?? 1_700_000_000)} +0000`,
          GIT_COMMITTER_NAME: "Cy Committer",
          GIT_COMMITTER_EMAIL: "cy@example.test",
          GIT_COMMITTER_DATE: `@${String(author?.at ?? 1_700_000_000)} +0000`,
        },
      },
      (err, out) => (err ? reject(err) : resolve(out.trim())),
    );
    // Without input nothing is written: git that never reads stdin may already have exited,
    // and a write to it raises an unhandled EPIPE.
    child.stdin?.end(input);
  });
/** A commit holding exactly `files`, a flat folder, on `parents`. */
const commit = async (
  dir: string,
  files: Record<string, string>,
  parents: ReadonlyArray<string>,
  message: string,
  author: Author,
) => {
  const lines = [];
  for (const [name, content] of Object.entries(files)) {
    const blob = await native(dir, ["hash-object", "-w", "--stdin"], content);
    lines.push(`100644 blob ${blob}\t${name}\n`);
  }
  const tree = await native(dir, ["mktree"], lines.join(""));
  return native(
    dir,
    ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message],
    undefined,
    author,
  );
};
const value = Effect.runPromise;
const ada = { name: "Ada Author", at: 1_700_000_000 };
const bo = { name: "Bo Builder", at: 1_710_000_000 };
const iso = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at * 1000));

describe("git browse blame", () => {
  it.effect("Each line names the commit that last changed it", () =>
    fixture(async (git, dir) => {
      const start = await commit(dir, { "a.txt": "one\ntwo\nthree\n" }, [], "Start", ada);
      const count = await commit(
        dir,
        { "a.txt": "one\n2\nthree\n" },
        [start],
        "Count with digits\n\nThe body is not the subject.",
        bo,
      );
      const read = await value(git.browse.blame(repo, count, "a.txt", 1024));
      expect(read).toEqual({
        kind: "blame",
        ranges: [
          { start: 1, count: 1, commit: start },
          { start: 2, count: 1, commit: count },
          { start: 3, count: 1, commit: start },
        ],
        commits: expect.arrayContaining([
          { sha: start, subject: "Start", authorName: "Ada Author", authoredAt: iso(ada.at) },
          {
            sha: count,
            subject: "Count with digits",
            authorName: "Bo Builder",
            authoredAt: iso(bo.at),
            previous: { sha: start, path: "a.txt" },
          },
        ]),
      });
      if (read.kind === "blame") expect(read.commits).toHaveLength(2);
      expect(JSON.stringify(read)).not.toContain("@example.test");
    }),
  );

  it.effect("Blame before a commit shows the file as its parent had it", () =>
    fixture(async (git, dir) => {
      const start = await commit(dir, { "a.txt": "one\ntwo\nthree\n" }, [], "Start", ada);
      // Renamed and changed in one commit: before it, the file has its old name.
      const moved = await commit(dir, { "b.txt": "one\n2\nthree\n" }, [start], "Move", bo);
      const at = await value(git.browse.blame(repo, moved, "b.txt", 1024));
      if (at.kind !== "blame") throw new Error(at.kind);
      const previous = at.commits.find((c) => c.sha === moved)?.previous;
      expect(previous).toEqual({ sha: start, path: "a.txt" });
      const before = await value(git.browse.blame(repo, previous!.sha, previous!.path, 1024));
      expect(before).toMatchObject({
        kind: "blame",
        ranges: [{ start: 1, count: 3, commit: start }],
      });
    }),
  );

  it.effect("A file past the read's ceiling is not blamed, only its size said", () =>
    fixture(async (git, dir) => {
      const sha = await commit(
        dir,
        { "big.txt": "x".repeat(2000), "small.txt": "hi\n" },
        [],
        "Start",
        ada,
      );
      const asked = (path: string, at = sha) => value(git.browse.blame(repo, at, path, 1024));
      expect(await asked("big.txt")).toEqual({ kind: "too-large", size: 2000 });
      expect(await asked("small.txt")).toMatchObject({ kind: "blame" });
      expect(await asked("none.txt")).toEqual({ kind: "path-missing" });
      expect(await asked("small.txt", "f".repeat(40))).toEqual({ kind: "commit-missing" });
    }),
  );

  it("Neighbouring groups of one commit read as one run of lines", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const porcelain = [
      `${a} 1 1 2`,
      "author Ann",
      "author-time 1700000000",
      "summary First",
      "boundary",
      "filename f.txt",
      "\tone",
      `${a} 2 2`,
      "\ttwo",
      `${a} 7 3 1`,
      "\tthree",
      `${b} 4 4 1`,
      "author Ben",
      "author-time 1710000000",
      "summary Second",
      `previous ${a} "sp\\303\\251cial \\"name\\".txt"`,
      "filename f.txt",
      `\t${a} 9 9 9`,
      "",
    ].join("\n");
    expect(parseBlame(porcelain)).toEqual({
      ranges: [
        { start: 1, count: 3, commit: a },
        { start: 4, count: 1, commit: b },
      ],
      commits: [
        { sha: a, subject: "First", authorName: "Ann", authoredAt: iso(1_700_000_000) },
        {
          sha: b,
          subject: "Second",
          authorName: "Ben",
          authoredAt: iso(1_710_000_000),
          previous: { sha: a, path: 'spécial "name".txt' },
        },
      ],
    });
    expect(unquotePath("plain name.txt")).toBe("plain name.txt");
  });
});
