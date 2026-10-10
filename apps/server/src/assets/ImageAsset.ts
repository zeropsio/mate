import {
  ThreadId,
  type ProjectId,
  type AssetCreateUrlInput,
  type AssetCreateUrlResult,
} from "@t3tools/contracts";
import {
  isWorkspaceImagePreviewPath,
  mediaMimeTypeFromExtension,
} from "@t3tools/shared/filePreview";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";
import {
  resolveAttachmentPathById,
  parseThreadSegmentFromAttachmentId,
} from "../attachmentStore.ts";
import { issueAssetUrl, resolveAsset, resolveConversationImageFile } from "./AssetAccess.ts";
import { contentAssetsAt, ContentAssetError } from "./ContentAssets.ts";
import { findRetainedMedia, retainedMediaDirectory } from "./RetainedMedia.ts";

/** One metadata read, followed by one protected representation; no signed-image fallback. */
export const resolveImageAsset = Effect.fn("resolveImageAsset")(function* (
  input: AssetCreateUrlInput & {
    readonly projectId?: ProjectId;
    readonly workspaceRoot?: string;
    /** The conversation wiring recognizes captured provider sessions; V1 uses exact thread ids. */
    readonly ownsThread?: (thread: ThreadId) => boolean;
    readonly projectFaviconPath?: string;
    readonly projectCheckoutPending?: boolean;
  },
) {
  const config = yield* ServerConfig;
  const path = yield* Path.Path;
  const store = contentAssetsAt(config.stateDir);
  const resource = input.resource;
  const occurrenceId =
    resource._tag === "attachment"
      ? resource.occurrenceId
      : resource._tag === "project-favicon"
        ? undefined
        : /^mate-asset:([a-f0-9-]{36})(?::(?:source-missing|source-changed|storage-full|unsupported|persistence-failed))?$/.exec(
            resource.path,
          )?.[1];
  const threadId =
    resource._tag === "workspace-file" || resource._tag === "media-file"
      ? resource.threadId
      : resource._tag === "attachment"
        ? ThreadId.make(parseThreadSegmentFromAttachmentId(resource.attachmentId) ?? "workspace")
        : ThreadId.make("workspace");
  const refusal =
    resource._tag === "attachment"
      ? resource.captureFailure
      : resource._tag === "project-favicon"
        ? undefined
        : /^mate-asset:[a-f0-9-]{36}:(source-missing|source-changed|storage-full|unsupported|persistence-failed)$/.exec(
            resource.path,
          )?.[1];
  // A page a call published, under the same reference as a picture: its document, no picture's
  // occurrence, to its own conversation alone.
  const page =
    occurrenceId && resource._tag !== "attachment" && resource._tag !== "project-favicon"
      ? yield* Effect.promise(() => store.pageOccurrence(occurrenceId).catch(() => null))
      : null;
  if (page !== null) {
    if (!(input.ownsThread ? input.ownsThread(page.threadId) : page.threadId === threadId))
      return yield* Effect.fail(new ContentAssetError("object-missing"));
    const relativeUrl = `/api/assets/objects/${page.original.digest}/original`;
    return {
      relativeUrl,
      expiresAt: 0,
      representation: {
        digest: page.original.digest,
        mimeType: page.original.mimeType,
        sizeBytes: page.original.sizeBytes,
        relativeUrl,
      },
    } satisfies AssetCreateUrlResult;
  }
  let occurrence;
  if (occurrenceId) {
    occurrence = yield* Effect.tryPromise({
      try: () => store.occurrence(occurrenceId),
      catch: () => new ContentAssetError("object-missing"),
    }).pipe(
      Effect.catch((error) =>
        refusal
          ? Effect.succeed({
              id: occurrenceId,
              threadId,
              ownerId: "capture-refusal",
              name: "image",
              provenance: "capture" as const,
              original: {
                status: "failed" as const,
                code: refusal as NonNullable<
                  Extract<typeof resource, { _tag: "attachment" }>["captureFailure"]
                >,
              },
            })
          : Effect.fail(error),
      ),
    );
    if (
      (resource._tag === "workspace-file" || resource._tag === "media-file") &&
      !(input.ownsThread
        ? input.ownsThread(occurrence.threadId)
        : occurrence.threadId === resource.threadId)
    )
      return yield* Effect.fail(new ContentAssetError("object-missing"));
  } else {
    let source: string | null = null;
    if (resource._tag === "attachment") {
      if (!resource.mimeType?.startsWith("image/")) return null;
      source = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: resource.attachmentId,
      });
    } else if (resource._tag === "project-favicon") {
      const signed = yield* issueAssetUrl(input);
      const suffix = signed.relativeUrl.slice("/api/assets/".length);
      const separator = suffix.indexOf("/");
      source =
        (yield* resolveAsset(suffix.slice(0, separator), suffix.slice(separator + 1)))?.path ??
        null;
    } else {
      if (
        !isWorkspaceImagePreviewPath(resource.path) &&
        !mediaMimeTypeFromExtension(path.extname(resource.path))?.startsWith("image/")
      )
        return null;
      if (!input.workspaceRoot) return null;
      const sourcePath = path.resolve(input.workspaceRoot, resource.path);
      const retained =
        resource._tag === "media-file" ? yield* findRetainedMedia(resource, sourcePath) : null;
      source =
        retained === null
          ? yield* resolveConversationImageFile(
              { ...resource, _tag: "workspace-file" },
              input.workspaceRoot,
            )
          : path.join(yield* retainedMediaDirectory, retained);
    }
    const owner = {
      threadId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ownerId: resource._tag === "attachment" ? resource.attachmentId : "workspace-preview",
      name: source ? path.basename(source) : "image",
      provenance: "legacy" as const,
    };
    occurrence = yield* Effect.promise(() =>
      source === null ? store.failure(owner, "source-missing") : store.ingestFile(source, owner),
    );
  }
  if (occurrence.original.status !== "ready")
    return { relativeUrl: `/api/assets/occurrences/${occurrence.id}`, expiresAt: 0, occurrence };
  const original = occurrence.original;
  const previewResult =
    input.preview === undefined
      ? null
      : yield* Effect.tryPromise({
          try: () => store.preview(occurrence.id, input.preview!.width, input.preview!.height),
          catch: (error) =>
            error instanceof ContentAssetError
              ? error
              : new ContentAssetError("preview-unavailable"),
        }).pipe(Effect.result);
  if (previewResult?._tag === "Failure")
    return {
      relativeUrl: `/api/assets/occurrences/${occurrence.id}`,
      expiresAt: 0,
      occurrence,
      renditionFailure:
        previewResult.failure.code === "storage-full"
          ? ("storage-full" as const)
          : ("preview-unavailable" as const),
    };
  const representation =
    previewResult === null
      ? { ...original, relativeUrl: `/api/assets/objects/${original.digest}/original` }
      : previewResult.success;
  return {
    relativeUrl: representation.relativeUrl,
    expiresAt: 0,
    occurrence,
    representation,
    ...(original.width && original.height
      ? { imageDimensions: { width: original.width, height: original.height } }
      : {}),
  } satisfies AssetCreateUrlResult;
});
