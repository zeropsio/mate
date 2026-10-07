import { contentAssetsAt } from "./ContentAssets.ts";
import * as NodeOS from "node:os";

import type { AssetResource } from "@t3tools/contracts";
import {
  AssetAttachmentNotFoundError,
  AssetPreviewTypeValidationError,
  AssetProjectFaviconInspectionError,
  AssetProjectFaviconNotFoundError,
  AssetProjectFaviconResolutionError,
  AssetSigningKeyLoadError,
  AssetWorkspaceAssetInspectionError,
  AssetWorkspaceAssetNotFoundError,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspacePathValidationError,
  AssetWorkspaceResolutionError,
  AssetWorkspaceRootNormalizationError,
} from "@t3tools/contracts";
import {
  isWorkspaceImagePreviewPath,
  isWorkspacePreviewEntryPath,
  mediaMimeTypeFromExtension,
  WORKSPACE_BROWSER_PREVIEW_EXTENSIONS,
  WORKSPACE_IMAGE_PREVIEW_EXTENSIONS,
} from "@t3tools/shared/filePreview";
import {
  IMAGE_DIMENSIONS_HEADER_BYTES,
  readImageDimensions,
  type ImageDimensions,
} from "@t3tools/shared/imageDimensions";
import { PROJECT_FAVICON_FALLBACK_MARKER } from "@t3tools/shared/projectFavicon";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import { parseAttachmentFileExtension, resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { expandHomePath } from "../pathExpansion.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { openMediaFile, readMediaFileHeader, type OpenMediaFile } from "./MediaFile.ts";
import { AssetSigningKey } from "./AssetSigningKey.ts";
import {
  findRetainedMedia,
  isTemporaryMediaPath,
  retainedMediaDirectory,
  retainMedia,
} from "./RetainedMedia.ts";

export const ASSET_ROUTE_PREFIX = "/api/assets";

/**
 * Where an image outside the thread's workspace root may still be served
 * from: the server user's home and the OS temp dir. A Mate's container is
 * the person's own dev box, and a Mate saves the screenshots it shows in a
 * reply there (`~/shots/home.png`, `/tmp/v1.png`). A reference so a test can
 * stand in its own directories for the real ones.
 */
export const OutsideWorkspaceImageRoots = Context.Reference<ReadonlyArray<string>>(
  "t3/assets/OutsideWorkspaceImageRoots",
  { defaultValue: () => [NodeOS.homedir(), NodeOS.tmpdir()] },
);

const ASSET_TOKEN_TTL_MS = 60 * 60 * 1000;
const PROJECT_FAVICON_TOKEN_BUCKET_MS = 30 * 60 * 1000;
const PROJECT_FAVICON_VERSION_PREFIX = "v";
const INLINE_VIDEO_MIME_TYPE_PATTERN = /^video\/[\w!#$&^.+-]+$/i;
const PREVIEW_ASSET_EXTENSIONS = new Set([
  ...WORKSPACE_BROWSER_PREVIEW_EXTENSIONS,
  ...WORKSPACE_IMAGE_PREVIEW_EXTENSIONS,
  ".css",
  ".js",
  ".mjs",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
]);

const AssetClaimsSchema = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal("workspace-file"),
    workspaceRoot: Schema.String,
    baseRelativePath: Schema.String,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal("workspace-file-exact"),
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal("media-file-exact"),
    filePath: Schema.String,
    device: Schema.String,
    inode: Schema.String,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal("retained-media"),
    mimeType: Schema.optionalKey(Schema.String),
    relativePath: Schema.String,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal("attachment"),
    attachmentId: Schema.String,
    /** Decided at mint time. Absent tokens (from before this field) serve
        inline, which is only ever the image case. */
    download: Schema.optionalKey(Schema.Boolean),
    /** Display name and mime the caller supplied at mint time; drive the
        download filename and Content-Type. */
    fileName: Schema.optionalKey(Schema.String),
    mimeType: Schema.optionalKey(Schema.String),
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal("project-favicon"),
    workspaceRoot: Schema.String,
    relativePath: Schema.NullOr(Schema.String),
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal("project-favicon-external"),
    filePath: Schema.String,
    expiresAt: Schema.Number,
  }),
]);
type AssetClaims = typeof AssetClaimsSchema.Type;

const AssetClaimsJson = Schema.fromJsonString(AssetClaimsSchema);
const decodeAssetClaims = Schema.decodeUnknownOption(AssetClaimsJson);
const encodeAssetClaims = Schema.encodeSync(AssetClaimsJson);

export type ResolvedAsset = {
  readonly kind: "file";
  readonly path: string;
  readonly download?: boolean;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly file?: OpenMediaFile;
};

function decodeClaims(encodedPayload: string): AssetClaims | null {
  try {
    return Option.getOrNull(decodeAssetClaims(base64UrlDecodeUtf8(encodedPayload)));
  } catch {
    return null;
  }
}

function decodeRelativePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

const optionOnNotFound = <A, R>(
  effect: Effect.Effect<A, PlatformError.PlatformError, R>,
): Effect.Effect<Option.Option<A>, PlatformError.PlatformError, R> =>
  effect.pipe(
    Effect.asSome,
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed(Option.none<A>()) : Effect.fail(error),
    }),
  );

/** Whether a canonical file lies below a canonical root, never the root itself. */
const isStrictlyInside = (path: Path.Path, root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

/** By the literal extension, as `media-file-exact` serves it: `shot.png#x.txt` is text. */
const isLiteralImageFile = (path: Path.Path, filePath: string): boolean =>
  mediaMimeTypeFromExtension(path.extname(filePath))?.startsWith("image/") === true;

const resolveCanonicalFile = Effect.fn("AssetAccess.resolveCanonicalFile")(function* (
  filePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const canonicalFile = yield* optionOnNotFound(fileSystem.realPath(filePath));
  if (Option.isNone(canonicalFile)) return null;

  const info = yield* optionOnNotFound(fileSystem.stat(canonicalFile.value));
  return Option.isSome(info) && info.value.type === "File" ? canonicalFile.value : null;
});

const resolveCanonicalWorkspaceFile = Effect.fn("AssetAccess.resolveCanonicalWorkspaceFile")(
  function* (input: { readonly workspaceRoot: string; readonly relativePath: string }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
    const resolved = yield* workspacePaths.resolveRelativePathWithinRoot(input).pipe(
      Effect.asSome,
      Effect.catchTags({
        WorkspacePathOutsideRootError: () => Effect.succeedNone,
      }),
    );
    if (Option.isNone(resolved)) return null;

    const [canonicalRoot, canonicalFile] = yield* Effect.all([
      optionOnNotFound(fileSystem.realPath(input.workspaceRoot)),
      optionOnNotFound(fileSystem.realPath(resolved.value.absolutePath)),
    ]);
    if (Option.isNone(canonicalRoot) || Option.isNone(canonicalFile)) return null;

    const path = yield* Path.Path;
    if (!isStrictlyInside(path, canonicalRoot.value, canonicalFile.value)) return null;

    const info = yield* optionOnNotFound(fileSystem.stat(canonicalFile.value));
    return Option.isSome(info) && info.value.type === "File" ? canonicalFile.value : null;
  },
);

const resolveCanonicalWorkspaceFileForRequest = (input: {
  readonly workspaceRoot: string;
  readonly relativePath: string;
}) =>
  resolveCanonicalWorkspaceFile(input).pipe(
    Effect.tapError((cause) =>
      Effect.logError("Failed to resolve canonical asset path.", {
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        cause,
      }),
    ),
    Effect.orElseSucceed(() => null),
  );

/**
 * Reads pixel dimensions from an image's header so clients can reserve the
 * exact box before the bytes arrive. Best effort: an unreadable or unsupported
 * file just leaves the field out, and the client measures after decode. Only
 * formats the parser understands are opened; SVG and the rest are skipped.
 */
const HEADER_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** From the identity-checked, non-blocking handle the caller already holds. */
const readImageDimensionsFromOpenFile = (filePath: string, file: OpenMediaFile) =>
  readMediaFileHeader(filePath, file, IMAGE_DIMENSIONS_HEADER_BYTES).pipe(
    Effect.map(readImageDimensions),
    Effect.orElseSucceed((): ImageDimensions | null => null),
  );

/**
 * Opens through `openMediaFile` so a path swapped for a FIFO cannot block the
 * request; a regular open would wait for a writer that never comes.
 */
const readImageDimensionsFromHeader = (filePath: string) =>
  openMediaFile(filePath).pipe(
    Effect.flatMap((file) =>
      file === null ? Effect.succeed(null) : readImageDimensionsFromOpenFile(filePath, file),
    ),
    Effect.scoped,
    Effect.orElseSucceed((): ImageDimensions | null => null),
  );

/**
 * Opens a canonical media file once to pin its identity for a
 * `media-file-exact` claim, reading an image's pixel size from the same
 * descriptor. Null when the path is no longer a regular file.
 */
const pinExactMediaFile = Effect.fn("AssetAccess.pinExactMediaFile")(function* (
  canonicalFile: string,
) {
  const path = yield* Path.Path;
  const wantsDimensions = HEADER_IMAGE_EXTENSIONS.has(path.extname(canonicalFile).toLowerCase());
  return yield* openMediaFile(canonicalFile).pipe(
    Effect.flatMap((file) =>
      file === null
        ? Effect.succeed(null)
        : Effect.map(
            wantsDimensions
              ? readImageDimensionsFromOpenFile(canonicalFile, file)
              : Effect.succeed(null),
            (dimensions) => ({
              identity: { device: file.info.dev.toString(), inode: file.info.ino.toString() },
              dimensions,
            }),
          ),
    ),
    Effect.scoped,
  );
});

/**
 * An image the Mate put in a reply from outside the thread's workspace root.
 * Served only when its canonical path, every symlink resolved, lies inside
 * one of {@link OutsideWorkspaceImageRoots} (resolved the same way) and is
 * literally an image; pinned by device and inode like a `media-file`. A root
 * that resolves to the filesystem root is skipped, or it would open every
 * image on the host.
 */
const resolveOutsideWorkspaceImage = Effect.fn("AssetAccess.resolveOutsideWorkspaceImage")(
  function* (
    resource: Extract<AssetResource, { readonly _tag: "workspace-file" }>,
    outsideRoot: AssetWorkspacePathValidationError,
  ) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const inspectionFailed = (cause: unknown) =>
      new AssetWorkspaceAssetInspectionError({ resource, cause });
    const canonicalFile = yield* resolveCanonicalFile(resource.path).pipe(
      Effect.mapError(inspectionFailed),
    );
    if (!canonicalFile) {
      return yield* new AssetWorkspaceAssetNotFoundError({ resource });
    }
    const roots = yield* Effect.forEach(
      (yield* OutsideWorkspaceImageRoots).filter((root) => path.isAbsolute(root)),
      (root) => optionOnNotFound(fileSystem.realPath(root)),
    ).pipe(Effect.mapError(inspectionFailed));
    const insideRoot = roots.some(
      (root) =>
        Option.isSome(root) &&
        path.parse(root.value).root !== root.value &&
        isStrictlyInside(path, root.value, canonicalFile),
    );
    if (!insideRoot) {
      return yield* outsideRoot;
    }
    if (!isLiteralImageFile(path, canonicalFile)) {
      return yield* new AssetPreviewTypeValidationError({ resource });
    }
    const pinned = yield* pinExactMediaFile(canonicalFile).pipe(Effect.mapError(inspectionFailed));
    if (!pinned) {
      return yield* new AssetWorkspaceAssetNotFoundError({ resource });
    }
    return { canonicalFile, ...pinned };
  },
);

const signAssetUrl = Effect.fnUntraced(function* (input: {
  readonly resource: AssetResource;
  readonly claims: AssetClaims;
  readonly fileName: string;
}) {
  const signingKey = yield* AssetSigningKey;
  const signingSecret = yield* signingKey.get.pipe(
    Effect.mapError((cause) => new AssetSigningKeyLoadError({ resource: input.resource, cause })),
  );
  const encodedPayload = base64UrlEncode(encodeAssetClaims(input.claims));
  const token = `${encodedPayload}.${signPayload(encodedPayload, signingSecret)}`;
  return {
    relativeUrl: `${ASSET_ROUTE_PREFIX}/${token}/${encodeURIComponent(input.fileName)}`,
    expiresAt: input.claims.expiresAt,
  };
});

export const resolveConversationImageFile = Effect.fn("resolveConversationImageFile")(function* (
  resource: Extract<AssetResource, { readonly _tag: "workspace-file" }>,
  workspaceRoot: string,
) {
  const path = yield* Path.Path;
  const relativePath = path.isAbsolute(resource.path)
    ? path.relative(workspaceRoot, resource.path)
    : resource.path;
  const file = yield* resolveCanonicalWorkspaceFile({ workspaceRoot, relativePath });
  if (file && isLiteralImageFile(path, file)) return file;
  if (path.isAbsolute(resource.path)) {
    const image = yield* resolveOutsideWorkspaceImage(
      resource,
      new AssetWorkspacePathValidationError({ resource, cause: "Outside workspace" }),
    );
    return image.canonicalFile;
  }
  return null;
});

export const issueAssetUrl = Effect.fn("AssetAccess.issueAssetUrl")(function* (input: {
  readonly resource: AssetResource;
  readonly workspaceRoot?: string;
  readonly projectFaviconPath?: string;
  /** The project's clone has not landed, so its icon is reported missing without a lookup. */
  readonly projectCheckoutPending?: boolean;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const occurrenceId =
    input.resource._tag === "attachment"
      ? input.resource.occurrenceId
      : input.resource._tag === "project-favicon"
        ? undefined
        : /^mate-asset:([a-f0-9-]{36})$/.exec(input.resource.path)?.[1];
  if (occurrenceId) {
    const config = yield* ServerConfig.ServerConfig;
    const occurrence = yield* Effect.tryPromise({
      try: () => contentAssetsAt(config.stateDir).occurrence(occurrenceId),
      catch: (cause) => new AssetWorkspaceAssetInspectionError({ resource: input.resource, cause }),
    });
    if (occurrence.original.status !== "ready")
      return yield* new AssetWorkspaceAssetNotFoundError({ resource: input.resource });
    return {
      relativeUrl: `/api/assets/objects/${occurrence.original.digest}/original`,
      expiresAt: 0,
      ...(occurrence.original.width && occurrence.original.height
        ? {
            imageDimensions: {
              width: occurrence.original.width,
              height: occurrence.original.height,
            },
          }
        : {}),
    };
  }
  let expiresAt = (yield* Clock.currentTimeMillis) + ASSET_TOKEN_TTL_MS;
  let claims: AssetClaims;
  let fileName: string;
  let sourcePath: string | undefined;
  let imageDimensions: ImageDimensions | null = null;
  let canonicalMediaPath: string | undefined;
  const mediaResource =
    input.resource._tag === "media-file" ||
    (input.resource._tag === "workspace-file" && isWorkspaceImagePreviewPath(input.resource.path))
      ? input.resource
      : undefined;
  const requestedMediaPath = mediaResource
    ? path.isAbsolute(mediaResource.path)
      ? mediaResource.path
      : input.workspaceRoot
        ? path.resolve(input.workspaceRoot, mediaResource.path)
        : undefined
    : undefined;
  const retainedPath =
    mediaResource && requestedMediaPath
      ? yield* findRetainedMedia(mediaResource, requestedMediaPath).pipe(
          Effect.mapError(
            (cause) => new AssetWorkspaceAssetInspectionError({ resource: input.resource, cause }),
          ),
        )
      : null;

  if (retainedPath !== null) {
    if (input.resource._tag === "workspace-file" && !input.workspaceRoot) {
      return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
    }
    const retainedFile = yield* resolveCanonicalWorkspaceFile({
      workspaceRoot: yield* retainedMediaDirectory,
      relativePath: retainedPath,
    }).pipe(
      Effect.mapError(
        (cause) => new AssetWorkspaceAssetInspectionError({ resource: input.resource, cause }),
      ),
    );
    if (!retainedFile)
      return yield* new AssetWorkspaceAssetNotFoundError({ resource: input.resource });
    imageDimensions = yield* readImageDimensionsFromHeader(retainedFile);
    claims = { version: 1, kind: "retained-media", relativePath: retainedPath, expiresAt };
    fileName = path.basename(retainedPath);
    return {
      ...(yield* signAssetUrl({ resource: input.resource, claims, fileName })),
      ...(imageDimensions !== null ? { imageDimensions } : {}),
    };
  }
  switch (input.resource._tag) {
    case "media-file": {
      let requestedPath = expandHomePath(input.resource.path);
      if (!path.isAbsolute(requestedPath)) {
        if (!input.workspaceRoot) {
          return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
        }
        const workspaceRoot = yield* workspacePaths
          .normalizeWorkspaceRoot(input.workspaceRoot)
          .pipe(
            Effect.mapError(
              (cause) =>
                new AssetWorkspaceRootNormalizationError({ resource: input.resource, cause }),
            ),
          );
        requestedPath = path.resolve(workspaceRoot, requestedPath);
      }
      const canonicalFile = yield* resolveCanonicalFile(requestedPath).pipe(
        Effect.mapError(
          (cause) => new AssetWorkspaceAssetInspectionError({ resource: input.resource, cause }),
        ),
      );
      if (!canonicalFile) {
        return yield* new AssetWorkspaceAssetNotFoundError({ resource: input.resource });
      }
      if (mediaMimeTypeFromExtension(path.extname(canonicalFile)) === null) {
        return yield* new AssetPreviewTypeValidationError({ resource: input.resource });
      }
      const opened = yield* pinExactMediaFile(canonicalFile).pipe(
        Effect.mapError(
          (cause) => new AssetWorkspaceAssetInspectionError({ resource: input.resource, cause }),
        ),
      );
      if (!opened) {
        return yield* new AssetWorkspaceAssetNotFoundError({ resource: input.resource });
      }
      imageDimensions = opened.dimensions;
      canonicalMediaPath = canonicalFile;
      claims = {
        version: 1,
        kind: "media-file-exact",
        filePath: canonicalFile,
        ...opened.identity,
        expiresAt,
      };
      fileName = path.basename(canonicalFile);
      break;
    }
    case "workspace-file": {
      if (!input.workspaceRoot) {
        return yield* new AssetWorkspaceContextNotFoundError({
          resource: input.resource,
        });
      }
      const workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(input.workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new AssetWorkspaceRootNormalizationError({
              resource: input.resource,
              cause,
            }),
        ),
      );
      const relativePath = path.isAbsolute(input.resource.path)
        ? path.relative(workspaceRoot, input.resource.path)
        : input.resource.path;
      const withinRoot = yield* workspacePaths
        .resolveRelativePathWithinRoot({ workspaceRoot, relativePath })
        .pipe(Effect.result);
      if (Result.isFailure(withinRoot)) {
        const outsideRoot = new AssetWorkspacePathValidationError({
          resource: input.resource,
          cause: withinRoot.failure,
        });
        if (
          !path.isAbsolute(input.resource.path) ||
          !isWorkspaceImagePreviewPath(input.resource.path)
        ) {
          return yield* outsideRoot;
        }
        const image = yield* resolveOutsideWorkspaceImage(input.resource, outsideRoot);
        imageDimensions = image.dimensions;
        canonicalMediaPath = image.canonicalFile;
        claims = {
          version: 1,
          kind: "media-file-exact",
          filePath: image.canonicalFile,
          ...image.identity,
          expiresAt,
        };
        fileName = path.basename(image.canonicalFile);
        break;
      }
      const resolved = withinRoot.success;
      if (!isWorkspacePreviewEntryPath(resolved.relativePath)) {
        return yield* new AssetPreviewTypeValidationError({
          resource: input.resource,
        });
      }
      const canonicalFile = yield* resolveCanonicalWorkspaceFile({
        workspaceRoot,
        relativePath: resolved.relativePath,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new AssetWorkspaceAssetInspectionError({
              resource: input.resource,
              cause,
            }),
        ),
      );
      if (!canonicalFile) {
        return yield* new AssetWorkspaceAssetNotFoundError({
          resource: input.resource,
        });
      }
      const canonicalWorkspaceRoot = yield* fileSystem.realPath(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new AssetWorkspaceResolutionError({
              resource: input.resource,
              cause,
            }),
        ),
      );
      if (HEADER_IMAGE_EXTENSIONS.has(path.extname(resolved.relativePath).toLowerCase())) {
        imageDimensions = yield* readImageDimensionsFromHeader(canonicalFile);
      }
      claims = isWorkspaceImagePreviewPath(resolved.relativePath)
        ? {
            version: 1,
            kind: "workspace-file-exact",
            workspaceRoot: canonicalWorkspaceRoot,
            relativePath: resolved.relativePath,
            expiresAt,
          }
        : {
            version: 1,
            kind: "workspace-file",
            workspaceRoot: canonicalWorkspaceRoot,
            baseRelativePath: path.dirname(resolved.relativePath),
            expiresAt,
          };
      if (claims.kind === "workspace-file-exact") canonicalMediaPath = canonicalFile;
      fileName = path.basename(resolved.relativePath);
      break;
    }
    case "attachment": {
      const config = yield* ServerConfig.ServerConfig;
      const attachmentPath = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: input.resource.attachmentId,
      });
      if (!attachmentPath) {
        return yield* new AssetAttachmentNotFoundError({
          resource: input.resource,
        });
      }
      // Generic files carry their extension inside the attachment id (that
      // shape resolves the on-disk path); images do not. Videos and images
      // render inline; other generic files download.
      const isGenericFile = parseAttachmentFileExtension(input.resource.attachmentId) !== null;
      const videoMimeType = input.resource.mimeType?.split(";", 1)[0]?.trim() ?? "";
      const isVideo = INLINE_VIDEO_MIME_TYPE_PATTERN.test(videoMimeType);
      if (!isGenericFile) {
        imageDimensions = yield* readImageDimensionsFromHeader(attachmentPath);
      }
      claims = {
        version: 1,
        kind: "attachment",
        attachmentId: input.resource.attachmentId,
        ...(isGenericFile && !isVideo ? { download: true } : {}),
        ...(input.resource.fileName !== undefined ? { fileName: input.resource.fileName } : {}),
        ...(input.resource.mimeType !== undefined
          ? { mimeType: isVideo ? videoMimeType : input.resource.mimeType }
          : {}),
        expiresAt,
      };
      fileName = input.resource.fileName ?? path.basename(attachmentPath);
      break;
    }
    case "project-favicon": {
      const workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(input.resource.cwd).pipe(
        Effect.mapError(
          (cause) =>
            new AssetWorkspaceRootNormalizationError({
              resource: input.resource,
              cause,
            }),
        ),
      );
      const faviconResolver = yield* ProjectFaviconResolver.ProjectFaviconResolver;
      // A lookup in a half-cloned checkout would cache a miss that outlives the clone.
      const faviconPath = input.projectCheckoutPending
        ? null
        : yield* faviconResolver
            .resolvePath(workspaceRoot, input.projectFaviconPath ?? undefined)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AssetProjectFaviconResolutionError({
                    resource: input.resource,
                    cause,
                  }),
              ),
            );
      const isExternalOverride =
        faviconPath !== null &&
        input.projectFaviconPath !== undefined &&
        path.isAbsolute(input.projectFaviconPath) &&
        path.normalize(faviconPath) === path.normalize(input.projectFaviconPath);
      const relativePath =
        faviconPath && !isExternalOverride ? path.relative(workspaceRoot, faviconPath) : null;
      const sourceFaviconPath = isExternalOverride ? faviconPath : relativePath;
      if (sourceFaviconPath && !isWorkspaceImagePreviewPath(sourceFaviconPath)) {
        return yield* new AssetPreviewTypeValidationError({ resource: input.resource });
      }
      sourcePath = sourceFaviconPath ?? undefined;
      const canonicalFaviconPath = sourceFaviconPath
        ? yield* (
            isExternalOverride
              ? resolveCanonicalFile(sourceFaviconPath)
              : resolveCanonicalWorkspaceFile({ workspaceRoot, relativePath: sourceFaviconPath })
          ).pipe(
            Effect.mapError(
              (cause) =>
                new AssetProjectFaviconInspectionError({
                  resource: input.resource,
                  cause,
                }),
            ),
          )
        : null;
      if (sourceFaviconPath && !canonicalFaviconPath) {
        return yield* new AssetProjectFaviconNotFoundError({
          resource: input.resource,
        });
      }
      claims =
        isExternalOverride && canonicalFaviconPath
          ? {
              version: 1,
              kind: "project-favicon-external",
              filePath: canonicalFaviconPath,
              expiresAt,
            }
          : {
              version: 1,
              kind: "project-favicon",
              workspaceRoot: yield* fileSystem.realPath(workspaceRoot).pipe(
                Effect.mapError(
                  (cause) =>
                    new AssetWorkspaceResolutionError({
                      resource: input.resource,
                      cause,
                    }),
                ),
              ),
              relativePath,
              expiresAt,
            };
      if (sourceFaviconPath && canonicalFaviconPath) {
        const crypto = yield* Crypto.Crypto;
        const faviconBytes = yield* fileSystem.readFile(canonicalFaviconPath).pipe(
          Effect.mapError(
            (cause) =>
              new AssetProjectFaviconInspectionError({
                resource: input.resource,
                cause,
              }),
          ),
        );
        const revision = yield* crypto.digest("SHA-256", faviconBytes).pipe(
          Effect.map(Encoding.encodeHex),
          Effect.mapError(
            (cause) =>
              new AssetProjectFaviconInspectionError({
                resource: input.resource,
                cause,
              }),
          ),
        );
        fileName = `${PROJECT_FAVICON_VERSION_PREFIX}${revision}-${path.basename(sourceFaviconPath)}`;
      } else {
        fileName = PROJECT_FAVICON_FALLBACK_MARKER;
      }
      break;
    }
  }

  if (
    mediaResource &&
    requestedMediaPath &&
    canonicalMediaPath &&
    (yield* isTemporaryMediaPath(canonicalMediaPath).pipe(
      Effect.mapError(
        (cause) => new AssetWorkspaceAssetInspectionError({ resource: input.resource, cause }),
      ),
    ))
  ) {
    const retained = yield* retainMedia({
      resource: mediaResource,
      sourcePath: requestedMediaPath,
      canonicalFile: canonicalMediaPath,
      ...(claims.kind === "media-file-exact" ? { identity: claims } : {}),
    }).pipe(
      Effect.mapError(
        (cause) => new AssetWorkspaceAssetInspectionError({ resource: input.resource, cause }),
      ),
    );
    if (!retained) return yield* new AssetWorkspaceAssetNotFoundError({ resource: input.resource });
    claims = { version: 1, kind: "retained-media", relativePath: retained, expiresAt };
    fileName = path.basename(retained);
  }

  if (claims.kind === "project-favicon" || claims.kind === "project-favicon-external") {
    const issuedAt = yield* Clock.currentTimeMillis;
    expiresAt =
      (Math.floor(issuedAt / PROJECT_FAVICON_TOKEN_BUCKET_MS) + 2) *
      PROJECT_FAVICON_TOKEN_BUCKET_MS;
    claims = { ...claims, expiresAt };
  }
  return {
    ...(yield* signAssetUrl({ resource: input.resource, claims, fileName })),
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    ...(imageDimensions !== null ? { imageDimensions } : {}),
  };
});

export const resolveAsset = Effect.fn("AssetAccess.resolveAsset")(function* (
  token: string,
  relativePath: string,
) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const signingKey = yield* AssetSigningKey;
  const signingSecret = yield* signingKey.get.pipe(
    Effect.tapError((cause) => Effect.logError("Failed to load the asset signing key.", { cause })),
    Effect.orElseSucceed(() => null),
  );
  if (!signingSecret) return null;
  if (!timingSafeEqualBase64Url(signature, signPayload(encodedPayload, signingSecret))) return null;

  const claims = decodeClaims(encodedPayload);
  if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) return null;

  if (claims.kind === "attachment") {
    const config = yield* ServerConfig.ServerConfig;
    const attachmentPath = resolveAttachmentPathById({
      attachmentsDir: config.attachmentsDir,
      attachmentId: claims.attachmentId,
    });
    if (!attachmentPath) return null;
    const fileSystem = yield* FileSystem.FileSystem;
    const info = yield* optionOnNotFound(fileSystem.stat(attachmentPath)).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Failed to inspect attachment asset.", {
          attachmentId: claims.attachmentId,
          path: attachmentPath,
          cause,
        }),
      ),
      Effect.orElseSucceed(() => Option.none()),
    );
    return Option.isSome(info) && info.value.type === "File"
      ? ({
          kind: "file",
          path: attachmentPath,
          ...(claims.download ? { download: true } : {}),
          ...(claims.fileName !== undefined ? { fileName: claims.fileName } : {}),
          ...(claims.mimeType !== undefined ? { mimeType: claims.mimeType } : {}),
        } satisfies ResolvedAsset)
      : null;
  }

  if (claims.kind === "project-favicon") {
    if (claims.relativePath === null) return null;
    const faviconPath = yield* resolveCanonicalWorkspaceFileForRequest({
      workspaceRoot: claims.workspaceRoot,
      relativePath: claims.relativePath,
    });
    return faviconPath ? ({ kind: "file", path: faviconPath } satisfies ResolvedAsset) : null;
  }

  if (claims.kind === "project-favicon-external") {
    const faviconPath = yield* resolveCanonicalFile(claims.filePath).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Failed to resolve canonical asset path.", {
          filePath: claims.filePath,
          cause,
        }),
      ),
      Effect.orElseSucceed(() => null),
    );
    return faviconPath === claims.filePath
      ? ({ kind: "file", path: faviconPath } satisfies ResolvedAsset)
      : null;
  }

  const decodedPath = decodeRelativePath(relativePath);
  if (decodedPath === null) return null;
  const path = yield* Path.Path;
  if (claims.kind === "retained-media") {
    // Content-addressed objects require the live session/owner checks of the digest route.
    const retainedPath = path.normalize(claims.relativePath);
    if (
      ["originals", "previews"].some(
        (directory) =>
          retainedPath === directory || retainedPath.startsWith(`${directory}${path.sep}`),
      )
    )
      return null;
    if (!claims.mimeType && decodedPath !== path.basename(claims.relativePath)) return null;
    const canonicalFile = yield* resolveCanonicalWorkspaceFileForRequest({
      workspaceRoot: yield* retainedMediaDirectory,
      relativePath: claims.relativePath,
    });
    if (!canonicalFile) return null;
    const mimeType = claims.mimeType ?? mediaMimeTypeFromExtension(path.extname(canonicalFile));
    if (!mimeType) return null;
    const file = yield* openMediaFile(canonicalFile).pipe(
      Effect.tapError((cause) => Effect.logError("Failed to open retained media.", { cause })),
      Effect.orElseSucceed(() => null),
    );
    return file
      ? ({ kind: "file", path: canonicalFile, mimeType, file } satisfies ResolvedAsset)
      : null;
  }
  if (claims.kind === "media-file-exact") {
    if (decodedPath !== path.basename(claims.filePath)) return null;
    const canonicalFile = yield* resolveCanonicalFile(claims.filePath).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Failed to resolve canonical media path.", {
          filePath: claims.filePath,
          cause,
        }),
      ),
      Effect.orElseSucceed(() => null),
    );
    if (canonicalFile !== claims.filePath) return null;
    const mimeType = mediaMimeTypeFromExtension(path.extname(canonicalFile));
    if (!mimeType) return null;
    const file = yield* openMediaFile(canonicalFile, claims).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Failed to open canonical media file.", { filePath: canonicalFile, cause }),
      ),
      Effect.orElseSucceed(() => null),
    );
    return file
      ? ({ kind: "file", path: canonicalFile, mimeType, file } satisfies ResolvedAsset)
      : null;
  }
  if (claims.kind === "workspace-file-exact") {
    if (decodedPath !== path.basename(claims.relativePath)) return null;
    const exactWorkspaceFile = yield* resolveCanonicalWorkspaceFileForRequest({
      workspaceRoot: claims.workspaceRoot,
      relativePath: claims.relativePath,
    });
    return exactWorkspaceFile
      ? ({ kind: "file", path: exactWorkspaceFile } satisfies ResolvedAsset)
      : null;
  }
  const segments = decodedPath.split(/[\\/]/);
  if (
    decodedPath.length === 0 ||
    decodedPath.includes("\0") ||
    segments.some((segment) => segment === "." || segment === ".." || segment.startsWith(".")) ||
    !PREVIEW_ASSET_EXTENSIONS.has(path.extname(decodedPath).toLowerCase())
  ) {
    return null;
  }
  const joinedRelativePath =
    claims.baseRelativePath === "." ? decodedPath : path.join(claims.baseRelativePath, decodedPath);
  const workspaceFile = yield* resolveCanonicalWorkspaceFileForRequest({
    workspaceRoot: claims.workspaceRoot,
    relativePath: joinedRelativePath,
  });
  return workspaceFile ? ({ kind: "file", path: workspaceFile } satisfies ResolvedAsset) : null;
});
