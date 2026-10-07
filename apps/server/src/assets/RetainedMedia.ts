// @effect-diagnostics nodeBuiltinImport:off - hash streamed media without buffering the file.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import type { AssetResource } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import { openMediaFile, streamMediaFile } from "./MediaFile.ts";

/** Tests can distinguish disposable screenshots from workspace fixtures on the same temp volume. */
export const TemporaryMediaRoots = Context.Reference<ReadonlyArray<string>>(
  "t3/assets/TemporaryMediaRoots",
  { defaultValue: () => [NodeOS.tmpdir()] },
);

type MediaResource = Extract<AssetResource, { readonly _tag: "media-file" | "workspace-file" }>;

const RetainedReference = Schema.fromJsonString(Schema.Struct({ relativePath: Schema.String }));
const decodeReference = Schema.decodeUnknownEffect(RetainedReference);
const encodeReference = Schema.encodeSync(RetainedReference);
const encodeReferenceKey = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

export const retainedMediaDirectory = Effect.gen(function* () {
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  return path.join(config.stateDir, "assets");
});

const referencePath = Effect.fnUntraced(function* (resource: MediaResource, sourcePath: string) {
  const path = yield* Path.Path;
  const key = NodeCrypto.createHash("sha256")
    .update(encodeReferenceKey([resource._tag, resource.threadId, path.normalize(sourcePath)]))
    .digest("hex");
  return path.join(yield* retainedMediaDirectory, "references", `${key}.json`);
});

export const isTemporaryMediaPath = Effect.fnUntraced(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const root of yield* TemporaryMediaRoots) {
    // realPath also covers /tmp -> /private/tmp on macOS.
    const canonicalRoot = yield* fs.realPath(root);
    const relative = path.relative(canonicalRoot, filePath);
    if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) return true;
  }
  return false;
});

/** Only references previously retained for this thread can reopen after their source is gone. */
export const findRetainedMedia = Effect.fnUntraced(function* (
  resource: MediaResource,
  sourcePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const indexPath = yield* referencePath(resource, sourcePath);
  if (!(yield* fs.exists(indexPath))) return null;
  return (yield* decodeReference(yield* fs.readFileString(indexPath))).relativePath;
});

/** Publish immutable bytes first, then their reference. Interrupted writes expose neither a partial image nor a dangling index. */
export const retainMedia = Effect.fn("retainMedia")(function* (input: {
  readonly resource: MediaResource;
  readonly sourcePath: string;
  readonly canonicalFile: string;
  readonly identity?: { readonly device: string; readonly inode: string };
}) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const assetsDir = yield* retainedMediaDirectory;
      const file = yield* openMediaFile(input.canonicalFile, input.identity);
      if (!file) return null;
      yield* fs.makeDirectory(assetsDir, { recursive: true });
      const staging = yield* fs.makeTempDirectoryScoped({
        directory: assetsDir,
        prefix: ".pending-",
      });
      const pending = path.join(staging, "media");
      const hash = NodeCrypto.createHash("sha256");
      const bytes =
        file.info.size === 0n ? Stream.empty : streamMediaFile(file, 0n, file.info.size);
      if (!bytes) return null;
      yield* bytes.pipe(
        Stream.tap((chunk) => Effect.sync(() => hash.update(chunk))),
        Stream.run(fs.sink(pending)),
      );
      const relativePath = path.join(
        "objects",
        hash.digest("hex"),
        path.basename(input.canonicalFile),
      );
      const destination = path.join(assetsDir, relativePath);
      yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
      if (!(yield* fs.exists(destination))) yield* fs.rename(pending, destination);
      yield* writeFileStringAtomically({
        filePath: yield* referencePath(input.resource, input.sourcePath),
        contents: encodeReference({ relativePath }),
      });
      return relativePath;
    }),
  );
});
