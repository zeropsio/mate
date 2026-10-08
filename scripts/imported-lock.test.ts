import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  checkImportedLock,
  diffOidMaps,
  formatOidMismatchLine,
  readImportedLock,
  resolveGitRevision,
  resolveTreeOids,
  writeImportedLock,
  writeImportedLockFile,
} from "./imported-lock.ts";

const TREE_OID_PATTERN = /^[0-9a-f]{40}$/;

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

// Runs real git against the fixture repo. Deliberately unmocked: the subject
// under test IS git's tree-OID behavior, so a mocked spawner would only prove
// the mock, not the tool.
const runGit = Effect.fn("test.runGit")(function* (cwd: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make("git", args, { cwd }));
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout),
      collectStreamAsString(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  );
  if (exitCode !== 0) {
    return yield* Effect.die(
      new Error(`test fixture git ${args.join(" ")} exited ${exitCode}: ${stderr || stdout}`),
    );
  }
  return stdout;
});

// Builds a real git repo under a scoped temp dir with one committed file per
// entry in `files` (path -> content), using per-invocation `-c` identity so
// no global git config is touched.
const makeFixtureRepo = Effect.fn("test.makeFixtureRepo")(function* (
  files: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoDir = yield* fs.makeTempDirectoryScoped({ prefix: "imported-lock-fixture-" });

  yield* runGit(repoDir, ["init", "-q", "-b", "main"]);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repoDir, relativePath);
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(filePath, content);
  }
  yield* runGit(repoDir, ["add", "-A"]);
  yield* runGit(repoDir, [
    "-c",
    "user.name=imported-lock-test",
    "-c",
    "user.email=imported-lock-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "-m",
    "fixture commit",
  ]);

  return { repoDir };
});

const commitChange = Effect.fn("test.commitChange")(function* (
  repoDir: string,
  relativePath: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(repoDir, relativePath), content);
  yield* runGit(repoDir, ["add", "-A"]);
  yield* runGit(repoDir, [
    "-c",
    "user.name=imported-lock-test",
    "-c",
    "user.email=imported-lock-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "-m",
    "fixture change",
  ]);
});

it.layer(NodeServices.layer)("imported-lock: pure comparison", (it) => {
  it("reports no mismatches for identical OID maps", () => {
    assert.deepStrictEqual(diffOidMaps({ a: "aaa", b: "bbb" }, { a: "aaa", b: "bbb" }), []);
  });

  it("names the drifted path with expected and actual OIDs", () => {
    assert.deepStrictEqual(diffOidMaps({ a: "aaa", b: "bbb" }, { a: "aaa", b: "ccc" }), [
      { path: "b", expected: "bbb", actual: "ccc" },
    ]);
  });

  it("reports every drifted path, in expected-map key order", () => {
    assert.deepStrictEqual(
      diffOidMaps({ a: "aaa", b: "bbb", c: "ccc" }, { a: "xxx", b: "bbb", c: "yyy" }),
      [
        { path: "a", expected: "aaa", actual: "xxx" },
        { path: "c", expected: "ccc", actual: "yyy" },
      ],
    );
  });

  it("formats one line per mismatch naming the path and both OIDs", () => {
    assert.equal(
      formatOidMismatchLine({ path: "packages/effect-acp", expected: "aaa", actual: "bbb" }),
      "packages/effect-acp: expected aaa, got bbb",
    );
  });
});

it.layer(NodeServices.layer)("imported-lock: git tree OIDs", (it) => {
  it.effect("resolves the same tree OID for identical content in different repos", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* makeFixtureRepo({ "pkg/a.ts": "export const a = 1;\n" });
        const second = yield* makeFixtureRepo({ "pkg/a.ts": "export const a = 1;\n" });

        const firstOid = yield* resolveGitRevision(first.repoDir, "HEAD:pkg");
        const secondOid = yield* resolveGitRevision(second.repoDir, "HEAD:pkg");

        assert.match(firstOid, TREE_OID_PATTERN);
        assert.equal(firstOid, secondOid);
      }),
    ),
  );

  it.effect("resolves a different tree OID once content differs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* makeFixtureRepo({ "pkg/a.ts": "export const a = 1;\n" });
        const second = yield* makeFixtureRepo({ "pkg/a.ts": "export const a = 2;\n" });

        const firstOid = yield* resolveGitRevision(first.repoDir, "HEAD:pkg");
        const secondOid = yield* resolveGitRevision(second.repoDir, "HEAD:pkg");

        assert.notEqual(firstOid, secondOid);
      }),
    ),
  );

  it.effect("fails with the revision and a non-zero exit for an unresolvable path", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixtureRepo({ "pkg/a.ts": "export const a = 1;\n" });

        const error = yield* resolveGitRevision(fixture.repoDir, "HEAD:does-not-exist").pipe(
          Effect.flip,
        );

        if (error._tag !== "GitRevisionExitError") {
          assert.fail(`Unexpected error: ${error._tag}`);
        }
        assert.equal(error.revision, "HEAD:does-not-exist");
        assert.equal(error.cwd, fixture.repoDir);
        assert.notEqual(error.exitCode, 0);
      }),
    ),
  );

  it.effect("resolves every requested path's OID in one call", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixtureRepo({
          "pkg-a/index.ts": "export const a = 1;\n",
          "pkg-b/index.ts": "export const b = 2;\n",
        });

        const oids = yield* resolveTreeOids(fixture.repoDir, "HEAD", ["pkg-a", "pkg-b"]);

        assert.match(oids["pkg-a"]!, TREE_OID_PATTERN);
        assert.match(oids["pkg-b"]!, TREE_OID_PATTERN);
        assert.notEqual(oids["pkg-a"], oids["pkg-b"]);
      }),
    ),
  );
});

it.layer(NodeServices.layer)("imported-lock: checkImportedLock", (it) => {
  it.effect("reports no drift when the lock matches HEAD", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fixture = yield* makeFixtureRepo({
          "pkg-a/index.ts": "export const a = 1;\n",
          "pkg-b/index.ts": "export const b = 2;\n",
        });
        const oids = yield* resolveTreeOids(fixture.repoDir, "HEAD", ["pkg-a", "pkg-b"]);
        const lockPath = path.join(fixture.repoDir, "imported.lock");
        yield* writeImportedLockFile(lockPath, { upstream: "deadbeef", paths: oids });

        const mismatches = yield* checkImportedLock(fixture.repoDir, lockPath);

        assert.deepStrictEqual(mismatches, []);
      }),
    ),
  );

  it.effect("names exactly the path whose content drifted from the lock", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fixture = yield* makeFixtureRepo({
          "pkg-a/index.ts": "export const a = 1;\n",
          "pkg-b/index.ts": "export const b = 2;\n",
        });
        const originalOids = yield* resolveTreeOids(fixture.repoDir, "HEAD", ["pkg-a", "pkg-b"]);
        const lockPath = path.join(fixture.repoDir, "imported.lock");
        yield* writeImportedLockFile(lockPath, { upstream: "deadbeef", paths: originalOids });

        yield* commitChange(fixture.repoDir, "pkg-a/index.ts", "export const a = 999;\n");
        const driftedOids = yield* resolveTreeOids(fixture.repoDir, "HEAD", ["pkg-a", "pkg-b"]);

        const mismatches = yield* checkImportedLock(fixture.repoDir, lockPath);

        assert.deepStrictEqual(mismatches, [
          {
            path: "pkg-a",
            expected: originalOids["pkg-a"]!,
            actual: driftedOids["pkg-a"]!,
          },
        ]);
      }),
    ),
  );

  it.effect("fails with a decode error for a lock file that is not valid JSON", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeFixtureRepo({ "pkg-a/index.ts": "export const a = 1;\n" });
        const lockPath = path.join(fixture.repoDir, "imported.lock");
        yield* fs.writeFileString(lockPath, "{ not json");

        const error = yield* checkImportedLock(fixture.repoDir, lockPath).pipe(Effect.flip);

        if (error._tag !== "ImportedLockFileError") {
          assert.fail(`Unexpected error: ${error._tag}`);
        }
        assert.equal(error.operation, "decode");
        assert.equal(error.filePath, lockPath);
      }),
    ),
  );

  it.effect("fails with a read error for a missing lock file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fixture = yield* makeFixtureRepo({ "pkg-a/index.ts": "export const a = 1;\n" });
        const lockPath = path.join(fixture.repoDir, "does-not-exist.lock");

        const error = yield* readImportedLock(lockPath).pipe(Effect.flip);

        if (error._tag !== "ImportedLockFileError") {
          assert.fail(`Unexpected error: ${error._tag}`);
        }
        assert.equal(error.operation, "read");
      }),
    ),
  );
});

// The Import zone may carry one recorded transform over upstream's tree until the next
// re-import (2026-10-07: Effect 4.0.1's import paths). The check reproduces it, so any edit
// beyond the transform still fails, even one the lock's own tree OIDs were updated to hide.
it.layer(NodeServices.layer)("imported-lock: a transformed import", (it) => {
  // Built from parts, so the codemod's own run leaves this upstream fixture as it is.
  const upstreamSource = `import { HttpClient } from "${["effect", "unstable", "http"].join("/")}";\nexport const a = 1;\n`;
  const transformedSource = 'import { HttpClient } from "effect/http";\nexport const a = 1;\n';

  const lockFor = Effect.fn("test.lockFor")(function* (repoDir: string) {
    const upstream = yield* makeFixtureRepo({ "pkg-a/index.ts": upstreamSource });
    const upstreamOids = yield* resolveTreeOids(upstream.repoDir, "HEAD", ["pkg-a"]);
    const headOids = yield* resolveTreeOids(repoDir, "HEAD", ["pkg-a"]);
    return {
      upstream: "deadbeef",
      paths: headOids,
      transform: {
        name: "effect-401" as const,
        script: "scripts/effect-401-codemod.ts --import-zone",
        since: "2026-10-07",
        until: "the next re-import",
        upstreamPaths: upstreamOids,
      },
    };
  });

  it.effect("passes when the path is exactly the transform of upstream's tree", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fixture = yield* makeFixtureRepo({ "pkg-a/index.ts": transformedSource });
        const lockPath = path.join(fixture.repoDir, "imported.lock");
        yield* writeImportedLockFile(lockPath, yield* lockFor(fixture.repoDir));

        assert.deepStrictEqual(yield* checkImportedLock(fixture.repoDir, lockPath), []);
      }),
    ),
  );

  it.effect("fails on an edit beyond the transform, even one the lock's tree OIDs record", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fixture = yield* makeFixtureRepo({
          "pkg-a/index.ts": `${transformedSource}export const b = 2;\n`,
        });
        const lockPath = path.join(fixture.repoDir, "imported.lock");
        const lock = yield* lockFor(fixture.repoDir);
        yield* writeImportedLockFile(lockPath, lock);

        const mismatches = yield* checkImportedLock(fixture.repoDir, lockPath);

        assert.deepStrictEqual(
          mismatches.map((mismatch) => [mismatch.path, mismatch.expected]),
          [["pkg-a", lock.transform.upstreamPaths["pkg-a"]!]],
        );
      }),
    ),
  );

  it.effect("fails when a file was left untransformed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fixture = yield* makeFixtureRepo({ "pkg-a/index.ts": upstreamSource });
        const lockPath = path.join(fixture.repoDir, "imported.lock");
        yield* writeImportedLockFile(lockPath, yield* lockFor(fixture.repoDir));

        const mismatches = yield* checkImportedLock(fixture.repoDir, lockPath);

        assert.deepStrictEqual(
          mismatches.map((mismatch) => mismatch.path),
          ["pkg-a"],
        );
      }),
    ),
  );

  it.effect("a re-import's write ends the transform", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixtureRepo({ "pkg-a/index.ts": upstreamSource });
        yield* runGit(fixture.repoDir, ["tag", "upstream-fixture"]);

        const lock = yield* writeImportedLock(fixture.repoDir, "upstream-fixture", ["pkg-a"]);

        assert.isFalse("transform" in lock);
      }),
    ),
  );
});

it.layer(NodeServices.layer)("imported-lock: writeImportedLock", (it) => {
  it.effect("regenerates the lock from the upstream ref when HEAD matches it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixtureRepo({
          "pkg-a/index.ts": "export const a = 1;\n",
          "pkg-b/index.ts": "export const b = 2;\n",
        });
        yield* runGit(fixture.repoDir, ["tag", "upstream-fixture"]);
        const expectedUpstreamSha = yield* resolveGitRevision(fixture.repoDir, "upstream-fixture");
        const expectedOids = yield* resolveTreeOids(fixture.repoDir, "HEAD", ["pkg-a", "pkg-b"]);

        const lock = yield* writeImportedLock(fixture.repoDir, "upstream-fixture", [
          "pkg-a",
          "pkg-b",
        ]);

        assert.equal(lock.upstream, expectedUpstreamSha);
        assert.deepStrictEqual(lock.paths, expectedOids);
      }),
    ),
  );

  it.effect("records the commit an annotated tag points at, not the tag object itself", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixtureRepo({ "pkg-a/index.ts": "export const a = 1;\n" });
        yield* runGit(fixture.repoDir, [
          "-c",
          "user.name=imported-lock-test",
          "-c",
          "user.email=imported-lock-test@example.invalid",
          "tag",
          "-a",
          "upstream-fixture",
          "-m",
          "annotated fixture tag",
        ]);
        const tagObjectSha = yield* resolveGitRevision(fixture.repoDir, "upstream-fixture");
        const commitSha = yield* resolveGitRevision(fixture.repoDir, "HEAD");
        // Sanity: an annotated tag's ref points at a tag object, not the commit
        // directly — if these were equal (a lightweight tag), the assertion
        // below would pass whether or not writeImportedLock peels to the
        // commit, and the fix this test exists for would go unproven.
        assert.notEqual(tagObjectSha, commitSha);

        const lock = yield* writeImportedLock(fixture.repoDir, "upstream-fixture", ["pkg-a"]);

        assert.equal(lock.upstream, commitSha);
      }),
    ),
  );

  it.effect("rejects a HEAD that has drifted from the upstream ref", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeFixtureRepo({
          "pkg-a/index.ts": "export const a = 1;\n",
          "pkg-b/index.ts": "export const b = 2;\n",
        });
        yield* runGit(fixture.repoDir, ["tag", "upstream-fixture"]);
        yield* commitChange(fixture.repoDir, "pkg-a/index.ts", "export const a = 999;\n");

        const error = yield* writeImportedLock(fixture.repoDir, "upstream-fixture", [
          "pkg-a",
          "pkg-b",
        ]).pipe(Effect.flip);

        if (error._tag !== "ImportedLockNotByteIdenticalError") {
          assert.fail(`Unexpected error: ${error._tag}`);
        }
        assert.equal(error.upstreamRef, "upstream-fixture");
        assert.deepStrictEqual(
          error.mismatches.map((mismatch) => mismatch.path),
          ["pkg-a"],
        );
      }),
    ),
  );
});

it.layer(NodeServices.layer)("imported-lock: file round-trip", (it) => {
  it.effect("reads back exactly what it wrote", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "imported-lock-roundtrip-" });
        const lockPath = path.join(tempDir, "imported.lock");
        const lock = {
          upstream: "db36862c71ee4602601ab4ddd815a7cc7d736725",
          paths: {
            "packages/effect-codex-app-server": "b6962682557984f0d7495e73e30cf8e484c72d98",
            "packages/effect-acp": "b3fbe1643622e47323a8e0eb5717ef2e405701f2",
          },
        };

        yield* writeImportedLockFile(lockPath, lock);
        const readBack = yield* readImportedLock(lockPath);

        assert.deepStrictEqual(readBack, lock);
      }),
    ),
  );
});
