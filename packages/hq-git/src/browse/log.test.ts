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
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-browse-log-"))),
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
const native = (dir: string, args: string[], env: Record<string, string> = {}, input?: string) =>
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
    child.stdin?.end(input);
  });
const value = Effect.runPromise;

/** Commits of the empty tree on `main`, one second apart, oldest first; their shas, oldest first. */
const chain = async (dir: string, count: number, from: string | null = null, start = 0) => {
  const tree = await native(dir, ["mktree"], {}, "");
  const shas: string[] = [];
  let parent = from;
  for (let i = 0; i < count; i++) {
    const date = `@${1_700_000_000 + start + i} +0000`;
    parent = await native(
      dir,
      [
        "commit-tree",
        tree,
        ...(parent === null ? [] : ["-p", parent]),
        "-m",
        `commit ${start + i}`,
      ],
      { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
    );
    shas.push(parent);
  }
  await native(dir, ["update-ref", "refs/heads/main", parent!]);
  return shas;
};
const write = async (git: HqGit, files: Record<string, string | null>, message: string) => {
  const head = await value(git.browse.resolve(repo, "main"));
  const result = await value(
    git.commitFiles(repo, "refs/heads/main", {
      files,
      expectedHead: head.kind === "commit" ? head.sha : null,
      message,
      author,
    }),
  );
  if (!("sha" in result)) throw new Error(`write refused: ${result.kind}`);
  return result.sha;
};

describe("git browse log", () => {
  it.live("The commit list pages 100 at a time from the commit the first page started at", () =>
    fixture(async (git, dir) => {
      const shas = await chain(dir, 150);
      const tip = shas.at(-1)!;
      const first = (await value(git.browse.log(repo, { sha: tip })))!;
      expect(first.items.map((item) => item.sha)).toEqual(shas.slice(50).reverse());
      expect(first.next).toBe(`${tip}:100`);
      expect(first.items[0]).toMatchObject({
        subject: "commit 149",
        authorName: "Core",
        committedAt: "2023-11-14T22:15:49.000Z",
        parents: [shas[148]],
      });
      const second = (await value(git.browse.log(repo, { sha: tip, cursor: first.next! })))!;
      expect(second.items.map((item) => item.sha)).toEqual(shas.slice(0, 50).reverse());
      expect(second.next).toBeNull();
      expect(second.stopped).toBe(false);
      // The person's email is never in the answer.
      expect(JSON.stringify([first, second])).not.toContain(author.email);
    }),
  );

  it.live("A new commit on the branch does not reorder a list already open", () =>
    fixture(async (git, dir) => {
      const shas = await chain(dir, 120);
      const tip = shas.at(-1)!;
      const first = (await value(git.browse.log(repo, { sha: tip })))!;
      // The branch moves on between the person's two pages.
      await chain(dir, 5, tip, 120);
      const second = (await value(git.browse.log(repo, { sha: tip, cursor: first.next! })))!;
      expect([...first.items, ...second.items].map((item) => item.sha)).toEqual(
        [...shas].reverse(),
      );
    }),
  );

  it.live("A path's history lists only commits that touched it", () =>
    fixture(async (git) => {
      const added = await write(git, { "app/a.txt": "1" }, "Add a");
      await write(git, { "b.txt": "1" }, "Add b");
      const changed = await write(git, { "app/a.txt": "2" }, "Change a");
      await write(git, { "b.txt": "2" }, "Change b");
      const tip = await write(git, { "app/[x].txt": "1" }, "Add a pattern-like name");
      const file = (await value(git.browse.log(repo, { sha: tip, path: "app/a.txt" })))!;
      expect(file.items.map((item) => item.sha)).toEqual([changed, added]);
      // Its oldest commit added it: no earlier history is followed.
      expect(file.addsPath).toBe(true);
      const folder = (await value(git.browse.log(repo, { sha: tip, path: "app" })))!;
      expect(folder.items.map((item) => item.subject)).toEqual([
        "Add a pattern-like name",
        "Change a",
        "Add a",
      ]);
      // A path is matched as written, never as a pattern.
      const literal = (await value(git.browse.log(repo, { sha: tip, path: "app/[x].txt" })))!;
      expect(literal.items.map((item) => item.sha)).toEqual([tip]);
      const whole = (await value(git.browse.log(repo, { sha: tip })))!;
      expect(whole.items).toHaveLength(5);
      expect(whole.addsPath).toBe(false);
    }),
  );

  it.live("A commit a change merged names that change", () =>
    fixture(async (git, dir) => {
      const [base] = await chain(dir, 1);
      const tree = await native(dir, ["mktree"], {}, "");
      const merged = await native(dir, [
        "commit-tree",
        tree,
        "-p",
        base!,
        "-m",
        "Add the cart\n\nMate-Change: vera/4",
      ]);
      const plain = await native(dir, ["commit-tree", tree, "-p", merged, "-m", "Tidy"]);
      const page = (await value(git.browse.log(repo, { sha: plain })))!;
      expect(page.items.map((item) => item.change)).toEqual([
        undefined,
        { mateId: "vera", number: 4 },
        undefined,
      ]);
    }),
  );

  it.live("A history longer than 10,000 commits stops there and says so", () =>
    fixture(async (git, dir) => {
      // One stream of empty commits: thousands of `commit-tree` spawns would take a minute.
      const stream = Array.from(
        { length: 10_010 },
        (_, i) =>
          `commit refs/heads/main\nmark :${i + 1}\ncommitter Core <core@example.test> ${1_700_000_000 + i} +0000\ndata 0\n${i === 0 ? "" : `from :${i}\n`}deleteall\n`,
      ).join("");
      await native(dir, ["fast-import", "--quiet"], {}, stream);
      const tip = await native(dir, ["rev-parse", "refs/heads/main"]);
      const last = (await value(git.browse.log(repo, { sha: tip, cursor: `${tip}:9950` })))!;
      expect(last.items).toHaveLength(50);
      expect(last.next).toBeNull();
      expect(last.stopped).toBe(true);
    }),
  );

  it.live("A commit the repository does not hold reads as no list", () =>
    fixture(async (git, dir) => {
      await chain(dir, 1);
      expect(await value(git.browse.log(repo, { sha: "f".repeat(40) }))).toBeNull();
    }),
  );
});
