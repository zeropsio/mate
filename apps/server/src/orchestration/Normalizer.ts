import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  type ChatAttachment,
  ThreadId,
  type ClientOrchestrationCommand,
  type UserInputAttachments,
  getProviderAttachmentLimitError,
  type IsoDateTime,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

import { ContentAssetError, contentAssetsAt } from "../assets/ContentAssets.ts";
import { withFittedPicture, withPictureSize } from "../attachmentFit.ts";
import { fitPictureOffThread } from "../attachmentFitThread.ts";
import {
  createAttachmentId,
  planAttachmentClaim,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export const canonicalizeClientCommandTimestamps = (
  command: ClientOrchestrationCommand,
  receivedAt: IsoDateTime,
): ClientOrchestrationCommand => {
  const canonicalCommand =
    "createdAt" in command
      ? {
          ...command,
          createdAt: receivedAt,
        }
      : command;

  if (canonicalCommand.type !== "thread.turn.start" || !canonicalCommand.bootstrap?.createThread) {
    return canonicalCommand;
  }

  return {
    ...canonicalCommand,
    bootstrap: {
      ...canonicalCommand.bootstrap,
      createThread: {
        ...canonicalCommand.bootstrap.createThread,
        createdAt: receivedAt,
      },
    },
  };
};

const removeClaimedAttachmentPaths = Effect.fn("Normalizer.removeClaimedAttachmentPaths")(
  function* (attachmentPaths: ReadonlyArray<string>) {
    if (attachmentPaths.length === 0) {
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* Effect.forEach(
      attachmentPaths,
      (attachmentPath) =>
        fileSystem.remove(attachmentPath, { force: true }).pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Failed to remove an unclaimed attachment copy.", {
              attachmentPath,
              cause,
            }),
          ),
          Effect.orElseSucceed(() => undefined),
        ),
      { concurrency: 1 },
    );
  },
);

/**
 * The picture fitted to what the providers take, or null when it goes as it
 * came. The composer fits its own pictures; mobile and older web clients send
 * theirs as taken.
 */
const fitPicture = Effect.fn("Normalizer.fitPicture")(function* (
  name: string,
  picture: { readonly bytes: Uint8Array; readonly mimeType: string },
) {
  const fit = yield* fitPictureOffThread(picture).pipe(
    Effect.mapError(
      (cause) =>
        new OrchestrationDispatchCommandError({
          message: `Picture '${name}' could not be shrunk to send. Send a smaller copy.`,
          cause,
        }),
    ),
  );
  if (fit._tag === "too-large") {
    return yield* new OrchestrationDispatchCommandError({
      message: `Picture '${name}' is too large to send even after shrinking it. Send a smaller copy.`,
    });
  }
  return fit._tag === "fitted" ? fit : null;
});

type ClientMessageAttachment =
  | Extract<
      ClientOrchestrationCommand,
      { readonly type: "thread.turn.start" }
    >["message"]["attachments"][number]
  | UserInputAttachments[string][number];

/**
 * A message's attachments claimed for `threadId`, a thread message's and a
 * crew message's alike: an uploaded one only while it is a pending upload
 * (never another message's stored attachment), copied under the thread's own
 * id; a picture sent inline stored. Nothing claimed stays when one fails.
 */
export const claimMessageAttachments = Effect.fn("Normalizer.claimMessageAttachments")(function* (
  threadId: string,
  attachments: ReadonlyArray<ClientMessageAttachment>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const attachmentLimitError = getProviderAttachmentLimitError(attachments);
  if (attachmentLimitError) {
    return yield* new OrchestrationDispatchCommandError({ message: attachmentLimitError });
  }
  const claimedAttachmentPaths: string[] = [];
  const attachmentsWithDecodedSizes = [...attachments];
  return yield* Effect.forEach(
    attachments,
    (attachment, index) =>
      Effect.gen(function* () {
        if (!("dataUrl" in attachment)) {
          const claim = planAttachmentClaim({
            attachmentsDir: serverConfig.attachmentsDir,
            threadId,
            attachmentId: attachment.id,
          });
          if (!claim.ok) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' cannot be sent: ${claim.reason}.`,
            });
          }

          const info = yield* fileSystem.stat(claim.currentPath).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: `Attachment '${attachment.name}' cannot be sent: attachment not found.`,
                  cause,
                }),
            ),
          );
          if (Number(info.size) !== attachment.sizeBytes) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' cannot be sent: stored size does not match.`,
            });
          }

          const normalizedAttachment = {
            ...attachment,
            id: claim.finalId,
            mimeType: attachment.mimeType.toLowerCase(),
          };
          const expectedPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: normalizedAttachment,
          });
          if (expectedPath !== claim.finalPath) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Attachment '${attachment.name}' cannot be sent: attachment type does not match the upload.`,
            });
          }

          const claimFailed = (cause: unknown) =>
            new OrchestrationDispatchCommandError({
              message: `Failed to claim attachment '${attachment.name}' for this thread.`,
              cause,
            });
          const pictureBytes =
            normalizedAttachment.type === "image"
              ? yield* fileSystem.readFile(claim.currentPath).pipe(Effect.mapError(claimFailed))
              : null;
          const asset =
            pictureBytes === null
              ? undefined
              : yield* Effect.promise(() =>
                  contentAssetsAt(serverConfig.stateDir).ingestBytes(pictureBytes, {
                    threadId: ThreadId.make(threadId),
                    ownerId: claim.finalId,
                    name: attachment.name,
                    mimeType: normalizedAttachment.mimeType,
                    provenance: "upload",
                  }),
                );
          let sourceAsset;
          if (
            attachment.type === "image" &&
            "sourceAttachmentId" in attachment &&
            attachment.sourceAttachmentId
          ) {
            const sourceClaim = planAttachmentClaim({
              attachmentsDir: serverConfig.attachmentsDir,
              threadId,
              attachmentId: attachment.sourceAttachmentId,
            });
            if (!sourceClaim.ok)
              return yield* new OrchestrationDispatchCommandError({
                message: "The original image upload is unavailable.",
              });
            const sourceOccurrence = yield* Effect.promise(() =>
              contentAssetsAt(serverConfig.stateDir).upload(
                attachment.sourceAttachmentId!,
                sourceClaim.currentPath,
                {
                  threadId: ThreadId.make("pending"),
                  ownerId: attachment.sourceAttachmentId!,
                  name: attachment.name,
                  mimeType: normalizedAttachment.mimeType,
                  provenance: "upload",
                },
              ),
            );
            sourceAsset = yield* Effect.tryPromise({
              try: () =>
                contentAssetsAt(serverConfig.stateDir).claim(sourceOccurrence, {
                  threadId: ThreadId.make(threadId),
                  ownerId: sourceClaim.finalId,
                  name: sourceOccurrence.name,
                  provenance: "upload",
                }),
              catch: (cause) =>
                new OrchestrationDispatchCommandError({
                  message:
                    cause instanceof ContentAssetError && cause.code === "storage-full"
                      ? "Storage full"
                      : "The original image could not be retained.",
                  cause,
                }),
            });
          }
          const { sourceAttachmentId: _, ...claimedMetadata } = {
            ...normalizedAttachment,
            sourceAttachmentId:
              "sourceAttachmentId" in attachment ? attachment.sourceAttachmentId : undefined,
          };
          const withOriginal =
            asset === undefined
              ? normalizedAttachment
              : {
                  ...claimedMetadata,
                  asset,
                  ...(sourceAsset === undefined ? {} : { sourceAsset }),
                };
          const picture =
            pictureBytes === null
              ? null
              : yield* fitPicture(attachment.name, {
                  bytes: pictureBytes,
                  mimeType: normalizedAttachment.mimeType,
                });
          // A fitted picture is the claimed copy, under the path its own type
          // gives it (`.png` may become `.jpg`).
          if (picture !== null) {
            const fittedAttachment = withFittedPicture(withOriginal, picture);
            const fittedPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment: fittedAttachment,
            });
            if (!fittedPath) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Failed to resolve persisted path for '${attachment.name}'.`,
              });
            }
            yield* fileSystem
              .writeFile(fittedPath, picture.bytes)
              .pipe(Effect.mapError(claimFailed));
            claimedAttachmentPaths.push(fittedPath);
            return fittedAttachment;
          }

          // Keep the pending copy until the turn succeeds. A failed thread
          // bootstrap can then retry with a fresh thread id. A copy, not a
          // hard link: an agent editing the delivered file in place must not
          // mutate the retry source.
          yield* fileSystem
            .copyFile(claim.currentPath, claim.finalPath)
            .pipe(Effect.mapError(claimFailed));
          claimedAttachmentPaths.push(claim.finalPath);

          return pictureBytes === null
            ? normalizedAttachment
            : withPictureSize(withOriginal, pictureBytes);
        }

        const parsed = parseBase64DataUrl(attachment.dataUrl);
        if (!parsed || !parsed.mimeType.startsWith("image/")) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Invalid image attachment payload for '${attachment.name}'.`,
          });
        }

        const decoded = Buffer.from(parsed.base64, "base64");
        if (decoded.byteLength === 0 || decoded.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Image attachment '${attachment.name}' is empty or too large.`,
          });
        }
        const asset = yield* Effect.promise(() =>
          contentAssetsAt(serverConfig.stateDir).ingestBytes(decoded, {
            threadId: ThreadId.make(threadId),
            ownerId: "inline-upload",
            name: attachment.name,
            mimeType: parsed.mimeType,
            provenance: "upload",
          }),
        );
        const picture = yield* fitPicture(attachment.name, {
          bytes: decoded,
          mimeType: parsed.mimeType,
        });

        const attachmentId = createAttachmentId(threadId);
        if (!attachmentId) {
          return yield* new OrchestrationDispatchCommandError({
            message: "Failed to create a safe attachment id.",
          });
        }

        const decodedAttachment = {
          asset,
          type: "image" as const,
          id: attachmentId,
          name: attachment.name,
          mimeType: parsed.mimeType.toLowerCase(),
          sizeBytes: decoded.byteLength,
        };
        const persistedAttachment =
          picture === null
            ? withPictureSize(decodedAttachment, decoded)
            : withFittedPicture(decodedAttachment, picture);
        const bytes = picture === null ? decoded : picture.bytes;
        attachmentsWithDecodedSizes[index] = persistedAttachment;
        const decodedLimitError = getProviderAttachmentLimitError(attachmentsWithDecodedSizes);
        if (decodedLimitError) {
          return yield* new OrchestrationDispatchCommandError({ message: decodedLimitError });
        }

        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment: persistedAttachment,
        });
        if (!attachmentPath) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Failed to resolve persisted path for '${attachment.name}'.`,
          });
        }

        yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
          Effect.mapError(
            () =>
              new OrchestrationDispatchCommandError({
                message: `Failed to create attachment directory for '${attachment.name}'.`,
              }),
          ),
        );
        yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
          Effect.mapError(
            () =>
              new OrchestrationDispatchCommandError({
                message: `Failed to persist attachment '${attachment.name}'.`,
              }),
          ),
        );
        claimedAttachmentPaths.push(attachmentPath);

        return persistedAttachment;
      }),
    { concurrency: 1 },
  ).pipe(Effect.tapError(() => removeClaimedAttachmentPaths(claimedAttachmentPaths)));
});

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const receivedAt = DateTime.formatIso(yield* DateTime.now);
    const canonicalCommand = canonicalizeClientCommandTimestamps(command, receivedAt);
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    const normalizeProjectWorkspaceRootForCreate = (
      workspaceRoot: string,
      createIfMissing: boolean | undefined,
    ) =>
      workspacePaths
        .normalizeWorkspaceRoot(workspaceRoot, {
          createIfMissing: createIfMissing === true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    if (canonicalCommand.type === "project.create") {
      return {
        ...canonicalCommand,
        workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
          canonicalCommand.workspaceRoot,
          canonicalCommand.createWorkspaceRootIfMissing,
        ),
        createWorkspaceRootIfMissing: canonicalCommand.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
    }

    if (
      canonicalCommand.type === "project.meta.update" &&
      canonicalCommand.workspaceRoot !== undefined
    ) {
      return {
        ...canonicalCommand,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(canonicalCommand.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (
      canonicalCommand.type !== "thread.turn.start" &&
      canonicalCommand.type !== "thread.user-input.respond"
    ) {
      return canonicalCommand as OrchestrationCommand;
    }

    const attachments =
      canonicalCommand.type === "thread.turn.start"
        ? canonicalCommand.message.attachments
        : Object.values(canonicalCommand.attachmentsByQuestionId ?? {}).flat();
    const normalizedAttachments = yield* claimMessageAttachments(
      canonicalCommand.threadId,
      attachments,
    );

    if (canonicalCommand.type === "thread.user-input.respond") {
      let index = 0;
      const attachmentsByQuestionId = Object.fromEntries(
        Object.entries(canonicalCommand.attachmentsByQuestionId ?? {}).map(
          ([questionId, original]) => {
            const claimed = normalizedAttachments.slice(
              index,
              index + original.length,
            ) as UserInputAttachments[string];
            index += original.length;
            return [questionId, claimed];
          },
        ),
      );
      return {
        ...canonicalCommand,
        ...(attachments.length > 0 ? { attachmentsByQuestionId } : {}),
      };
    }
    return {
      ...canonicalCommand,
      message: {
        ...canonicalCommand.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });

/** Removes the copies a claim made, when the message they were claimed for was not sent. */
export const releaseClaimedAttachments = Effect.fn("Normalizer.releaseClaimedAttachments")(
  function* (attachments: ReadonlyArray<ChatAttachment>) {
    const serverConfig = yield* ServerConfig;
    yield* removeClaimedAttachmentPaths(
      attachments.flatMap((attachment) => {
        const claimedPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        return claimedPath === null ? [] : [claimedPath];
      }),
    );
  },
);

export const cleanupFailedUploadedAttachments = Effect.fn(
  "Normalizer.cleanupFailedUploadedAttachments",
)(function* (command: ClientOrchestrationCommand, normalizedCommand: OrchestrationCommand) {
  const originalAttachments =
    command.type === "thread.turn.start"
      ? command.message.attachments
      : command.type === "thread.user-input.respond"
        ? Object.values(command.attachmentsByQuestionId ?? {}).flat()
        : [];
  const normalizedAttachments =
    normalizedCommand.type === "thread.turn.start"
      ? normalizedCommand.message.attachments
      : normalizedCommand.type === "thread.user-input.respond"
        ? Object.values(normalizedCommand.attachmentsByQuestionId ?? {}).flat()
        : [];
  if (normalizedAttachments.length === 0) return;

  const serverConfig = yield* ServerConfig;
  const claimedPaths: string[] = [];
  for (const [index, attachment] of normalizedAttachments.entries()) {
    const original = originalAttachments[index];
    if (
      !original ||
      "dataUrl" in original ||
      parseThreadSegmentFromAttachmentId(original.id) !== PENDING_ATTACHMENT_THREAD_SEGMENT
    ) {
      continue;
    }

    const claimedPath = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment,
    });
    if (claimedPath) {
      claimedPaths.push(claimedPath);
    }
  }
  yield* removeClaimedAttachmentPaths(claimedPaths);
});
