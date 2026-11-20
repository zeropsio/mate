import { assert, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import * as ServerConfig from "../config.ts";
import * as ReviewService from "../review/ReviewService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

// One scoped directory per case holds the workspace root, the outside directory and the server's
// base directory as siblings, so a path that escapes the root still lands inside it.
const scopedDisk = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scoped = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workspace-unit-" });
  const root = path.join(scoped, "root");
  const outside = path.join(scoped, "outside");
  const base = path.join(scoped, "base");
  yield* fs.makeDirectory(root);
  yield* fs.makeDirectory(outside);
  yield* fs.makeDirectory(base);
  return { scoped, root, outside, base };
});

// The file index is an in-process service: refresh records its root, nothing else may run.
const workspaceFileSystemLayer = (root: string, base: string, refreshed: Array<string>) =>
  WorkspaceFileSystem.layer.pipe(
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(
      Layer.succeed(WorkspaceEntries.WorkspaceEntries, {
        browse: () => Effect.die("unused"),
        list: () => Effect.die("unused"),
        search: () => Effect.die("unused"),
        searchContents: () => Effect.die("unused"),
        refresh: (cwd) =>
          Effect.sync(() => {
            refreshed.push(cwd);
          }),
      }),
    ),
    Layer.provide(ServerConfig.layerTest(root, base)),
  );

const failureTag = <A, E extends { readonly _tag: string }>(result: Result.Result<A, E>) =>
  Result.isFailure(result) ? result.failure._tag : "Success";

// witness: apps/server/src/workspace/WorkspacePaths.ts | relativeToRoot.startsWith("../") || → relativeToRoot.startsWith("../../") ||
it.effect(
  "WS1: A workspace file path that leaves the workspace root is refused, and a write to it creates nothing outside the root",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { scoped, root, base } = yield* scopedDisk;
      const refreshed: Array<string> = [];

      const resolved = yield* Effect.result(
        Effect.flatMap(WorkspacePaths.WorkspacePaths, (paths) =>
          paths.resolveRelativePathWithinRoot({
            workspaceRoot: root,
            relativePath: "../escape.md",
          }),
        ),
      ).pipe(
        Effect.provide(
          WorkspacePaths.layer.pipe(Layer.provide(ServerConfig.layerTest(root, base))),
        ),
      );
      expect(failureTag(resolved)).toBe("WorkspacePathOutsideRootError");

      const written = yield* Effect.result(
        Effect.flatMap(WorkspaceFileSystem.WorkspaceFileSystem, (files) =>
          files.writeFile({ cwd: root, relativePath: "../escape.md", contents: "# nope\n" }),
        ),
      ).pipe(Effect.provide(workspaceFileSystemLayer(root, base, refreshed)));
      expect(failureTag(written)).toBe("WorkspacePathOutsideRootError");
      expect(yield* fs.exists(path.join(scoped, "escape.md"))).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/workspace/WorkspaceFileSystem.ts | relativeRealPath.startsWith(`..${path.sep}`) || → relativeRealPath.startsWith(`..${path.sep}..`) ||
it.effect(
  "WS2: A workspace file read through a symlink that resolves outside the root is refused",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, outside, base } = yield* scopedDisk;
      yield* fs.writeFileString(path.join(outside, "secret.txt"), "outside\n");
      yield* fs.symlink(path.join(outside, "secret.txt"), path.join(root, "linked-secret.txt"));

      const read = yield* Effect.result(
        Effect.flatMap(WorkspaceFileSystem.WorkspaceFileSystem, (files) =>
          files.readFile({ cwd: root, relativePath: "linked-secret.txt" }),
        ),
      ).pipe(Effect.provide(workspaceFileSystemLayer(root, base, [])));
      expect(failureTag(read)).toBe("WorkspaceFilePathEscapeError");
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/workspace/WorkspaceFileSystem.ts | if (fileBytes.includes(0)) { → if (fileBytes.includes(255)) {
it.effect(
  "WS3: A workspace file holding a NUL byte is refused as binary, and its contents never travel in the error",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, base } = yield* scopedDisk;
      yield* fs.writeFile(path.join(root, "asset.bin"), Uint8Array.from([0x61, 0, 0x62]));

      const read = yield* Effect.result(
        Effect.flatMap(WorkspaceFileSystem.WorkspaceFileSystem, (files) =>
          files.readFile({ cwd: root, relativePath: "asset.bin" }),
        ),
      ).pipe(Effect.provide(workspaceFileSystemLayer(root, base, [])));
      expect(failureTag(read)).toBe("WorkspaceBinaryFileError");
      assert(Result.isFailure(read));
      expect("contents" in read.failure).toBe(false);
      expect("cause" in read.failure).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/workspace/WorkspaceFileSystem.ts | yield* workspaceEntries.refresh(input.cwd); → yield* Effect.void;
it.effect(
  "WS4: A write inside the workspace lands at its relative path, creating missing folders, and refreshes that root's file index",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, base } = yield* scopedDisk;
      const refreshed: Array<string> = [];

      const written = yield* Effect.flatMap(WorkspaceFileSystem.WorkspaceFileSystem, (files) =>
        files.writeFile({ cwd: root, relativePath: "plans/effect-rpc.md", contents: "# Plan\n" }),
      ).pipe(Effect.provide(workspaceFileSystemLayer(root, base, refreshed)));

      expect(written).toEqual({ relativePath: "plans/effect-rpc.md" });
      expect(yield* fs.readFileString(path.join(root, "plans/effect-rpc.md"))).toBe("# Plan\n");
      expect(refreshed).toEqual([root]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/review/ReviewService.ts | canonicalizePath(config.cwd), → canonicalizePath(path.dirname(config.cwd)),
it.effect(
  "WS5: Review's diff preview and diff file contents refuse a working directory outside the workspace and worktree roots before any repository detection, and serve one inside",
  () =>
    Effect.gen(function* () {
      const { root, outside, base } = yield* scopedDisk;
      const detectCalls: Array<{ readonly cwd: string }> = [];
      const reviewLayer = ReviewService.layer.pipe(
        Layer.provide(
          Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
            get: () => Effect.die("unexpected VCS registry get"),
            resolve: () => Effect.die("unexpected VCS registry resolve"),
            detect: (request) =>
              Effect.sync(() => {
                detectCalls.push({ cwd: request.cwd });
                return null;
              }),
          }),
        ),
        Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
        Layer.provide(ServerConfig.layerTest(root, base)),
      );

      const preview = yield* Effect.result(
        Effect.flatMap(ReviewService.ReviewService, (review) =>
          review.getDiffPreview({ cwd: outside }),
        ),
      ).pipe(Effect.provide(reviewLayer));
      expect(failureTag(preview)).toBe("VcsRepositoryDetectionError");
      assert(Result.isFailure(preview));
      assert(preview.failure._tag === "VcsRepositoryDetectionError");
      expect(preview.failure.operation).toBe("ReviewService.getDiffPreview");

      const contents = yield* Effect.result(
        Effect.flatMap(ReviewService.ReviewService, (review) =>
          review.getDiffFileContents({
            cwd: outside,
            sourceKind: "working-tree",
            changeType: "change",
            baseRef: "HEAD",
            headRef: null,
            oldPath: "file.ts",
            newPath: "file.ts",
          }),
        ),
      ).pipe(Effect.provide(reviewLayer));
      expect(failureTag(contents)).toBe("VcsRepositoryDetectionError");
      assert(Result.isFailure(contents));
      assert(contents.failure._tag === "VcsRepositoryDetectionError");
      expect(contents.failure.operation).toBe("ReviewService.getDiffFileContents");
      expect(detectCalls).toEqual([]);

      const inside = yield* Effect.flatMap(ReviewService.ReviewService, (review) =>
        review.getDiffPreview({ cwd: root }),
      ).pipe(Effect.provide(reviewLayer));
      expect(inside.cwd).toBe(root);
      expect(inside.sources).toEqual([]);
      expect(detectCalls).toEqual([{ cwd: root }]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/workspace/WorkspacePaths.ts | if (workspaceStat.type !== "Directory") { → if (workspaceStat.type === "SymbolicLink") {
it.effect(
  "WS6: A workspace root must be an existing directory: a missing one is refused unless creation is asked for, and a file is refused",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, base } = yield* scopedDisk;
      yield* fs.writeFileString(path.join(root, "README.md"), "# hi\n");
      const normalize = (workspaceRoot: string, options?: { readonly createIfMissing?: boolean }) =>
        Effect.result(
          Effect.flatMap(WorkspacePaths.WorkspacePaths, (paths) =>
            paths.normalizeWorkspaceRoot(workspaceRoot, options),
          ),
        ).pipe(
          Effect.provide(
            WorkspacePaths.layer.pipe(Layer.provide(ServerConfig.layerTest(root, base))),
          ),
        );

      expect(failureTag(yield* normalize(path.join(root, "missing")))).toBe(
        "WorkspaceRootNotExistsError",
      );

      const missingPath = path.join(root, "nested", "new-project");
      const created = yield* normalize(missingPath, { createIfMissing: true });
      expect(created).toEqual(Result.succeed(missingPath));
      expect((yield* fs.stat(missingPath)).type).toBe("Directory");

      expect(failureTag(yield* normalize(path.join(root, "README.md")))).toBe(
        "WorkspaceRootNotDirectoryError",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);
