import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpRouter } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { assetRouteLayer } from "../http.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { issueAssetUrl } from "./AssetAccess.ts";
import * as AssetSigningKey from "./AssetSigningKey.ts";
import {
  retainedMediaDirectory,
  RetainedMediaSpace,
  TemporaryMediaRoots,
} from "./RetainedMedia.ts";

const serverLayer = (baseDir: string, workspace: string) => {
  const config = ServerConfig.layerTest(workspace, baseDir);
  return Layer.mergeAll(
    config,
    WorkspacePaths.layer,
    ProjectFaviconResolver.layer.pipe(
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(T3ProjectFileLoader.layer),
    ),
    AssetSigningKey.layer.pipe(Layer.provide(ServerSecretStore.layer), Layer.provide(config)),
  ).pipe(Layer.provideMerge(NodeServices.layer));
};

describe("persistent conversation assets", () => {
  it.effect.each([
    { name: "free space below the floor", available: 50n, bytes: 10 },
    { name: "an incoming copy would consume the reserve", available: 120n, bytes: 30 },
    { name: "a copy cannot fit without consuming the reserve", available: 1000n, bytes: 901 },
  ])("declines a new retained copy when $name and nothing can be evicted", ({ available, bytes }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-full-" });
      const source = path.join(baseDir, "screenshot.png");
      yield* fs.writeFileString(source, "x".repeat(bytes));
      yield* Effect.gen(function* () {
        const failure = yield* issueAssetUrl({
          resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: source },
        }).pipe(Effect.flip);
        expect(failure._tag).toBe("AssetWorkspaceAssetNotFoundError");
        expect(yield* fs.readDirectory(yield* retainedMediaDirectory)).toEqual([]);
        expect(yield* fs.readFileString(source)).toBe("x".repeat(bytes));
      }).pipe(
        Effect.provideService(RetainedMediaSpace, () =>
          Effect.succeed({ total: 1000n, available }),
        ),
        Effect.provide(serverLayer(baseDir, baseDir)),
        Effect.scoped,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("does not publish a copy when eviction cannot restore the free-space floor", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-unreclaimed-" });
      let available = 500n;
      const input = {
        resource: {
          _tag: "media-file" as const,
          threadId: ThreadId.make("thread-1"),
          path: path.join(baseDir, "screenshot.png"),
        },
      };
      yield* fs.writeFileString(input.resource.path, "image");
      yield* Effect.gen(function* () {
        yield* Layer.build(HttpRouter.serve(assetRouteLayer));
        const previous = yield* issueAssetUrl(input);
        available = 50n;
        const nextInput = {
          resource: { ...input.resource, path: path.join(baseDir, "next.png") },
        };
        yield* fs.writeFileString(nextInput.resource.path, "next image");
        // The probe stays low, as when open descriptors or other writers use the reclaimed space.
        expect((yield* issueAssetUrl(nextInput).pipe(Effect.flip))._tag).toBe(
          "AssetWorkspaceAssetNotFoundError",
        );
        expect((yield* HttpClient.get(previous.relativeUrl)).status).toBe(404);
        const assetsDir = yield* retainedMediaDirectory;
        expect(yield* fs.readDirectory(path.join(assetsDir, "objects"))).toEqual([]);
        expect(yield* fs.readDirectory(path.join(assetsDir, "references"))).toHaveLength(1);
        expect(
          (yield* fs.readDirectory(assetsDir)).some((name) => name.startsWith(".pending-")),
        ).toBe(false);
      }).pipe(
        Effect.provideService(RetainedMediaSpace, () =>
          Effect.sync(() => ({ total: 1000n, available })),
        ),
        Effect.provide(Layer.mergeAll(serverLayer(baseDir, baseDir), NodeHttpServer.layerTest)),
        Effect.scoped,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each([10_000n, 20_000n])(
    "evicts least-recently-served media across restart using a fraction of a %s-byte volume",
    (total) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-pressure-" });
        let available = total / 5n;
        const probe = () => Effect.sync(() => ({ total, available }));
        const releasedPerObject = (total * 12n) / 1000n;
        const inputs = ["a", "b", "c", "d"].map((name) => ({
          resource: {
            _tag: "media-file" as const,
            threadId: ThreadId.make("thread-1"),
            path: path.join(baseDir, `${name}.png`),
          },
        }));
        for (const input of inputs)
          yield* fs.writeFileString(input.resource.path, path.basename(input.resource.path));
        const urls = yield* Effect.gen(function* () {
          yield* Layer.build(HttpRouter.serve(assetRouteLayer));
          const issued = [];
          for (const input of inputs.slice(0, 3)) {
            issued.push((yield* issueAssetUrl(input)).relativeUrl);
            yield* TestClock.adjust("1 second");
          }
          // Serving a refreshes its persisted recency, later than b and c.
          const recent = yield* HttpClient.get(issued[0]!);
          expect(recent.status).toBe(200);
          yield* recent.text;
          return issued;
        }).pipe(
          Effect.provideService(RetainedMediaSpace, probe),
          Effect.provide(Layer.mergeAll(serverLayer(baseDir, baseDir), NodeHttpServer.layerTest)),
          Effect.scoped,
        );
        available = (total * 8n) / 100n;
        yield* Effect.gen(function* () {
          yield* Layer.build(HttpRouter.serve(assetRouteLayer));
          const assetsDir = yield* retainedMediaDirectory;
          const config = yield* ServerConfig.ServerConfig;
          const protectedPath = path.join(config.stateDir, "state.sqlite");
          yield* fs.writeFileString(protectedPath, "database sentinel");
          const removed: string[] = [];
          const newest = yield* issueAssetUrl(inputs[3]!).pipe(
            Effect.provideService(FileSystem.FileSystem, {
              ...fs,
              remove: (file, options) =>
                fs.remove(file, options).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      if (file.includes(`${path.sep}objects${path.sep}`) && file.endsWith(".png")) {
                        removed.push(path.basename(file));
                        available += releasedPerObject;
                      }
                    }),
                  ),
                ),
            }),
          );
          expect(removed).toEqual(["b.png", "c.png"]);
          expect(available).toBeGreaterThan(total / 10n);
          expect(yield* fs.readFileString(protectedPath)).toBe("database sentinel");
          for (const [index, url] of urls.entries()) {
            const response = yield* HttpClient.get(url);
            expect(response.status).toBe(index === 0 ? 200 : 404);
            if (index === 0) yield* response.text;
          }
          const response = yield* HttpClient.get(newest.relativeUrl);
          expect(response.status).toBe(200);
          yield* response.text;
          // Evicted bindings stay gone even though the original source still exists.
          expect((yield* issueAssetUrl(inputs[1]!).pipe(Effect.flip))._tag).toBe(
            "AssetWorkspaceAssetNotFoundError",
          );
          expect(
            (yield* fs.readDirectory(assetsDir)).some((name) => name.startsWith(".pending-")),
          ).toBe(false);
        }).pipe(
          Effect.provideService(RetainedMediaSpace, probe),
          Effect.provide(Layer.mergeAll(serverLayer(baseDir, baseDir), NodeHttpServer.layerTest)),
          Effect.scoped,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each(["workspace-file", "media-file"] as const)(
    "keeps an established %s reference stable when a new conversation reuses its temp path after restart",
    (tag) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-reused-" });
        const source = path.join(baseDir, "screenshot.png");
        const oldInput = {
          resource: { _tag: tag, threadId: ThreadId.make("old-conversation"), path: source },
          workspaceRoot: baseDir,
        };
        yield* fs.writeFileString(source, "old screenshot");
        const oldUrl = yield* issueAssetUrl(oldInput).pipe(
          Effect.provide(serverLayer(baseDir, baseDir)),
          Effect.scoped,
        );
        yield* fs.writeFileString(source, "new screenshot");
        yield* Effect.gen(function* () {
          yield* Layer.build(HttpRouter.serve(assetRouteLayer));
          const newInput = {
            ...oldInput,
            resource: { ...oldInput.resource, threadId: ThreadId.make("new-conversation") },
          };
          const newUrl = yield* issueAssetUrl(newInput);
          expect(newUrl.relativeUrl).not.toBe(oldUrl.relativeUrl);
          const identical = yield* issueAssetUrl({
            ...newInput,
            resource: { ...newInput.resource, threadId: ThreadId.make("third-conversation") },
          });
          expect(identical.relativeUrl).toBe(newUrl.relativeUrl);
          expect(
            yield* fs.readDirectory(path.join(yield* retainedMediaDirectory, "objects")),
          ).toHaveLength(2);
          const oldReopened = yield* issueAssetUrl(oldInput);
          for (const [url, expected] of [
            [oldUrl.relativeUrl, "old screenshot"],
            [oldReopened.relativeUrl, "old screenshot"],
            [newUrl.relativeUrl, "new screenshot"],
          ] as const) {
            const response = yield* HttpClient.get(url);
            expect(response.status).toBe(200);
            expect(yield* response.text).toBe(expected);
          }
        }).pipe(
          Effect.provide(Layer.mergeAll(serverLayer(baseDir, baseDir), NodeHttpServer.layerTest)),
          Effect.scoped,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each([
    { tag: "workspace-file" as const, name: "screenshot.png", mime: "image/png" },
    { tag: "media-file" as const, name: "screenshot.png", mime: "image/png" },
    { tag: "media-file" as const, name: "recording.mp4", mime: "video/mp4" },
  ])(
    "serves $tag $name after a new server starts and temporary files disappear",
    ({ tag, name, mime }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-state-" });
        const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-workspace-" });
        const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-source-" });
        const source = path.join(temporary, name);
        const body = "retained conversation media";
        yield* fs.writeFileString(source, body);
        const input = {
          resource: { _tag: tag, threadId: ThreadId.make("thread-1"), path: source },
          workspaceRoot: workspace,
        };
        // End the first instance's scope, including its cached signing key.
        const issued = yield* issueAssetUrl(input).pipe(
          Effect.provide(serverLayer(baseDir, workspace)),
          Effect.scoped,
        );
        yield* fs.remove(source);

        yield* Effect.gen(function* () {
          yield* Layer.build(HttpRouter.serve(assetRouteLayer));
          const retained = yield* HttpClient.get(issued.relativeUrl);
          expect(retained.status).toBe(200);
          expect(retained.headers["content-type"]).toContain(mime);
          expect(yield* retained.text).toBe(body);
          for (const url of [
            issued.relativeUrl.replace(`/${name}`, "/sibling.png"),
            issued.relativeUrl.replace("/api/assets/", "/api/assets/tampered"),
          ])
            expect((yield* HttpClient.get(url)).status).toBe(404);
          if (mime.startsWith("video/")) {
            const partial = yield* HttpClient.get(issued.relativeUrl, {
              headers: { range: "bytes=0-7" },
            });
            expect(partial.status).toBe(206);
            expect(yield* partial.text).toBe(body.slice(0, 8));
          }
          yield* TestClock.adjust("61 minutes");
          expect((yield* HttpClient.get(issued.relativeUrl)).status).toBe(404);

          // Reopening a chat mints a fresh URL from its original resource path.
          const reopened = yield* issueAssetUrl(input);
          const response = yield* HttpClient.get(reopened.relativeUrl);
          expect(response.status).toBe(200);
          expect(yield* response.text).toBe(body);
          const wrongThread = yield* issueAssetUrl({
            ...input,
            resource: { ...input.resource, threadId: ThreadId.make("thread-2") },
          }).pipe(Effect.flip);
          expect(wrongThread._tag).toBe("AssetWorkspaceAssetNotFoundError");
        }).pipe(
          Effect.provide(Layer.mergeAll(serverLayer(baseDir, workspace), NodeHttpServer.layerTest)),
          Effect.scoped,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("retains a workspace image symlink using its canonical media filename", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-alias-" });
      const source = path.join(workspace, "original.svg");
      const alias = path.join(workspace, "screenshot.png");
      const body = '<svg xmlns="http://www.w3.org/2000/svg"/>';
      yield* fs.writeFileString(source, body);
      yield* fs.symlink(source, alias);
      const resource = {
        _tag: "workspace-file" as const,
        threadId: ThreadId.make("thread-1"),
        path: alias,
      };
      yield* Effect.gen(function* () {
        yield* Layer.build(HttpRouter.serve(assetRouteLayer));
        const issued = yield* issueAssetUrl({ resource, workspaceRoot: workspace });
        const response = yield* HttpClient.get(issued.relativeUrl);
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("image/svg+xml");
        expect(yield* response.text).toBe(body);
        yield* fs.remove(source);
        const reopened = yield* issueAssetUrl({ resource, workspaceRoot: workspace });
        expect((yield* HttpClient.get(reopened.relativeUrl)).status).toBe(200);
        expect((yield* issueAssetUrl({ resource }).pipe(Effect.flip))._tag).toBe(
          "AssetWorkspaceContextNotFoundError",
        );
      }).pipe(
        Effect.provide(Layer.mergeAll(serverLayer(workspace, workspace), NodeHttpServer.layerTest)),
        Effect.scoped,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("surviving references minted before retention still work after restart", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-existing-" });
      const source = path.join(baseDir, "screenshot.png");
      yield* fs.writeFileString(source, "existing image");
      const issued = yield* issueAssetUrl({
        resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: source },
      }).pipe(
        Effect.provideService(TemporaryMediaRoots, []),
        Effect.provide(serverLayer(baseDir, baseDir)),
        Effect.scoped,
      );
      yield* Effect.gen(function* () {
        yield* Layer.build(HttpRouter.serve(assetRouteLayer));
        const response = yield* HttpClient.get(issued.relativeUrl);
        expect(response.status).toBe(200);
        expect(yield* response.text).toBe("existing image");
      }).pipe(
        Effect.provide(Layer.mergeAll(serverLayer(baseDir, baseDir), NodeHttpServer.layerTest)),
        Effect.scoped,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "a failed atomic publication preserves the previous reference and removes staging files",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-assets-atomic-" });
        const source = path.join(baseDir, "screenshot.png");
        yield* fs.writeFileString(source, "previous image");
        const input = {
          resource: {
            _tag: "media-file" as const,
            threadId: ThreadId.make("thread-1"),
            path: source,
          },
        };
        yield* Effect.gen(function* () {
          yield* Layer.build(HttpRouter.serve(assetRouteLayer));
          const previous = yield* issueAssetUrl(input);
          yield* fs.writeFileString(source, "next image");
          const nextInput = {
            resource: { ...input.resource, threadId: ThreadId.make("thread-2") },
          };
          const failed = yield* issueAssetUrl(nextInput).pipe(
            Effect.provideService(FileSystem.FileSystem, {
              ...fs,
              rename: (from, to) =>
                from.endsWith("/media")
                  ? Effect.fail(
                      PlatformError.systemError({
                        _tag: "PermissionDenied",
                        module: "FileSystem",
                        method: "rename",
                        pathOrDescriptor: to,
                        description: "Synthetic publication failure",
                      }),
                    )
                  : fs.rename(from, to),
            }),
            Effect.flip,
          );
          expect(failed._tag).toBe("AssetWorkspaceAssetInspectionError");
          expect(
            (yield* fs.readDirectory(yield* retainedMediaDirectory)).some((name) =>
              name.startsWith(".pending-"),
            ),
          ).toBe(false);
          yield* fs.remove(source);
          expect((yield* issueAssetUrl(nextInput).pipe(Effect.flip))._tag).toBe(
            "AssetWorkspaceAssetNotFoundError",
          );
          for (const url of [previous.relativeUrl, (yield* issueAssetUrl(input)).relativeUrl]) {
            const response = yield* HttpClient.get(url);
            expect(response.status).toBe(200);
            expect(yield* response.text).toBe("previous image");
          }
        }).pipe(
          Effect.provide(Layer.mergeAll(serverLayer(baseDir, baseDir), NodeHttpServer.layerTest)),
          Effect.scoped,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
