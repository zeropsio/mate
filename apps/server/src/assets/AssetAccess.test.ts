// @effect-diagnostics nodeBuiltinImport:off - tests inject swaps at the native open boundary.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeFSP from "node:fs/promises";
import { AssetPreviewTypeValidationError, ThreadId } from "@t3tools/contracts";
import { PROJECT_FAVICON_FALLBACK_MARKER } from "@t3tools/shared/projectFavicon";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";
import * as Schema from "effect/Schema";
import { HttpServerResponse } from "effect/unstable/http";
import { vi } from "vite-plus/test";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { assetFileResponse } from "../http.ts";
import {
  ASSET_ROUTE_PREFIX,
  issueAssetUrl,
  OutsideWorkspaceImageRoots,
  resolveAsset,
} from "./AssetAccess.ts";
import { openMediaFile } from "./MediaFile.ts";
import * as AssetSigningKey from "./AssetSigningKey.ts";
import { TemporaryMediaRoots } from "./RetainedMedia.ts";
import sharp from "sharp";
import { contentAssetsAt } from "./ContentAssets.ts";
import { base64UrlEncode, signPayload } from "../auth/utils.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFSP>();
  return { ...actual, open: vi.fn(actual.open), realpath: vi.fn(actual.realpath) };
});

const configLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-asset-access-test-",
});
const makeTestLayer = (services = NodeServices.layer) =>
  Layer.mergeAll(
    NodeHttpPlatform.layer,
    configLayer,
    WorkspacePaths.layer,
    ProjectFaviconResolver.layer.pipe(
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(T3ProjectFileLoader.layer),
    ),
    AssetSigningKey.layer.pipe(Layer.provide(ServerSecretStore.layer), Layer.provide(configLayer)),
  ).pipe(Layer.provideMerge(services));
// Workspace fixtures use temp directories but model files on a persistent workspace volume.
const testLayer = makeTestLayer().pipe(Layer.provideMerge(Layer.succeed(TemporaryMediaRoots, [])));

it.effect.each(["attachment", "workspace-file", "media-file"] as const)(
  "a captured %s original is only addressed by its protected digest route",
  (kind) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const occurrence = yield* Effect.promise(async () =>
        contentAssetsAt(config.stateDir).ingestBytes(
          await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } })
            .png()
            .toBuffer(),
          {
            threadId: ThreadId.make("thread"),
            ownerId: "message",
            name: "original.png",
            provenance: "capture",
          },
        ),
      );
      if (occurrence.original.status !== "ready") throw new Error("not retained");
      const issued = yield* issueAssetUrl({
        resource:
          kind === "attachment"
            ? { _tag: "attachment", attachmentId: "thread-image", occurrenceId: occurrence.id }
            : {
                _tag: kind,
                threadId: ThreadId.make("thread"),
                path: `mate-asset:${occurrence.id}`,
              },
      });
      expect(issued.relativeUrl).toBe(`/api/assets/objects/${occurrence.original.digest}/original`);
      expect(issued.expiresAt).toBe(0);
      const signingKey = yield* AssetSigningKey.AssetSigningKey;
      const payload = base64UrlEncode(
        encodeJson({
          version: 1,
          kind: "retained-media",
          relativePath: `originals/${occurrence.original.digest}`,
          mimeType: "image/png",
          expiresAt: Number.MAX_SAFE_INTEGER,
        }),
      );
      const token = `${payload}.${signPayload(payload, yield* signingKey.get)}`;
      expect(yield* resolveAsset(token, "original.png")).toBeNull();
    }).pipe(Effect.provide(testLayer)),
);

const recordingKeyServices = (read: Effect.Effect<void, PlatformError.PlatformError>) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return {
        ...fs,
        readFile: (path) =>
          path.endsWith("/asset-access-signing-key.bin")
            ? Effect.andThen(read, () => fs.readFile(path))
            : fs.readFile(path),
      } satisfies FileSystem.FileSystem;
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

const exerciseSigningKey = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-asset-key-" });
  yield* fs.writeFileString(path.join(root, "report.html"), "<p>asset</p>");
  const urls = yield* Effect.all(
    Array.from({ length: 3 }, () =>
      issueAssetUrl({
        resource: {
          _tag: "workspace-file",
          threadId: ThreadId.make("thread-1"),
          path: "report.html",
        },
        workspaceRoot: root,
      }),
    ),
    { concurrency: "unbounded" },
  );
  for (const url of urls) {
    const suffix = url.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
    const slash = suffix.indexOf("/");
    const token = suffix.slice(0, slash);
    expect(yield* resolveAsset(token, suffix.slice(slash + 1))).toMatchObject({ kind: "file" });
    expect(yield* resolveAsset(`${token}tampered`, suffix.slice(slash + 1))).toBeNull();
  }
});

describe("AssetAccess", () => {
  it.effect(
    "shares one signing-key read across concurrent minting and asset requests per server",
    () =>
      Effect.gen(function* () {
        let reads = 0;
        const services = recordingKeyServices(
          Effect.sync(() => {
            reads += 1;
          }),
        );
        yield* exerciseSigningKey.pipe(Effect.provide(makeTestLayer(services)));
        expect(reads).toBe(1);
        yield* exerciseSigningKey.pipe(Effect.provide(makeTestLayer(services)));
        expect(reads).toBe(2);
      }),
  );

  it.effect("a failed key load can recover and then remains cached", () =>
    Effect.gen(function* () {
      let reads = 0;
      const services = recordingKeyServices(
        Effect.suspend(() => {
          reads += 1;
          return reads === 1
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "readFile",
                  description: "Synthetic key-read failure",
                  pathOrDescriptor: "synthetic signing key",
                }),
              )
            : Effect.void;
        }),
      );
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-asset-key-recovery-" });
        yield* fs.writeFileString(path.join(root, "report.html"), "<p>asset</p>");
        const issue = issueAssetUrl({
          resource: {
            _tag: "workspace-file",
            threadId: ThreadId.make("thread-1"),
            path: "report.html",
          },
          workspaceRoot: root,
        });
        expect((yield* Effect.flip(issue))._tag).toBe("AssetSigningKeyLoadError");
        yield* issue;
        yield* exerciseSigningKey;
        expect(reads).toBe(2);
      }).pipe(Effect.provide(makeTestLayer(services)));
    }),
  );
  it.effect("issues exact URLs for images and videos outside the workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-root-" });
      const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-outside-" });
      for (const [name, mimeType] of [
        ["screenshot.png", "image/png"],
        ["recording.mp4", "video/mp4"],
        ["recording.webm", "video/webm"],
      ] as const) {
        const filePath = path.join(outside, name);
        yield* fs.writeFileString(filePath, "media");
        const canonicalFile = yield* fs.realPath(filePath);
        const result = yield* issueAssetUrl({
          resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: filePath },
          workspaceRoot: root,
        });
        const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
        const separator = suffix.indexOf("/");
        const token = suffix.slice(0, separator);
        expect(yield* resolveAsset(token, suffix.slice(separator + 1))).toMatchObject({
          kind: "file",
          path: canonicalFile,
          mimeType,
        });
        yield* fs.writeFileString(path.join(outside, "sibling.png"), "private sibling");
        expect(yield* resolveAsset(token, "sibling.png")).toBeNull();
        expect(yield* resolveAsset(token, `../${name}`)).toBeNull();
        expect(yield* resolveAsset(`${token}tampered`, name)).toBeNull();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("reports pixel dimensions from an image header and nothing for other files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-dimensions-" });
      const png = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0,
        0x06, 0x40, 0, 0, 0x03, 0x84,
      ]);
      yield* fs.writeFile(path.join(root, "shot.png"), png);
      yield* fs.writeFileString(path.join(root, "clip.mp4"), "video");
      yield* fs.writeFileString(path.join(root, "broken.png"), "not a png");
      const issue = (name: string) =>
        issueAssetUrl({
          resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: name },
          workspaceRoot: root,
        });

      expect((yield* issue("shot.png")).imageDimensions).toEqual({ width: 1600, height: 900 });
      expect((yield* issue("clip.mp4")).imageDimensions).toBeUndefined();
      expect((yield* issue("broken.png")).imageDimensions).toBeUndefined();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("resolves relative media paths from the thread workspace, including outside it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-relative-" });
      const root = path.join(directory, "workspace");
      yield* fs.makeDirectory(root);
      for (const relativePath of ["screenshot.png", "../recording.mp4"]) {
        const filePath = path.resolve(root, relativePath);
        yield* fs.writeFileString(filePath, "media");
        const result = yield* issueAssetUrl({
          resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: relativePath },
          workspaceRoot: root,
        });
        const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
        const separator = suffix.indexOf("/");
        expect(
          yield* resolveAsset(suffix.slice(0, separator), suffix.slice(separator + 1)),
        ).toMatchObject({
          kind: "file",
          path: yield* fs.realPath(filePath),
        });
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects non-media files, disguised targets, and directories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-validation-" });
      for (const name of ["report.html", "secret.txt", "secret.%70ng", "secret.png#private.txt"]) {
        const filePath = path.join(root, name);
        yield* fs.writeFileString(filePath, "not media");
        const error = yield* issueAssetUrl({
          resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: filePath },
        }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(AssetPreviewTypeValidationError);
      }
      const disguisedPath = path.join(root, "disguised.png");
      yield* fs.symlink(path.join(root, "report.html"), disguisedPath);
      const disguisedError = yield* issueAssetUrl({
        resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: disguisedPath },
      }).pipe(Effect.flip);
      expect(disguisedError).toBeInstanceOf(AssetPreviewTypeValidationError);
      const directoryPath = path.join(root, "directory.png");
      yield* fs.makeDirectory(directoryPath);
      const directoryError = yield* issueAssetUrl({
        resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: directoryPath },
      }).pipe(Effect.flip);
      expect(directoryError._tag).toBe("AssetWorkspaceAssetNotFoundError");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("binds media URLs to the canonical target and rejects symlink substitution", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-symlink-" });
      const filePath = path.join(root, "actual.svg");
      const aliasPath = path.join(root, "alias.png");
      const replacementPath = path.join(root, "other.svg");
      yield* fs.writeFileString(filePath, "<svg/>");
      yield* fs.writeFileString(replacementPath, "<svg>private</svg>");
      yield* fs.symlink(filePath, aliasPath);
      const canonicalFile = yield* fs.realPath(filePath);
      const result = yield* issueAssetUrl({
        resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: aliasPath },
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separator = suffix.indexOf("/");
      const token = suffix.slice(0, separator);
      const name = suffix.slice(separator + 1);
      const expected = { kind: "file", path: canonicalFile, mimeType: "image/svg+xml" };
      expect(yield* resolveAsset(token, name)).toMatchObject(expected);
      yield* fs.remove(aliasPath);
      yield* fs.symlink(replacementPath, aliasPath);
      expect(yield* resolveAsset(token, name)).toMatchObject(expected);
      yield* fs.remove(filePath);
      yield* fs.symlink(replacementPath, filePath);
      expect(yield* resolveAsset(token, name)).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps full and partial responses bound to the file opened during resolution", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-open-file-" });
      const filePath = path.join(root, "recording.mp4");
      const savedPath = path.join(root, "saved.mp4");
      const secretPath = path.join(root, "secret.txt");
      yield* fs.writeFileString(filePath, "0123456789");
      yield* fs.writeFileString(secretPath, "private information");
      const result = yield* issueAssetUrl({
        resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: filePath },
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separator = suffix.indexOf("/");
      for (const [range, expected, status] of [
        [undefined, "0123456789", 200],
        ["bytes=2-5", "2345", 206],
      ] as const) {
        const asset = yield* resolveAsset(suffix.slice(0, separator), suffix.slice(separator + 1));
        if (!asset) throw new Error("Expected a resolved media file");

        yield* fs.rename(filePath, savedPath);
        yield* fs.symlink(secretPath, filePath);
        const response = HttpServerResponse.toWeb(yield* assetFileResponse(asset, range));
        expect(response.status).toBe(status);
        expect(response.headers.get("content-length")).toBe(String(expected.length));
        expect(yield* Effect.promise(() => response.text())).toBe(expected);
        yield* fs.remove(filePath);
        yield* fs.rename(savedPath, filePath);
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects a symlink swapped in after canonical validation but before open", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-open-race-" });
      const filePath = path.join(root, "recording.mp4");
      const secretPath = path.join(root, "secret.txt");
      yield* fs.writeFileString(filePath, "video");
      yield* fs.writeFileString(secretPath, "secret");
      const canonicalPath = yield* fs.realPath(filePath);
      const result = yield* issueAssetUrl({
        resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: filePath },
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separator = suffix.indexOf("/");
      const swappingFileSystem = FileSystem.FileSystem.of({
        ...fs,
        stat: Effect.fn(function* (requestedPath) {
          const info = yield* fs.stat(requestedPath);
          if (requestedPath === canonicalPath) {
            yield* fs.remove(filePath);
            yield* fs.symlink(secretPath, filePath);
          }
          return info;
        }),
      });
      expect(
        yield* resolveAsset(suffix.slice(0, separator), suffix.slice(separator + 1)).pipe(
          Effect.provideService(FileSystem.FileSystem, swappingFileSystem),
        ),
      ).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("closes a descriptor rejected when its path changes during open", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-open-rejected-" });
      const filePath = path.join(root, "recording.mp4");
      const secretPath = path.join(root, "secret.txt");
      yield* fs.writeFileString(filePath, "video");
      yield* fs.writeFileString(secretPath, "secret");
      const canonicalPath = yield* fs.realPath(filePath);
      const originalOpen = (yield* Effect.promise(() =>
        vi.importActual<typeof NodeFSP>("node:fs/promises"),
      )).open;
      let opened: NodeFSP.FileHandle | undefined;
      const openSpy = vi.mocked(NodeFSP.open).mockImplementation(async (target, flags, mode) => {
        const handle = await originalOpen(target, flags, mode);
        if (target === canonicalPath) {
          opened = handle;
          await NodeFSP.unlink(filePath);
          await NodeFSP.symlink(secretPath, filePath);
        }
        return handle;
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => openSpy.mockImplementation(originalOpen)));
      expect(yield* openMediaFile(canonicalPath)).toBeNull();
      expect(opened).toBeDefined();
      expect(opened?.fd).toBe(-1);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects an ancestor symlink race even when canonical path rechecks would pass", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-parent-race-" });
      const publicDirectory = path.join(root, "public");
      const privateDirectory = path.join(root, "private");
      yield* fs.makeDirectory(publicDirectory);
      yield* fs.makeDirectory(privateDirectory);
      const filePath = path.join(publicDirectory, "recording.mp4");
      yield* fs.writeFileString(filePath, "public video");
      yield* fs.writeFileString(path.join(privateDirectory, "recording.mp4"), "private video");
      const canonicalPath = yield* fs.realPath(filePath);
      const result = yield* issueAssetUrl({
        resource: { _tag: "media-file", threadId: ThreadId.make("thread-1"), path: filePath },
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separator = suffix.indexOf("/");
      const native = yield* Effect.promise(() =>
        vi.importActual<typeof NodeFSP>("node:fs/promises"),
      );
      const savedDirectory = path.join(root, "saved");
      const realpathSpy = vi.mocked(NodeFSP.realpath).mockImplementationOnce(async () => {
        // A pathname-only guard can see the original parents during realpath,
        // but the private file during both lstat calls and open.
        await native.unlink(publicDirectory);
        await native.rename(savedDirectory, publicDirectory);
        const canonical = await native.realpath(canonicalPath);
        await native.rename(publicDirectory, savedDirectory);
        await native.symlink(privateDirectory, publicDirectory, "junction");
        return canonical;
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => realpathSpy.mockReset().mockImplementation(native.realpath)),
      );
      const swappingFileSystem = FileSystem.FileSystem.of({
        ...fs,
        realPath: Effect.fn(function* (requestedPath) {
          const canonical = yield* fs.realPath(requestedPath);
          if (requestedPath === canonicalPath) {
            yield* fs.rename(publicDirectory, savedDirectory);
            yield* Effect.promise(() =>
              NodeFSP.symlink(privateDirectory, publicDirectory, "junction"),
            );
          }
          return canonical;
        }),
      });
      expect(
        yield* resolveAsset(suffix.slice(0, separator), suffix.slice(separator + 1)).pipe(
          Effect.provideService(FileSystem.FileSystem, swappingFileSystem),
        ),
      ).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps in-place edits readable but requires a new URL after atomic replacement", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-media-replacement-" });
      const filePath = path.join(root, "recording.mp4");
      yield* fs.writeFileString(filePath, "original");
      const input = {
        resource: {
          _tag: "media-file" as const,
          threadId: ThreadId.make("thread-1"),
          path: filePath,
        },
      };
      const original = yield* issueAssetUrl(input);
      const suffix = original.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separator = suffix.indexOf("/");
      const token = suffix.slice(0, separator);
      const name = suffix.slice(separator + 1);
      yield* fs.writeFileString(filePath, "in-place edit");
      const edited = yield* resolveAsset(token, name);
      if (!edited) throw new Error("Expected the edited media file");
      const editedResponse = HttpServerResponse.toWeb(yield* assetFileResponse(edited));
      expect(yield* Effect.promise(() => editedResponse.text())).toBe("in-place edit");

      const replacement = path.join(root, "replacement.mp4");
      yield* fs.writeFileString(replacement, "replacement");
      yield* fs.rename(replacement, filePath);
      expect(yield* resolveAsset(token, name)).toBeNull();

      const renewed = yield* issueAssetUrl(input);
      const renewedSuffix = renewed.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const renewedSeparator = renewedSuffix.indexOf("/");
      const renewedAsset = yield* resolveAsset(
        renewedSuffix.slice(0, renewedSeparator),
        renewedSuffix.slice(renewedSeparator + 1),
      );
      if (!renewedAsset) throw new Error("Expected the replacement media file");
      const renewedResponse = HttpServerResponse.toWeb(yield* assetFileResponse(renewedAsset));
      expect(yield* Effect.promise(() => renewedResponse.text())).toBe("replacement");
      yield* fs.remove(filePath);
      expect(
        yield* resolveAsset(
          renewedSuffix.slice(0, renewedSeparator),
          renewedSuffix.slice(renewedSeparator + 1),
        ),
      ).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("issues workspace URLs that resolve the entry file and sibling assets", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-workspace-",
      });
      const htmlPath = path.join(root, "report.html");
      const cssPath = path.join(root, "report.css");
      yield* fileSystem.writeFileString(htmlPath, '<link rel="stylesheet" href="report.css">');
      yield* fileSystem.writeFileString(cssPath, "body { color: red; }");
      yield* fileSystem.writeFileString(path.join(root, ".env"), "SECRET=value");
      const canonicalHtmlPath = yield* fileSystem.realPath(htmlPath);
      const canonicalCssPath = yield* fileSystem.realPath(cssPath);

      const result = yield* issueAssetUrl({
        resource: {
          _tag: "workspace-file",
          threadId: ThreadId.make("thread-1"),
          path: htmlPath,
        },
        workspaceRoot: root,
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separatorIndex = suffix.indexOf("/");
      const token = suffix.slice(0, separatorIndex);

      expect(yield* resolveAsset(token, "report.html")).toEqual({
        kind: "file",
        path: canonicalHtmlPath,
      });
      expect(yield* resolveAsset(token, "report.css")).toEqual({
        kind: "file",
        path: canonicalCssPath,
      });
      expect(yield* resolveAsset(token, "../secret.txt")).toBeNull();
      expect(yield* resolveAsset(token, ".env")).toBeNull();
      expect(yield* resolveAsset(`${token}tampered`, "report.html")).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects workspace files outside the authorized root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-root-",
      });
      const outside = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-outside-",
      });
      const htmlPath = path.join(outside, "report.html");
      yield* fileSystem.writeFileString(htmlPath, "<p>outside</p>");

      const error = yield* issueAssetUrl({
        resource: {
          _tag: "workspace-file",
          threadId: ThreadId.make("thread-1"),
          path: htmlPath,
        },
        workspaceRoot: root,
      }).pipe(Effect.flip);
      expect(error.message).toBe("Workspace file path must be relative to the project root.");
      expect(error).toMatchObject({
        _tag: "AssetWorkspacePathValidationError",
        resource: {
          _tag: "workspace-file",
          threadId: "thread-1",
          path: htmlPath,
        },
      });
      expect(error.cause).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("preserves non-missing canonical path failures when issuing asset URLs", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-permission-root-",
      });
      const htmlPath = path.join(root, "report.html");
      yield* fileSystem.writeFileString(htmlPath, "<p>report</p>");
      const cause = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "realPath",
        pathOrDescriptor: htmlPath,
      });
      const failingFileSystem = FileSystem.FileSystem.of({
        ...fileSystem,
        realPath: () => Effect.fail(cause),
      });

      const error = yield* issueAssetUrl({
        resource: {
          _tag: "workspace-file",
          threadId: ThreadId.make("thread-1"),
          path: htmlPath,
        },
        workspaceRoot: root,
      }).pipe(Effect.provideService(FileSystem.FileSystem, failingFileSystem), Effect.flip);

      expect(error.message).toBe("Failed to inspect the workspace asset.");
      expect(error).toMatchObject({
        _tag: "AssetWorkspaceAssetInspectionError",
        resource: {
          _tag: "workspace-file",
          threadId: "thread-1",
          path: htmlPath,
        },
      });
      expect(error.cause).toBe(cause);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("issues exact workspace URLs for image previews", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-image-workspace-",
      });
      const assetsDirectory = path.join(root, "assets");
      const imagePath = path.join(assetsDirectory, "icon.png");
      const siblingPath = path.join(assetsDirectory, "other.png");
      yield* fileSystem.makeDirectory(assetsDirectory, { recursive: true });
      yield* fileSystem.writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));
      yield* fileSystem.writeFile(siblingPath, new Uint8Array([137, 80, 78, 71]));
      const canonicalImagePath = yield* fileSystem.realPath(imagePath);

      const result = yield* issueAssetUrl({
        resource: {
          _tag: "workspace-file",
          threadId: ThreadId.make("thread-1"),
          path: imagePath,
        },
        workspaceRoot: root,
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separatorIndex = suffix.indexOf("/");
      const token = suffix.slice(0, separatorIndex);

      expect(yield* resolveAsset(token, "icon.png")).toEqual({
        kind: "file",
        path: canonicalImagePath,
      });
      expect(yield* resolveAsset(token, "other.png")).toBeNull();
      expect(yield* resolveAsset(token, "../icon.png")).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("issues exact attachment capabilities by attachment id", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const attachmentId = "thread-1-00000000-0000-4000-8000-000000000001";
      const attachmentPath = path.join(config.attachmentsDir, `${attachmentId}.png`);
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fileSystem.writeFile(attachmentPath, new Uint8Array([1, 2, 3]));

      const result = yield* issueAssetUrl({
        resource: { _tag: "attachment", attachmentId },
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separatorIndex = suffix.indexOf("/");
      const token = suffix.slice(0, separatorIndex);

      expect(yield* resolveAsset(token, "ignored.png")).toEqual({
        kind: "file",
        path: attachmentPath,
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("serves video attachments inline", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const attachmentId = "thread-1-00000000-0000-4000-8000-000000000001-mp4";
      const attachmentPath = path.join(config.attachmentsDir, `${attachmentId}.mp4`);
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fileSystem.writeFile(attachmentPath, new Uint8Array([1, 2, 3]));

      const result = yield* issueAssetUrl({
        resource: {
          _tag: "attachment",
          attachmentId,
          fileName: "demo.mp4",
          mimeType: 'video/mp4; codecs="avc1.42E01E"',
        },
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separatorIndex = suffix.indexOf("/");

      expect(
        yield* resolveAsset(suffix.slice(0, separatorIndex), suffix.slice(separatorIndex + 1)),
      ).toEqual({
        kind: "file",
        path: attachmentPath,
        fileName: "demo.mp4",
        mimeType: "video/mp4",
      });
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect("issues project favicon capabilities with a signed fallback", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-",
      });
      const faviconPath = path.join(root, "favicon.svg");
      const initialFavicon = "<svg>a</svg>";
      const updatedFavicon = "<svg>b</svg>";
      expect(updatedFavicon).toHaveLength(initialFavicon.length);
      yield* fileSystem.writeFileString(faviconPath, initialFavicon);
      const canonicalFaviconPath = yield* fileSystem.realPath(faviconPath);

      const faviconResult = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
      });
      expect(faviconResult.sourcePath).toBe("favicon.svg");
      expect(faviconResult.relativeUrl).toMatch(/\/v[0-9a-f]{64}-favicon\.svg$/);
      expect(
        yield* issueAssetUrl({
          resource: { _tag: "project-favicon", cwd: root },
        }),
      ).toEqual(faviconResult);
      const faviconSuffix = faviconResult.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const faviconSeparatorIndex = faviconSuffix.indexOf("/");
      expect(
        yield* resolveAsset(
          faviconSuffix.slice(0, faviconSeparatorIndex),
          faviconSuffix.slice(faviconSeparatorIndex + 1),
        ),
      ).toEqual({ kind: "file", path: canonicalFaviconPath });

      yield* fileSystem.writeFileString(faviconPath, updatedFavicon);
      const updatedFaviconResult = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
      });
      expect(
        updatedFaviconResult.relativeUrl.slice(updatedFaviconResult.relativeUrl.lastIndexOf("/")),
      ).not.toBe(faviconResult.relativeUrl.slice(faviconResult.relativeUrl.lastIndexOf("/")));

      yield* fileSystem.remove(faviconPath);
      const fallbackResult = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
      });
      expect(fallbackResult.relativeUrl.endsWith(`/${PROJECT_FAVICON_FALLBACK_MARKER}`)).toBe(true);
      expect(fallbackResult.sourcePath).toBeUndefined();
      const fallbackSuffix = fallbackResult.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const fallbackSeparatorIndex = fallbackSuffix.indexOf("/");
      expect(
        yield* resolveAsset(
          fallbackSuffix.slice(0, fallbackSeparatorIndex),
          fallbackSuffix.slice(fallbackSeparatorIndex + 1),
        ),
      ).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("issues project favicon capabilities for a saved override", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-override-",
      });
      yield* fileSystem.makeDirectory(path.join(root, "brand"));
      yield* fileSystem.writeFileString(path.join(root, "brand", "custom.svg"), "<svg />");
      yield* fileSystem.writeFileString(path.join(root, "favicon.svg"), "<svg>auto</svg>");

      const result = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
        projectFaviconPath: "brand/custom.svg",
      });

      expect(result.sourcePath).toBe(path.join("brand", "custom.svg"));
      expect(result.relativeUrl).toMatch(/\/v[0-9a-f]{64}-custom\.svg$/);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("issues an exact capability for a saved favicon outside the workspace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-workspace-",
      });
      const pictures = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-pictures-",
      });
      const externalPath = path.join(pictures, "custom.png");
      const siblingPath = path.join(pictures, "sibling.png");
      yield* fileSystem.writeFile(externalPath, new Uint8Array([1, 2, 3]));
      yield* fileSystem.writeFile(siblingPath, new Uint8Array([4, 5, 6]));
      const canonicalPath = yield* fileSystem.realPath(externalPath);
      const canonicalSiblingPath = yield* fileSystem.realPath(siblingPath);

      const result = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
        projectFaviconPath: externalPath,
      });
      const suffix = result.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separatorIndex = suffix.indexOf("/");

      expect(result.sourcePath).toBe(externalPath);
      expect(result.relativeUrl).toMatch(/\/v[0-9a-f]{64}-custom\.png$/);
      expect(
        yield* resolveAsset(suffix.slice(0, separatorIndex), suffix.slice(separatorIndex + 1)),
      ).toEqual({ kind: "file", path: canonicalPath });
      const tamperedSuffixResult = yield* resolveAsset(
        suffix.slice(0, separatorIndex),
        "sibling.png",
      );
      expect(tamperedSuffixResult).toEqual({ kind: "file", path: canonicalPath });
      expect(tamperedSuffixResult).not.toEqual({ kind: "file", path: canonicalSiblingPath });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("ignores a client favicon path hint", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-hint-",
      });
      yield* fileSystem.makeDirectory(path.join(root, "brand"));
      yield* fileSystem.writeFileString(path.join(root, "brand", "hint.svg"), "<svg>hint</svg>");
      yield* fileSystem.writeFileString(path.join(root, "brand", "saved.svg"), "<svg>saved</svg>");

      const result = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root, path: "brand/hint.svg" },
        projectFaviconPath: "brand/saved.svg",
      });

      expect(result.sourcePath).toBe(path.join("brand", "saved.svg"));
      expect(result.relativeUrl).toMatch(/\/v[0-9a-f]{64}-saved\.svg$/);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps automatic favicon resolution separate from a saved override", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-automatic-",
      });
      yield* fileSystem.makeDirectory(path.join(root, "brand"));
      yield* fileSystem.writeFileString(path.join(root, "brand", "saved.svg"), "<svg>saved</svg>");
      yield* fileSystem.writeFileString(path.join(root, "favicon.svg"), "<svg>automatic</svg>");

      const result = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
      });

      expect(result.sourcePath).toBe("favicon.svg");
      expect(result.relativeUrl).toMatch(/\/v[0-9a-f]{64}-favicon\.svg$/);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects a resolved project favicon with a non-image extension", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-type-",
      });
      yield* fileSystem.writeFileString(path.join(root, "secret.txt"), "not an image");

      const error = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
        projectFaviconPath: "secret.txt",
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(AssetPreviewTypeValidationError);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("buckets project favicon expiry after content hashing", () =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-expiry-",
      });
      yield* fileSystem.writeFileString(path.join(root, "favicon.svg"), "<svg />");

      const bucketMs = 30 * 60 * 1000;
      yield* TestClock.setTime(bucketMs - 1);
      const crossingCrypto = Crypto.make({
        randomBytes: (size) => new Uint8Array(size),
        digest: (algorithm, data) =>
          TestClock.adjust("2 millis").pipe(Effect.andThen(crypto.digest(algorithm, data))),
      });
      const result = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
      }).pipe(Effect.provideService(Crypto.Crypto, crossingCrypto));

      expect(result.expiresAt).toBe(3 * bucketMs);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("preserves structured project favicon resolution causes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-asset-favicon-error-",
      });
      const platformCause = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "stat",
      });
      const resolutionCause = new ProjectFaviconResolver.ProjectFaviconResolutionError({
        operation: "stat-candidate",
        workspaceRoot: root,
        relativePath: "favicon.svg",
        cause: platformCause,
      });
      const resolver = ProjectFaviconResolver.ProjectFaviconResolver.of({
        resolvePath: () => Effect.fail(resolutionCause),
      });

      const error = yield* issueAssetUrl({
        resource: { _tag: "project-favicon", cwd: root },
      }).pipe(
        Effect.provideService(ProjectFaviconResolver.ProjectFaviconResolver, resolver),
        Effect.flip,
      );

      expect(error.message).toBe("Failed to resolve project favicon.");
      expect(error._tag).toBe("AssetProjectFaviconResolutionError");
      expect(error.cause).toBe(resolutionCause);
    }).pipe(Effect.provide(testLayer)),
  );
});

/**
 * A Mate's container is the person's own dev box: an image the Mate saved in
 * its home or the temp dir and put in its reply is served, though it sits
 * outside the workspace root. Nothing else outside the root is: not another
 * kind of file, not an image elsewhere on the host, not a link out of those
 * directories, not a link that dresses a key as an image.
 */
describe("AssetAccess — an image outside the workspace", () => {
  interface Fixture {
    readonly workspace: string;
    readonly home: string;
    readonly tmp: string;
    readonly elsewhere: string;
  }

  const makeFixture = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-asset-outside-image-" });
    const fixture: Fixture = {
      workspace: path.join(base, "workspace"),
      home: path.join(base, "home"),
      tmp: path.join(base, "tmp"),
      elsewhere: path.join(base, "elsewhere"),
    };
    for (const directory of [
      path.join(fixture.workspace, "assets"),
      path.join(fixture.home, "shots"),
      path.join(fixture.home, ".ssh"),
      fixture.tmp,
      fixture.elsewhere,
    ]) {
      yield* fs.makeDirectory(directory, { recursive: true });
    }
    yield* fs.writeFileString(path.join(fixture.workspace, "assets", "icon.png"), "workspace");
    yield* fs.writeFileString(path.join(fixture.home, "shots", "home.png"), "home image");
    yield* fs.writeFileString(path.join(fixture.home, "shots", "shot.png#x.txt"), "text");
    yield* fs.writeFileString(path.join(fixture.home, "notes.txt"), "notes");
    yield* fs.writeFileString(path.join(fixture.home, ".ssh", "id_ed25519"), "private key");
    yield* fs.writeFileString(path.join(fixture.tmp, "v1.png"), "temp image");
    yield* fs.writeFileString(path.join(fixture.elsewhere, "leak.png"), "elsewhere");
    yield* fs.symlink(
      path.join(fixture.elsewhere, "leak.png"),
      path.join(fixture.home, "shots", "escape.png"),
    );
    yield* fs.symlink(
      path.join(fixture.home, ".ssh", "id_ed25519"),
      path.join(fixture.home, "shots", "key.png"),
    );
    return fixture;
  });

  const tokenAndName = (relativeUrl: string) => {
    const suffix = relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
    const separator = suffix.indexOf("/");
    return { token: suffix.slice(0, separator), name: suffix.slice(separator + 1) };
  };

  it.effect.each<{
    readonly name: string;
    readonly at: (fixture: Fixture, path: Path.Path) => string;
    readonly expected:
      | { readonly outcome: "served"; readonly body: string }
      | { readonly outcome: "workspace" }
      | { readonly outcome: "refused"; readonly error: string };
  }>([
    {
      name: "an image in the home directory is served",
      at: (fixture, path) => path.join(fixture.home, "shots", "home.png"),
      expected: { outcome: "served", body: "home image" },
    },
    {
      name: "an image in the temp directory is served",
      at: (fixture, path) => path.join(fixture.tmp, "v1.png"),
      expected: { outcome: "served", body: "temp image" },
    },
    {
      name: "an image inside the workspace resolves as it did",
      at: (fixture, path) => path.join(fixture.workspace, "assets", "icon.png"),
      expected: { outcome: "workspace" },
    },
    {
      name: "a non-image in the home directory is refused",
      at: (fixture, path) => path.join(fixture.home, "notes.txt"),
      expected: { outcome: "refused", error: "AssetWorkspacePathValidationError" },
    },
    {
      name: "a system file is refused",
      at: () => "/etc/passwd",
      expected: { outcome: "refused", error: "AssetWorkspacePathValidationError" },
    },
    {
      name: "an image outside the home and temp directories is refused",
      at: (fixture, path) => path.join(fixture.elsewhere, "leak.png"),
      expected: { outcome: "refused", error: "AssetWorkspacePathValidationError" },
    },
    {
      name: "a symlink in home that points out of it is refused",
      at: (fixture, path) => path.join(fixture.home, "shots", "escape.png"),
      expected: { outcome: "refused", error: "AssetWorkspacePathValidationError" },
    },
    {
      name: "a symlink in home that dresses a key as an image is refused",
      at: (fixture, path) => path.join(fixture.home, "shots", "key.png"),
      expected: { outcome: "refused", error: "AssetPreviewTypeValidationError" },
    },
    {
      name: "a name that only ends like an image is refused",
      at: (fixture, path) => path.join(fixture.home, "shots", "shot.png#x.txt"),
      expected: { outcome: "refused", error: "AssetPreviewTypeValidationError" },
    },
    {
      name: "a missing image in the home directory is not found",
      at: (fixture, path) => path.join(fixture.home, "shots", "gone.png"),
      expected: { outcome: "refused", error: "AssetWorkspaceAssetNotFoundError" },
    },
  ])("$name", ({ at, expected }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture;
      const filePath = at(fixture, path);
      const issue = issueAssetUrl({
        resource: { _tag: "workspace-file", threadId: ThreadId.make("thread-1"), path: filePath },
        workspaceRoot: fixture.workspace,
      }).pipe(Effect.provideService(OutsideWorkspaceImageRoots, [fixture.home, fixture.tmp]));

      if (expected.outcome === "refused") {
        expect((yield* Effect.flip(issue))._tag).toBe(expected.error);
        return;
      }
      const { token, name } = tokenAndName((yield* issue).relativeUrl);
      const asset = yield* resolveAsset(token, name);
      const canonicalFile = yield* fs.realPath(filePath);
      if (expected.outcome === "workspace") {
        expect(asset).toEqual({ kind: "file", path: canonicalFile });
        return;
      }
      expect(asset).toMatchObject({ kind: "file", path: canonicalFile, mimeType: "image/png" });
      if (!asset) throw new Error("Expected the image to resolve");
      const response = HttpServerResponse.toWeb(yield* assetFileResponse(asset));
      expect(yield* Effect.promise(() => response.text())).toBe(expected.body);
      expect(yield* resolveAsset(token, "sibling.png")).toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("serves an image from the real temp directory by default", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-asset-default-workspace-",
      });
      const shots = yield* fs.makeTempDirectoryScoped({ prefix: "t3-asset-default-shots-" });
      const imagePath = path.join(shots, "v1.png");
      yield* fs.writeFileString(imagePath, "temp image");

      const { relativeUrl } = yield* issueAssetUrl({
        resource: { _tag: "workspace-file", threadId: ThreadId.make("thread-1"), path: imagePath },
        workspaceRoot: workspace,
      });
      const { token, name } = tokenAndName(relativeUrl);

      expect(yield* resolveAsset(token, name)).toMatchObject({
        kind: "file",
        path: yield* fs.realPath(imagePath),
        mimeType: "image/png",
      });
    }).pipe(Effect.provide(testLayer)),
  );
});
