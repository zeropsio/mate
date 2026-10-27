import type { EnvironmentId } from "@t3tools/contracts";

export type ReadyAttachmentUpload = {
  readonly status: "ready";
  readonly environmentId: EnvironmentId;
  readonly attachmentId: string;
};

export type AttachmentUploadState =
  | {
      readonly status: "uploading";
      readonly environmentId: EnvironmentId;
      readonly progress: number;
      readonly previous?: ReadyAttachmentUpload;
    }
  | ReadyAttachmentUpload
  | {
      readonly status: "failed";
      readonly environmentId: EnvironmentId;
      readonly reason: string;
      readonly attachmentId?: string;
      readonly previous?: ReadyAttachmentUpload;
    };

export function attachmentUploadBlockReason(input: {
  readonly imageIds: ReadonlyArray<string>;
  /** The draft's files, which upload beside its pictures. */
  readonly fileIds?: ReadonlyArray<string>;
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
  readonly environmentId: EnvironmentId;
}): string | null {
  const count = (ids: ReadonlyArray<string>) => {
    let pending = 0;
    let failed = 0;
    for (const id of ids) {
      const upload = input.uploadsByImageId[id];
      if (upload?.status === "failed" && upload.environmentId === input.environmentId) {
        failed += 1;
      } else if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) {
        pending += 1;
      }
    }
    return { pending, failed };
  };
  const images = count(input.imageIds);
  const files = count(input.fileIds ?? []);
  // What is held up, in its own word: images, files, or both as attachments.
  const noun = (imageCount: number, fileCount: number, one: boolean) =>
    imageCount > 0 && fileCount > 0
      ? "attachments"
      : fileCount > 0
        ? one
          ? "file"
          : "files"
        : one
          ? "image"
          : "images";

  const failed = images.failed + files.failed;
  if (failed > 0) {
    const full = [...input.imageIds, ...(input.fileIds ?? [])].some((id) => {
      const upload = input.uploadsByImageId[id];
      return (
        upload?.status === "failed" &&
        upload.environmentId === input.environmentId &&
        upload.reason === "Storage full"
      );
    });
    return `${full ? "Storage full. " : ""}Retry or remove the failed ${noun(images.failed, files.failed, failed === 1)}`;
  }
  const pending = images.pending + files.pending;
  if (pending > 0) {
    const word = noun(images.pending, files.pending, pending === 1);
    return `${word.charAt(0).toUpperCase()}${word.slice(1)} still uploading`;
  }
  return null;
}

export function formatAttachmentUploadProgress(progress: number): string {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${Math.floor(bounded * 100)}%`;
}
