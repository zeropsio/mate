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
import { retainedMediaDirectory, TemporaryMediaRoots } from "./RetainedMedia.ts";

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
          const failed = yield* issueAssetUrl(input).pipe(
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
