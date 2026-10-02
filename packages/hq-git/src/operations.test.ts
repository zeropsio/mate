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
import { makeHqGit } from "./index.ts";
import type { HqGit, GitEvent, HqGitOptions, GitError } from "./api.ts";

const repo = { appId: "app", id: "repo" };
const author = { name: "Core", email: "core@example.test" };
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
const native = (dir: string, args: string[], input?: string) =>
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
const merge = async (
  git: HqGit,
  main: string,
  number = 1,
  message = "Add file\n\nMate-Change: forged/99\nCrew-Assignment: forged",
  head?: string,
) =>
  value(
    git.squashMerge(repo, {
      mateId: "alice",
      number,
      expectedMain: main,
      expectedHead: head ?? (await value(git.changeHead(repo, "alice", number))) ?? "0".repeat(40),
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
        expect(await value(git.changeHead(repo, "alice", 1))).toBeNull();
        const head = await branch(git, dir, main, { "new.txt": "new\n" });
        expect(await value(git.changeHead(repo, "alice", 1))).toBe(head);
        expect(await value(git.mergeability(repo, "alice", 1))).toEqual({ kind: "clean" });
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
        expect(await value(git.mergeability(repo, "alice", 1))).toEqual({ kind: "already_merged" });
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
          mateId: "alice",
          number: 1,
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
      expect(await value(git.mergeability(repo, "alice", 1))).toEqual({ kind: "clean" });
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
      expect(await value(git.mergeability(repo, "alice", 1))).toEqual({ kind: "clean" });
    }),
  );
  it.live("refuses a change whose history is unrelated to main", () =>
    fixture(async (git, dir) => {
      const main = await write(git, { base: "base" }, null);
      const root = await write(git, { other: "other" }, null, "refs/heads/core/other");
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", root]);
      expect(await value(git.mergeability(repo, "alice", 1))).toEqual({ kind: "unrelated" });
      expect(await merge(git, main)).toEqual({ kind: "unrelated" });
    }),
  );
  it.live("reports a missing main, not a missing change, while main is unborn", () =>
    fixture(async (git, dir) => {
      expect(await value(git.mergeability(repo, "alice", 1))).toEqual({ kind: "no_change" });
      const head = await write(git, { file: "x" }, null, "refs/heads/core/start");
      await native(dir, ["update-ref", "refs/heads/mate/alice/1", head]);
      await expect(value(git.mergeability(repo, "alice", 1))).rejects.toHaveProperty(
        "reason",
        "no_main",
      );
      await expect(
        value(git.changeDiff(repo, "alice", 1, { maxFiles: 1, maxBytesPerFile: 1 })),
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
        expect(await value(git.mergeability(repo, "alice", 1))).toEqual({
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
      expect(await value(git.mergeability(repo, "alice", 1))).toEqual({
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
    fixture(async (git, dir) => {
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

describe("a change's own history", () => {
  it.live("names each file the change touches against its base, with how", () =>
    fixture(async (git, dir) => {
      expect(await value(git.changeNames(repo, "alice", 1))).toEqual({
        items: [],
        truncated: false,
      });
      const main = await write(
        git,
        { "kept.txt": "kept\n", "edited.txt": "one\n", "gone.txt": "x\n" },
        null,
      );
      await branch(git, dir, main, {
        "added.txt": "new\n",
        "edited.txt": "two\n",
        "gone.txt": null,
      });
      // main moving on is no part of the change.
      await write(git, { "later.txt": "later\n" }, main);
      expect(await value(git.changeNames(repo, "alice", 1))).toEqual({
        items: [
          { path: "added.txt", status: "A" },
          { path: "edited.txt", status: "M" },
          { path: "gone.txt", status: "D" },
        ],
        truncated: false,
      });
    }),
  );

  it.live("names what squashing the change does to main now, against the main and head read", () =>
    fixture(async (git, dir) => {
      expect(await value(git.squashNames(repo, "alice", 1))).toEqual({ kind: "no_change" });
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
      const names = await value(git.squashNames(repo, "alice", 1));
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
        expect(await value(git.squashNames(repo, "alice", 1))).toEqual({
          main: moved,
          head: both,
          files: { items: [{ path: "own.txt", status: "A" }], truncated: false },
        });
        expect(await value(git.squashNames(repo, "alice", 2))).toMatchObject({
          main: moved,
          files: { items: [], truncated: false },
        });
        // Added otherwise, it does not merge: git's verdict, no names.
        expect(await value(git.squashNames(repo, "alice", 3))).toEqual({
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
      const names = await value(git.squashNames(repo, "alice", 1));
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
          git.changeTrailers(repo, "alice", 1, ["Crew-Lane", "Crew-Assignment"]),
        );
        const of = (key: string) =>
          trailers.filter((entry) => entry.key === key).map((entry) => entry.value);
        expect(of("Crew-Assignment")).toEqual([
          ...Array.from({ length: 150 }, (_, i) => `task-${i + 1}`),
          "a long task",
        ]);
        expect(of("Crew-Lane")).toEqual([...Array(150).fill("ada"), "bo"]);
        expect(trailers).toHaveLength(302);
        expect(await value(git.changeTrailers(repo, "alice", 2, ["Crew-Lane"]))).toEqual([]);
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
          (await value(git.changeLog(repo, "alice", 2, { limit: 10 }))).items.map((c) => c.sha),
        ).toEqual([lone]);
        expect(await value(git.mergeBase(repo, "alice", 2))).toBeNull();

        const main = await write(git, { "base.txt": "base\n" }, null);
        expect(await value(git.mergeBase(repo, "alice", 1))).toBeNull();
        expect(await value(git.changeLog(repo, "alice", 1, { limit: 10 }))).toEqual({
          items: [],
          truncated: false,
        });
        const first = await branch(git, dir, main, { "a.txt": "a\n" });
        expect(await value(git.mergeBase(repo, "alice", 1))).toBe(main);
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

        expect(await value(git.mergeBase(repo, "alice", 1))).toBe(moved);
        const log = await value(git.changeLog(repo, "alice", 1, { limit: 10 }));
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
        const capped = await value(git.changeLog(repo, "alice", 1, { limit: 1 }));
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
        git.changeDiff(repo, "alice", 1, { maxFiles: 10, maxBytesPerFile: 10000 }),
      );
      expect(diff.truncated).toBe(false);
      expect(diff.items[0]?.hunks).toContain("@@ -1 +1 @@\n-original\n+changed");
      expect(diff.items[0]).toMatchObject({ path: "base", added: 1, deleted: 1, binary: false });
      expect(
        await value(git.changeDiff(repo, "alice", 1, { maxFiles: 1, maxBytesPerFile: 10 })),
      ).toMatchObject({ truncated: true, items: [{ truncated: true }] });
      expect(
        await value(git.changeDiff(repo, "alice", 99, { maxFiles: 1, maxBytesPerFile: 10 })),
      ).toEqual({ items: [], truncated: false });
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
          git.changeDiff(repo, "alice", 1, { maxFiles: 1000, maxBytesPerFile: 1024 * 1024 }),
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
      await vi.waitFor(() =>
        expect(events).toEqual([
          { kind: "main_moved", repo, old: null, new: head, by: "commit" },
          { kind: "tagged", repo, name: "v1", sha: head },
        ]),
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

describe("receive-pack events without a listener", () => {
  it.live("reports applied refs, Core's main and tag pushes, in order with later operations", () =>
    fixture(
      async (git, dir, events) => {
        const head = await write(git, { file: "content" }, null);
        const exchange = async (commands: Buffer) => {
          const request = new NodeHttp.IncomingMessage(new NodeNet.Socket());
          request.complete = true;
          request.method = "POST";
          request.url = "/git/app/repo.git/git-receive-pack";
          request.headers = { "content-type": "application/x-git-receive-pack-request" };
          const response = new NodeHttp.ServerResponse(request);
          const chunks: Buffer[] = [];
          const sink = new NodeNet.Socket();
          vi.spyOn(sink, "write").mockImplementation((chunk) => {
            chunks.push(Buffer.from(chunk));
            return true;
          });
          response.assignSocket(sink);
          const finished = new Promise<void>((resolve, reject) => {
            response.once("finish", resolve);
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
        expect(await exchange(command([zero, head, "refs/heads/mate/alice/1"]))).toContain(
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
          await exchange(command([zero, "f".repeat(40), "refs/heads/mate/alice/2"])),
        ).toContain("ng ");
        expect(events.map((e) => e.kind)).toEqual(["main_moved", "pushed"]);
        const next = await native(dir, ["commit-tree", `${head}^{tree}`, "-p", head, "-m", "next"]);
        const tag = await native(
          dir,
          ["mktag"],
          `object ${head}\ntype commit\ntag v2\ntagger a <a@x> 0 +0000\n\nPushed\n`,
        );
        expect(
          await exchange(command([head, next, "refs/heads/main"], [zero, tag, "refs/tags/v2"])),
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
