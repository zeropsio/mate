// @effect-diagnostics nodeBuiltinImport:off - real git fixtures, no network listeners.
import { describe, expect, it, vi } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import { GitRunner } from "./git.ts";
import { PushReport } from "./report.ts";
import { pkt } from "./protocol.ts";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { makeHqGit } from "./index.ts";
import type { HqGit, GitEvent, HqGitOptions, GitError, MirrorRemote } from "./api.ts";

const repo = { appId: "app", id: "repo" };
const author = { name: "Core", email: "core@example.test" };
/** Alice's change `number`, on the branch a change opened without naming one is on. */
const alice = (number: number) => ({ mateId: "alice", number, branch: `mate/alice/${number}` });
const fixture = (
  run: (git: HqGit, dir: string, events: GitEvent[]) => Promise<void>,
  overrides: Partial<HqGitOptions> = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-ops-"))),
        (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
      );
      const events: GitEvent[] = [];
      const git = yield* makeHqGit({
        rootDir: root,
        authenticate: () => null,
        canRead: () => true,
        lookupChange: async () => null,
        onEvent: (e) => {
          events.push(e);
        },
        ...overrides,
      });
      yield* git.create(repo);
      yield* Effect.promise(() => run(git, NodePath.join(root, "app/repo.git"), events));
    }),
  );
const native = (dir: string, args: string[], input?: string | Buffer) =>
  new Promise<string>((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      "git",
      ["-C", dir, ...args],
      {
        env: {
          PATH: "/usr/bin:/bin",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: author.name,
          GIT_AUTHOR_EMAIL: author.email,
          GIT_COMMITTER_NAME: author.name,
          GIT_COMMITTER_EMAIL: author.email,
        },
      },
      (err, out) => (err ? reject(err) : resolve(out.trim())),
    );
    child.stdin?.end(input);
  });
const value = Effect.runPromise;
const write = async (
  git: HqGit,
  files: Record<string, string | null>,
  expectedHead: string | null,
  ref = "refs/heads/main",
) => {
  const result = await value(
    git.commitFiles(repo, ref, { files, expectedHead, message: "Core write", author }),
  );
  if (!("sha" in result)) throw new Error(`write refused: ${result.kind}`);
  return result.sha;
};
const branch = async (
  git: HqGit,
  dir: string,
  main: string,
  files: Record<string, string | null>,
  number = 1,
) => {
  await native(dir, ["update-ref", "refs/heads/core/build", main]);
  const head = await write(git, files, main, "refs/heads/core/build");
  await native(dir, ["update-ref", `refs/heads/mate/alice/${number}`, head]);
  await native(dir, ["update-ref", "-d", "refs/heads/core/build"]);
  return head;
};
/**
 * Another repository's history written into `dir`: from a root of its own, one commit per file,
 * each adding it; its last commit.
 */
const history = async (dir: string, files: ReadonlyArray<string>) => {
  let tip: string | undefined;
  let entries = "";
  for (const file of files) {
    const blob = await native(dir, ["hash-object", "-w", "--stdin"], file);
    entries += `100644 blob ${blob}\t${file}\n`;
    const tree = await native(dir, ["mktree"], entries);
    tip = await native(dir, [
      "commit-tree",
      tree,
      ...(tip === undefined ? [] : ["-p", tip]),
      "-m",
      `Add ${file}`,
    ]);
  }
  if (tip === undefined) throw new Error("a history needs a file");
  return tip;
};
const merge = async (
  git: HqGit,
  main: string,
  number = 1,
  message = "Add file\n\nMate-Change: forged/99\nCrew-Assignment: forged",
  head?: string,
) =>
  value(
    git.squashMerge(repo, {
      ...alice(number),
      expectedMain: main,
      expectedHead: head ?? (await value(git.changeHead(repo, alice(number)))) ?? "0".repeat(40),
      message,
      trailers: { "Crew-Assignment": "trusted" },
      author,
    }),
  );

describe("git operations", () => {
  it.live(
    "squashes exact content, ends the message with trusted trailers, emits ordered events, and refuses remerge after deletion",
    () =>
      fixture(async (git, dir, events) => {
        const main = await write(git, { "base.txt": "base\n" }, null);
        expect(await value(git.changeHead(repo, alice(1)))).toBeNull();
        const head = await branch(git, dir, main, { "new.txt": "new\n" });
        expect(await value(git.changeHead(repo, alice(1)))).toBe(head);
        expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "clean" });
        const result = await merge(git, main);
        expect(result).toHaveProperty("merged");
        if (!("merged" in result)) throw new Error("merge refused");
        expect(await native(dir, ["ls-tree", "-r", "--name-only", result.merged])).toBe(
          "base.txt\nnew.txt",
        );
        expect(await native(dir, ["show", `${result.merged}:new.txt`])).toBe("new");
        const commit = await value(git.commit(repo, result.merged));
        expect(commit.parents).toEqual([main]);
        expect(commit.message).toBe(
          "Add file\n\nMate-Change: forged/99\nCrew-Assignment: forged\n\nCrew-Assignment: trusted\nMate-Change: alice/1\n",
        );
        const deleted = await write(git, { "new.txt": null }, result.merged);
        expect(await merge(git, deleted)).toEqual({ kind: "already_merged" });
        expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "already_merged" });
        expect(await native(dir, ["ls-tree", "-r", "--name-only", "main"])).toBe("base.txt");
        await vi.waitFor(() =>
          expect(events.map((e) => e.kind)).toEqual(["main_moved", "main_moved", "main_moved"]),
        );
      }),
  );
  it.live("keeps an ordinary title and body verbatim and still refuses remerge", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      await branch(git, dir, main, { "new.txt": "new" });
      const message =
        "fix: crash on start\n\nExample: run `x = 1`\n    indented code line\nSee: http://example.com";
      const result = await merge(git, main, 1, message);
      if (!("merged" in result)) throw new Error("merge refused");
      expect((await value(git.commit(repo, result.merged))).message).toBe(
        `${message}\n\nCrew-Assignment: trusted\nMate-Change: alice/1\n`,
      );
      const deleted = await write(git, { "new.txt": null }, result.merged);
      expect(await merge(git, deleted, 1, "fix: thing")).toEqual({ kind: "already_merged" });
    }),
  );
  it.live("carries a trailer key once per value, as a crew's landings name their tasks", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      const head = await branch(git, dir, main, { "new.txt": "new" });
      const result = await value(
        git.squashMerge(repo, {
          ...alice(1),
          expectedMain: main,
          expectedHead: head,
          message: "Add a page (#1)",
          trailers: { "Crew-Lane": "ada", "Crew-Assignment": ["task-1", "task-2"] },
          author,
        }),
      );
      if (!("merged" in result)) throw new Error("merge refused");
      expect((await value(git.commit(repo, result.merged))).message).toBe(
        "Add a page (#1)\n\nCrew-Lane: ada\nCrew-Assignment: task-1\nCrew-Assignment: task-2\nMate-Change: alice/1\n",
      );
      expect(
        await native(dir, [
          "log",
          "-1",
          "--format=%(trailers:key=Crew-Assignment,valueonly,separator=%x0A)",
          result.merged,
        ]),
      ).toBe("task-1\ntask-2");
    }),
  );
  it.live.each([
    ["an empty message", ""],
    ["an empty first line", "\nAdd file"],
    ["a blank first line", "  \nAdd file"],
    ["git's scissors line", "Add file\n\n# ------------------------ >8 ------------------------\n"],
  ] as const)("refuses a merge message with %s", ([_name, message]) =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      await branch(git, dir, main, { "new.txt": "new" });
      await expect(merge(git, main, 1, message)).rejects.toHaveProperty("reason", "invalid_config");
      expect(await native(dir, ["rev-parse", "main"])).toBe(main);
    }),
  );
  it.live("never moves main to a squash whose stored message hides the Mate-Change trailer", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      await branch(git, dir, main, { "new.txt": "new" });
      const original = GitRunner.prototype.run;
      const spy = vi.spyOn(GitRunner.prototype, "run").mockImplementation(function (
        this: GitRunner,
        args,
        options,
      ) {
        return original.call(
          this,
          args,
          args.includes("commit-tree") ? { ...options, input: "Add file\n" } : options,
        );
      });
      try {
        await expect(merge(git, main)).rejects.toHaveProperty("reason", "invalid_config");
      } finally {
        spy.mockRestore();
      }
      expect(await native(dir, ["rev-parse", "main"])).toBe(main);
    }),
  );
  it.live("refuses a Core commit that carries a Mate-Change trailer", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      await branch(git, dir, main, { "new.txt": "new" });
      await expect(
        value(
          git.commitFiles(repo, "refs/heads/main", {
            files: { "new.txt": "new" },
            expectedHead: main,
            message: "Copy change\n\nMate-Change: alice/1",
            author,
          }),
        ),
      ).rejects.toHaveProperty("reason", "invalid_config");
      expect(await native(dir, ["rev-parse", "main"])).toBe(main);
      expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "clean" });
    }),
  );
  it.live("merges exactly the change head Core reviewed", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      const reviewed = await branch(git, dir, main, { "new.txt": "new" });
      await native(dir, ["update-ref", "refs/heads/core/build", reviewed]);
      const pushed = await write(git, { "late.txt": "late" }, reviewed, "refs/heads/core/build");
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", pushed]);
      expect(await merge(git, main, 1, "Add file", reviewed)).toEqual({ kind: "head_moved" });
      await expect(merge(git, main, 1, "Add file", "HEAD")).rejects.toHaveProperty(
        "reason",
        "invalid_config",
      );
      const result = await merge(git, main, 1, "Add file", pushed);
      if (!("merged" in result)) throw new Error("merge refused");
      expect(await native(dir, ["ls-tree", "--name-only", result.merged])).toBe(
        "base\nlate.txt\nnew.txt",
      );
    }),
  );
  it.live("walks main only past the change's base, so a deep history stays mergeable", () =>
    fixture(async (git, dir) => {
      let stream = "";
      for (let i = 1; i <= 10001; i++)
        stream += `commit refs/heads/main\ncommitter a <a@x> ${i} +0000\ndata 1\n${i % 10}\nM 644 inline f\ndata ${String(i).length}\n${i}\n\n`;
      await native(dir, ["fast-import", "--quiet"], stream);
      const main = await native(dir, ["rev-parse", "main"]);
      await branch(git, dir, main, { "new.txt": "new" });
      expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "clean" });
    }),
  );
  it.live("refuses a change whose history is unrelated to main", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      const root = await write(git, { other: "other" }, null, "refs/heads/core/other");
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", root]);
      expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "unrelated" });
      expect(await merge(git, main)).toEqual({ kind: "unrelated" });
    }),
  );
  it.live(
    "onto a main that never held a file, a change carrying another repository's history and building on main lands as one merge commit of main and its head, never a fast-forward",
    () =>
      fixture(async (git, dir, events) => {
        const main = await write(git, {}, null);
        // Another repository's history, joined onto main as zcp joins it: one merge of both roots.
        const theirs = await history(dir, ["readme.md", "app.ts"]);
        const joined = await native(dir, [
          "commit-tree",
          `${theirs}^{tree}`,
          "-p",
          main,
          "-p",
          theirs,
          "-m",
          "Join the repository's base",
        ]);
        await native(dir, ["update-ref", "refs/heads/mate/alice/1", joined]);
        expect(await value(git.mergeability(repo, alice(1)))).toEqual({
          kind: "clean",
          keepsHistory: true,
        });
        // Main's own line stays HQ's: the history comes in beside it, under one merge carrying
        // the trailers, so no commit of that history is read as one of main's merges.
        const result = await merge(git, main, 1, "Bring the repository in");
        if (!("merged" in result)) throw new Error(`merge refused: ${JSON.stringify(result)}`);
        const commit = await value(git.commit(repo, result.merged));
        expect(commit.parents).toEqual([main, joined]);
        expect(commit.message).toBe(
          "Bring the repository in\n\nCrew-Assignment: trusted\nMate-Change: alice/1\n",
        );
        expect(await native(dir, ["rev-parse", `${result.merged}^{tree}`])).toBe(
          await native(dir, ["rev-parse", `${joined}^{tree}`]),
        );
        expect(await native(dir, ["rev-parse", "main"])).toBe(result.merged);
        await vi.waitFor(() =>
          expect(events.at(-1)).toEqual({
            kind: "main_moved",
            repo,
            old: main,
            new: result.merged,
            by: "merge",
          }),
        );
        expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "already_merged" });
      }),
  );
  it.live(
    "onto a main that never held a file, a change carrying another repository's history and none of main's lands as one merge commit keeping both",
    () =>
      fixture(async (git, dir) => {
        const main = await write(git, {}, null);
        const theirs = await history(dir, ["readme.md", "app.ts"]);
        await native(dir, ["update-ref", "refs/heads/mate/alice/1", theirs]);
        expect(await value(git.mergeability(repo, alice(1)))).toEqual({
          kind: "clean",
          keepsHistory: true,
        });
        const result = await merge(git, main, 1, "Bring the repository in");
        if (!("merged" in result)) throw new Error(`merge refused: ${JSON.stringify(result)}`);
        const commit = await value(git.commit(repo, result.merged));
        expect(commit.parents).toEqual([main, theirs]);
        expect(commit.message).toBe(
          "Bring the repository in\n\nCrew-Assignment: trusted\nMate-Change: alice/1\n",
        );
        expect(await native(dir, ["rev-parse", `${result.merged}^{tree}`])).toBe(
          await native(dir, ["rev-parse", `${theirs}^{tree}`]),
        );
        expect(await native(dir, ["rev-parse", "main"])).toBe(result.merged);
        expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "already_merged" });
      }),
  );
  it.live(
    "a change sharing no history with a main that never held a file reads all it carries as its diff, for its review",
    () =>
      fixture(async (git, dir) => {
        await write(git, {}, null);
        const theirs = await history(dir, ["readme.md", "app.ts"]);
        await native(dir, ["update-ref", "refs/heads/mate/alice/1", theirs]);
        const diff = await value(
          git.changeDiff(repo, alice(1), { maxFiles: 10, maxBytesPerFile: 1000 }),
        );
        expect(diff.items.map((file) => [file.path, file.added, file.deleted])).toEqual([
          ["app.ts", 1, 0],
          ["readme.md", 1, 0],
        ]);
      }),
  );
  it.live.each([
    ["built on a main that never held a file, with no history of its own beneath it", "empty"],
    ["carrying another repository's history onto a main that holds a file", "held"],
  ] as const)("a change %s is one squash as always", ([_name, base]) =>
    fixture(async (git, dir) => {
      const main = await write(git, base === "empty" ? {} : { base: "base" }, null);
      const theirs = await history(dir, ["readme.md", "app.ts"]);
      const head =
        base === "empty"
          ? await branch(git, dir, main, { "app.ts": "app" })
          : await native(dir, [
              "commit-tree",
              `${theirs}^{tree}`,
              "-p",
              main,
              "-p",
              theirs,
              "-m",
              "Join the repository's base",
            ]);
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", head]);
      expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "clean" });
      const result = await merge(git, main, 1, "Add the app");
      if (!("merged" in result)) throw new Error(`merge refused: ${JSON.stringify(result)}`);
      expect((await value(git.commit(repo, result.merged))).parents).toEqual([main]);
    }),
  );
  it.live("reports a missing main, not a missing change, while main is unborn", () =>
    fixture(async (git, dir) => {
      expect(await value(git.mergeability(repo, alice(1)))).toEqual({ kind: "no_change" });
      const head = await write(git, { file: "x" }, null, "refs/heads/core/start");
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", head]);
      await expect(value(git.mergeability(repo, alice(1)))).rejects.toHaveProperty(
        "reason",
        "no_main",
      );
      await expect(
        value(git.changeDiff(repo, alice(1), { maxFiles: 1, maxBytesPerFile: 1 })),
      ).rejects.toHaveProperty("reason", "no_main");
    }),
  );
  it.live("reads merge-tree's conflict status even when it names no path", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      await branch(git, dir, main, { "new.txt": "new" });
      const tree = await native(dir, ["rev-parse", `${main}^{tree}`]);
      const original = GitRunner.prototype.exec;
      const spy = vi.spyOn(GitRunner.prototype, "exec").mockImplementation(function (
        this: GitRunner,
        args,
        options,
      ) {
        return args.includes("merge-tree")
          ? Promise.resolve({ stdout: Buffer.from(`${tree}\0`), code: 1 })
          : original.call(this, args, options);
      });
      try {
        expect(await value(git.mergeability(repo, alice(1)))).toEqual({
          kind: "conflict",
          paths: [],
        });
      } finally {
        spy.mockRestore();
      }
    }),
  );
  it.live("refuses absent, empty, ancestral, conflicting and stale changes", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { file: "base\n" }, null);
      expect(await merge(git, main)).toEqual({ kind: "no_change" });
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", main]);
      expect(await merge(git, main)).toEqual({ kind: "already_merged" });
      const tree = await native(dir, ["rev-parse", `${main}^{tree}`]);
      const empty = await native(dir, ["commit-tree", tree, "-p", main, "-m", "empty"]);
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", empty]);
      expect(await merge(git, main)).toEqual({ kind: "empty" });
      await branch(git, dir, main, { file: "change\n" });
      const moved = await write(git, { file: "core\n" }, main);
      expect(await merge(git, main)).toEqual({ kind: "main_moved" });
      expect(await merge(git, moved)).toEqual({ kind: "conflict", paths: ["file"] });
      expect(await value(git.mergeability(repo, alice(1)))).toEqual({
        kind: "conflict",
        paths: ["file"],
      });
      expect(
        await value(
          git.commitFiles(repo, "refs/heads/main", {
            files: {},
            expectedHead: main,
            message: "stale",
            author,
          }),
        ),
      ).toEqual({ kind: "head_moved" });
    }),
  );
  it.live("answers busy when a held ref lock stops the write and the ref has not moved", () =>
    fixture(
      async (git, dir) => {
        const main = await write(git, { base: "base" }, null);
        await branch(git, dir, main, { "new.txt": "new" });
        const lock = NodePath.join(dir, "refs/heads/main.lock");
        await NodeFSP.writeFile(lock, "");
        try {
          await expect(write(git, { more: "more" }, main)).rejects.toHaveProperty("reason", "busy");
          await expect(merge(git, main)).rejects.toHaveProperty("reason", "busy");
        } finally {
          await NodeFSP.rm(lock);
        }
        expect(await native(dir, ["rev-parse", "main"])).toBe(main);
        await write(git, { more: "more" }, main);
      },
      { refLockTimeoutMs: 100 },
    ),
  );
  it.live("waits for a ref lock another writer holds a while, then writes", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      const lock = NodePath.join(dir, "refs/heads/main.lock");
      await NodeFSP.writeFile(lock, "");
      // Held past git's own 100 ms retry, as a writer slowed by IO holds it.
      const released = value(
        Effect.andThen(
          Effect.sleep("500 millis"),
          Effect.promise(() => NodeFSP.rm(lock)),
        ),
      );
      const written = await write(git, { more: "more" }, main);
      await released;
      expect(await native(dir, ["rev-parse", "main"])).toBe(written);
    }),
  );
  it.live("uses CAS for simultaneous merges", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      await branch(git, dir, main, { one: "1" }, 1);
      await branch(git, dir, main, { two: "2" }, 2);
      const results = await Promise.all([merge(git, main, 1), merge(git, main, 2)]);
      expect(results.filter((r) => "merged" in r)).toHaveLength(1);
      expect(results).toContainEqual({ kind: "main_moved" });
    }),
  );
});

describe("a repository's backup", () => {
  it.live("bundles a repository whole, and makes it again from the bundle", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { "a.txt": "a\n" }, null);
      const change = await branch(git, dir, main, { "b.txt": "b\n" });
      expect(await value(git.createTag(repo, "v0.1.0", main, "web " + main))).toEqual({
        kind: "created",
      });
      const file = NodePath.join(NodePath.dirname(NodePath.dirname(dir)), "repo.bundle");
      const bundled = await value(git.bundle(repo, file));
      const refs = Object.fromEntries(bundled.refs.map(({ ref, sha }) => [ref, sha]));
      expect(refs["refs/heads/main"]).toBe(main);
      expect(refs["refs/heads/mate/alice/1"]).toBe(change);
      expect(refs["refs/tags/v0.1.0"]).toBe(await native(dir, ["rev-parse", "refs/tags/v0.1.0"]));

      const copy = { appId: "app", id: "copy" };
      await value(git.restore(copy, file));
      const copied = NodePath.join(NodePath.dirname(dir), "copy.git");
      expect(await native(copied, ["for-each-ref", "--format=%(refname) %(objectname)"])).toBe(
        await native(dir, ["for-each-ref", "--format=%(refname) %(objectname)"]),
      );
      await native(copied, ["fsck", "--full", "--strict"]);
      // Made again, it is converged like every repository: pushes still only go forward.
      expect(await native(copied, ["config", "receive.denyNonFastForwards"])).toBe("true");
      await expect(value(git.restore(copy, file))).rejects.toHaveProperty("reason", "exists");
    }),
  );
  it.live.each([
    { mate: "main and GitHub's branches and tags", main: true },
    { mate: "only GitHub's branches and tags", main: false },
  ])(
    "A bundle of a repository holding $mate carries none of GitHub's, nor what only they hold",
    ({ main }) =>
      fixture(async (git, dir) => {
        const ours = main ? await write(git, { "a.txt": "a\n" }, null) : null;
        const github = NodePath.join(dir, "github.git");
        await native(dir, ["init", "--bare", github]);
        const blob = await native(github, ["hash-object", "-w", "--stdin"], "theirs");
        const tree = await native(github, ["mktree"], `100644 blob ${blob}\ttheirs.txt\n`);
        const theirs = await native(github, ["commit-tree", tree, "-m", "Theirs"]);
        await native(github, ["update-ref", "refs/heads/feature", theirs]);
        await native(github, ["tag", "v1.0.0", theirs]);
        await value(git.followRefs(repo, { url: github, token: Redacted.make("mirror-fixture") }));
        expect(await native(dir, ["rev-parse", "refs/github/heads/feature"])).toBe(theirs);
        const file = NodePath.join(NodePath.dirname(NodePath.dirname(dir)), "repo.bundle");
        const bundled = await value(git.bundle(repo, file));
        expect(bundled.refs).toEqual(ours === null ? [] : [{ ref: "refs/heads/main", sha: ours }]);
        if (ours === null) return;
        const copy = { appId: "app", id: "copy" };
        await value(git.restore(copy, file));
        const copied = NodePath.join(NodePath.dirname(dir), "copy.git");
        expect(await native(copied, ["for-each-ref", "--format=%(refname)"])).toBe(
          "refs/heads/main",
        );
        await expect(native(copied, ["cat-file", "-e", theirs])).rejects.toThrow();
      }),
  );
  it.live("bundles nothing of a repository with no ref, and makes it again empty", () =>
    fixture(async (git, dir) => {
      const file = NodePath.join(NodePath.dirname(NodePath.dirname(dir)), "empty.bundle");
      expect(await value(git.bundle(repo, file))).toEqual({ refs: [] });
      await expect(NodeFSP.stat(file)).rejects.toThrow();
      const copy = { appId: "app", id: "copy" };
      await value(git.restore(copy, null));
      expect(await value(git.changeHead(copy, alice(1)))).toBeNull();
    }),
  );
  it.live("lists tags by their commit, message and date", () =>
    fixture(async (git) => {
      const main = await write(git, { "a.txt": "a\n" }, null);
      await value(git.createTag(repo, "v0.1.0", main, `web ${main}`));
      const tags = await value(git.tags(repo));
      expect(tags.truncated).toBe(false);
      expect(tags.items.map(({ name, sha, message }) => [name, sha, message])).toEqual([
        ["v0.1.0", main, `web ${main}`],
      ]);
      expect(Number.isNaN(Date.parse(tags.items[0]!.taggedAt))).toBe(false);
    }),
  );
  it.live("lists every change branch by its Mate and number", () =>
    fixture(async (git, dir) => {
      expect(await value(git.changeRefs(repo))).toEqual([]);
      const main = await write(git, { "a.txt": "a\n" }, null);
      const one = await branch(git, dir, main, { "b.txt": "b\n" }, 1);
      await native(dir, ["update-ref", "refs/heads/mate/bob/12", one]);
      await native(dir, ["update-ref", "refs/heads/core/build", one]);
      expect(await value(git.changeRefs(repo))).toEqual([
        { ...alice(1), sha: one },
        { mateId: "bob", number: 12, branch: "mate/bob/12", sha: one },
      ]);
    }),
  );
  it.live("names the commits a repository lacks", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { "a.txt": "a\n" }, null);
      const tree = await native(dir, ["rev-parse", `${main}^{tree}`]);
      const absent = "f".repeat(40);
      expect(await value(git.missingCommits(repo, [main, tree, absent]))).toEqual([tree, absent]);
      expect(await value(git.missingCommits(repo, []))).toEqual([]);
    }),
  );
});

describe("main's own history", () => {
  it.live("says whether a commit is main's head or before it, and nothing else is", () =>
    fixture(async (git, dir) => {
      const first = await write(git, { "a.txt": "1\n" }, null);
      expect(await value(git.onMain(repo, first))).toBe(true);
      const second = await write(git, { "a.txt": "2\n" }, first);
      expect(await value(git.onMain(repo, first))).toBe(true);
      expect(await value(git.onMain(repo, second))).toBe(true);
      // A branch's commit past main, an object that is no commit, and one the repository lacks.
      const branched = await branch(git, dir, second, { "b.txt": "b\n" });
      expect(await value(git.onMain(repo, branched))).toBe(false);
      const tree = await native(dir, ["rev-parse", `${second}^{tree}`]);
      expect(await value(git.onMain(repo, tree))).toBe(false);
      expect(await value(git.onMain(repo, "f".repeat(40)))).toBe(false);
      await expect(value(git.onMain(repo, "main"))).rejects.toHaveProperty(
        "reason",
        "invalid_config",
      );
    }),
  );
  it.live("says no commit is on an unborn main", () =>
    fixture(async (git) => {
      expect(await value(git.onMain(repo, "a".repeat(40)))).toBe(false);
    }),
  );
});

describe("what lies between two commits", () => {
  const shas = (read: { readonly items: ReadonlyArray<{ readonly sha: string }> }) =>
    read.items.map((item) => item.sha);

  it.live(
    "names base..head both ways, newest first, with how many, from the root without a base",
    () =>
      fixture(async (git, dir) => {
        const first = await write(git, { "a.txt": "1\n" }, null);
        const second = await write(git, { "a.txt": "2\n" }, first);
        const third = await write(git, { "a.txt": "3\n" }, second);
        // A commit beside main: no ancestor of main's head, nor main's of it.
        const beside = await branch(git, dir, second, { "b.txt": "b\n" });
        const range = (base: string | null, head: string, limit = 100) =>
          value(git.range(repo, base, head, { limit }));

        const all = await range(null, third);
        expect([shas(all), all.truncated, all.total]).toEqual([[third, second, first], false, 3]);
        const forward = await range(first, third);
        expect([shas(forward), forward.total]).toEqual([[third, second], 2]);
        expect(forward.items[0]).toMatchObject({ message: "Core write", author });
        // Neither comes before the other: what each has that the other has not.
        expect(shas(await range(third, beside))).toEqual([beside]);
        expect(shas(await range(beside, third))).toEqual([third]);
        const none = await range(third, third);
        expect([shas(none), none.truncated, none.total]).toEqual([[], false, 0]);
        const cut = await range(null, third, 2);
        expect([shas(cut), cut.truncated, cut.total]).toEqual([[third, second], true, 3]);
      }),
  );

  it.live("refuses a commit the repository lacks, and an argument posing as an option", () =>
    fixture(async (git) => {
      const first = await write(git, { "a.txt": "1\n" }, null);
      const range = (base: string | null, head: string) =>
        value(git.range(repo, base, head, { limit: 10 }));
      await expect(range(null, "f".repeat(40))).rejects.toHaveProperty("reason", "not_found");
      await expect(range("f".repeat(40), first)).rejects.toHaveProperty("reason", "not_found");
      for (const [base, head] of [
        [null, "--all"],
        ["--all", first],
        [null, "main"],
      ] as const) {
        await expect(range(base, head)).rejects.toHaveProperty("reason", "invalid_config");
      }
    }),
  );
});

describe("a change's own history", () => {
  it.live("names what squashing the change does to main now, against the main and head read", () =>
    fixture(async (git, dir) => {
      expect(await value(git.squashNames(repo, alice(1)))).toEqual({ kind: "no_change" });
      const main = await write(
        git,
        { "kept.txt": "kept\n", "edited.txt": "one\n", "gone.txt": "x\n" },
        null,
      );
      const head = await branch(git, dir, main, {
        "added.txt": "new\n",
        "edited.txt": "two\n",
        "gone.txt": null,
      });
      // main moving on is no part of the change.
      const moved = await write(git, { "later.txt": "later\n" }, main);
      const names = await value(git.squashNames(repo, alice(1)));
      expect(names).toEqual({
        main: moved,
        head,
        files: {
          items: [
            { path: "added.txt", status: "A" },
            { path: "edited.txt", status: "M" },
            { path: "gone.txt", status: "D" },
          ],
          truncated: false,
        },
      });
      // What was named is what lands: the squash takes the main and head it was named against.
      expect(await merge(git, moved, 1, "Change", head)).toHaveProperty("merged");
    }),
  );
  it.live(
    "names no addition of a file main gained meanwhile, and nothing for a change of nothing",
    () =>
      fixture(async (git, dir) => {
        const main = await write(git, { "base.txt": "base\n" }, null);
        const both = await branch(git, dir, main, { "same.txt": "same\n", "own.txt": "own\n" }, 1);
        await branch(git, dir, main, { "same.txt": "same\n" }, 2);
        await branch(git, dir, main, { "same.txt": "other\n" }, 3);
        // A sibling's merge adds the same file first.
        const moved = await write(git, { "same.txt": "same\n", "sibling.txt": "sibling\n" }, main);
        expect(await value(git.squashNames(repo, alice(1)))).toEqual({
          main: moved,
          head: both,
          files: { items: [{ path: "own.txt", status: "A" }], truncated: false },
        });
        expect(await value(git.squashNames(repo, alice(2)))).toMatchObject({
          main: moved,
          files: { items: [], truncated: false },
        });
        // A change main has already, its head on main itself, would do nothing either.
        await native(dir, ["update-ref", "refs/heads/mate/alice/4", main]);
        expect(await value(git.squashNames(repo, alice(4)))).toEqual({
          main: moved,
          head: main,
          files: { items: [], truncated: false },
        });
        // Added otherwise, it does not merge: git's verdict, no names.
        expect(await value(git.squashNames(repo, alice(3)))).toEqual({
          kind: "conflict",
          paths: ["same.txt"],
        });
      }),
  );
  it.live("bounds the names of a change of many files, and says so", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { "base.txt": "base\n" }, null);
      const blob = await native(dir, ["hash-object", "-w", "--stdin"], "x");
      const paths = Array.from({ length: 1001 }, (_, i) => `f${i.toString().padStart(4, "0")}`);
      const tree = await native(
        dir,
        ["mktree"],
        [
          `100644 blob ${blob}\tbase.txt\n`,
          ...paths.map((p) => `100644 blob ${blob}\t${p}\n`),
        ].join(""),
      );
      const head = await native(dir, ["commit-tree", tree, "-p", main], "many");
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", head]);
      const names = await value(git.squashNames(repo, alice(1)));
      expect(names).toMatchObject({ files: { truncated: true } });
      expect("files" in names && names.files.items).toHaveLength(1000);
    }),
  );

  it.live(
    "reads every trailer of the change's commits as git parses them, oldest first, however many",
    () =>
      fixture(async (git, dir) => {
        const main = await write(git, { base: "base\n" }, null);
        const tree = await native(dir, ["rev-parse", `${main}^{tree}`]);
        let parent = main;
        for (let i = 1; i <= 150; i++) {
          parent = await native(dir, [
            "commit-tree",
            tree,
            "-p",
            parent,
            "-m",
            `Task ${i}`,
            "-m",
            `Crew-Lane: ada\nCrew-Assignment: task-${i}`,
          ]);
        }
        // A folded trailer is read whole; a key in another case is the key asked.
        parent = await native(dir, [
          "commit-tree",
          tree,
          "-p",
          parent,
          "-m",
          "Long",
          "-m",
          "Crew-Assignment: a long\n  task\ncrew-lane: bo",
        ]);
        // A paragraph before the last is no trailer.
        parent = await native(dir, [
          "commit-tree",
          tree,
          "-p",
          parent,
          "-m",
          "Prose",
          "-m",
          "Crew-Assignment: not a trailer",
          "-m",
          "Just words.",
        ]);
        await native(dir, ["update-ref", "refs/heads/mate/alice/1", parent]);
        // On main, past the change's base: not the change's.
        await write(git, { base: "moved\n" }, main);

        const trailers = await value(
          git.changeTrailers(repo, alice(1), ["Crew-Lane", "Crew-Assignment"]),
        );
        const of = (key: string) =>
          trailers.filter((entry) => entry.key === key).map((entry) => entry.value);
        expect(of("Crew-Assignment")).toEqual([
          ...Array.from({ length: 150 }, (_, i) => `task-${i + 1}`),
          "a long task",
        ]);
        expect(of("Crew-Lane")).toEqual([...Array(150).fill("ada"), "bo"]);
        expect(trailers).toHaveLength(302);
        expect(await value(git.changeTrailers(repo, alice(2), ["Crew-Lane"]))).toEqual([]);
      }),
  );

  it.live("excludes the previous landed head from a later change's history", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { "base.txt": "base\n" }, null);
      const landed = await branch(git, dir, main, { "a.txt": "a\n" });
      await merge(git, main, 1, "First task", landed);
      await native(dir, ["update-ref", "refs/heads/core/build", landed]);
      const next = await write(git, { "b.txt": "b\n" }, landed, "refs/heads/core/build");
      await native(dir, ["update-ref", "refs/heads/mate/alice/2", next]);
      const log = await value(git.changeLog(repo, alice(2), { limit: 100, landed: [landed] }));
      expect(log.items.map((c) => c.sha)).toEqual([next]);
      expect(log.truncated).toBe(false);
    }),
  );

  it.live(
    "excludes every landed head from a change's history, whichever change it built on, passing over one the repository lacks",
    () =>
      fixture(async (git, dir) => {
        const main = await write(git, { "base.txt": "base\n" }, null);
        // Two changes cut from main, each squashed onto it; a third built on both.
        const first = await branch(git, dir, main, { "a.txt": "a\n" });
        const second = await branch(git, dir, main, { "b.txt": "b\n" }, 2);
        await merge(git, main, 1, "First task", first);
        const tree = await native(dir, ["merge-tree", "--write-tree", first, second]);
        const both = await native(dir, [
          "commit-tree",
          tree,
          "-p",
          first,
          "-p",
          second,
          "-m",
          "Both",
        ]);
        await native(dir, ["update-ref", "refs/heads/core/build", both]);
        const own = await write(git, { "c.txt": "c\n" }, both, "refs/heads/core/build");
        await native(dir, ["update-ref", "refs/heads/mate/alice/3", own]);
        const missing = "1".repeat(40);
        const log = await value(
          git.changeLog(repo, alice(3), { limit: 100, landed: [first, missing, second] }),
        );
        expect(log.items.map((c) => c.sha)).toEqual([own, both]);
      }),
  );

  it.live(
    "reads the change's commits not on main, newest first with their dates, and its merge base",
    () =>
      fixture(async (git, dir) => {
        // While main is unborn, all of a change is its own, and it has no base.
        const lone = await native(dir, [
          "commit-tree",
          await native(dir, ["mktree"], ""),
          "-m",
          "Alone",
        ]);
        await native(dir, ["update-ref", "refs/heads/mate/alice/2", lone]);
        expect(
          (await value(git.changeLog(repo, alice(2), { limit: 10 }))).items.map((c) => c.sha),
        ).toEqual([lone]);
        expect(await value(git.mergeBase(repo, alice(2)))).toBeNull();

        const main = await write(git, { "base.txt": "base\n" }, null);
        expect(await value(git.mergeBase(repo, alice(1)))).toBeNull();
        expect(await value(git.changeLog(repo, alice(1), { limit: 10 }))).toEqual({
          items: [],
          truncated: false,
        });
        const first = await branch(git, dir, main, { "a.txt": "a\n" });
        expect(await value(git.mergeBase(repo, alice(1)))).toBe(main);
        // main moves on, and the change takes it in with a merge before its next commit.
        const moved = await write(git, { "base.txt": "base 2\n" }, main);
        const tree = await native(dir, ["merge-tree", "--write-tree", first, moved]);
        const merged = await native(dir, [
          "commit-tree",
          tree,
          "-p",
          first,
          "-p",
          moved,
          "-m",
          "Merge main",
        ]);
        await native(dir, ["update-ref", "refs/heads/core/build", merged]);
        const second = await write(git, { "b.txt": "b\n" }, merged, "refs/heads/core/build");
        await native(dir, ["update-ref", "refs/heads/mate/alice/1", second]);
        await native(dir, ["update-ref", "-d", "refs/heads/core/build"]);

        expect(await value(git.mergeBase(repo, alice(1)))).toBe(moved);
        const log = await value(git.changeLog(repo, alice(1), { limit: 10 }));
        expect(log.items.map((commit) => commit.sha)).toEqual([second, merged, first]);
        // Messages as stored: `commit-tree -m` ends its with a newline.
        expect(log.items.map((commit) => commit.message)).toEqual([
          "Core write",
          "Merge main\n",
          "Core write",
        ]);
        expect(log.truncated).toBe(false);
        for (const commit of log.items) {
          expect(commit.committedAt).toMatch(
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/u,
          );
        }
        const capped = await value(git.changeLog(repo, alice(1), { limit: 1 }));
        expect([capped.items.map((commit) => commit.sha), capped.truncated]).toEqual([
          [second],
          true,
        ]);
        expect((await value(git.commit(repo, first))).committedAt).toBe(log.items[2]!.committedAt);
      }),
  );
});

describe("Core file writes", () => {
  it.live("deletes only an existing file, never a directory or a missing path", () =>
    fixture(async (git, dir) => {
      await expect(write(git, { gone: null }, null)).rejects.toHaveProperty(
        "reason",
        "invalid_path",
      );
      const main = await write(git, { "d/x": "x", keep: "k", link: "k" }, null);
      for (const files of [{ d: null }, { missing: null }, { "keep/x": null }])
        await expect(write(git, files, main)).rejects.toHaveProperty("reason", "invalid_path");
      expect(await native(dir, ["rev-parse", "main"])).toBe(main);
      const deleted = await write(git, { "d/x": null }, main);
      expect(await native(dir, ["ls-tree", "-r", "--name-only", deleted])).toBe("keep\nlink");
    }),
  );
  it.live.each([
    ["a parent segment", "../escape"],
    ["a backslash", "a\\b"],
    ["an HFS-ignorable .git", ".GIT\u200c/config"],
    ["an NTFS .git alias", "git~1/config"],
    ["a trailing-space .git", ".git "],
    ["a file over a directory", "d"],
    ["a directory over a file", "keep/x"],
  ] as const)("refuses a write path with %s", ([_name, path]) =>
    fixture(async (git, dir) => {
      const main = await write(git, { "d/x": "x", keep: "k" }, null);
      await expect(write(git, { [path]: "v" }, main)).rejects.toHaveProperty(
        "reason",
        "invalid_path",
      );
      expect(await native(dir, ["rev-parse", "main"])).toBe(main);
    }),
  );
  it.live("refuses a write whose name collides by case or Unicode form in one directory", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { README: "a", "Docs/a": "a", "caf\u00e9": "x" }, null);
      for (const files of [
        { readme: "b" },
        { "docs/b": "b" },
        { "cafe\u0301": "y" },
        { "new/A": "1", "new/a": "2" },
      ])
        await expect(write(git, files, main)).rejects.toHaveProperty("reason", "invalid_path");
      const renamed = await write(git, { README: null, readme: "b", "Docs/b": "b" }, main);
      expect(await native(dir, ["show", `${renamed}:readme`])).toBe("b");
    }),
  );
});

describe("reads, tags, archive and ports", () => {
  it.live("bounds reads, preserves odd paths, binary files and stable log pagination", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { "dir/tab\tline\n.txt": "abcdef", base: "original\n" }, null);
      const { sha: binary } = (await value(
        git.commitFiles(repo, "refs/heads/main", {
          files: { binary: new Uint8Array([0, 1, 2]) },
          expectedHead: main,
          author,
          message: "Binary",
        }),
      )) as { sha: string };
      expect(await value(git.file(repo, main, "dir/tab\tline\n.txt", 3))).toEqual({
        content: Buffer.from("abc"),
        binary: false,
        truncated: true,
      });
      expect(await value(git.file(repo, main, "dir/tab\tline\n.txt", 6))).toMatchObject({
        truncated: false,
      });
      expect(await value(git.file(repo, binary, "binary", 3))).toMatchObject({
        binary: true,
        truncated: false,
      });
      expect((await value(git.tree(repo, main, "dir"))).items[0]?.path).toBe("tab\tline\n.txt");
      expect((await value(git.commit(repo, main))).files).toContainEqual({
        path: "dir/tab\tline\n.txt",
        added: 1,
        deleted: 0,
      });
      expect((await value(git.branches(repo))).items).toEqual([
        { ref: "refs/heads/main", sha: binary },
      ]);
      const mergedTree = await native(dir, ["rev-parse", `${binary}^{tree}`]);
      const mergeCommit = await native(dir, [
        "commit-tree",
        mergedTree,
        "-p",
        main,
        "-p",
        binary,
        "-m",
        "Merge",
      ]);
      expect((await value(git.commit(repo, mergeCommit))).files).toEqual([
        { path: "binary", added: null, deleted: null },
      ]);
      const first = await value(git.log(repo, "main", { limit: 1 }));
      expect(first.items.map((c) => c.sha)).toEqual([binary]);
      expect(first.truncated).toBe(true);
      await write(git, { moved: "yes" }, binary);
      const next = await value(git.log(repo, "main", { limit: 1, cursor: first.cursor! }));
      expect(next.items.map((c) => c.sha)).toEqual([main]);
      expect(next.cursor).toBeNull();
      expect(next.truncated).toBe(false);
      await branch(git, dir, binary, { base: "changed\n", second: "second\n" });
      const diff = await value(
        git.changeDiff(repo, alice(1), { maxFiles: 10, maxBytesPerFile: 10000 }),
      );
      expect(diff.truncated).toBe(false);
      expect(diff.items[0]?.hunks).toContain("@@ -1 +1 @@\n-original\n+changed");
      expect(diff.items[0]).toMatchObject({ path: "base", added: 1, deleted: 1, binary: false });
      expect(
        await value(git.changeDiff(repo, alice(1), { maxFiles: 1, maxBytesPerFile: 10 })),
      ).toMatchObject({ truncated: true, items: [{ truncated: true }] });
      expect(
        await value(git.changeDiff(repo, alice(99), { maxFiles: 1, maxBytesPerFile: 10 })),
      ).toEqual({ items: [], truncated: false });
    }),
  );
  it.live("reads one captured head and main after both refs move", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "original\n" }, null);
      const head = await branch(git, dir, main, { first: "reviewed\n" });
      const snapshot = { head, main };
      await branch(git, dir, head, { later: "unreviewed\n" });
      await write(git, { base: "moved\n" }, main);
      const diff = await value(
        git.changeDiff(repo, alice(1), {
          maxFiles: 10,
          maxBytesPerFile: 10000,
          snapshot,
        }),
      );
      expect(diff.items.map((file) => file.path)).toEqual(["first"]);
      const log = await value(git.changeLog(repo, alice(1), { limit: 100, snapshot }));
      expect(log.items.map((commit) => commit.sha)).toEqual([head]);
      expect(await value(git.mergeBase(repo, alice(1), snapshot))).toBe(main);
      expect(await value(git.mergeability(repo, alice(1), snapshot))).toEqual({ kind: "clean" });
    }),
  );
  it.live("stops reading a change diff at a total byte ceiling across files", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      const big = `${"x".repeat(1023)}\n`.repeat(1024);
      await branch(
        git,
        dir,
        main,
        Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [`f${i.toString().padStart(2, "0")}`, big]),
        ),
      );
      const spy = vi.spyOn(GitRunner.prototype, "start");
      try {
        const diff = await value(
          git.changeDiff(repo, alice(1), { maxFiles: 1000, maxBytesPerFile: 1024 * 1024 }),
        );
        expect(diff.truncated).toBe(true);
        expect(diff.items).toHaveLength(12);
        const total = diff.items.reduce((sum, item) => sum + Buffer.byteLength(item.hunks), 0);
        expect(total).toBeLessThanOrEqual(8 * 1024 * 1024);
        expect(diff.items.at(-1)).toMatchObject({ path: "f11", hunks: "", truncated: true });
        const patches = spy.mock.calls.filter(([args]) => args.includes("--unified=3"));
        expect(patches.length).toBeLessThanOrEqual(8);
      } finally {
        spy.mockRestore();
      }
    }),
  );
  it.live("bounds branch/tree counts and commit/log messages and stats", () =>
    fixture(async (git, dir) => {
      const blob = await native(dir, ["hash-object", "-w", "--stdin"], "x");
      const paths = Array.from({ length: 1001 }, (_, i) => `f${i.toString().padStart(4, "0")}`);
      const tree = await native(
        dir,
        ["mktree"],
        paths.map((p) => `100644 blob ${blob}\t${p}\n`).join(""),
      );
      const head = await native(dir, ["commit-tree", tree], "x".repeat(70000));
      await native(
        dir,
        ["update-ref", "--stdin"],
        ["refs/heads/main", ...paths.map((p) => `refs/heads/${p}`)]
          .map((ref) => `create ${ref} ${head}\n`)
          .join(""),
      );
      expect(await value(git.branches(repo))).toMatchObject({ truncated: true });
      expect((await value(git.branches(repo))).items).toHaveLength(1000);
      expect((await value(git.tree(repo, "main", ""))).items).toHaveLength(1000);
      expect((await value(git.tree(repo, "main", ""))).truncated).toBe(true);
      const commit = await value(git.commit(repo, head));
      expect(commit.truncated).toBe(true);
      expect(commit.files).toHaveLength(1000);
      expect(Buffer.byteLength(commit.message)).toBeLessThanOrEqual(65536);
      const log = await value(git.log(repo, head, { limit: 5 }));
      expect(log.items).toHaveLength(1);
      expect(log.truncated).toBe(true);
    }),
  );
  it.live("creates immutable, dated annotated tags and reports events after writes", () =>
    fixture(async (git, dir, events) => {
      const head = await write(git, { a: "a" }, null);
      expect(await value(git.createTag(repo, "v1", head, "Release"))).toEqual({ kind: "created" });
      expect(await native(dir, ["cat-file", "-t", "refs/tags/v1"])).toBe("tag");
      expect(await native(dir, ["cat-file", "-p", "refs/tags/v1"])).toContain("Release");
      const [tagged = 0, committed = 0] = (
        await native(dir, [
          "for-each-ref",
          "--format=%(taggerdate:unix) %(*committerdate:unix)",
          "refs/tags/v1",
        ])
      )
        .split(" ")
        .map(Number);
      expect(Math.abs(tagged - committed)).toBeLessThan(60);
      expect(await value(git.createTag(repo, "v1", head, "Replace"))).toEqual({
        kind: "exists_same",
      });
      const other = await write(git, { b: "b" }, null, "refs/heads/core/other");
      expect(await value(git.createTag(repo, "v1", other, "Replace"))).toEqual({
        kind: "conflict",
      });
      // Delivered after the writes, on their own chain: a loaded CI worker may take more than
      // waitFor's default second to get there.
      await vi.waitFor(
        () =>
          expect(events).toEqual([
            { kind: "main_moved", repo, old: null, new: head, by: "commit" },
            { kind: "tagged", repo, name: "v1", sha: head },
          ]),
        { timeout: 15_000 },
      );
      expect(
        (
          await Promise.all([
            value(git.createTag(repo, "race", head, "one")),
            value(git.createTag(repo, "race", head, "two")),
          ])
        )
          .map((result) => result.kind)
          .sort(),
      ).toEqual(["created", "exists_same"]);
      const writes = await Promise.all(
        [1, 2].map((i) =>
          value(
            git.commitFiles(repo, "refs/heads/main", {
              expectedHead: head,
              author,
              message: `Write ${i}`,
              files: { race: `${i}` },
            }),
          ),
        ),
      );
      expect(writes).toContainEqual({ kind: "head_moved" });
      expect(writes.filter((write) => "sha" in write)).toHaveLength(1);
    }),
  );
  it.live(
    "archives the requested commit without a prefix and terminates on consumer cancellation",
    () =>
      fixture(async (git, dir) => {
        const { sha: head } = (await value(
          git.commitFiles(repo, "refs/heads/main", {
            files: {
              ".gitattributes": "one export-ignore\ndir/two export-subst\n",
              one: "one",
              "dir/two": "$Format:%H$",
              random: NodeCrypto.randomBytes(1024 * 1024),
            },
            expectedHead: null,
            author,
            message: "archive",
          }),
        )) as { sha: string };
        await write(git, { later: "later" }, head);
        const stream = await value(git.archive(repo, head));
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const names = await new Promise<string>((resolve, reject) => {
          const child = NodeChildProcess.execFile("tar", ["-tzf", "-"], (err, out) =>
            err ? reject(err) : resolve(out),
          );
          child.stdin?.end(Buffer.concat(chunks));
        });
        expect(names.trim().split("\n").sort()).toEqual([
          ".gitattributes",
          "dir/",
          "dir/two",
          "one",
          "random",
        ]);
        const stored = await new Promise<string>((resolve, reject) => {
          const child = NodeChildProcess.execFile("tar", ["-xOzf", "-", "dir/two"], (err, out) =>
            err ? reject(err) : resolve(out),
          );
          child.stdin?.end(Buffer.concat(chunks));
        });
        expect(stored).toBe("$Format:%H$");
        const spy = vi.spyOn(GitRunner.prototype, "start");
        try {
          const aborted = await value(git.archive(repo, head));
          const process = spy.mock.results.at(-1)!.value;
          const closed = new Promise<void>((resolve) => {
            aborted.once("close", resolve);
          });
          aborted.destroy();
          await closed;
          await process.done.catch(() => {});
          expect(process.child.exitCode !== null || process.child.signalCode !== null).toBe(true);
          expect((await NodeFSP.readdir(dir)).filter((p) => p.startsWith(".archive-"))).toEqual([]);
        } finally {
          spy.mockRestore();
        }
      }),
  );
  it.live("delivers events in order without holding the write, so a handler may call back", () => {
    let hq: HqGit | undefined;
    const seen: string[] = [];
    return fixture(
      async (git, dir) => {
        hq = git;
        const head = await write(git, { a: "a" }, null);
        await vi.waitFor(() => expect(seen).toEqual(["main_moved", "tagged"]));
        expect(await native(dir, ["rev-parse", "v1^{commit}"])).toBe(head);
      },
      {
        onEvent: async (event) => {
          seen.push(event.kind);
          if (event.kind === "main_moved")
            await value(hq!.createTag(repo, "v1", event.new, "Automatic"));
        },
      },
    );
  });
  it.live("archives entries writable by their owner only", () =>
    fixture(async (git) => {
      const head = await write(git, { "a.txt": "a", "d/b.txt": "b" }, null);
      const chunks: Buffer[] = [];
      for await (const chunk of await value(git.archive(repo, head)))
        chunks.push(Buffer.from(chunk));
      const listing = await new Promise<string>((resolve, reject) => {
        const child = NodeChildProcess.execFile("tar", ["-tvzf", "-"], (err, out) =>
          err ? reject(err) : resolve(out),
        );
        child.stdin?.end(Buffer.concat(chunks));
      });
      expect(
        listing
          .trim()
          .split("\n")
          .map((line) => line.slice(0, 10)),
      ).toEqual(["-rw-r--r--", "drwxr-xr-x", "-rw-r--r--"]);
    }),
  );
  it.live("logs port failure and keeps committed refs", () =>
    fixture(
      async (git, dir) => {
        const head = await write(git, { a: "a" }, null);
        expect(await native(dir, ["rev-parse", "main"])).toBe(head);
        expect(await value(git.createTag(repo, "v1", head, "Release"))).toEqual({
          kind: "created",
        });
      },
      {
        onEvent: async () => {
          throw new Error("Core unavailable");
        },
      },
    ),
  );
  it.live("honors Core's merged state and rejects unsafe inputs", () =>
    fixture(
      async (git, dir) => {
        const main = await write(git, { a: "a" }, null);
        await branch(git, dir, main, { b: "b" });
        expect(await merge(git, main)).toEqual({ kind: "already_merged" });
        const invalid: Array<Effect.Effect<unknown, GitError>> = [
          git.commitFiles(repo, "refs/heads/mate/alice/1", {
            files: {},
            expectedHead: main,
            message: "bad",
            author,
          }),
          git.commitFiles(repo, "refs/tags/x", {
            files: {},
            expectedHead: null,
            message: "bad",
            author,
          }),
          git.file(repo, "--output=bad", "a", 1),
          git.log(repo, "--output=bad", { limit: 1 }),
          git.file(repo, "main", "a", 0),
          git.log(repo, "main", { limit: 1, cursor: "bad" }),
          git.createTag(repo, "../bad", main, "bad"),
        ];
        for (const effect of invalid)
          await expect(value(effect.pipe(Effect.asVoid))).rejects.toHaveProperty(
            "reason",
            "invalid_config",
          );
      },
      {
        lookupChange: async () => ({
          appId: "app",
          mateId: "alice",
          number: 1,
          open: false,
          merged: true,
        }),
      },
    ),
  );
  it("decodes fragmented successful push reports and excludes refused refs", () => {
    const ref = "refs/heads/mate/alice/1";
    const report = Buffer.concat([
      pkt("unpack ok\n"),
      pkt(`ok ${ref}\n`),
      pkt("ng refs/heads/main stale\n"),
      Buffer.from("0000"),
    ]);
    for (const sideband of [false, true]) {
      const decoder = new PushReport(["report-status", ...(sideband ? ["side-band-64k"] : [])]);
      const bytes = sideband
        ? Buffer.concat([
            pkt(Buffer.concat([Buffer.from([2]), Buffer.from("progress")])),
            pkt(Buffer.concat([Buffer.from([1]), report])),
            Buffer.from("0000"),
          ])
        : report;
      for (const byte of bytes) decoder.feed(Buffer.from([byte]));
      expect([...decoder.ok]).toEqual([ref]);
    }
  });
});

const exchange = async (git: HqGit, commands: Buffer) => {
  const request = new NodeHttp.IncomingMessage(new NodeNet.Socket());
  request.complete = true;
  request.method = "POST";
  request.url = "/git/app/repo.git/git-receive-pack";
  request.headers = { "content-type": "application/x-git-receive-pack-request" };
  const response = new NodeHttp.ServerResponse(request);
  const chunks: Buffer[] = [];
  const sink = new NodeNet.Socket();
  vi.spyOn(sink, "write").mockImplementation((chunk, encoding, callback) => {
    chunks.push(Buffer.from(chunk));
    const done = typeof encoding === "function" ? encoding : callback;
    done?.();
    return true;
  });
  response.assignSocket(sink);
  const finished = new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("close", resolve);
    response.once("error", reject);
  });
  request.push(commands);
  request.push(null);
  git.handler(request, response);
  await finished;
  response.detachSocket(sink);
  sink.destroy();
  request.destroy();
  return Buffer.concat(chunks).toString();
};

describe("receive-pack events without a listener", () => {
  it.live.each([false, true])(
    "acknowledges a push only after its change is recorded (record fails: %s)",
    (fails) => {
      let recorded = false;
      return fixture(
        async (git) => {
          const head = await write(git, { file: "content" }, null);
          const header = Buffer.from("5041434b0000000200000000", "hex");
          const commands = Buffer.concat([
            pkt(`${"0".repeat(40)} ${head} refs/heads/mate/alice/1\0report-status side-band-64k\n`),
            Buffer.from("0000"),
            header,
            NodeCrypto.createHash("sha1").update(header).digest(),
          ]);
          const response = await exchange(git, commands);
          expect(recorded).toBe(true);
          expect(response.includes("ok refs/heads/mate/alice/1")).toBe(!fails);
        },
        {
          authenticate: () => ({ kind: "core" }),
          onEvent: async (event) => {
            if (event.kind !== "pushed") return;
            await new Promise<void>((resolve) => setImmediate(resolve));
            recorded = true;
            if (fails) throw new Error("record unavailable");
          },
        },
      );
    },
  );

  it.live("reports applied refs, Core's main and tag pushes, in order with later operations", () =>
    fixture(
      async (git, dir, events) => {
        const head = await write(git, { file: "content" }, null);
        const packHeader = Buffer.from("5041434b0000000200000000", "hex");
        const pack = Buffer.concat([
          packHeader,
          NodeCrypto.createHash("sha1").update(packHeader).digest(),
        ]);
        const zero = "0".repeat(40);
        const command = (...updates: Array<[string, string, string]>) =>
          Buffer.concat([
            ...updates.map(([old, sha, ref], i) =>
              pkt(`${old} ${sha} ${ref}${i ? "" : "\0report-status side-band-64k"}\n`),
            ),
            Buffer.from("0000"),
            pack,
          ]);
        expect(await exchange(git, command([zero, head, "refs/heads/mate/alice/1"]))).toContain(
          "ok refs/heads/mate/alice/1",
        );
        await vi.waitFor(() =>
          expect(events.at(-1)).toEqual({
            kind: "pushed",
            repo,
            updates: [{ oldSha: "0".repeat(40), newSha: head, ref: "refs/heads/mate/alice/1" }],
          }),
        );
        expect(
          await exchange(git, command([zero, "f".repeat(40), "refs/heads/mate/alice/2"])),
        ).toContain("ng ");
        expect(events.map((e) => e.kind)).toEqual(["main_moved", "pushed"]);
        const next = await native(dir, ["commit-tree", `${head}^{tree}`, "-p", head, "-m", "next"]);
        const tag = await native(
          dir,
          ["mktag"],
          `object ${head}\ntype commit\ntag v2\ntagger a <a@x> 0 +0000\n\nPushed\n`,
        );
        expect(
          await exchange(
            git,
            command([head, next, "refs/heads/main"], [zero, tag, "refs/tags/v2"]),
          ),
        ).toContain("ok refs/tags/v2");
        await value(git.createTag(repo, "v1", head, "Release"));
        await vi.waitFor(() =>
          expect(events.slice(2)).toEqual([
            {
              kind: "pushed",
              repo,
              updates: [
                { oldSha: head, newSha: next, ref: "refs/heads/main" },
                { oldSha: zero, newSha: tag, ref: "refs/tags/v2" },
              ],
            },
            { kind: "main_moved", repo, old: head, new: next, by: "push" },
            { kind: "tagged", repo, name: "v2", sha: head },
            { kind: "tagged", repo, name: "v1", sha: head },
          ]),
        );
      },
      { authenticate: () => ({ kind: "core" }) },
    ),
  );
});

describe("remote adoption", () => {
  it.live("counts the exact first-push tree changes before main moves", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { same: "same", hq: "hq", changed: "hq" }, null);
      const remote = NodePath.join(dir, "remote.git");
      await native(dir, ["init", "--bare", remote]);
      const blob = await native(remote, ["hash-object", "-w", "--stdin"], "remote");
      const same = await native(remote, ["hash-object", "-w", "--stdin"], "same");
      const tree = await native(
        remote,
        ["mktree"],
        `100644 blob ${blob}\tchanged\n100644 blob ${blob}\tremote\n100644 blob ${same}\tsame\n`,
      );
      const head = await native(remote, ["commit-tree", tree, "-m", "Remote"]);
      await native(remote, ["update-ref", "refs/heads/main", head]);
      const preview = await value(
        git.previewAdoption(repo, { url: remote, token: Redacted.make("test"), branch: "main" }),
      );
      const ours = (await native(dir, ["ls-tree", "-r", main])).split("\n");
      const theirs = (await native(remote, ["ls-tree", "-r", head])).split("\n");
      const paths = new Set([...ours, ...theirs].map((entry) => entry.split("\t")[1]));
      const n = [...paths].filter(
        (path) =>
          ours.find((entry) => entry.endsWith(`\t${path}`)) !==
          theirs.find((entry) => entry.endsWith(`\t${path}`)),
      ).length;
      expect(n).toBe(3);
      expect(preview.changedFiles).toBe(n);
      expect(preview.main).toBe(main);
      expect(preview.remoteTip).toBe(head);
      expect(preview.seed).toBe(false);
      expect(await native(dir, ["rev-parse", "main"])).toBe(main);
    }),
  );
});

it.live.each([
  { seed: true, treeName: "the remote tree and empty seed" },
  { seed: false, treeName: "HQ's populated tree" },
])("adoption makes one two-parent commit and preserves $treeName", ({ seed }) =>
  fixture(async (git, dir, events) => {
    const main = await write(git, seed ? {} : { hq: "hq" }, null);
    const mate = await branch(git, dir, main, { mate: "work" });
    const remote = NodePath.join(dir, "remote.git");
    await native(dir, ["init", "--bare", remote]);
    const blob = await native(remote, ["hash-object", "-w", "--stdin"], "remote");
    const tree = await native(remote, ["mktree"], `100644 blob ${blob}\tremote\n`);
    const tip = await native(remote, ["commit-tree", tree, "-m", "Remote"]);
    await native(remote, ["update-ref", "refs/heads/main", tip]);
    await native(remote, ["tag", "upstream-tag", tip]);
    const source = { url: remote, token: Redacted.make("test"), branch: "main" };
    const preview = await value(git.previewAdoption(repo, source));
    expect(preview.seed).toBe(seed);
    expect(preview.changedFiles).toBe(seed ? 0 : 2);
    const before = events.length;
    const result = await value(git.acceptAdoption(repo, source, preview, author, false));
    expect(result.kind).toBe("adopted");
    if (result.kind !== "adopted") throw new Error("adoption refused");
    expect(await native(dir, ["show", "-s", "--format=%P", "main"])).toBe(`${main} ${tip}`);
    expect(await native(dir, ["rev-parse", "main^{tree}"])).toBe(
      seed ? tree : await native(dir, ["rev-parse", `${main}^{tree}`]),
    );
    expect(await native(dir, ["merge-base", mate, "main"])).toBe(main);
    expect(await native(dir, ["merge-base", "--is-ancestor", main, "main"])).toBe("");
    expect(await native(dir, ["for-each-ref", "--format=%(refname)", "refs/tags"])).toBe("");
    expect(
      await NodeFSP.access(NodePath.join(dir, "FETCH_HEAD")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(events.slice(before)).toEqual([
      { kind: "main_moved", repo, old: main, new: result.sha, by: "commit" },
    ]);
    const count = await native(dir, ["rev-list", "--all", "--count"]);
    const again = await value(git.previewAdoption(repo, source));
    expect(await value(git.acceptAdoption(repo, source, again, author, false))).toEqual({
      kind: "unchanged",
    });
    expect(await native(dir, ["rev-list", "--all", "--count"])).toBe(count);
    expect(events.length).toBe(before + 1);
  }),
);
it.live(
  "connecting an origin to an untouched repository takes the origin's history as main, with no commit of HQ's own",
  () =>
    fixture(async (git, dir, events) => {
      const seed = await write(git, {}, null);
      const remote = NodePath.join(dir, "remote.git");
      await native(dir, ["init", "--bare", remote]);
      const blob = await native(remote, ["hash-object", "-w", "--stdin"], "remote");
      const tree = await native(remote, ["mktree"], `100644 blob ${blob}\tremote\n`);
      const first = await native(remote, ["commit-tree", tree, "-m", "First"]);
      const tip = await native(remote, ["commit-tree", tree, "-p", first, "-m", "Second"]);
      await native(remote, ["update-ref", "refs/heads/main", tip]);
      const source = { url: remote, token: Redacted.make("test"), branch: "main" };
      const preview = await value(git.previewAdoption(repo, source));
      expect(preview.seed).toBe(true);
      const before = events.length;
      expect(await value(git.acceptAdoption(repo, source, preview, author, false))).toEqual({
        kind: "adopted",
        sha: tip,
      });
      expect(await native(dir, ["rev-list", "main"])).toBe(`${tip}\n${first}`);
      expect(events.slice(before)).toEqual([
        { kind: "main_moved", repo, old: seed, new: tip, by: "commit" },
      ]);
      const again = await value(git.previewAdoption(repo, source));
      expect(await value(git.acceptAdoption(repo, source, again, author, false))).toEqual({
        kind: "unchanged",
      });
    }),
);
it.live.each([
  { holder: "an open change's branch", recorded: false },
  { holder: "a tag", recorded: false },
  { holder: "a record of HQ's", recorded: true },
])(
  "a seed $holder holds stays under main: adoption merges it with the origin",
  ({ holder, recorded }) =>
    fixture(async (git, dir) => {
      const seed = await write(git, {}, null);
      if (holder === "a tag") await native(dir, ["tag", "v0", seed]);
      else if (!recorded) await branch(git, dir, seed, { mate: "work" });
      const remote = NodePath.join(dir, "remote.git");
      await native(dir, ["init", "--bare", remote]);
      const blob = await native(remote, ["hash-object", "-w", "--stdin"], "remote");
      const tree = await native(remote, ["mktree"], `100644 blob ${blob}\tremote\n`);
      const tip = await native(remote, ["commit-tree", tree, "-m", "Remote"]);
      await native(remote, ["update-ref", "refs/heads/main", tip]);
      const source = { url: remote, token: Redacted.make("test"), branch: "main" };
      const preview = await value(git.previewAdoption(repo, source));
      const result = await value(git.acceptAdoption(repo, source, preview, author, recorded));
      expect(result.kind).toBe("adopted");
      expect(await native(dir, ["show", "-s", "--format=%P", "main"])).toBe(`${seed} ${tip}`);
      expect(await native(dir, ["rev-parse", "main^{tree}"])).toBe(tree);
    }),
);
it.live("A fetched GitHub branch does not make an untouched seed look touched", () =>
  fixture(async (git, dir) => {
    const seed = await write(git, {}, null);
    const github = NodePath.join(dir, "github.git");
    await native(dir, ["init", "--bare", github]);
    const mirror = { url: github, token: Redacted.make("mirror-fixture") };
    // GitHub took HQ's seed once, and someone branched from it there.
    await value(git.pushRef(repo, mirror, "feature", seed, null));
    const tree = await native(github, ["mktree"], "");
    const work = await native(github, ["commit-tree", tree, "-p", seed, "-m", "Work"]);
    await native(github, ["update-ref", "refs/heads/feature", work]);
    await value(git.followRefs(repo, mirror));
    expect(await native(dir, ["rev-parse", "refs/github/heads/feature"])).toBe(work);
    const remote = NodePath.join(dir, "remote.git");
    await native(dir, ["init", "--bare", remote]);
    const blob = await native(remote, ["hash-object", "-w", "--stdin"], "remote");
    const theirs = await native(remote, ["mktree"], `100644 blob ${blob}\tremote\n`);
    const tip = await native(remote, ["commit-tree", theirs, "-m", "Remote"]);
    await native(remote, ["update-ref", "refs/heads/main", tip]);
    const source = { url: remote, token: Redacted.make("test"), branch: "main" };
    const preview = await value(git.previewAdoption(repo, source));
    expect(await value(git.acceptAdoption(repo, source, preview, author, false))).toEqual({
      kind: "adopted",
      sha: tip,
    });
  }),
);
/**
 * A GitHub stand-in whose main is clean and whose side branch holds a tree git's fsck refuses (a
 * zero-padded mode): following every ref fails there each time, as a fetch the deadline stopped.
 */
const refusedSideBranch = async (dir: string) => {
  const github = NodePath.join(dir, "github.git");
  await native(dir, ["init", "--bare", github]);
  const empty = await native(github, ["mktree"], "");
  await native(github, [
    "update-ref",
    "refs/heads/main",
    await native(github, ["commit-tree", empty, "-m", "Main"]),
  ]);
  const blob = await native(github, ["hash-object", "-w", "--stdin"], "old");
  const sub = await native(github, ["mktree"], `100644 blob ${blob}\told\n`);
  const tree = await native(
    github,
    ["hash-object", "-t", "tree", "-w", "--literally", "--stdin"],
    Buffer.concat([Buffer.from("040000 vendor\0"), Buffer.from(sub, "hex")]),
  );
  const legacy = await native(github, ["commit-tree", tree, "-m", "Imported from SVN"]);
  await native(github, ["update-ref", "refs/heads/legacy", legacy]);
  return { url: github, token: Redacted.make("mirror-fixture") };
};
const partialPacks = async (dir: string) =>
  (await NodeFSP.readdir(NodePath.join(dir, "objects", "pack"))).filter((name) =>
    name.startsWith("tmp_"),
  );
it.live.each([
  {
    by: "the next follow of GitHub's refs",
    next: (git: HqGit, remote: MirrorRemote) => git.followRefs(repo, remote),
  },
  {
    by: "the next fetch of GitHub's main",
    next: (git: HqGit, remote: MirrorRemote) => git.fetchTip(repo, remote, "main"),
  },
  { by: "HQ's sweep on takeover", next: (git: HqGit) => git.convergeRepo(repo) },
])(
  "A partial pack a fetch from GitHub left behind is removed by $by once no fetch can still be writing it",
  ({ next }) =>
    fixture(async (git, dir) => {
      const remote = await refusedSideBranch(dir);
      await value(Effect.flip(git.followRefs(repo, remote)));
      const [stale] = await partialPacks(dir);
      expect(stale).toBeDefined();
      // Two minutes older than it was written: past any fetch's deadline.
      const path = NodePath.join(dir, "objects", "pack", stale!);
      const past = (await NodeFSP.stat(path)).mtimeMs / 1000 - 2 * 60;
      await NodeFSP.utimes(path, past, past);
      await value(Effect.exit(next(git, remote)));
      expect(await partialPacks(dir)).not.toContain(stale);
    }),
);
it.live("A partial pack a fetch may still be writing is kept", () =>
  fixture(async (git, dir) => {
    const remote = await refusedSideBranch(dir);
    await value(Effect.flip(git.followRefs(repo, remote)));
    const fresh = await partialPacks(dir);
    expect(fresh).toHaveLength(1);
    await value(git.convergeRepo(repo));
    expect(await partialPacks(dir)).toEqual(fresh);
  }),
);
it.live.each(["remote", "main"] as const)(
  "Decision L3a: a moved %s refuses the displayed adoption without moving main",
  (changed) =>
    fixture(async (git, dir, events) => {
      const main = await write(git, { hq: "hq" }, null);
      const remote = NodePath.join(dir, "remote.git");
      await native(dir, ["init", "--bare", remote]);
      const tree = await native(remote, ["mktree"], "");
      const tip = await native(remote, ["commit-tree", tree, "-m", "Remote"]);
      await native(remote, ["update-ref", "refs/heads/main", tip]);
      const source = { url: remote, token: Redacted.make("test"), branch: "main" };
      const preview = await value(git.previewAdoption(repo, source));
      let expectedMain = main;
      if (changed === "main") expectedMain = await write(git, { next: "next" }, main);
      else {
        const next = await native(remote, ["commit-tree", tree, "-p", tip, "-m", "Remote moved"]);
        await native(remote, ["update-ref", "refs/heads/main", next]);
      }
      const before = events.length;
      const objects = await native(dir, ["rev-list", "--all", "--count"]);
      expect(await value(git.acceptAdoption(repo, source, preview, author, false))).toEqual({
        kind: "stale",
      });
      expect(await native(dir, ["rev-parse", "main"])).toBe(expectedMain);
      expect(await native(dir, ["rev-list", "--all", "--count"])).toBe(objects);
      expect(events.length).toBe(before);
    }),
);
it.live("an absent remote branch writes no adoption commit", () =>
  fixture(async (git, dir, events) => {
    const main = await write(git, {}, null);
    const remote = NodePath.join(dir, "remote.git");
    await native(dir, ["init", "--bare", remote]);
    const source = { url: remote, token: Redacted.make("test"), branch: "missing" };
    const preview = await value(git.previewAdoption(repo, source));
    expect(preview.remoteTip).toBeNull();
    expect(preview.changedFiles).toBe(0);
    expect(await value(git.acceptAdoption(repo, source, preview, author, false))).toEqual({
      kind: "unchanged",
    });
    expect(await native(dir, ["rev-parse", "main"])).toBe(main);
    expect(await native(dir, ["rev-list", "--all", "--count"])).toBe("1");
    expect(events.length).toBe(1);
  }),
);

it.live("an absent remote previews every populated HQ file while writing no adoption commit", () =>
  fixture(async (git, dir) => {
    const main = await write(git, { a: "a", b: "b" }, null);
    const remote = NodePath.join(dir, "remote.git");
    await native(dir, ["init", "--bare", remote]);
    const source = { url: remote, token: Redacted.make("fixture"), branch: "main" };
    const preview = await value(git.previewAdoption(repo, source));
    const files = (await native(dir, ["ls-tree", "-r", "--name-only", main])).split("\n");
    expect(preview.changedFiles).toBe(files.length);
    expect(await value(git.acceptAdoption(repo, source, preview, author, false))).toEqual({
      kind: "unchanged",
    });
    expect(await native(dir, ["rev-parse", "main"])).toBe(main);
  }),
);

it.live("an empty tree after real work is populated history and never the seed", () =>
  fixture(async (git, dir) => {
    const original = await write(git, { a: "work" }, null);
    const main = await write(git, { a: null }, original);
    const remote = NodePath.join(dir, "remote.git");
    await native(dir, ["init", "--bare", remote]);
    const blob = await native(remote, ["hash-object", "-w", "--stdin"], "remote");
    const tree = await native(remote, ["mktree"], `100644 blob ${blob}\ta\n`);
    const head = await native(remote, ["commit-tree", tree, "-m", "Remote"]);
    await native(remote, ["update-ref", "refs/heads/main", head]);
    const source = { url: remote, token: Redacted.make("fixture"), branch: "main" };
    const preview = await value(git.previewAdoption(repo, source));
    expect(preview.seed).toBe(false);
    expect(preview.changedFiles).toBe(1);
    expect((await value(git.acceptAdoption(repo, source, preview, author, false))).kind).toBe(
      "adopted",
    );
    expect(await native(dir, ["rev-parse", "main^{tree}"])).toBe(
      await native(dir, ["rev-parse", `${main}^{tree}`]),
    );
    expect(await native(dir, ["ls-tree", "main"])).toBe("");
  }),
);
it.live(
  "the first-push count is exact beyond bounded tree readers, including unusual path names",
  () =>
    fixture(async (git, dir) => {
      const main = await write(git, { hq: "hq" }, null);
      const remote = NodePath.join(dir, "remote.git");
      await native(dir, ["init", "--bare", remote]);
      const blob = await native(remote, ["hash-object", "-w", "--stdin"], "remote");
      const paths = [
        ...Array.from({ length: 1005 }, (_, i) => `file-${i}`),
        "line\nfeed",
        "tab\tfile",
      ];
      const tree = await native(
        remote,
        ["mktree", "-z"],
        paths.map((path) => `100644 blob ${blob}\t${path}\0`).join(""),
      );
      const tip = await native(remote, ["commit-tree", tree, "-m", "Remote"]);
      await native(remote, ["update-ref", "refs/heads/main", tip]);
      const source = { url: remote, token: Redacted.make("fixture"), branch: "main" };
      const preview = await value(git.previewAdoption(repo, source));
      const listed = (await native(remote, ["ls-tree", "-r", "-z", "--name-only", tip]))
        .split("\0")
        .filter(Boolean);
      expect(listed.length).toBe(paths.length);
      expect(preview.changedFiles).toBe(listed.length + 1);
      expect(await native(dir, ["rev-parse", "main"])).toBe(main);
    }),
);

describe("a mirror on another host", () => {
  /** An empty bare repository beside HQ's, standing in for GitHub; a token it never asks for. */
  const mirrorOf = async (dir: string) => {
    const path = NodePath.join(NodePath.dirname(dir), "github.git");
    await native(NodePath.dirname(dir), ["init", "--bare", "-b", "main", path]);
    return { path, remote: { url: path, token: Redacted.make("mirror-fixture") } };
  };
  /** A commit made on the mirror itself, after `parent`: a merge there. */
  const commitThere = async (path: string, parent: string | null, file: string) => {
    const blob = await native(path, ["hash-object", "-w", "--stdin"], file);
    const tree = await native(path, ["mktree"], `100644 blob ${blob}\t${file}\n`);
    return native(path, [
      "commit-tree",
      tree,
      ...(parent === null ? [] : ["-p", parent]),
      "-m",
      `Merge ${file}`,
    ]);
  };

  it.live("an empty mirror names main and no tip, and takes HQ's main as its first branch", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { app: "1" }, null);
      const { path, remote } = await mirrorOf(dir);
      expect(await value(git.remoteHead(repo, remote))).toEqual({ branch: "main", sha: null });
      expect(await value(git.pushRef(repo, remote, "main", main, null))).toEqual({
        kind: "pushed",
      });
      expect(await native(path, ["rev-parse", "refs/heads/main"])).toBe(main);
      expect(await value(git.remoteHead(repo, remote))).toEqual({ branch: "main", sha: main });
    }),
  );

  it.live("a mirror's default branch is the one its HEAD names", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { app: "1" }, null);
      const { path, remote } = await mirrorOf(dir);
      await value(git.pushRef(repo, remote, "trunk", main, null));
      await native(path, ["symbolic-ref", "HEAD", "refs/heads/trunk"]);
      expect(await value(git.remoteHead(repo, remote))).toEqual({ branch: "trunk", sha: main });
    }),
  );

  it.live("a mirror's newer tip comes in as objects only, and main fast-forwards to it once", () =>
    fixture(async (git, dir, events) => {
      const main = await write(git, { app: "1" }, null);
      const { path, remote } = await mirrorOf(dir);
      await value(git.pushRef(repo, remote, "main", main, null));
      const merged = await commitThere(path, main, "merged");
      await native(path, ["update-ref", "refs/heads/main", merged]);
      const refs = await native(dir, ["for-each-ref"]);
      expect(await value(git.fetchTip(repo, remote, "main"))).toBe(merged);
      // Nothing names it yet: no ref, tag or FETCH_HEAD.
      expect(await native(dir, ["for-each-ref"])).toBe(refs);
      expect(await value(git.isAncestor(repo, main, merged))).toBe(true);
      expect(await value(git.isAncestor(repo, merged, main))).toBe(false);
      const before = events.length;
      expect(await value(git.fastForwardMain(repo, merged, main))).toEqual({ kind: "moved" });
      expect(await native(dir, ["rev-parse", "main"])).toBe(merged);
      expect(events.slice(before)).toEqual([
        { kind: "main_moved", repo, old: main, new: merged, by: "import" },
      ]);
      // A second import of the same tip, from the main it read before, moves nothing.
      expect(await value(git.fastForwardMain(repo, merged, main))).toEqual({ kind: "stale" });
      expect(events.length).toBe(before + 1);
    }),
  );

  it.live("a main that never held a file takes a mirror's history in its place", () =>
    fixture(async (git, dir, events) => {
      const main = await write(git, {}, null);
      const { path, remote } = await mirrorOf(dir);
      const theirs = await commitThere(path, null, "readme");
      await native(path, ["update-ref", "refs/heads/main", theirs]);
      expect(await value(git.fetchTip(repo, remote, "main"))).toBe(theirs);
      expect(await value(git.holdsNothing(repo, main))).toBe(true);
      expect(await value(git.holdsNothing(repo, theirs))).toBe(false);
      const before = events.length;
      expect(await value(git.fastForwardMain(repo, theirs, main))).toEqual({ kind: "moved" });
      expect(await native(dir, ["rev-parse", "main"])).toBe(theirs);
      expect(events.slice(before)).toEqual([
        { kind: "main_moved", repo, old: main, new: theirs, by: "import" },
      ]);
    }),
  );

  it.live("a main that once held a file is never replaced by a mirror's history", () =>
    fixture(async (git, dir) => {
      const first = await write(git, { app: "1" }, null);
      const emptied = await write(git, { app: null }, first);
      const { path, remote } = await mirrorOf(dir);
      const theirs = await commitThere(path, null, "readme");
      await native(path, ["update-ref", "refs/heads/main", theirs]);
      await value(git.fetchTip(repo, remote, "main"));
      expect(await value(git.holdsNothing(repo, emptied))).toBe(false);
      expect(await value(git.fastForwardMain(repo, theirs, emptied))).toEqual({
        kind: "not_fast_forward",
      });
      expect(await native(dir, ["rev-parse", "main"])).toBe(emptied);
    }),
  );

  it.live("a change's branch takes commits added on top of it elsewhere, only forward", () =>
    fixture(async (git, dir, events) => {
      const main = await write(git, { app: "1" }, null);
      const head = await branch(git, dir, main, { mate: "work" });
      const { path, remote } = await mirrorOf(dir);
      await value(git.pushRef(repo, remote, "mate/1-work", head, null));
      const theirs = await commitThere(path, head, "suggestion");
      await native(path, ["update-ref", "refs/heads/mate/1-work", theirs]);
      expect(await value(git.fetchTip(repo, remote, "mate/1-work"))).toBe(theirs);
      expect(await value(git.fastForwardChange(repo, alice(1), theirs, main))).toEqual({
        kind: "stale",
      });
      expect(await value(git.fastForwardChange(repo, alice(1), main, head))).toEqual({
        kind: "not_fast_forward",
      });
      const before = events.length;
      expect(await value(git.fastForwardChange(repo, alice(1), theirs, head))).toEqual({
        kind: "moved",
      });
      expect(await native(dir, ["rev-parse", "refs/heads/mate/alice/1"])).toBe(theirs);
      expect(events.slice(before)).toEqual([
        {
          kind: "pushed",
          repo,
          updates: [{ ref: "refs/heads/mate/alice/1", oldSha: head, newSha: theirs }],
        },
      ]);
    }),
  );

  it.live(
    "a change's branch kept on GitHub is made in HQ's copy at the tip followed from there, then only moves forward",
    () =>
      fixture(async (git, dir, events) => {
        const main = await write(git, { app: "1" }, null);
        const { path, remote } = await mirrorOf(dir);
        await value(git.pushRef(repo, remote, "main", main, null));
        const pushed = await commitThere(path, main, "fix");
        await native(path, ["update-ref", "refs/heads/fix-x", pushed]);
        const followed = await value(git.followRefs(repo, remote));
        expect([...followed.heads]).toEqual([
          ["fix-x", pushed],
          ["main", main],
        ]);
        const change = { mateId: "alice", number: 1, branch: "fix-x" };
        const before = events.length;
        expect(await value(git.fastForwardChange(repo, change, pushed, null))).toEqual({
          kind: "moved",
        });
        expect(await native(dir, ["rev-parse", "refs/heads/fix-x"])).toBe(pushed);
        expect(events.slice(before)).toEqual([
          {
            kind: "pushed",
            repo,
            updates: [{ ref: "refs/heads/fix-x", oldSha: "0".repeat(40), newSha: pushed }],
          },
        ]);
        // Made once: a second making from nothing is stale, never a reset.
        expect(await value(git.fastForwardChange(repo, change, main, null))).toEqual({
          kind: "stale",
        });
      }),
  );

  it.live("main never moves backwards or sideways to a mirror's tip", () =>
    fixture(async (git, dir, events) => {
      const first = await write(git, { app: "1" }, null);
      const main = await write(git, { app: "2" }, first);
      const { path, remote } = await mirrorOf(dir);
      const elsewhere = await commitThere(path, null, "unrelated");
      await native(path, ["update-ref", "refs/heads/main", elsewhere]);
      expect(await value(git.fetchTip(repo, remote, "main"))).toBe(elsewhere);
      const before = events.length;
      expect(await value(git.fastForwardMain(repo, elsewhere, main))).toEqual({
        kind: "not_fast_forward",
      });
      expect(await value(git.fastForwardMain(repo, first, main))).toEqual({
        kind: "not_fast_forward",
      });
      expect(await native(dir, ["rev-parse", "main"])).toBe(main);
      expect(events.length).toBe(before);
    }),
  );

  it.live("a push to a mirror's branch that moved since, or away from it, changes nothing", () =>
    fixture(async (git, dir) => {
      const first = await write(git, { app: "1" }, null);
      const second = await write(git, { app: "2" }, first);
      const { path, remote } = await mirrorOf(dir);
      await value(git.pushRef(repo, remote, "mate/1-add-search", first, null));
      const theirs = await commitThere(path, first, "reviewer");
      await native(path, ["update-ref", "refs/heads/mate/1-add-search", theirs]);
      // Leased on what HQ pushed last: someone else's commit there is never overwritten.
      expect(await value(git.pushRef(repo, remote, "mate/1-add-search", second, first))).toEqual({
        kind: "rejected",
        reason: "stale",
      });
      // And never a force push: HQ moves a branch only forward from what it expects there.
      expect(await value(git.pushRef(repo, remote, "mate/1-add-search", first, second))).toEqual({
        kind: "rejected",
        reason: "not_fast_forward",
      });
      expect(await native(path, ["rev-parse", "refs/heads/mate/1-add-search"])).toBe(theirs);
      expect(await value(git.pushRef(repo, remote, "mate/1-add-search", second, null))).toEqual({
        kind: "rejected",
        reason: "stale",
      });
    }),
  );

  it.live.each(["moved forward", "deleted"])(
    "a push whose remote moved since HQ read it is refused as stale and overwrites nothing: %s",
    (change) =>
      fixture(async (git, dir) => {
        const first = await write(git, { app: "1" }, null);
        const second = await write(git, { app: "2" }, first);
        const third = await write(git, { app: "3" }, second);
        const { path, remote } = await mirrorOf(dir);
        await value(git.pushRef(repo, remote, "mate/1-add-search", first, null));
        // Moved to an ancestor of the pushed commit: only the expected tip stops the push.
        if (change === "deleted")
          await native(path, ["update-ref", "-d", "refs/heads/mate/1-add-search"]);
        else await value(git.pushRef(repo, remote, "mate/1-add-search", second, first));
        expect(await value(git.pushRef(repo, remote, "mate/1-add-search", third, first))).toEqual({
          kind: "rejected",
          reason: "stale",
        });
        expect(
          await native(path, [
            "for-each-ref",
            "--format=%(objectname)",
            "refs/heads/mate/1-add-search",
          ]),
        ).toBe(change === "deleted" ? "" : second);
      }),
  );
});
