import { expect, it } from "vite-plus/test";
import {
  composerUploadExpired,
  hydrateComposerFiles,
  normalizePersistedComposerFile,
  persistedComposerFiles,
  type ComposerFileAttachment,
} from "./composerFiles.ts";

const now = Date.parse("2026-11-20T10:00:00Z");
const uploadedAt = Date.parse("2026-11-20T09:00:00Z");

const uploaded: ComposerFileAttachment = {
  type: "file",
  id: "file-menu",
  name: "menu.pdf",
  mimeType: "application/pdf",
  sizeBytes: 5,
  file: new File(["%PDF-"], "menu.pdf", { type: "application/pdf" }),
  uploaded: { environmentId: "env-rye", attachmentId: "att-menu", uploadedAt },
};
const notUploaded: ComposerFileAttachment = {
  ...uploaded,
  id: "file-prices",
  name: "prices.zip",
  mimeType: "application/zip",
  uploaded: null,
};

// witness: apps/web/src/lib/composerFiles.ts | uploadedAt: typeof uploadedAt === "number" && Number.isFinite(uploadedAt) ? uploadedAt : 0, → uploadedAt: Number(uploadedAt),
it("WL+2: A draft kept for a reload keeps only uploaded files, never their bytes, and a file without its upload's time reads expired", () => {
  expect(persistedComposerFiles([uploaded, notUploaded])).toEqual([
    {
      id: "file-menu",
      name: "menu.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      environmentId: "env-rye",
      attachmentId: "att-menu",
      uploadedAt,
    },
  ]);

  const timeless = {
    id: "file-menu",
    name: "menu.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5,
    environmentId: "env-rye",
    attachmentId: "att-menu",
  };
  const restored = normalizePersistedComposerFile(timeless);
  expect(restored).not.toBeNull();
  expect(composerUploadExpired(restored!, now)).toBe(true);
  const [hydrated] = hydrateComposerFiles([timeless]);
  expect(hydrated?.file).toBeNull();
  expect(composerUploadExpired(hydrated!.uploaded!, now)).toBe(true);
});
