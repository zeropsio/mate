// @effect-diagnostics nodeBuiltinImport:off -- the archive is unpacked by the system's own tools.
import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sessionFor, startCore, untilHealth } from "../../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../../test/harness/tempPostgres.ts";
import { BrowseBusy, BrowseHeavy, browseHeavyLayer } from "./heavy.ts";

const author = { name: "Core", email: "core@example.test" };

/** A commit beside `sha` holding `bytes` more, written past HQ's own write limits. */
const commitBeside = (dir: string, sha: string, bytes: Uint8Array) => {
  const git = (args: ReadonlyArray<string>, input?: string | Uint8Array) =>
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
  const blob = git(["hash-object", "-w", "--stdin"], bytes);
  const tree = git(["mktree"], `${git(["ls-tree", sha])}\n100644 blob ${blob}\tnoise.bin\n`);
  return git(["commit-tree", tree, "-p", sha, "-m", "Noise"]);
};

describe("Git browser archive on HQ", () => {
  it.effect("An archive runs only while its person runs no other heavy read", () =>
    Effect.gen(function* () {
      const heavy = yield* BrowseHeavy;
      const give = yield* heavy.hold("ann", 1);
      assert.deepStrictEqual(
        yield* Effect.flip(heavy.hold("ann", 1)),
        new BrowseBusy({ limit: "person" }),
      );
      // A search beside it still runs: one person runs two heavy reads at once.
      assert.strictEqual(yield* heavy.run("ann", Effect.succeed("read")), "read");
      const other = yield* heavy.hold("bob", 1);
      give();
      give();
      other();
      const again = yield* heavy.hold("ann", 1);
      again();
      // Released twice, it gave back one: HQ still takes four.
      const four = yield* Effect.forEach(["a", "b", "c", "d"], (userId) => heavy.hold(userId, 1));
      assert.deepStrictEqual(
        yield* Effect.flip(heavy.hold("e", 1)),
        new BrowseBusy({ limit: "hq" }),
      );
      for (const give of four) give();
    }).pipe(Effect.provide(browseHeavyLayer)),
  );

  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("A person who sees the application downloads a commit's archive, one at a time", () =>
      Effect.gen(function* () {
        const { call, gitHost, gitRoot, origin } = yield* startCore(true, {
          viewTtl: Duration.zero,
        });
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const outsider = yield* sessionFor(call, "door-dev");
        const made = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
        const appId = (made.body as { id: string }).id;
        const git = yield* gitHost.opened(Duration.seconds(3));
        const main = (yield* git.branches({ appId, id: "group" })).items.find(
          (branch) => branch.ref === "refs/heads/main",
        );
        const written = yield* git.commitFiles({ appId, id: "group" }, "refs/heads/main", {
          files: { "src/tea.ts": "export const tea = 1;\n" },
          expectedHead: main?.sha ?? null,
          message: "Tea",
          author,
        });
        if (!("sha" in written)) throw new Error(written.kind);
        const sha = written.sha;
        const path = (format: string, at = sha) =>
          `/api/apps/${appId}/repos/group/browse/archive?sha=${at}&format=${format}`;
        assert.strictEqual((yield* call("GET", path("zip"), { session: outsider })).status, 403);
        const zip = yield* call("GET", path("zip"), { session: owner });
        assert.strictEqual(zip.status, 200);
        assert.strictEqual(zip.headers.get("content-type"), "application/zip");
        assert.strictEqual(
          zip.headers.get("content-disposition"),
          `attachment; filename*=UTF-8''group-${sha.slice(0, 7)}.zip`,
        );
        assert.strictEqual(zip.headers.get("cache-control"), "no-store");
        const listed = yield* Effect.promise(async () => {
          const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hq-archive-"));
          try {
            await NodeFSP.writeFile(NodePath.join(dir, "a.zip"), zip.bytes);
            return await new Promise<string>((resolve, reject) =>
              NodeChildProcess.execFile("unzip", ["-Z1", "a.zip"], { cwd: dir }, (error, out) =>
                error ? reject(error) : resolve(out),
              ),
            );
          } finally {
            await NodeFSP.rm(dir, { recursive: true, force: true });
          }
        });
        expect(listed.trim().split("\n")).toContain("src/tea.ts");
        const missing = yield* call("GET", path("zip", "f".repeat(40)), { session: owner });
        assert.strictEqual(missing.status, 404);
        assert.deepStrictEqual(missing.body, {
          code: "commit_not_found",
          reason: "commit_not_found",
        });
        assert.strictEqual((yield* call("GET", path("rar"), { session: owner })).status, 400);
        // An archive still streaming holds the person's one: one larger than what the
        // connection buffers, read by nobody.
        const large = commitBeside(
          NodePath.join(gitRoot, appId, "group.git"),
          sha,
          NodeCrypto.randomBytes(32 * 1024 * 1024),
        );
        const held = new AbortController();
        const streaming = yield* Effect.promise(() =>
          fetch(`${origin}${path("tar.gz", large)}`, {
            headers: { authorization: `Bearer ${owner}` },
            signal: held.signal,
          }),
        );
        assert.strictEqual(streaming.status, 200);
        assert.strictEqual(streaming.headers.get("content-type"), "application/gzip");
        const busy = yield* call("GET", path("zip"), { session: owner });
        assert.strictEqual(busy.status, 503);
        held.abort();
      }),
    );
  });
});
