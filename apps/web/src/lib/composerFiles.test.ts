import { PROVIDER_SEND_TURN_MAX_FILE_BYTES } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  INLINE_FILE_PLACEHOLDER as F,
  composerAttachmentCount,
  composerAttachmentRoute,
  countInlineFilePlaceholders,
  fileChipName,
  hydrateComposerFiles,
  insertInlineFilePlaceholder,
  normalizePersistedComposerFile,
  optimisticFileAttachments,
  persistedComposerFiles,
  reconcileInlineFilePlaceholders,
  removeInlineFilePlaceholder,
  restoreFilePlaces,
  stripInlineFilePlaceholders,
  type ComposerFileAttachment,
} from "./composerFiles";
import { INLINE_PICTURE_PLACEHOLDER as P } from "./composerPictures";

const file = (id: string, extra: Partial<ComposerFileAttachment> = {}): ComposerFileAttachment => ({
  type: "file",
  id,
  name: `${id}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 2048,
  file: null,
  uploaded: null,
  ...extra,
});

describe("file placeholders in the prompt", () => {
  it("is a character of its own, not a picture's", () => {
    expect(F).not.toBe(P);
    expect(F).not.toBe("￼");
  });

  it.each([
    ["at the start, the words going on below", "abc", 0, `${F}\nabc`, 2, 0],
    ["between words", "ab", 1, `a${F}\nb`, 3, 0],
    ["after another file", `a${F}b`, 3, `a${F}b${F}\n`, 5, 1],
    ["before another file", `a${F}b`, 0, `${F}\na${F}b`, 2, 0],
    ["pictures do not count", `${P}${P}x`, 3, `${P}${P}x${F}\n`, 5, 0],
    ["a cursor past the end lands at the end", "ab", 99, `ab${F}\n`, 4, 0],
    ["on the empty line under a row it joins the row", `${P}${F}\n`, 3, `${P}${F}${F}\n`, 4, 1],
    ["a line break already there is kept, not doubled", "a\nb", 1, `a${F}\nb`, 3, 0],
  ])("inserts %s", (_label, prompt, cursor, expected, expectedCursor, fileIndex) => {
    expect(insertInlineFilePlaceholder(prompt, cursor)).toEqual({
      prompt: expected,
      cursor: expectedCursor,
      fileIndex,
    });
  });

  it.each([
    ["the first", `a${F}b${F}c`, 0, `ab${F}c`, 1],
    ["the second", `a${F}b${F}c`, 1, `a${F}bc`, 3],
    ["one that is not there", `a${F}b`, 3, `a${F}b`, 3],
    ["past a picture", `${P}${F}`, 0, P, 1],
    ["alone on its line, with the line", `a\n${F}\nb`, 0, "a\nb", 2],
    ["first in the prompt and alone, with its line", `${F}\nb`, 0, "b", 0],
  ])("removes %s", (_label, prompt, index, expected, cursor) => {
    expect(removeInlineFilePlaceholder(prompt, index)).toEqual({ prompt: expected, cursor });
  });

  it.each([
    ["as many places as files", `a${F}b`, 1, `a${F}b`],
    ["a place past the last file leaves", `a${F}b${F}c`, 1, `a${F}bc`],
    ["a missing place goes first", "ab", 2, `${F}${F}ab`],
    ["no files, no places", `${F}a${F}`, 0, "a"],
  ])("reconciles: %s", (_label, prompt, count, expected) => {
    expect(reconcileInlineFilePlaceholders(prompt, count)).toBe(expected);
  });

  it("counts and strips them", () => {
    expect(countInlineFilePlaceholders(`${F}a${P}${F}`)).toBe(2);
    expect(stripInlineFilePlaceholders(`${F}a${P}${F}`)).toBe(`a${P}`);
  });
});

describe("restoreFilePlaces", () => {
  it.each([
    ["every file kept", `a${F}b${F}`, ["x", "y"], ["y", "x"], `a${F}b${F}`, ["x", "y"]],
    ["a file not kept leaves its place", `a${F}b${F}c`, ["x", "y"], ["y"], `ab${F}c`, ["y"]],
    ["none kept", `${F}a${F}`, ["x", "y"], [], "a", []],
    ["no ids saved: places match the files", `${F}a${F}`, undefined, ["x"], `${F}a`, ["x"]],
  ])("%s", (_label, prompt, fileIds, kept, expectedPrompt, expectedIds) => {
    const restored = restoreFilePlaces(
      prompt,
      fileIds,
      kept.map((id) => file(id)),
    );
    expect(restored.prompt).toBe(expectedPrompt);
    expect(restored.files.map((entry) => entry.id)).toEqual(expectedIds);
  });
});

describe("composerAttachmentRoute", () => {
  it.each([
    ["a PNG", "shot.png", "image/png", 10, { kind: "picture" }],
    ["a JPEG", "a.jpg", "image/jpeg", 10, { kind: "picture" }],
    ["a WebP", "a.webp", "image/webp", 10, { kind: "picture" }],
    ["a GIF", "a.gif", "image/gif", 10, { kind: "picture" }],
    ["a HEIC", "a.heic", "image/heic", 10, { kind: "picture" }],
    ["a HEIC the browser could not type", "IMG_1.HEIC", "", 10, { kind: "picture" }],
    ["an SVG", "logo.svg", "image/svg+xml", 10, { kind: "file" }],
    ["a BMP", "a.bmp", "image/bmp", 10, { kind: "file" }],
    ["a PDF", "spec.pdf", "application/pdf", 10, { kind: "file" }],
    ["a ZIP", "src.zip", "application/zip", 10, { kind: "file" }],
    ["a file without a type", "Makefile", "", 10, { kind: "file" }],
    ["a file of exactly 50 MB", "big.zip", "", PROVIDER_SEND_TURN_MAX_FILE_BYTES, { kind: "file" }],
    [
      "a file over 50 MB",
      "huge.zip",
      "application/zip",
      PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1,
      { kind: "refused", message: "'huge.zip' is larger than 50 MB." },
    ],
    [
      "an empty file",
      "empty.txt",
      "text/plain",
      0,
      { kind: "refused", message: "'empty.txt' is empty." },
    ],
  ])("%s", (_label, name, type, size, expected) => {
    expect(composerAttachmentRoute({ name, type, size })).toEqual(expected);
  });
});

describe("fileChipName", () => {
  it.each([
    ["a short name stays", "spec.pdf", 24, "spec.pdf"],
    [
      "a long name keeps its extension",
      "quarterly-report-final-v2.pdf",
      20,
      "quarterly-repor….pdf",
    ],
    ["a name without an extension cuts at the end", "a-very-long-makefile-name", 10, "a-very-lo…"],
    [
      "an extension too long to keep cuts at the end",
      "notes.averyveryverylongext",
      12,
      "notes.avery…",
    ],
    ["a dotted name keeps its last part", ".env.production.local", 12, ".env.….local"],
  ])("%s", (_label, name, max, expected) => {
    const shown = fileChipName(name, max);
    expect(shown).toBe(expected);
    expect(shown.length).toBeLessThanOrEqual(max);
  });
});

describe("files in a sent message", () => {
  it("shows each file at once, as it goes", () => {
    expect(optimisticFileAttachments([file("a"), file("b", { mimeType: "" })])).toEqual([
      { type: "file", id: "a", name: "a.pdf", mimeType: "application/pdf", sizeBytes: 2048 },
      {
        type: "file",
        id: "b",
        name: "b.pdf",
        mimeType: "application/octet-stream",
        sizeBytes: 2048,
      },
    ]);
  });

  it.each([
    ["nothing", [], [], 0],
    ["pictures and files", [{}, {}], [file("a")], 3],
    ["a picture's kept original counts", [{ keep: true }, {}], [file("a")], 4],
  ])("counts %s against the limit", (_label, images, files, expected) => {
    const shaped = images.map((image: { keep?: boolean }) => ({
      picture: image.keep ? { keepOriginal: true, source: new Blob() } : undefined,
    }));
    expect(composerAttachmentCount(shaped, files)).toBe(expected);
  });
});

describe("files a draft keeps for a reload", () => {
  const uploaded = { environmentId: "env-1", attachmentId: "att-1", uploadedAt: 1_000 };

  it("keeps only the uploaded files, never their bytes", () => {
    const bytes = new File(["x"], "a.pdf");
    expect(
      persistedComposerFiles([file("a", { file: bytes, uploaded }), file("b", { file: bytes })]),
    ).toEqual([
      {
        id: "a",
        name: "a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        environmentId: "env-1",
        attachmentId: "att-1",
        uploadedAt: 1_000,
      },
    ]);
  });

  it("brings them back uploaded, without bytes", () => {
    const [restored] = hydrateComposerFiles(persistedComposerFiles([file("a", { uploaded })]));
    expect(restored).toEqual(file("a", { uploaded }));
  });

  it.each([
    ["a whole entry", { ...uploaded, id: "a", name: "a", mimeType: "x/y", sizeBytes: 1 }, true],
    ["no attachment id", { id: "a", name: "a", mimeType: "x/y", sizeBytes: 1 }, false],
    ["no id", { ...uploaded, name: "a", mimeType: "x/y", sizeBytes: 1 }, false],
    [
      "a size that is no number",
      { ...uploaded, id: "a", name: "a", mimeType: "", sizeBytes: "1" },
      false,
    ],
    ["not an object", "a", false],
  ])("reads %s", (_label, value, kept) => {
    expect(normalizePersistedComposerFile(value) !== null).toBe(kept);
  });

  it("reads a file saved without its upload's time as long expired", () => {
    const { uploadedAt: _uploadedAt, ...untimed } = uploaded;
    expect(
      normalizePersistedComposerFile({ ...untimed, id: "a", name: "a", mimeType: "", sizeBytes: 1 })
        ?.uploadedAt,
    ).toBe(0);
  });
});
