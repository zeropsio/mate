import { splitPictureText } from "@t3tools/shared/composerPictures";
import { describe, expect, it } from "vite-plus/test";

import {
  INLINE_PICTURE_PLACEHOLDER as P,
  countInlinePicturePlaceholders,
  cropPictureMarks,
  ensureInlinePicturePlaceholders,
  insertInlinePicturePlaceholder,
  isFullPictureCrop,
  materializePicturePrompt,
  optimisticPictureAttachments,
  pictureMarkAt,
  pictureNeedsNewCopy,
  picturesBlockReason,
  pictureThumbSize,
  reconcileInlinePicturePlaceholders,
  removeInlinePicturePlaceholder,
  restorePicturePlaces,
  stripInlinePicturePlaceholders,
  type ComposerPicture,
  type PictureMark,
} from "./composerPictures";

const pin = (id: string, x: number, y: number, note = ""): PictureMark => ({
  kind: "pin",
  id,
  x,
  y,
  note,
});
const box = (id: string, x: number, y: number, w: number, h: number, note = ""): PictureMark => ({
  kind: "box",
  id,
  x,
  y,
  w,
  h,
  note,
});
const withNotes = (...notes: string[]) => ({
  picture: { marks: notes.map((note, index) => pin(`m${index}`, 1, 1, note)) },
});

describe("picture placeholders in the prompt", () => {
  it.each([
    ["an empty prompt, the caret below it", "", 0, `${P}\n`, 2, 0],
    [
      "between words, where the caret is, the rest of the line below it",
      "feels off:Can you",
      10,
      `feels off:${P}\nCan you`,
      12,
      0,
    ],
    ["after an earlier picture", `a${P}b`, 3, `a${P}b${P}\n`, 5, 1],
    ["before an earlier picture", `a${P}b`, 0, `${P}\na${P}b`, 2, 0],
    ["a caret past the end lands at the end", "ab", 99, `ab${P}\n`, 4, 0],
    ["on the empty line under a row, beside the row", `look:${P}\n`, 7, `look:${P}${P}\n`, 8, 1],
    ["right after a row, beside it, the caret below", `look:${P}`, 6, `look:${P}${P}\n`, 8, 1],
    [
      "at the start of words under a row, a row of its own",
      `${P}\nmore`,
      2,
      `${P}\n${P}\nmore`,
      4,
      1,
    ],
    ["a blank line under a row keeps them apart", `${P}\n\n`, 3, `${P}\n\n${P}\n`, 5, 1],
  ])("%s", (_label, prompt, cursor, expectedPrompt, expectedCursor, expectedIndex) => {
    expect(insertInlinePicturePlaceholder(prompt, cursor)).toEqual({
      prompt: expectedPrompt,
      cursor: expectedCursor,
      pictureIndex: expectedIndex,
    });
  });

  it.each([
    ["the first of two", `a${P}b${P}c`, 0, `ab${P}c`, 1],
    ["the second of two", `a${P}b${P}c`, 1, `a${P}bc`, 3],
    ["one that is not there", `a${P}b`, 3, `a${P}b`, 3],
    ["one alone on its line, with its line", `look:\n${P}\nmore`, 0, "look:\nmore", 6],
    ["one of a row, the row's line kept", `${P}${P}\nmore`, 1, `${P}\nmore`, 1],
    ["one after words, the words' line kept", `look:${P}\nmore`, 0, "look:\nmore", 5],
  ])("removes %s", (_label, prompt, index, expectedPrompt, expectedCursor) => {
    expect(removeInlinePicturePlaceholder(prompt, index)).toEqual({
      prompt: expectedPrompt,
      cursor: expectedCursor,
    });
  });

  it.each([
    ["as many as pictures", `a${P}b`, 1, `a${P}b`],
    ["missing ones go first, where pictures used to go", "hello", 2, `${P}${P}hello`],
    ["more places than pictures are kept for the editor to drop", `${P}${P}`, 1, `${P}${P}`],
  ])("ensures %s", (_label, prompt, count, expected) => {
    expect(ensureInlinePicturePlaceholders(prompt, count)).toBe(expected);
  });

  it.each([
    ["one place per picture stays", `a${P}b${P}`, 2, `a${P}b${P}`],
    ["a place past the last picture leaves", `a${P}b${P}c`, 1, `a${P}bc`],
    ["a missing place goes first", "a", 1, `${P}a`],
  ])("reconciles %s", (_label, prompt, count, expected) => {
    expect(reconcileInlinePicturePlaceholders(prompt, count)).toBe(expected);
  });

  it.each([
    ["nothing preparing", [{ picture: { preparing: false } }, {}], null],
    ["one preparing", [{ picture: { preparing: true } }], "Picture still preparing"],
    [
      "two preparing",
      [{ picture: { preparing: true } }, { picture: { preparing: true } }],
      "Pictures still preparing",
    ],
  ])("blocks the send with %s", (_label, images, expected) => {
    expect(picturesBlockReason(images)).toBe(expected);
  });

  it("counts and strips them", () => {
    expect(countInlinePicturePlaceholders(`${P}a${P}￼`)).toBe(2);
    expect(stripInlinePicturePlaceholders(`${P}a${P}￼`)).toBe("a￼");
  });
});

describe("restorePicturePlaces", () => {
  const saved = (...ids: string[]) => ids.map((id) => ({ id }));
  it.each([
    [
      "every picture back, each in its place",
      `a${P}b${P}`,
      ["one", "two"],
      saved("one", "two"),
      `a${P}b${P}`,
      ["one", "two"],
    ],
    [
      "saved in another order, back in the text's",
      `a${P}b${P}`,
      ["one", "two"],
      saved("two", "one"),
      `a${P}b${P}`,
      ["one", "two"],
    ],
    [
      "a picture that could not be kept leaves its place",
      `a${P}b${P}c${P}`,
      ["one", "two", "three"],
      saved("one", "three"),
      `a${P}bc${P}`,
      ["one", "three"],
    ],
    [
      "a draft saved before pictures were named keeps its text",
      `a${P}b`,
      undefined,
      saved("one"),
      `a${P}b`,
      ["one"],
    ],
  ])("%s", (_label, prompt, pictureIds, attachments, expectedPrompt, expectedIds) => {
    const restored = restorePicturePlaces(prompt, pictureIds, attachments);
    expect(restored.prompt).toBe(expectedPrompt);
    expect(restored.attachments.map((attachment) => attachment.id)).toEqual(expectedIds);
  });
});

describe("materializePicturePrompt", () => {
  it.each([
    ["no pictures", "Fix it", [], "Fix it"],
    [
      "a picture between words, each on its own line",
      `The header feels off:${P}Can you fix both?`,
      [withNotes("The logo is too small.", "")],
      "The header feels off:\n[Picture 1]\nNotes on picture 1:\n1. The logo is too small.\n2. Marked, no note.\nCan you fix both?",
    ],
    [
      "the space around a picture folds into its line breaks",
      `Look: \n${P}\n\n and fix`,
      [{}],
      "Look:\n[Picture 1]\nand fix",
    ],
    [
      "pictures numbered in the order they sit",
      `${P}${P}`,
      [withNotes("first"), withNotes("second")],
      "[Picture 1]\nNotes on picture 1:\n1. first\n[Picture 2]\nNotes on picture 2:\n1. second",
    ],
    [
      "a picture with no place of its own goes first",
      "Only words",
      [{}],
      "[Picture 1]\nOnly words",
    ],
    ["a place with no picture says nothing", `a${P}b`, [], "ab"],
    [
      "terminal contexts keep their places",
      `￼ then ${P} after`,
      [{}],
      "￼ then\n[Picture 1]\nafter",
    ],
  ])("%s", (_label, prompt, images, expected) => {
    expect(materializePicturePrompt(prompt, images)).toBe(expected);
  });

  it.each([
    [
      "a line of theirs that reads as a label",
      `[Picture 1]\n${P}`,
      [{}],
      "[Picture 1] \n[Picture 1]",
      [
        { kind: "text", text: "[Picture 1] " },
        { kind: "picture", n: 1, notes: [] },
      ],
    ],
    [
      "a later picture's label written before it",
      `${P}\n[Picture 2]\n${P}`,
      [{}, {}],
      "[Picture 1]\n[Picture 2] \n[Picture 2]",
      [
        { kind: "picture", n: 1, notes: [] },
        { kind: "text", text: "[Picture 2] " },
        { kind: "picture", n: 2, notes: [] },
      ],
    ],
    [
      "a line of theirs that reads as a notes heading",
      `${P}\nNotes on picture 1:\n1. mine`,
      [{}],
      "[Picture 1]\nNotes on picture 1: \n1. mine",
      [
        { kind: "picture", n: 1, notes: [] },
        { kind: "text", text: "Notes on picture 1: \n1. mine" },
      ],
    ],
    [
      "a numbered line right after a picture's notes",
      `${P}\n3. Also the footer`,
      [withNotes("Logo", "Grid")],
      "[Picture 1]\nNotes on picture 1:\n1. Logo\n2. Grid\n\n3. Also the footer",
      [
        { kind: "picture", n: 1, notes: ["Logo", "Grid"] },
        { kind: "text", text: "3. Also the footer" },
      ],
    ],
  ])("the person's own words stay words: %s", (_label, prompt, images, expected, segments) => {
    const text = materializePicturePrompt(prompt, images);
    expect(text).toBe(expected);
    expect(splitPictureText(text, images.length)).toEqual(segments);
  });
});

describe("pictureNeedsNewCopy", () => {
  const crop = { x: 0, y: 0, w: 1200, h: 800 };
  const marks = [pin("a", 10, 10, "Logo"), box("b", 20, 20, 50, 40, "Grid")];
  it.each([
    ["nothing changed", { crop, marks }, false],
    ["a note reworded", { crop, marks: [pin("a", 10, 10, "Bigger logo"), marks[1]!] }, false],
    ["the same crop, drawn anew", { crop: { ...crop }, marks }, false],
    ["the crop moved", { crop: { ...crop, x: 5 }, marks }, true],
    ["a pin moved", { crop, marks: [pin("a", 11, 10, "Logo"), marks[1]!] }, true],
    ["a box resized", { crop, marks: [marks[0]!, box("b", 20, 20, 60, 40, "Grid")] }, true],
    ["a mark added", { crop, marks: [...marks, pin("c", 1, 1, "")] }, true],
    ["the marks renumbered", { crop, marks: [marks[1]!, marks[0]!] }, true],
  ])("%s: %s", (_label, after, expected) => {
    expect(pictureNeedsNewCopy({ crop, marks }, after)).toBe(expected);
  });
});

describe("cropPictureMarks", () => {
  const crop = { x: 100, y: 100, w: 200, h: 100 };
  it.each([
    ["a pin inside stays", [pin("a", 150, 150)], [pin("a", 150, 150)], 0],
    ["a pin on the edge stays", [pin("a", 100, 200)], [pin("a", 100, 200)], 0],
    ["a pin outside goes", [pin("a", 50, 150)], [], 1],
    [
      "a box across the edge is cut to the crop",
      [box("b", 50, 120, 100, 20)],
      [box("b", 100, 120, 50, 20)],
      0,
    ],
    ["a box outside goes", [box("b", 400, 400, 10, 10)], [], 1],
  ])("%s", (_label, marks, expected, removed) => {
    expect(cropPictureMarks(marks, crop)).toEqual({ marks: expected, removed });
  });
});

describe("pictureMarkAt", () => {
  const marks = [pin("a", 100, 100), box("b", 200, 200, 100, 50)];
  it.each([
    ["on a pin", { x: 104, y: 98 }, 0],
    ["on a box's edge", { x: 250, y: 203 }, 1],
    ["inside a box, away from its edge", { x: 250, y: 225 }, -1],
    ["on nothing", { x: 10, y: 10 }, -1],
  ])("%s", (_label, point, expected) => {
    expect(pictureMarkAt(marks, point, { pinRadius: 12, edge: 6 })).toBe(expected);
  });
});

describe("picture geometry", () => {
  it.each([
    ["a wide screenshot", { x: 0, y: 0, w: 3024, h: 1964 }, { width: 123, height: 80 }],
    ["a phone screenshot", { x: 0, y: 0, w: 1179, h: 2556 }, { width: 48, height: 80 }],
    ["a panorama", { x: 0, y: 0, w: 8000, h: 1000 }, { width: 240, height: 80 }],
  ])("the thumbnail of %s", (_label, crop, expected) => {
    expect(pictureThumbSize(crop)).toEqual(expected);
  });

  it.each([
    ["the whole picture", { x: 0, y: 0, w: 300, h: 200 }, true],
    ["a part of it", { x: 10, y: 0, w: 290, h: 200 }, false],
  ])("%s is a full crop or not", (_label, crop, expected) => {
    expect(isFullPictureCrop({ crop, sourceWidth: 300, sourceHeight: 200 })).toBe(expected);
  });
});

describe("optimisticPictureAttachments", () => {
  const file = (name: string, size: number) =>
    new File([new Uint8Array(size)], name, { type: "image/png" });
  const image = (id: string, picture?: Partial<ComposerPicture>) => ({
    type: "image" as const,
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 3,
    previewUrl: `blob:${id}`,
    file: file(`${id}.png`, 3),
    ...(picture
      ? {
          picture: {
            source: file("home-page.png", 9),
            sourceWidth: 3024,
            sourceHeight: 1964,
            crop: { x: 0, y: 0, w: 3024, h: 1964 },
            marks: [],
            keepOriginal: false,
            width: 2000,
            height: 1299,
            asPasted: false,
            preparing: false,
            ...picture,
          },
        }
      : {}),
  });

  it.each([
    ["a picture shows at its copy's size", [image("a", {})], [["image", "a", 2000, 1299]]],
    [
      "a kept original rides right after its picture",
      [image("a", { keepOriginal: true })],
      [
        ["image", "a", 2000, 1299],
        ["file", "a-original", undefined, undefined],
      ],
    ],
    [
      "an image that is no picture has no size",
      [image("b")],
      [["image", "b", undefined, undefined]],
    ],
  ])("%s", (_label, images, expected) => {
    expect(
      optimisticPictureAttachments(images).map((attachment) => [
        attachment.type,
        attachment.id,
        "width" in attachment ? attachment.width : undefined,
        "height" in attachment ? attachment.height : undefined,
      ]),
    ).toEqual(expected);
  });
});
