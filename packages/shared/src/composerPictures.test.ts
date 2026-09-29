import { describe, expect, it } from "vite-plus/test";

import {
  PICTURE_MAX_BYTES,
  PICTURE_MAX_EDGE,
  escapePictureWords,
  interleavePictures,
  messagePictures,
  pictureBlockText,
  pictureLabel,
  pictureNoteText,
  pictureWords,
  readsAsPictureNote,
  splitPictureText,
} from "./composerPictures.ts";

describe("the limits a picture is fitted to", () => {
  it("encodes to at most 5 MB of base64", () => {
    expect(PICTURE_MAX_BYTES).toBe(3_932_160);
    expect(Math.ceil(PICTURE_MAX_BYTES / 3) * 4).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(Math.ceil((PICTURE_MAX_BYTES + 3) / 3) * 4).toBeGreaterThan(5 * 1024 * 1024);
  });

  it("keeps a side at 2000 px", () => {
    expect(PICTURE_MAX_EDGE).toBe(2000);
  });
});

describe("pictureNoteText", () => {
  it.each([
    ["a note as written", "The logo is too small.", "The logo is too small."],
    ["lines folded into one", "Too much space\nabove the grid", "Too much space above the grid"],
    ["runs of space folded", "  a   b \t c  ", "a b c"],
    ["an empty note", "", "Marked, no note."],
    ["a note of spaces", " \n ", "Marked, no note."],
  ])("%s", (_label, note, expected) => {
    expect(pictureNoteText(note)).toBe(expected);
  });
});

describe("pictureBlockText", () => {
  it.each([
    ["a picture without notes", 1, [], "[Picture 1]"],
    [
      "a picture with notes, numbered as its marks",
      2,
      ["The logo is too small next to the menu.", ""],
      "[Picture 2]\nNotes on picture 2:\n1. The logo is too small next to the menu.\n2. Marked, no note.",
    ],
  ])("%s", (_label, n, notes, expected) => {
    expect(pictureBlockText(n, notes)).toBe(expected);
    expect(pictureBlockText(n, notes).startsWith(pictureLabel(n))).toBe(true);
  });
});

describe("the person's own words", () => {
  it.each([
    ["a label-like line ends in a space", "See\n[Picture 3]\nhere", "See\n[Picture 3] \nhere"],
    ["a heading-like line too", "Notes on picture 1:\n1. x", "Notes on picture 1: \n1. x"],
    [
      "a label inside a line stays as written",
      "as in [Picture 1] above",
      "as in [Picture 1] above",
    ],
    ["plain words stay as written", "Fix it\n2. then this", "Fix it\n2. then this"],
  ])("%s", (_label, words, expected) => {
    expect(escapePictureWords(words)).toBe(expected);
    expect(
      splitPictureText(escapePictureWords(words), 5).every((part) => part.kind === "text"),
    ).toBe(true);
  });

  it.each([
    ["a numbered first line", "3. Also the footer\nthanks", true],
    ["a numbered later line", "Also:\n3. the footer", false],
    ["no number", "Also the footer", false],
  ])("%s reads as a note: %s", (_label, words, expected) => {
    expect(readsAsPictureNote(words)).toBe(expected);
  });
});

describe("splitPictureText", () => {
  const sample = [
    "The header on the home page feels off:",
    "[Picture 1]",
    "Notes on picture 1:",
    "1. The logo is too small next to the menu.",
    "2. Too much space above the product grid.",
    "Can you fix both, and check the phone layout too?",
  ].join("\n");

  it.each([
    ["no pictures in the message", "Fix the header", 0, [{ kind: "text", text: "Fix the header" }]],
    [
      "a picture between words, its notes read back",
      sample,
      1,
      [
        { kind: "text", text: "The header on the home page feels off:" },
        {
          kind: "picture",
          n: 1,
          notes: [
            "The logo is too small next to the menu.",
            "Too much space above the product grid.",
          ],
        },
        { kind: "text", text: "Can you fix both, and check the phone layout too?" },
      ],
    ],
    [
      "a label with no image behind it stays words",
      "See [Picture 1]\n[Picture 1]",
      0,
      [{ kind: "text", text: "See [Picture 1]\n[Picture 1]" }],
    ],
    [
      "a label inside a line stays words",
      "See [Picture 1] here",
      1,
      [{ kind: "text", text: "See [Picture 1] here" }],
    ],
    [
      "two pictures, first and last, without words between",
      "[Picture 1]\n[Picture 2]",
      2,
      [
        { kind: "picture", n: 1, notes: [] },
        { kind: "picture", n: 2, notes: [] },
      ],
    ],
    [
      "labels are read in order: a second 'Picture 1' is words",
      "[Picture 1]\n[Picture 1]",
      2,
      [
        { kind: "picture", n: 1, notes: [] },
        { kind: "text", text: "[Picture 1]" },
      ],
    ],
    [
      "a list after the notes that does not continue them stays words",
      "[Picture 1]\nNotes on picture 1:\n1. Bigger logo\n1. first\n2. second",
      1,
      [
        { kind: "picture", n: 1, notes: ["Bigger logo"] },
        { kind: "text", text: "1. first\n2. second" },
      ],
    ],
    [
      "a notes heading for another picture is words",
      "[Picture 1]\nNotes on picture 2:\n1. Bigger logo",
      1,
      [
        { kind: "picture", n: 1, notes: [] },
        { kind: "text", text: "Notes on picture 2:\n1. Bigger logo" },
      ],
    ],
  ] as const)("%s", (_label, text, pictureCount, expected) => {
    expect(splitPictureText(text, pictureCount)).toEqual(expected);
  });

  it("reads back what pictureBlockText writes", () => {
    const notes = ["Bigger logo", "Less space\nabove", ""];
    const text = `Before\n${pictureBlockText(1, notes)}\nAfter`;
    expect(splitPictureText(text, 1)).toEqual([
      { kind: "text", text: "Before" },
      { kind: "picture", n: 1, notes: ["Bigger logo", "Less space above", "Marked, no note."] },
      { kind: "text", text: "After" },
    ]);
  });
});

describe("pictureWords", () => {
  it.each([
    ["words alone", "Fix the header", 0, "Fix the header"],
    [
      "a picture's label goes, its notes stay as the person's words",
      "The header feels off:\n[Picture 1]\nNotes on picture 1:\n1. Bigger logo\nFix it",
      1,
      "The header feels off:\nBigger logo\nFix it",
    ],
    ["a picture without notes or words", "[Picture 1]", 1, ""],
    [
      "a mark without a note says nothing",
      "[Picture 1]\nNotes on picture 1:\n1. Marked, no note.",
      1,
      "",
    ],
  ])("%s", (_label, text, pictureCount, expected) => {
    expect(pictureWords(text, pictureCount)).toBe(expected);
  });
});

describe("messagePictures", () => {
  const image = (id: string) => ({ id, type: "image", mimeType: "image/png" });
  const file = (id: string, mimeType = "image/png") => ({ id, type: "file", mimeType });
  const text = "[Picture 1]\nwords\n[Picture 2]";

  it.each([
    ["no labels, no pictures", "Look at these", [image("a"), image("b")], []],
    [
      "each image is the picture its label names",
      text,
      [image("a"), image("b")],
      [
        { n: 1, image: "a", original: null },
        { n: 2, image: "b", original: null },
      ],
    ],
    [
      "a picture's original is the image file right after it",
      text,
      [image("a"), file("a-original"), image("b")],
      [
        { n: 1, image: "a", original: "a-original" },
        { n: 2, image: "b", original: null },
      ],
    ],
    [
      "a file that is not an image is nobody's original",
      text,
      [image("a"), file("notes", "text/plain"), image("b")],
      [
        { n: 1, image: "a", original: null },
        { n: 2, image: "b", original: null },
      ],
    ],
    [
      "an image past the last label is not a picture",
      "[Picture 1]",
      [image("a"), image("b")],
      [{ n: 1, image: "a", original: null }],
    ],
  ])("%s", (_label, message, attachments, expected) => {
    expect(
      messagePictures(message, attachments).map((picture) => ({
        n: picture.n,
        image: picture.image.id,
        original: picture.original?.id ?? null,
      })),
    ).toEqual(expected);
  });
});

describe("interleavePictures", () => {
  const sample = [
    "The header on the home page feels off:",
    "[Picture 1]",
    "Notes on picture 1:",
    "1. The logo is too small next to the menu.",
    "Can you fix both?",
    "",
    '[Attached image "home-page.png" is saved at: /attachments/t-1.png]',
  ].join("\n");

  it.each([
    ["words alone have nothing to interleave", "Fix the header", 0, null],
    ["images with no labels keep the old order", "Look at these", 2, null],
    [
      "each image goes right after its label, the words around it as text",
      sample,
      1,
      [
        { kind: "text", text: "The header on the home page feels off:\n[Picture 1]" },
        { kind: "image", index: 0 },
        {
          kind: "text",
          text: 'Notes on picture 1:\n1. The logo is too small next to the menu.\nCan you fix both?\n\n[Attached image "home-page.png" is saved at: /attachments/t-1.png]',
        },
      ],
    ],
    [
      "two pictures in a row, the message opening on one",
      "[Picture 1]\n[Picture 2]\nBoth broken",
      2,
      [
        { kind: "text", text: "[Picture 1]" },
        { kind: "image", index: 0 },
        { kind: "text", text: "[Picture 2]" },
        { kind: "image", index: 1 },
        { kind: "text", text: "Both broken" },
      ],
    ],
    [
      "an image past the last label goes first, as images always did",
      "See:\n[Picture 1]\nok",
      2,
      [
        { kind: "image", index: 1 },
        { kind: "text", text: "See:\n[Picture 1]" },
        { kind: "image", index: 0 },
        { kind: "text", text: "ok" },
      ],
    ],
  ] as const)("%s", (_label, text, imageCount, expected) => {
    expect(interleavePictures(text, imageCount)).toEqual(expected);
  });
});
