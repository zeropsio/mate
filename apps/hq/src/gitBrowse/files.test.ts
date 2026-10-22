// @effect-diagnostics nodeBuiltinImport:off -- a file past HQ's own write limit is written by git itself.
import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../../test/harness/tempPostgres.ts";

const author = { name: "Core", email: "core@example.test" };

/** A running Core with an application whose `group` repository's `main` holds `files`. */
const shopWith = (files: Record<string, string | Uint8Array>) =>
  Effect.gen(function* () {
    const core = yield* startCore(true, { viewTtl: Duration.zero });
    const { call, gitHost } = core;
    yield* untilHealth(call, "active");
    const owner = yield* sessionFor(call, "door-owner");
    const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
    const appId = (made.body as { id: string }).id;
    const git = yield* gitHost.opened(Duration.seconds(3));
    const main = (yield* git.branches({ appId, id: "group" })).items.find(
      (branch) => branch.ref === "refs/heads/main",
    );
    const written = yield* git.commitFiles({ appId, id: "group" }, "refs/heads/main", {
      files,
      expectedHead: main?.sha ?? null,
      message: "Files",
      author,
    });
    assert.isTrue("sha" in written);
    const sha = "sha" in written ? written.sha : "";
    const browse = (read: string, params: Record<string, string>, session = owner) =>
      call("GET", `/api/apps/${appId}/repos/group/browse/${read}?${new URLSearchParams(params)}`, {
        session,
      });
    return {
      ...core,
      owner,
      appId,
      sha,
      browse,
      dir: NodePath.join(core.gitRoot, appId, "group.git"),
    };
  });

/** `main` moved to a commit of `sha`'s files and one more, written past HQ's own write limits. */
const commitBeside = (dir: string, sha: string, name: string, content: string) => {
  const git = (args: ReadonlyArray<string>, input?: string) =>
    NodeChildProcess.execFileSync("git", ["-C", dir, ...args], {
      input,
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      },
    })
      .toString()
      .trim();
  const blob = git(["hash-object", "-w", "--stdin"], content);
  const listed = git(["ls-tree", sha]);
  const tree = git(
    ["mktree"],
    `${listed}${listed === "" ? "" : "\n"}100644 blob ${blob}\t${name}\n`,
  );
  const commit = git(["commit-tree", tree, "-p", sha, "-m", "Beside"]);
  git(["update-ref", "refs/heads/main", commit, sha]);
  return commit;
};

interface Tree {
  readonly entries: ReadonlyArray<{
    readonly name: string;
    readonly path: string;
    readonly type: string;
  }>;
  readonly truncated: boolean;
}
interface Blob {
  readonly content: string | null;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly size: number;
}

describe("Git browse files", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("A folder lists at most 1,000 entries and says when it stops", () =>
      Effect.gen(function* () {
        const files: Record<string, string> = { "few/a.txt": "a" };
        for (let index = 0; index < 999; index++) files[`many/f${index}.txt`] = `${index}`;
        const { appId, gitHost, sha: first, browse } = yield* shopWith(files);
        // HQ writes at most 1,000 files a commit: the folder's last two come in a second one.
        const git = yield* gitHost.opened(Duration.seconds(3));
        const second = yield* git.commitFiles({ appId, id: "group" }, "refs/heads/main", {
          files: { "many/g0.txt": "0", "many/g1.txt": "1" },
          expectedHead: first,
          message: "More",
          author,
        });
        const sha = "sha" in second ? second.sha : "";
        const many = yield* browse("tree", { sha, path: "many" });
        assert.strictEqual(many.status, 200);
        assert.strictEqual((many.body as Tree).entries.length, 1000);
        assert.isTrue((many.body as Tree).truncated);
        const few = yield* browse("tree", { sha, path: "few" });
        expect(few.body).toEqual({
          entries: [
            expect.objectContaining({ name: "a.txt", path: "few/a.txt", type: "file", size: 1 }),
          ],
          truncated: false,
        });
      }),
    );

    it.effect("Folders list before files, each by name", () =>
      Effect.gen(function* () {
        const { sha, browse } = yield* shopWith({
          "b.txt": "b",
          "a.txt": "a",
          "zdir/x.txt": "x",
          "adir/y.txt": "y",
        });
        const root = yield* browse("tree", { sha, path: "" });
        assert.strictEqual(root.status, 200);
        const names = (root.body as Tree).entries.map((entry) => [entry.name, entry.type]);
        // The application's seed may hold more; these keep their order among them.
        expect(
          names.filter(([name]) => ["a.txt", "b.txt", "adir", "zdir"].includes(name!)),
        ).toEqual([
          ["adir", "folder"],
          ["zdir", "folder"],
          ["a.txt", "file"],
          ["b.txt", "file"],
        ]);
        const folders = names.findLastIndex(([, type]) => type === "folder");
        const files = names.findIndex(([, type]) => type !== "folder");
        assert.isBelow(folders, files === -1 ? Infinity : files);
      }),
    );

    it.effect("A file over 256 KiB shows its first 256 KiB and says so", () =>
      Effect.gen(function* () {
        const { sha, browse } = yield* shopWith({
          "large.txt": "x".repeat(300_000),
          "small.txt": "hi",
        });
        const large = yield* browse("blob", { sha, path: "large.txt" });
        assert.strictEqual(large.status, 200);
        const read = large.body as Blob;
        assert.strictEqual(read.content, "x".repeat(256 * 1024));
        assert.isTrue(read.truncated);
        assert.strictEqual(read.size, 300_000);
        const small = yield* browse("blob", { sha, path: "small.txt" });
        expect(small.body).toMatchObject({
          content: "hi",
          truncated: false,
          binary: false,
          size: 2,
        });
      }),
    );

    it.effect("A binary file is never sent as text", () =>
      Effect.gen(function* () {
        const { sha, browse } = yield* shopWith({ "image.bin": new Uint8Array([1, 0, 2]) });
        const blob = yield* browse("blob", { sha, path: "image.bin" });
        expect(blob.body).toMatchObject({ binary: true, content: null, size: 3 });
        const raw = yield* browse("raw", { sha, path: "image.bin" });
        assert.strictEqual(raw.status, 200);
        assert.strictEqual(raw.headers.get("content-type"), "application/octet-stream");
        assert.deepStrictEqual([...raw.bytes], [1, 0, 2]);
      }),
    );

    it.effect("Raw serves HTML and SVG as plain text that cannot run", () =>
      Effect.gen(function* () {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
        const { sha, browse } = yield* shopWith({
          "index.html": "<script>alert(1)</script>",
          "logo.svg": '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
          "logo.png": png,
        });
        for (const path of ["index.html", "logo.svg"]) {
          const raw = yield* browse("raw", { sha, path });
          assert.strictEqual(raw.status, 200, path);
          assert.strictEqual(raw.headers.get("content-type"), "text/plain; charset=utf-8", path);
          assert.strictEqual(raw.headers.get("x-content-type-options"), "nosniff", path);
          assert.strictEqual(
            raw.headers.get("content-security-policy"),
            "default-src 'none'; sandbox",
            path,
          );
          assert.isNull(raw.headers.get("content-disposition"), path);
        }
        const image = yield* browse("raw", { sha, path: "logo.png" });
        assert.strictEqual(image.headers.get("content-type"), "image/png");
        const blob = (yield* browse("blob", { sha, path: "logo.png" })).body as { blobSha: string };
        assert.strictEqual(image.headers.get("etag"), `"${blob.blobSha}"`);
        assert.strictEqual(
          image.headers.get("cache-control"),
          "private, max-age=31536000, immutable",
        );
        // Kept per session token: another account on the same browser is checked again.
        assert.strictEqual(image.headers.get("vary"), "Authorization");
      }),
    );

    it.effect("A download names the file", () =>
      Effect.gen(function* () {
        const { sha, browse } = yield* shopWith({ "src/a b ž.ts": "export {};\n" });
        const download = yield* browse("raw", { sha, path: "src/a b ž.ts", download: "1" });
        assert.strictEqual(download.status, 200);
        assert.strictEqual(
          download.headers.get("content-disposition"),
          "attachment; filename*=UTF-8''a%20b%20%C5%BE.ts",
        );
        assert.strictEqual(download.body, "export {};\n");
      }),
    );

    it.effect("A file over 1 MiB is refused with its size", () =>
      Effect.gen(function* () {
        const size = 1024 * 1024 + 1;
        const { dir, sha: first, browse } = yield* shopWith({ "small.txt": "s" });
        const sha = commitBeside(dir, first, "big.bin", "y".repeat(size));
        const refused = yield* browse("raw", { sha, path: "big.bin" });
        assert.strictEqual(refused.status, 413);
        assert.deepStrictEqual(refused.body, { code: "too_large", limit: 1024 * 1024, size });
        // The file view still shows its first 256 KiB.
        expect((yield* browse("blob", { sha, path: "big.bin" })).body).toMatchObject({
          size,
          truncated: true,
        });
      }),
    );

    it.effect("A path the commit does not hold is not found", () =>
      Effect.gen(function* () {
        const { sha, browse } = yield* shopWith({ "src/a.ts": "a" });
        for (const [read, path] of [
          ["tree", "nope"],
          ["tree", "src/a.ts"],
          ["blob", "nope.ts"],
          ["raw", "src/nope.ts"],
        ] as const) {
          const missing = yield* browse(read, { sha, path });
          assert.strictEqual(missing.status, 404, `${read} ${path}`);
          assert.deepStrictEqual(missing.body, { code: "path_not_found" }, `${read} ${path}`);
        }
        const commit = yield* browse("tree", { sha: "a".repeat(40), path: "" });
        assert.strictEqual(commit.status, 404);
        expect(commit.body).toMatchObject({ code: "commit_not_found" });
      }),
    );

    it.effect(
      "A folder asked as a file is answered as a folder the page opens, never as nothing",
      () =>
        Effect.gen(function* () {
          // A README's `[src](src)` names the folder as a file.
          const { sha, browse } = yield* shopWith({ "src/a.ts": "a" });
          for (const read of ["blob", "raw"] as const) {
            const folder = yield* browse(read, { sha, path: "src" });
            assert.strictEqual(folder.status, 404, read);
            assert.deepStrictEqual(folder.body, { code: "not_a_file" }, read);
          }
        }),
    );
  });
});

describe("person repository browsing (E203)", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "reads a branch, directory and file at a pinned commit, without exposing another person's source",
      () =>
        Effect.gen(function* () {
          const { call, sha, appId, browse } = yield* shopWith({
            "README.md": "Hello <script>world</script>\n",
            "src/a.ts": "export const a = 1;\n",
          });
          const reader = yield* sessionFor(call, "door-reader");
          const dev = yield* sessionFor(call, "door-dev");
          const home = yield* browse("home", {}, reader);
          assert.strictEqual(home.status, 200);
          expect(home.body).toMatchObject({ sha, ref: { name: "main", kind: "branch" } });
          const root = yield* browse("tree", { sha, path: "" }, reader);
          assert.strictEqual(root.status, 200);
          assert.isTrue(
            (root.body as Tree).entries.some(
              (entry) => entry.path === "src" && entry.type === "folder",
            ),
          );
          const directory = yield* browse("tree", { sha, path: "src" }, reader);
          assert.deepStrictEqual(
            (directory.body as Tree).entries.map((entry) => entry.path),
            ["src/a.ts"],
          );
          const file = yield* browse("blob", { sha, path: "src/a.ts" }, reader);
          assert.strictEqual(file.status, 200);
          assert.strictEqual((file.body as Blob).content, "export const a = 1;\n");
          for (const [read, params] of [
            ["home", {}],
            ["tree", { sha, path: "" }],
            ["blob", { sha, path: "src/a.ts" }],
            ["raw", { sha, path: "src/a.ts" }],
          ] as const) {
            assert.strictEqual((yield* browse(read, params, dev)).status, 403, read);
            const path = `/api/apps/${appId}/repos/group/browse/${read}?${new URLSearchParams(params)}`;
            assert.strictEqual((yield* call("GET", path)).status, 401, read);
          }
          assert.strictEqual((yield* browse("home", { rev: "--help" }, reader)).status, 400);
          assert.strictEqual(
            (yield* browse("tree", { sha: "main", path: "" }, reader)).status,
            400,
          );
          assert.strictEqual(
            (yield* browse("blob", { sha, path: "../secret" }, reader)).status,
            400,
          );
        }),
    );

    it.effect("distinguishes an empty repository from a missing repository or revision", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Empty" } });
        const appId = (app.body as { id: string }).id;
        const browse = `/api/apps/${appId}/repos/group/browse`;
        const home = yield* call("GET", `${browse}/home`, { session: owner });
        assert.strictEqual(home.status, 200);
        const sha = (home.body as { sha: string | null }).sha;
        assert.isString(sha);
        const top = yield* call("GET", `${browse}/tree?sha=${sha}&path=`, { session: owner });
        assert.deepStrictEqual((top.body as Tree).entries, []);
        assert.strictEqual(
          (yield* call("GET", `${browse}/home?rev=${"a".repeat(40)}`, { session: owner })).status,
          404,
        );
        assert.strictEqual(
          (yield* call("GET", `${browse}/tree?sha=${"a".repeat(40)}&path=`, { session: owner }))
            .status,
          404,
        );
        assert.strictEqual(
          (yield* call("GET", `/api/apps/${appId}/repos/missing/browse/home`, { session: owner }))
            .status,
          404,
        );
      }),
    );
  });
});
