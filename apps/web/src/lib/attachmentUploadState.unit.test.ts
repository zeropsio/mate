import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  attachmentUploadBlockReason,
  type AttachmentUploadState,
} from "./attachmentUploadState.ts";

const active = EnvironmentId.make("env-rye");
const other = EnvironmentId.make("env-wheat");
const ready = (environmentId: EnvironmentId, attachmentId: string): AttachmentUploadState => ({
  status: "ready",
  environmentId,
  attachmentId,
});

const waits = (
  uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>,
  fileIds: ReadonlyArray<string> = [],
) =>
  attachmentUploadBlockReason({
    imageIds: ["photo"],
    fileIds,
    uploadsByImageId,
    environmentId: active,
  }) !== null;

// witness: apps/web/src/lib/attachmentUploadState.ts | } else if (upload?.status !== "ready" || upload.environmentId !== input.environmentId) { → } else if (upload?.status !== "ready") {
it("WL2: A message waits while any of its attachments is missing, uploading or failed, and an upload to another environment than the active one is not accepted", () => {
  expect(waits({ photo: ready(active, "a-1"), notes: ready(active, "a-2") }, ["notes"])).toBe(
    false,
  );

  expect(waits({ photo: ready(active, "a-1") }, ["notes"])).toBe(true);
  expect(
    waits(
      {
        photo: ready(active, "a-1"),
        notes: { status: "uploading", environmentId: active, progress: 0.5 },
      },
      ["notes"],
    ),
  ).toBe(true);
  expect(
    waits({ photo: { status: "failed", environmentId: active, reason: "Upload failed" } }),
  ).toBe(true);
  expect(waits({ photo: ready(other, "a-1") })).toBe(true);
});
