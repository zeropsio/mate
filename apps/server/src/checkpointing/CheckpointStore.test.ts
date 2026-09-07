// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { CheckpointRef, ThreadId, type VcsError } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { describe, expect } from "vite-plus/test";

import { checkpointRefForThreadTurn } from "./Utils.ts";
import { parseTurnDiffFilesFromNumstat } from "./Diffs.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsProjectConfig from "../vcs/VcsProjectConfig.ts";
import { withRepository } from "../zerops/ZeropsWorkspaceAccess.ts";
import * as ServerConfig from "../config.ts";

const ServerConfigLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-checkpoint-store-test-",
});
const VcsProcessTestLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const VcsDriverTestLayer = VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcessTestLayer));
const CheckpointStoreTestLayer = CheckpointStore.layer.pipe(
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(NodeServices.layer),
);
const TestLayer = CheckpointStoreTestLayer.pipe(
  Layer.provideMerge(VcsProcessTestLayer),
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

function makeTmpDir(
  prefix = "checkpoint-store-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeTextFile(
  filePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

function git(
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, VcsError, VcsProcess.VcsProcess> {
  return Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const result = yield* process.run({
      operation: "CheckpointStore.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });
}

function initRepoWithCommit(
  cwd: string,
): Effect.Effect<
  void,
  VcsError | PlatformError.PlatformError,
  VcsProcess.VcsProcess | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    yield* git(cwd, ["init"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(NodePath.join(cwd, "README.md"), "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
  });
}

function buildLargeText(lineCount = 5_000): string {
  return Array.from({ length: lineCount }, (_, index) => `line ${String(index).padStart(5, "0")}`)
    .join("\n")
    .concat("\n");
}

it.layer(TestLayer)("CheckpointStore.layer", (it) => {
  describe("immutable snapshots", () => {
    it.effect("uses the verified remote Git driver without probing local mount configuration", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* git(tmp, ["init"]);
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "source");
        const fs = yield* FileSystem.FileSystem;
        const noMountProbes = FileSystem.FileSystem.of({
          ...fs,
          exists: () => Effect.die("local FUSE configuration probe"),
        });
        const config = yield* VcsProjectConfig.make.pipe(
          Effect.provideService(FileSystem.FileSystem, noMountProbes),
        );
        const registry = yield* VcsDriverRegistry.make.pipe(
          Effect.provideService(VcsProjectConfig.VcsProjectConfig, config),
          Effect.provideService(FileSystem.FileSystem, noMountProbes),
        );
        const store = yield* CheckpointStore.make.pipe(
          Effect.provideService(VcsDriverRegistry.VcsDriverRegistry, registry),
        );
        const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/test/runs/no-fuse/before");
        yield* withRepository(
          {
            host: "app",
            mountPath: tmp,
            remotePath: "/var/www",
            identity: { projectId: "project", serviceId: "service" },
          },
          Effect.gen(function* () {
            expect(yield* store.isGitRepository(tmp)).toBe(true);
            const snapshot = yield* store.captureSnapshot({ cwd: tmp, checkpointRef });
            expect(
              yield* store.resolveSnapshot({ cwd: tmp, checkpointRef, expectedOid: snapshot.oid }),
            ).toBe(snapshot.oid);
            expect(
              yield* store.diffCheckpoints({
                cwd: tmp,
                fromCheckpointRef: checkpointRef,
                toCheckpointRef: checkpointRef,
                ignoreWhitespace: false,
                maxOutputBytes: 512,
              }),
            ).toBe("");
            yield* store.deleteCheckpointRefs({ cwd: tmp, checkpointRefs: [checkpointRef] });
          }),
        );
      }),
    );

    it.effect("converges concurrent captures on one immutable ref without sharing an index", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "working content");
        const index = yield* git(tmp, ["ls-files", "--stage"]);
        const store = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/test/runs/concurrent/before");
        const snapshots = yield* Effect.all(
          [
            store.captureSnapshot({ cwd: tmp, checkpointRef }),
            store.captureSnapshot({ cwd: tmp, checkpointRef }),
          ],
          { concurrency: 2 },
        );
        expect(snapshots[0].oid).toBe(snapshots[1].oid);
        expect(yield* git(tmp, ["rev-parse", checkpointRef])).toBe(snapshots[0].oid);
        expect(yield* git(tmp, ["ls-files", "--stage"])).toBe(index);
        const fs = yield* FileSystem.FileSystem;
        expect(
          (yield* fs.readDirectory(NodePath.join(tmp, ".git"))).filter((name) =>
            name.startsWith("mate-snapshot-"),
          ),
        ).toEqual([]);
      }),
    );

    it.effect("distinguishes newly ignored baseline content from actual deletion", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* git(tmp, ["init"]);
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "source");
        const store = yield* CheckpointStore.CheckpointStore;
        const before = yield* store.captureSnapshot({
          cwd: tmp,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/ignore-change/before"),
        });
        yield* writeTextFile(NodePath.join(tmp, ".gitignore"), "app.txt\n");
        const input = {
          cwd: tmp,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/ignore-change/after"),
          baselineOid: before.oid,
        };
        expect(String(yield* Effect.result(store.captureSnapshot(input)))).toContain(
          "selection rules changed",
        );
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(NodePath.join(tmp, "app.txt"));
        const after = yield* store.captureSnapshot(input);
        expect(yield* git(tmp, ["diff", "--name-status", before.oid, after.oid])).toBe(
          "A\t.gitignore\nD\tapp.txt",
        );
      }),
    );

    it.effect("resolves the recorded object after its protection ref is deleted", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* git(tmp, ["init"]);
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "source");
        const store = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/test/runs/moved/before");
        const before = yield* store.captureSnapshot({ cwd: tmp, checkpointRef });
        yield* git(tmp, ["update-ref", "-d", checkpointRef]);
        expect(yield* store.resolveSnapshot({ cwd: tmp, checkpointRef })).toBeNull();
        expect(
          yield* store.resolveSnapshot({ cwd: tmp, checkpointRef, expectedOid: before.oid }),
        ).toBe(before.oid);
      }),
    );

    it.effect("refuses oversized diff transport instead of returning a truncated patch", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* git(tmp, ["init"]);
        const store = yield* CheckpointStore.CheckpointStore;
        const before = yield* store.captureSnapshot({
          cwd: tmp,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/output/before"),
        });
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), buildLargeText());
        const after = yield* store.captureSnapshot({
          cwd: tmp,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/output/after"),
          baselineOid: before.oid,
        });
        const result = yield* Effect.result(
          store.diffCheckpoints({
            cwd: tmp,
            fromCheckpointRef: CheckpointRef.make(before.oid),
            toCheckpointRef: CheckpointRef.make(after.oid),
            ignoreWhitespace: false,
            maxOutputBytes: 512,
          }),
        );
        expect(result).toMatchObject({ _tag: "Failure" });
        expect(String(result)).toContain("VcsProcessOutputLimitError");
      }),
    );

    it.effect(
      "keeps HEAD, branch and staged deletions while capturing current files with literal names",
      () =>
        Effect.gen(function* () {
          const tmp = yield* makeTmpDir();
          yield* initRepoWithCommit(tmp);
          yield* git(tmp, ["rm", "--cached", "README.md"]);
          const head = yield* git(tmp, ["rev-parse", "HEAD"]);
          const branch = yield* git(tmp, ["symbolic-ref", "HEAD"]);
          const index = yield* git(tmp, ["ls-files", "--stage"]);
          const names = ["-option.txt", "with\nnewline.txt", "literal*[x].txt", "quote'file.txt"];
          for (const name of names) yield* writeTextFile(NodePath.join(tmp, name), name);
          const store = yield* CheckpointStore.CheckpointStore;
          const snapshot = yield* store.captureSnapshot({
            cwd: tmp,
            checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/literal/before"),
          });
          for (const name of names)
            expect(yield* git(tmp, ["show", `${snapshot.oid}:${name}`])).toBe(name);
          expect(yield* git(tmp, ["show", `${snapshot.oid}:README.md`])).toBe("# test");
          expect(yield* git(tmp, ["rev-parse", "HEAD"])).toBe(head);
          expect(yield* git(tmp, ["symbolic-ref", "HEAD"])).toBe(branch);
          expect(yield* git(tmp, ["ls-files", "--stage"])).toBe(index);
          const fs = yield* FileSystem.FileSystem;
          yield* fs.remove(NodePath.join(tmp, "README.md"));
          const after = yield* store.captureSnapshot({
            cwd: tmp,
            checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/literal/after"),
          });
          expect(yield* git(tmp, ["diff", "--name-status", snapshot.oid, after.oid])).toBe(
            "D\tREADME.md",
          );
          expect(
            (yield* fs.readDirectory(NodePath.join(tmp, ".git"))).filter((name) =>
              name.startsWith("mate-snapshot-"),
            ),
          ).toEqual([]);
        }),
    );

    it.effect("respects ignored dependencies without requiring a blanket ignore file", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* git(tmp, ["init"]);
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(NodePath.join(tmp, "node_modules"));
        yield* writeTextFile(NodePath.join(tmp, "node_modules", "dep.js"), "dependency");
        yield* writeTextFile(NodePath.join(tmp, ".gitignore"), "node_modules/\n");
        yield* writeTextFile(NodePath.join(tmp, "app.js"), "app");
        const store = yield* CheckpointStore.CheckpointStore;
        const snapshot = yield* store.captureSnapshot({
          cwd: tmp,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/ignored/before"),
        });
        expect(yield* git(tmp, ["ls-tree", "--name-only", snapshot.oid])).toBe(
          ".gitignore\napp.js",
        );
      }),
    );

    it.effect("captures a dirty shallow detached checkout without fetching or attaching HEAD", () =>
      Effect.gen(function* () {
        const origin = yield* makeTmpDir();
        yield* initRepoWithCommit(origin);
        const tmp = yield* makeTmpDir();
        yield* git(origin, ["clone", "--depth=1", `file://${origin}`, tmp]);
        yield* git(tmp, ["checkout", "--detach"]);
        const head = yield* git(tmp, ["rev-parse", "HEAD"]);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "dirty shallow\n");
        const store = yield* CheckpointStore.CheckpointStore;
        const snapshot = yield* store.captureSnapshot({
          cwd: tmp,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/shallow/before"),
        });
        expect(yield* git(tmp, ["show", `${snapshot.oid}:README.md`])).toBe("dirty shallow");
        expect(yield* git(tmp, ["rev-parse", "--is-shallow-repository"])).toBe("true");
        expect(yield* git(tmp, ["rev-parse", "HEAD"])).toBe(head);
        expect(yield* Effect.result(git(tmp, ["symbolic-ref", "HEAD"]))).toMatchObject({
          _tag: "Failure",
        });
      }),
    );

    for (const [label, policy] of [
      ["file byte", { maxFileBytes: 4 }],
      ["total input byte", { maxTotalBytes: 4 }],
      ["candidate file", { maxPaths: 1 }],
      ["candidate path byte", { maxPathBytes: 4 }],
    ] as const) {
      it.effect(`refuses ${label} overflow before storing content`, () =>
        Effect.gen(function* () {
          const tmp = yield* makeTmpDir();
          yield* initRepoWithCommit(tmp);
          yield* writeTextFile(NodePath.join(tmp, "new.txt"), "new content");
          const store = yield* CheckpointStore.CheckpointStore;
          const objectsBefore = yield* git(tmp, ["count-objects", "-v"]);
          const result = yield* Effect.result(
            store.captureSnapshot({
              cwd: tmp,
              checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/limit/before"),
              policy,
            }),
          );
          expect(String(result)).toContain(label);
          expect(yield* git(tmp, ["count-objects", "-v"])).toBe(objectsBefore);
          const fs = yield* FileSystem.FileSystem;
          expect(
            (yield* fs.readDirectory(NodePath.join(tmp, ".git"))).filter((name) =>
              name.startsWith("mate-snapshot-"),
            ),
          ).toEqual([]);
        }),
      );
    }

    it.effect("refuses configured clean filters without invoking them", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* git(tmp, ["init"]);
        yield* writeTextFile(NodePath.join(tmp, ".gitattributes"), "*.txt filter=unsupported\n");
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "content");
        yield* git(tmp, ["config", "filter.unsupported.clean", "touch filter-was-run"]);
        const store = yield* CheckpointStore.CheckpointStore;
        const result = yield* Effect.result(
          store.captureSnapshot({
            cwd: tmp,
            checkpointRef: CheckpointRef.make("refs/t3/checkpoints/test/runs/filter/before"),
          }),
        );
        expect(String(result)).toContain("unsupported filter");
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.exists(NodePath.join(tmp, "filter-was-run"))).toBe(false);
      }),
    );

    it.effect("validates the complete object closure on retry and resolution", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* git(tmp, ["init"]);
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "content");
        const store = yield* CheckpointStore.CheckpointStore;
        const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/test/runs/closure/before");
        const snapshot = yield* store.captureSnapshot({ cwd: tmp, checkpointRef });
        expect(yield* store.resolveSnapshot({ cwd: tmp, checkpointRef })).toBe(snapshot.oid);
        const blob = yield* git(tmp, ["rev-parse", `${snapshot.oid}:app.txt`]);
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(NodePath.join(tmp, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
        expect(
          String(yield* Effect.result(store.resolveSnapshot({ cwd: tmp, checkpointRef }))),
        ).toContain("objects missing");
        expect(
          String(yield* Effect.result(store.captureSnapshot({ cwd: tmp, checkpointRef }))),
        ).toContain("objects missing");
      }),
    );

    it.effect("captures an unborn dirty index without creating HEAD or changing staging", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* git(tmp, ["init"]);
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "staged\n");
        yield* git(tmp, ["add", "app.txt"]);
        const indexBefore = yield* git(tmp, ["ls-files", "--stage"]);
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "working\n");
        const store = yield* CheckpointStore.CheckpointStore;
        const ref = CheckpointRef.make("refs/t3/checkpoints/test/runs/unborn/before");
        const snapshot = yield* store.captureSnapshot({ cwd: tmp, checkpointRef: ref });
        expect(snapshot.policyVersion).toBe("git-v1");
        expect(yield* git(tmp, ["show", `${snapshot.oid}:app.txt`])).toBe("working");
        expect(yield* git(tmp, ["ls-files", "--stage"])).toBe(indexBefore);
        expect(yield* Effect.result(git(tmp, ["rev-parse", "--verify", "HEAD"]))).toMatchObject({
          _tag: "Failure",
        });
        yield* writeTextFile(NodePath.join(tmp, "app.txt"), "later\n");
        const retry = yield* store.captureSnapshot({ cwd: tmp, checkpointRef: ref });
        expect(retry).toMatchObject({ oid: snapshot.oid, reused: true });
      }),
    );

    for (const tracked of [false, true]) {
      it.effect(
        `refuses ${tracked ? "tracked" : "untracked"} dependencies before snapshot writes`,
        () =>
          Effect.gen(function* () {
            const tmp = yield* makeTmpDir();
            yield* initRepoWithCommit(tmp);
            const fs = yield* FileSystem.FileSystem;
            yield* fs.makeDirectory(NodePath.join(tmp, "node_modules"));
            yield* writeTextFile(NodePath.join(tmp, "node_modules", "dep.js"), "dependency");
            if (tracked) yield* git(tmp, ["add", "node_modules"]);
            const store = yield* CheckpointStore.CheckpointStore;
            const result = yield* Effect.result(
              store.captureSnapshot({
                cwd: tmp,
                checkpointRef: CheckpointRef.make(
                  "refs/t3/checkpoints/test/runs/dependency/before",
                ),
              }),
            );
            expect(result).toMatchObject({ _tag: "Failure" });
            expect(String(result)).toContain("dependency");
            expect(yield* git(tmp, ["for-each-ref", "refs/t3/checkpoints"])).toBe("");
          }),
      );
    }
  });

  describe("isGitRepository", () => {
    it.effect("returns false when no Git repository is detected", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const checkpointStore = yield* CheckpointStore.CheckpointStore;

        expect(yield* checkpointStore.isGitRepository(tmp)).toBe(false);
      }),
    );

    it.effect("returns true when a Git repository is detected", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;

        expect(yield* checkpointStore.isGitRepository(tmp)).toBe(true);
      }),
    );
  });

  describe("diffCheckpoints", () => {
    it.effect("returns full oversized checkpoint diffs without truncation", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(NodePath.join(tmp, "README.md"), buildLargeText());
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(diff).toContain("diff --git");
        expect(diff).not.toContain("[truncated]");
        expect(diff).toContain("+line 04999");
      }),
    );

    it.effect("keeps a/ and b/ patch prefixes when the repository disables them", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* git(tmp, ["config", "diff.noprefix", "true"]);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-noprefix");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# changed\n");
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });

        expect(diff).toContain("diff --git a/README.md b/README.md");
      }),
    );

    it.effect("can hide indentation churn when changes wrap existing lines", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-whitespace");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        const componentPath = NodePath.join(tmp, "Component.tsx");
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      <h1>Title</h1>",
            "      <p>Body</p>",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      {isReady ? (",
            "        <div>",
            "          <h1>Title</h1>",
            "          <p>Body</p>",
            "        </div>",
            "      ) : null}",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const normalDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });
        const whitespaceIgnoredDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(normalDiff).toContain("diff --git");
        expect(normalDiff).toContain("-      <h1>Title</h1>");
        expect(normalDiff).toContain("+          <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).toContain("diff --git");
        expect(whitespaceIgnoredDiff).toContain("+      {isReady ? (");
        expect(whitespaceIgnoredDiff).toContain("+        <div>");
        expect(whitespaceIgnoredDiff).not.toContain("-      <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).not.toContain("+          <h1>Title</h1>");

        for (const ignoreWhitespace of [false, true]) {
          const numstat = yield* checkpointStore.diffCheckpoints({
            cwd: tmp,
            fromCheckpointRef,
            toCheckpointRef,
            ignoreWhitespace,
            format: "numstat",
          });
          expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
            {
              path: "Component.tsx",
              additions: ignoreWhitespace ? 4 : 6,
              deletions: ignoreWhitespace ? 0 : 2,
            },
          ]);
        }
      }),
    );
  });

  describe("checkpoint file summaries", () => {
    it.effect("counts changes whose full patch exceeds the output limit", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("large-checkpoint-summary");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
        const filePath = NodePath.join(tmp, "README.md");
        const lineCount = 20_000;
        yield* writeTextFile(filePath, `${"before".repeat(50)}\n`.repeat(lineCount));
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: fromCheckpointRef });
        yield* writeTextFile(filePath, `${"after".repeat(60)}\n`.repeat(lineCount));
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: toCheckpointRef });

        const numstat = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
          format: "numstat",
        });

        expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
          { path: "README.md", additions: lineCount, deletions: lineCount },
        ]);
        expect(numstat.length).toBeLessThan(100);
      }),
    );

    it.effect("preserves file paths and turn ranges without changing the user index", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* git(tmp, ["config", "diff.renames", "copies"]);
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("checkpoint-summary-paths");
        const baseline = checkpointRefForThreadTurn(threadId, 0);
        const firstTurn = checkpointRefForThreadTurn(threadId, 1);
        const secondTurn = checkpointRefForThreadTurn(threadId, 2);
        const copiedText = Array.from({ length: 20 }, (_, index) => `copy line ${index}\n`).join(
          "",
        );
        const platform = yield* HostProcessPlatform;
        const renamedPath = platform === "win32" ? "renamed café.txt" : "renamed\tcafé\nname.txt";
        const addedPath = platform === "win32" ? "new café.txt" : "new\tfile\n名.txt";
        for (const [path, contents] of Object.entries({
          "copy-source.txt": copiedText,
          "deleted.txt": "delete me\n",
          "rename-old.txt": "before\nkeep one\nkeep two\nkeep three\n",
          "binary.bin": "\0before",
        })) {
          yield* writeTextFile(NodePath.join(tmp, path), contents);
        }
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: baseline });

        yield* fileSystem.rename(
          NodePath.join(tmp, "rename-old.txt"),
          NodePath.join(tmp, renamedPath),
        );
        yield* fileSystem.remove(NodePath.join(tmp, "deleted.txt"));
        for (const [path, contents] of Object.entries({
          "copy-source.txt": `${copiedText}one more\n`,
          "copied.txt": copiedText,
          [renamedPath]: "after\nkeep one\nkeep two\nkeep three\n",
          "binary.bin": "\0after",
          "empty.txt": "",
          [addedPath]: "first\nsecond\n",
        })) {
          yield* writeTextFile(NodePath.join(tmp, path), contents);
        }
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: firstTurn });
        const userIndex = yield* fileSystem.readFile(NodePath.join(tmp, ".git/index"));
        const input = {
          cwd: tmp,
          fromCheckpointRef: baseline,
          toCheckpointRef: firstTurn,
          ignoreWhitespace: false,
          format: "numstat" as const,
        };
        const firstSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints(input),
        );
        const expectedFiles = [
          { path: "binary.bin", additions: 0, deletions: 0 },
          { path: "copied.txt", additions: 0, deletions: 0 },
          { path: "copy-source.txt", additions: 1, deletions: 0 },
          { path: "deleted.txt", additions: 0, deletions: 1 },
          { path: "empty.txt", additions: 0, deletions: 0 },
          { path: addedPath, additions: 2, deletions: 0 },
          { path: renamedPath, additions: 1, deletions: 1 },
        ].toSorted((left, right) => left.path.localeCompare(right.path));
        expect(firstSummary).toEqual(expectedFiles);

        yield* fileSystem.remove(NodePath.join(tmp, "empty.txt"));
        yield* writeTextFile(NodePath.join(tmp, "copy-source.txt"), "replacement\n");
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: secondTurn });
        const secondSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints({
            ...input,
            fromCheckpointRef: firstTurn,
            toCheckpointRef: secondTurn,
          }),
        );
        expect(secondSummary).toEqual([
          { path: "copy-source.txt", additions: 1, deletions: 21 },
          { path: "empty.txt", additions: 0, deletions: 0 },
        ]);

        const inclusiveSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints({ ...input, toCheckpointRef: secondTurn }),
        );
        expect(inclusiveSummary).toEqual(
          expectedFiles
            .filter((file) => file.path !== "empty.txt")
            .map((file) =>
              file.path === "copy-source.txt" ? { ...file, additions: 1, deletions: 20 } : file,
            ),
        );
        expect(
          yield* checkpointStore.diffCheckpoints({ ...input, toCheckpointRef: baseline }),
        ).toBe("");
        expect(yield* fileSystem.readFile(NodePath.join(tmp, ".git/index"))).toEqual(userIndex);
      }),
    );

    it.effect("uses HEAD for a missing baseline only when requested", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("checkpoint-summary-fallback");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "changed\n");
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: toCheckpointRef });
        const input = {
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
          format: "numstat" as const,
        };

        const error = yield* Effect.flip(checkpointStore.diffCheckpoints(input));
        expect(error._tag).toBe("VcsProcessExitError");
        const numstat = yield* checkpointStore.diffCheckpoints({
          ...input,
          fallbackFromToHead: true,
        });
        expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
          { path: "README.md", additions: 1, deletions: 1 },
        ]);
      }),
    );
  });
});
