// @effect-diagnostics nodeBuiltinImport:off - real git fixtures and archive tools, no network listeners.
import { describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { makeHqGit } from "../index.ts";
import type { HqGit } from "../api.ts";

const repo = { appId: "app", id: "repo" };
const author = { name: "Core", email: "core@example.test" };
const value = Effect.runPromise;
const fixture = (run: (git: HqGit, root: string) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-archive-"))),
        (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
      );
      const git = yield* makeHqGit({
        rootDir: root,
        authenticate: () => null,
        canRead: () => true,
        lookupChange: async () => null,
      });
      yield* git.create(repo);
      yield* Effect.promise(() => run(git, root));
    }),
  );
const write = async (
  git: HqGit,
  files: Record<string, string | Uint8Array | null>,
  head: string | null,
) => {
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
const run = (command: string, args: string[], cwd: string) =>
  new Promise<void>((resolve, reject) =>
    NodeChildProcess.execFile(command, args, { cwd }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
/** Every file under `dir`, by its path, as bytes. */
const filesIn = async (dir: string) => {
  const files: Record<string, string> = {};
  for (const entry of await NodeFSP.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = NodePath.join(entry.parentPath, entry.name);
    files[NodePath.relative(dir, path)] = (await NodeFSP.readFile(path)).toString("base64");
  }
  return files;
};

describe("Git browser archive", () => {
  it.live("An archive holds the repository exactly as it is at that commit", () =>
    fixture(async (git, root) => {
      const files = {
        ".gitattributes": "one export-ignore\ndir/two export-subst\n",
        one: "one",
        "dir/two": "$Format:%H$",
        "dir/deeper/three.bin": NodeCrypto.randomBytes(64 * 1024),
      };
      const sha = await write(git, files, null);
      await write(git, { one: "moved on", later: "later" }, sha);
      const expected = Object.fromEntries(
        Object.entries(files).map(([path, content]) => [
          path,
          Buffer.from(content).toString("base64"),
        ]),
      );
      for (const [format, unpack] of [
        ["tar.gz", (file: string) => ["tar", ["-xzf", file]]],
        ["zip", (file: string) => ["unzip", ["-q", file]]],
      ] as const) {
        const stream = await value(git.browse.archive(repo, sha, format));
        expect(stream, format).not.toBeNull();
        const chunks: Buffer[] = [];
        for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
        const into = await NodeFSP.mkdtemp(NodePath.join(root, `unpacked-${format}-`));
        const file = NodePath.join(root, `archive.${format}`);
        await NodeFSP.writeFile(file, Buffer.concat(chunks));
        const [command, args] = unpack(file);
        await run(command, [...args], into);
        expect(await filesIn(into), format).toEqual(expected);
      }
      expect(await value(git.browse.archive(repo, "f".repeat(40), "zip"))).toBeNull();
      expect(
        (await NodeFSP.readdir(NodePath.join(root, "app/repo.git"))).filter((name) =>
          name.startsWith(".archive-"),
        ),
      ).toEqual([]);
    }),
  );
});
