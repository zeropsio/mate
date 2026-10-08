import {
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type ChatAttachment,
  type EnvironmentId,
} from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { create } from "zustand";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import type { ComposerImageAttachment } from "../composerDraftStore";
import { composerUploadExpired, type ComposerFileAttachment } from "./composerFiles";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentCatalog } from "../connection/catalog";
import { attachmentEnvironment } from "../state/attachments";
import { readPreparedConnection } from "../state/session";
import type { AttachmentUploadState, ReadyAttachmentUpload } from "./attachmentUploadState";

const MAX_UPLOADS_PER_ENVIRONMENT = 3;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

interface AttachmentUploadStore {
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
}

export const useAttachmentUploadStore = create<AttachmentUploadStore>(() => ({
  uploadsByImageId: {},
}));

/**
 * One file to upload. An image uploads its file under its own id; a picture
 * that keeps its original also uploads the pasted file, as a plain file (so no
 * provider looks at it), under `pictureOriginalUploadKey(id)`.
 */
interface UploadItem {
  readonly key: string;
  readonly kind: "image" | "file";
  readonly name: string;
  readonly mimeType: string;
  readonly file: File;
}

/** Where a picture's original upload is kept, beside the picture's own. */
export function pictureOriginalUploadKey(imageId: string): string {
  return `${imageId}~original`;
}

function keptOriginal(image: ComposerImageAttachment): File | null {
  return image.picture?.source ?? null;
}

/** Every upload an image makes: its own, and its original's when it keeps one. */
export function attachmentUploadKeys(image: ComposerImageAttachment): string[] {
  return keptOriginal(image) ? [image.id, pictureOriginalUploadKey(image.id)] : [image.id];
}

function imageUploadItem(image: ComposerImageAttachment): UploadItem {
  return {
    key: image.id,
    kind: "image",
    name: image.name,
    mimeType: image.mimeType,
    file: image.file,
  };
}

function originalUploadItem(image: ComposerImageAttachment, original: File): UploadItem {
  return {
    key: pictureOriginalUploadKey(image.id),
    kind: "file",
    name: original.name || image.name,
    mimeType: original.type || "application/octet-stream",
    file: original,
  };
}

interface UploadJob {
  readonly item: UploadItem;
  readonly environmentId: EnvironmentId;
  readonly previous?: ReadyAttachmentUpload;
  readonly settled: Promise<void>;
  resolveSettled: () => void;
  attachmentId: string | null;
  cancelled: boolean;
  abort: (() => void) | null;
  stopWatchingConnection: () => void;
}

// Failed jobs retain their source and connection subscription until retry or release.
const jobsByImageId = new Map<string, UploadJob>();
const queue: UploadJob[] = [];
const activeUploadsByEnvironment = new Map<EnvironmentId, number>();

function setUploadState(imageId: string, upload: AttachmentUploadState): void {
  useAttachmentUploadStore.setState((state) => ({
    uploadsByImageId: { ...state.uploadsByImageId, [imageId]: upload },
  }));
}

function clearUploadState(imageId: string): void {
  useAttachmentUploadStore.setState((state) => {
    if (!(imageId in state.uploadsByImageId)) {
      return state;
    }
    const uploadsByImageId = { ...state.uploadsByImageId };
    delete uploadsByImageId[imageId];
    return { uploadsByImageId };
  });
}

export function readAttachmentUpload(imageId: string): AttachmentUploadState | undefined {
  return useAttachmentUploadStore.getState().uploadsByImageId[imageId];
}

function deletePendingUpload(environmentId: EnvironmentId, attachmentId: string): void {
  void runAtomCommand(
    appAtomRegistry,
    attachmentEnvironment.remove,
    { environmentId, input: { attachmentId } },
    { reportFailure: false, reportDefect: false },
  );
}

function uploadBytes(input: {
  readonly url: string;
  readonly file: File;
  readonly onProgress: (progress: number) => void;
}): { readonly done: Promise<void>; readonly abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("POST", input.url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", input.file.type);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(xhr.status === 507 ? "Storage full" : `Upload rejected (${xhr.status})`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.send(input.file);
  });

  return { done, abort: () => xhr.abort() };
}

async function runUpload(job: UploadJob): Promise<void> {
  const { item } = job;
  const imageMimeType = PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES.find(
    (supportedMimeType) => supportedMimeType === item.mimeType.toLowerCase(),
  );
  const input =
    item.kind === "file"
      ? ({
          type: "file",
          name: item.name,
          mimeType: item.mimeType,
          sizeBytes: item.file.size,
        } as const)
      : imageMimeType
        ? { name: item.name, mimeType: imageMimeType, sizeBytes: item.file.size }
        : null;
  if (input === null) {
    setUploadState(item.key, {
      status: "failed",
      environmentId: job.environmentId,
      reason: "Unsupported image type",
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }

  const minted = await runAtomCommand(
    appAtomRegistry,
    attachmentEnvironment.createUploadUrl,
    {
      environmentId: job.environmentId,
      input,
    },
    { reportFailure: false },
  );
  if (job.cancelled) {
    if (minted._tag === "Success") {
      deletePendingUpload(job.environmentId, minted.value.attachmentId);
    }
    return;
  }
  if (minted._tag !== "Success") {
    setUploadState(item.key, {
      status: "failed",
      environmentId: job.environmentId,
      reason: "Upload could not start",
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }
  job.attachmentId = minted.value.attachmentId;

  const connection = readPreparedConnection(job.environmentId);
  const url = connection ? resolveAssetUrl(connection.httpBaseUrl, minted.value.relativeUrl) : null;
  if (!url) {
    setUploadState(item.key, {
      status: "failed",
      environmentId: job.environmentId,
      reason: "Not connected",
      attachmentId: minted.value.attachmentId,
      ...(job.previous ? { previous: job.previous } : {}),
    });
    return;
  }

  let lastStep = -1;
  const upload = uploadBytes({
    url,
    file: item.file,
    onProgress: (progress) => {
      const step = Math.floor(progress * 20);
      if (step === lastStep || job.cancelled) {
        return;
      }
      lastStep = step;
      setUploadState(item.key, {
        status: "uploading",
        environmentId: job.environmentId,
        progress,
        ...(job.previous ? { previous: job.previous } : {}),
      });
    },
  });
  job.abort = upload.abort;

  try {
    await upload.done;
    if (job.cancelled) {
      return;
    }
    setUploadState(item.key, {
      status: "ready",
      environmentId: job.environmentId,
      attachmentId: minted.value.attachmentId,
    });
    if (job.previous) {
      deletePendingUpload(job.previous.environmentId, job.previous.attachmentId);
    }
  } catch (error) {
    if (job.cancelled) {
      return;
    }
    setUploadState(item.key, {
      status: "failed",
      environmentId: job.environmentId,
      reason: error instanceof Error ? error.message : "Upload failed",
      attachmentId: minted.value.attachmentId,
      ...(job.previous ? { previous: job.previous } : {}),
    });
  } finally {
    job.abort = null;
  }
}

function pumpUploads(): void {
  for (let index = 0; index < queue.length;) {
    const job = queue[index]!;
    const active = activeUploadsByEnvironment.get(job.environmentId) ?? 0;
    if (active >= MAX_UPLOADS_PER_ENVIRONMENT) {
      index += 1;
      continue;
    }

    queue.splice(index, 1);
    if (job.cancelled) {
      continue;
    }
    activeUploadsByEnvironment.set(job.environmentId, active + 1);
    void runUpload(job)
      .catch(() => {
        if (!job.cancelled) {
          setUploadState(job.item.key, {
            status: "failed",
            environmentId: job.environmentId,
            reason: "Upload failed",
            ...(job.previous ? { previous: job.previous } : {}),
          });
        }
      })
      .finally(() => {
        if (
          jobsByImageId.get(job.item.key) === job &&
          readAttachmentUpload(job.item.key)?.status !== "failed"
        ) {
          job.stopWatchingConnection();
          jobsByImageId.delete(job.item.key);
        }
        const remaining = (activeUploadsByEnvironment.get(job.environmentId) ?? 1) - 1;
        if (remaining > 0) {
          activeUploadsByEnvironment.set(job.environmentId, remaining);
        } else {
          activeUploadsByEnvironment.delete(job.environmentId);
        }
        job.resolveSettled();
        pumpUploads();
      });
  }
}

/**
 * Starts an image's upload, and its picture's original's when it keeps one; a
 * picture that no longer keeps its original lets that upload go.
 */
export function startAttachmentUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly image: ComposerImageAttachment;
}): void {
  startUpload(input.environmentId, imageUploadItem(input.image));
  const original = keptOriginal(input.image);
  if (original) {
    startUpload(input.environmentId, originalUploadItem(input.image, original));
  } else if (readAttachmentUpload(pictureOriginalUploadKey(input.image.id))) {
    releaseUpload(pictureOriginalUploadKey(input.image.id));
  }
}

function startUpload(environmentId: EnvironmentId, item: UploadItem): void {
  const input = { environmentId, item };
  const existingJob = jobsByImageId.get(item.key);
  if (existingJob?.environmentId === input.environmentId) {
    return;
  }

  const existing = readAttachmentUpload(item.key);
  if (existing?.status === "ready" && existing.environmentId === input.environmentId) {
    return;
  }
  if (existing?.status === "failed" && existing.environmentId === input.environmentId) {
    return;
  }
  if (
    existing &&
    "previous" in existing &&
    existing.previous?.environmentId === input.environmentId
  ) {
    cancelAttachmentUpload(item.key);
    if (existing.status === "failed" && existing.attachmentId) {
      deletePendingUpload(existing.environmentId, existing.attachmentId);
    }
    setUploadState(item.key, existing.previous);
    return;
  }

  if (existingJob) {
    cancelAttachmentUpload(item.key);
  }
  const previous = existing?.status === "ready" ? existing : existing?.previous;
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const job: UploadJob = {
    item,
    environmentId: input.environmentId,
    ...(previous ? { previous } : {}),
    settled,
    resolveSettled,
    attachmentId: null,
    cancelled: false,
    abort: null,
    stopWatchingConnection: () => {},
  };

  jobsByImageId.set(item.key, job);
  const connectionAtom = environmentCatalog.stateAtom(job.environmentId);
  const isConnected = () =>
    Option.exists(
      AsyncResult.value(appAtomRegistry.get(connectionAtom)),
      (state) => state.phase === "connected",
    );
  let wasConnected = isConnected();
  job.stopWatchingConnection = appAtomRegistry.subscribe(connectionAtom, () => {
    const connected = isConnected();
    const reconnected = connected && !wasConnected;
    wasConnected = connected;
    if (!reconnected) return;
    // The HTTP failure can arrive after the socket has already reconnected.
    // Wait for that attempt, then retry only if this job still owns the file.
    void job.settled.then(() => {
      const outcome = readAttachmentUpload(job.item.key);
      if (
        jobsByImageId.get(job.item.key) === job &&
        outcome?.status === "failed" &&
        outcome.reason !== "Storage full" &&
        isConnected()
      ) {
        retryUpload(input.environmentId, item);
      }
    });
  });
  queue.push(job);
  setUploadState(item.key, {
    status: "uploading",
    environmentId: input.environmentId,
    progress: 0,
    ...(previous ? { previous } : {}),
  });
  pumpUploads();
}

function cancelAttachmentUpload(imageId: string): void {
  const job = jobsByImageId.get(imageId);
  if (!job) {
    return;
  }
  job.cancelled = true;
  job.stopWatchingConnection();
  jobsByImageId.delete(imageId);
  const queuedIndex = queue.indexOf(job);
  if (queuedIndex !== -1) {
    queue.splice(queuedIndex, 1);
  }
  job.abort?.();
  if (job.attachmentId) {
    deletePendingUpload(job.environmentId, job.attachmentId);
  }
  job.resolveSettled();
}

/** Lets an image's uploads go: its own and its original's. */
export function releaseAttachmentUpload(imageId: string): void {
  releaseUpload(imageId);
  releaseUpload(pictureOriginalUploadKey(imageId));
}

/** Lets a picture's copy upload go, keeping its original's: the copy was made again. */
export function releasePictureCopyUpload(imageId: string): void {
  releaseUpload(imageId);
}

function releaseUpload(imageId: string): void {
  const upload = readAttachmentUpload(imageId);
  cancelAttachmentUpload(imageId);
  if (upload?.status === "ready") {
    deletePendingUpload(upload.environmentId, upload.attachmentId);
  } else if (upload) {
    if (upload.status === "failed" && upload.attachmentId) {
      deletePendingUpload(upload.environmentId, upload.attachmentId);
    }
    if (upload.previous) {
      deletePendingUpload(upload.previous.environmentId, upload.previous.attachmentId);
    }
  }
  clearUploadState(imageId);
}

/** Tries an image's upload again, and its original's when that one failed. */
export function retryAttachmentUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly image: ComposerImageAttachment;
}): void {
  retryUpload(input.environmentId, imageUploadItem(input.image));
  const original = keptOriginal(input.image);
  if (
    original &&
    readAttachmentUpload(pictureOriginalUploadKey(input.image.id))?.status === "failed"
  ) {
    retryUpload(input.environmentId, originalUploadItem(input.image, original));
  }
}

function retryUpload(environmentId: EnvironmentId, item: UploadItem): void {
  const previous = readAttachmentUpload(item.key);
  cancelAttachmentUpload(item.key);
  if (previous?.status === "failed" && previous.attachmentId) {
    deletePendingUpload(previous.environmentId, previous.attachmentId);
  }
  if (previous && "previous" in previous && previous.previous) {
    setUploadState(item.key, previous.previous);
  } else {
    clearUploadState(item.key);
  }
  startUpload(environmentId, item);
}

function fileUploadItem(file: ComposerFileAttachment, bytes: File): UploadItem {
  return {
    key: file.id,
    kind: "file",
    name: file.name,
    mimeType: file.mimeType || "application/octet-stream",
    file: bytes,
  };
}

/**
 * Starts a file's upload. A file a reload brought back has no bytes, only
 * the upload it finished: it stands uploaded where it went for a day (the
 * server lets an unsent upload go then), and elsewhere or later it cannot go
 * (the person attaches it again).
 */
export function startFileUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly file: ComposerFileAttachment;
}): void {
  const { environmentId, file } = input;
  if (file.file !== null) {
    startUpload(environmentId, fileUploadItem(file, file.file));
    return;
  }
  const existing = readAttachmentUpload(file.id);
  if (existing?.environmentId === environmentId) return;
  const uploaded = file.uploaded;
  setUploadState(
    file.id,
    uploaded?.environmentId !== environmentId
      ? { status: "failed", environmentId, reason: "Attach the file again to send it here" }
      : composerUploadExpired(uploaded, Date.now())
        ? { status: "failed", environmentId, reason: "Its upload expired. Attach the file again" }
        : { status: "ready", environmentId, attachmentId: uploaded.attachmentId },
  );
}

/** Tries a file's upload again, when its bytes are still here. */
export function retryFileUpload(input: {
  readonly environmentId: EnvironmentId;
  readonly file: ComposerFileAttachment;
}): void {
  if (input.file.file === null) return;
  retryUpload(input.environmentId, fileUploadItem(input.file, input.file.file));
}

export async function awaitAttachmentUploads(imageIds: ReadonlyArray<string>): Promise<void> {
  await Promise.all(
    imageIds.flatMap((imageId) => [
      jobsByImageId.get(imageId)?.settled,
      jobsByImageId.get(pictureOriginalUploadKey(imageId))?.settled,
    ]),
  );
}

/**
 * What the message carries, once every upload is up: its files first, in the
 * order they sit, then its images, each with its kept original right after it
 * (that is how an original is known, so no file may follow an image).
 */
export function getUploadedAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly files?: ReadonlyArray<ComposerFileAttachment>;
}): ChatAttachment[] | null {
  const attachments: ChatAttachment[] = [];
  const readyId = (key: string): string | null => {
    const upload = readAttachmentUpload(key);
    return upload?.status === "ready" && upload.environmentId === input.environmentId
      ? upload.attachmentId
      : null;
  };
  for (const file of input.files ?? []) {
    const id = readyId(file.id);
    if (id === null) return null;
    attachments.push({
      type: "file",
      id,
      name: file.name,
      mimeType: file.mimeType || "application/octet-stream",
      sizeBytes: file.sizeBytes,
    });
  }
  for (const image of input.images) {
    const id = readyId(image.id);
    if (id === null) return null;
    const source = keptOriginal(image);
    const sourceAttachmentId = source ? readyId(pictureOriginalUploadKey(image.id)) : null;
    if (source && sourceAttachmentId === null) return null;
    attachments.push({
      ...(sourceAttachmentId === null ? {} : { sourceAttachmentId }),
      type: "image",
      id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      ...(image.picture ? { width: image.picture.width, height: image.picture.height } : {}),
    });
    const original = keptOriginal(image);
    if (original && image.picture?.keepOriginal) {
      const item = originalUploadItem(image, original);
      const originalId = readyId(item.key);
      if (originalId === null) return null;
      attachments.push({
        type: "file",
        id: originalId,
        name: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.file.size,
      });
    }
  }
  return attachments;
}

/** Lets the uploads of images or files go. */
export function releaseAttachmentUploads(
  attachments: ReadonlyArray<{ readonly id: string }>,
): void {
  for (const attachment of attachments) {
    releaseAttachmentUpload(attachment.id);
  }
}
