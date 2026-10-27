// @effect-diagnostics nodeBuiltinImport:off - real git fixtures, no network listeners.
import { describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { makeHqGit } from "../index.ts";
import type { HqGit } from "../api.ts";
import { readMatches, type GrepLimits, type GrepRequest } from "./grep.ts";

const repo = { appId: "app", id: "repo" };
const author = { name: "Core", email: "core@example.test" };
const LIMITS: GrepLimits = { matches: 500, perFile: 20, lineChars: 500 };
const fixture = (run: (git: HqGit, dir: string) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-search-"))),
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
const native = (dir: string, args: string[], input?: string, env: Record<string, string> = {}) =>
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
          GIT_AUTHOR_NAME: author.name,
          GIT_AUTHOR_EMAIL: author.email,
          GIT_COMMITTER_NAME: author.name,
          GIT_COMMITTER_EMAIL: author.email,
          ...env,
        },
      },
      (err, out) => (err ? reject(err) : resolve(out.trim())),
    );
    // Without input nothing is written: git that never reads stdin may already have exited,
    // and a write to it raises an unhandled EPIPE.
    child.stdin?.end(input);
  });
const value = Effect.runPromise;
const write = async (git: HqGit, files: Record<string, string | null>, head: string | null) => {
  const result = await value(
    git.commitFiles(repo, "refs/heads/main", {
      files,
      expectedHead: head,
      message: "Core write",
      author,
    }),
  );
  if (!("sha" in result)) throw new Error(`write refused: ${result.kind}`);
  return result.sha;
};
const never = new AbortController().signal;
const grep = (git: HqGit, sha: string, request: Partial<GrepRequest> & { q: string }) =>
  value(
    git.browse.grep(repo, sha, { mode: "fixed", caseSensitive: false, ...request }, LIMITS, never),
  );

describe("Git browser search", () => {
  it.live("Searching for text lists each matching line with its file at that commit", () =>
    fixture(async (git) => {
      const first = await write(
        git,
        {
          "README.md": "# Shop\nThe shop sells Tea.\n",
          "src/tea.ts": 'export const tea = "green tea";\nexport const cup = 1;\n',
          "src/deep/menu.txt": "coffee\nTEA time\n",
        },
        null,
      );
      // Searched later, the page's commit still answers: the branch moved on without tea.
      await write(git, { "src/tea.ts": "export const cup = 2;\n" }, first);
      expect(await grep(git, first, { q: "tea" })).toEqual({
        kind: "found",
        matches: [
          {
            path: "README.md",
            line: 2,
            text: "The shop sells Tea.",
            ranges: [{ start: 15, end: 18 }],
          },
          {
            path: "src/deep/menu.txt",
            line: 2,
            text: "TEA time",
            ranges: [{ start: 0, end: 3 }],
          },
          {
            path: "src/tea.ts",
            line: 1,
            text: 'export const tea = "green tea";',
            ranges: [
              { start: 13, end: 16 },
              { start: 26, end: 29 },
            ],
          },
        ],
        truncated: false,
        deadlineHit: false,
      });
      // Case, a folder, and a regular expression narrow it.
      const exact = await grep(git, first, { q: "Tea", caseSensitive: true });
      expect(exact.kind === "found" && exact.matches.map((m) => m.path)).toEqual(["README.md"]);
      const folder = await grep(git, first, { q: "tea", path: "src/deep" });
      expect(folder.kind === "found" && folder.matches.map((m) => m.path)).toEqual([
        "src/deep/menu.txt",
      ]);
      const regex = await grep(git, first, { q: "c[ou]p+", mode: "regex" });
      expect(regex).toMatchObject({
        kind: "found",
        matches: [{ path: "src/tea.ts", line: 2, ranges: [{ start: 13, end: 16 }] }],
      });
      // A pattern git cannot read is no search, and a commit the repository lacks is none either.
      expect(await grep(git, first, { q: "tea(", mode: "regex" })).toEqual({ kind: "invalid" });
      expect(await grep(git, "f".repeat(40), { q: "tea" })).toEqual({ kind: "missing" });
    }),
  );

  it.live("A search stops at 500 matches and says so", () =>
    fixture(async (git) => {
      const lines = Array.from({ length: 25 }, (_, n) => `needle ${n}`).join("\n");
      const files = Object.fromEntries(
        Array.from({ length: 30 }, (_, n) => [`f${String(n).padStart(2, "0")}.txt`, lines]),
      );
      const sha = await write(git, files, null);
      const found = await grep(git, sha, { q: "needle" });
      if (found.kind !== "found") throw new Error(found.kind);
      expect(found.truncated).toBe(true);
      expect(found.matches).toHaveLength(500);
      // Each file gives at most 20 lines, so 25 files fill the 500.
      expect(found.matches.filter((m) => m.path === "f00.txt").map((m) => m.line)).toEqual(
        Array.from({ length: 20 }, (_, n) => n + 1),
      );
      expect(found.matches.at(-1)).toMatchObject({ path: "f24.txt", line: 20 });
      // Exactly the limit is no cut.
      const few = await grep(git, sha, { q: "needle 1", caseSensitive: true, path: "f00.txt" });
      expect(few).toMatchObject({ kind: "found", truncated: false });
    }),
  );

  it.live("A search that runs past its deadline shows what it found and says it stopped", () =>
    Effect.promise(async () => {
      const deadline = new AbortController();
      const treeish = "a".repeat(40);
      // Git has written one match and is still reading when the deadline passes.
      async function* output() {
        yield Buffer.from(`${treeish}:src/a.ts\x007\x00`);
        yield Buffer.from("const \x1b[7mtea\x1b[m = 1;\n");
        deadline.abort();
        await new Promise(() => {});
      }
      expect(await readMatches(output(), treeish, LIMITS, deadline.signal)).toEqual({
        matches: [
          { path: "src/a.ts", line: 7, text: "const tea = 1;", ranges: [{ start: 6, end: 9 }] },
        ],
        truncated: false,
        deadlineHit: true,
      });
    }),
  );

  it.live("Binary files are not searched", () =>
    fixture(async (git) => {
      const sha = await write(
        git,
        { "logo.bin": "PNG\u0000needle\u0000", "notes.txt": "a needle here\n" },
        null,
      );
      expect(await grep(git, sha, { q: "needle" })).toMatchObject({
        kind: "found",
        matches: [{ path: "notes.txt", line: 1 }],
      });
      const found = await grep(git, sha, { q: "needle" });
      expect(found.kind === "found" && found.matches).toHaveLength(1);
    }),
  );

  it.live("A long line is cut to its first 500 characters, its matches with it", () =>
    fixture(async (git) => {
      const sha = await write(
        git,
        { "min.js": `${"x".repeat(498)}tea${"y".repeat(40_000)}tea\n` },
        null,
      );
      expect(await grep(git, sha, { q: "tea" })).toMatchObject({
        kind: "found",
        matches: [
          {
            path: "min.js",
            line: 1,
            text: `${"x".repeat(498)}te`,
            ranges: [{ start: 498, end: 500 }],
          },
        ],
      });
    }),
  );

  it.live("The finder lists every file and symbolic link at a commit, never a submodule", () =>
    fixture(async (git, dir) => {
      const blob = await native(dir, ["hash-object", "-w", "--stdin"], "x\n");
      const index = NodePath.join(dir, "search-test-index");
      await native(
        dir,
        ["update-index", "--add", "--index-info"],
        [
          `100644 blob ${blob}\ta.txt`,
          `120000 blob ${blob}\tlink`,
          `160000 commit ${"1".repeat(40)}\tvendor/lib`,
          `100755 blob ${blob}\tvendor/run.sh`,
        ].join("\n"),
        { GIT_INDEX_FILE: index },
      );
      const tree = await native(dir, ["write-tree"], undefined, { GIT_INDEX_FILE: index });
      const sha = await native(dir, ["commit-tree", tree, "-m", "with a submodule"]);
      expect(await value(git.browse.paths(repo, sha, 25_000))).toEqual({
        paths: ["a.txt", "link", "vendor/run.sh"],
        truncated: false,
      });
      // The limit counts the files it lists.
      expect(await value(git.browse.paths(repo, sha, 3))).toEqual({
        paths: ["a.txt", "link", "vendor/run.sh"],
        truncated: false,
      });
    }),
  );

  it.live("A repository over 25,000 files says the finder sees only the first 25,000", () =>
    fixture(async (git, dir) => {
      const blob = await native(dir, ["hash-object", "-w", "--stdin"], "x\n");
      const index = NodePath.join(dir, "search-test-index");
      const names = Array.from({ length: 25_001 }, (_, n) => `d${n % 7}/f${n}.txt`);
      await native(
        dir,
        ["update-index", "--add", "--index-info"],
        names.map((name) => `100644 blob ${blob}\t${name}\n`).join(""),
        { GIT_INDEX_FILE: index },
      );
      const tree = await native(dir, ["write-tree"], undefined, { GIT_INDEX_FILE: index });
      const sha = await native(dir, ["commit-tree", tree, "-m", "many"]);
      const all = await value(git.browse.paths(repo, sha, 25_001));
      expect(all?.truncated).toBe(false);
      expect(new Set(all?.paths)).toEqual(new Set(names));
      const cut = await value(git.browse.paths(repo, sha, 25_000));
      expect(cut?.truncated).toBe(true);
      expect(cut?.paths).toHaveLength(25_000);
      expect(cut?.paths).toEqual(all?.paths.slice(0, 25_000));
      expect(await value(git.browse.paths(repo, "f".repeat(40), 25_000))).toBeNull();
    }),
  );
});
