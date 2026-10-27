import { describe, expect, it } from "vite-plus/test";

import type { ChatAttachment } from "~/types";
import {
  echoOfMessage,
  GALLERY_PICTURE_MAX_HEIGHT,
  messagePictureRows,
  placeMessagePictures,
  reservedPictureBox,
  terminalContextsBySegment,
  unplacedMessageFiles,
} from "./messagePictures.logic";

const image = (id: string): ChatAttachment => ({
  type: "image",
  id,
  name: `${id}.png`,
  mimeType: "image/png",
  sizeBytes: 10,
});
const file = (id: string, mimeType = "image/png"): ChatAttachment => ({
  type: "file",
  id,
  name: `${id}.png`,
  mimeType,
  sizeBytes: 99,
});

describe("placeMessagePictures", () => {
  it("leaves a message that places no picture as it was", () => {
    expect(placeMessagePictures("Look at these", [image("a"), image("b")])).toBeNull();
  });

  it.each([
    [
      "words and pictures in the order they were written",
      "Off:\n[Picture 1]\nNotes on picture 1:\n1. Bigger logo\nFix it",
      [image("a")],
      [
        { kind: "text", after: 0, text: "Off:" },
        { kind: "picture", n: 1, image: "a", notes: ["1 Bigger logo"], original: null },
        { kind: "text", after: 1, text: "Fix it" },
      ],
      [],
    ],
    [
      "a kept original goes with its picture, an unlabelled image above the words",
      "[Picture 1]",
      [image("a"), file("a-original"), image("b")],
      [{ kind: "picture", n: 1, image: "a", notes: [], original: "a-original" }],
      ["b"],
    ],
  ])("%s", (_label, text, attachments, segments, unplaced) => {
    const placed = placeMessagePictures(text, attachments);
    expect(
      placed?.segments.map((segment) =>
        segment.kind !== "picture"
          ? segment
          : {
              kind: segment.kind,
              n: segment.n,
              image: segment.image.id,
              notes: segment.notes.map((note) => `${note.number} ${note.text}`),
              original: segment.original?.id ?? null,
            },
      ),
    ).toEqual(segments);
    expect(placed?.unplaced.map((entry) => entry.id)).toEqual(unplaced);
  });
});

describe("files in a sent message", () => {
  const pdf = (id: string): ChatAttachment => ({
    type: "file",
    id,
    name: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 4096,
  });
  const shape = (text: string, attachments: ReadonlyArray<ChatAttachment>) => {
    const placed = placeMessagePictures(text, attachments);
    return placed
      ? {
          segments: placed.segments.map((segment) =>
            segment.kind === "text"
              ? segment
              : segment.kind === "file"
                ? { kind: "file", n: segment.n, file: segment.file.id }
                : { kind: "picture", n: segment.n, image: segment.image.id },
          ),
          unplaced: placed.unplaced.map((entry) => entry.id),
          unplacedFiles: placed.unplacedFiles.map((entry) => entry.id),
        }
      : null;
  };

  it.each([
    [
      "a placed file stands where its label does",
      "Read this:\n[File 1]\nthanks",
      [pdf("spec")],
      {
        segments: [
          { kind: "text", after: 0, text: "Read this:" },
          { kind: "file", n: 1, file: "spec" },
          { kind: "text", after: 1, text: "thanks" },
        ],
        unplaced: [],
        unplacedFiles: [],
      },
    ],
    [
      "files and pictures keep their own numbers, files sent first",
      "a\n[Picture 1]\n[File 1]\nb\n[File 2]",
      [pdf("x"), pdf("y"), image("p")],
      {
        segments: [
          { kind: "text", after: 0, text: "a" },
          { kind: "picture", n: 1, image: "p" },
          { kind: "file", n: 1, file: "x" },
          { kind: "text", after: 2, text: "b" },
          { kind: "file", n: 2, file: "y" },
        ],
        unplaced: [],
        unplacedFiles: [],
      },
    ],
    [
      "a file sent before a picture is no kept original of it",
      "[Picture 1]\n[File 1]",
      [file("logo.svg", "image/svg+xml"), image("p")],
      {
        segments: [
          { kind: "picture", n: 1, image: "p" },
          { kind: "file", n: 1, file: "logo.svg" },
        ],
        unplaced: [],
        unplacedFiles: [],
      },
    ],
    [
      "a file whose label the text lacks stands by the words",
      "[File 1]\nwords",
      [pdf("a"), pdf("b")],
      {
        segments: [
          { kind: "file", n: 1, file: "a" },
          { kind: "text", after: 1, text: "words" },
        ],
        unplaced: [],
        unplacedFiles: ["b"],
      },
    ],
    ["a person's own escaped label stays words", "[File 1] \nwords", [pdf("a")], null],
  ])("%s", (_label, text, attachments, expected) => {
    expect(shape(text, attachments)).toEqual(expected);
  });

  it.each([
    ["a phone's files, with no labels", "Here you go", [pdf("a"), pdf("b")], ["a", "b"]],
    [
      "a picture's kept original is no file of its own",
      "[Picture 1]\nLook",
      [image("p"), file("p-o")],
      [],
    ],
    ["no files", "Look", [image("p")], []],
  ])("unplacedMessageFiles: %s", (_label, text, attachments, expected) => {
    expect(unplacedMessageFiles(text, attachments).map((entry) => entry.id)).toEqual(expected);
  });
});

describe("terminalContextsBySegment", () => {
  const context = (header: string) => ({ header, body: "", kind: "terminal" as const });
  const first = context("Terminal 1 line 3");
  const second = context("Terminal 2 lines 4-5");
  const segments = (...texts: string[]) =>
    texts.map((text, index) => ({ kind: "text" as const, after: index, text }));

  it.each([
    [
      "each segment gets the contexts its words name",
      segments("see @terminal-1:3", "and @terminal-2:4-5"),
      [first, second],
      [[first], [second]],
    ],
    [
      "a context named nowhere goes to the last words",
      segments("see", "fix it"),
      [first],
      [[], [first]],
    ],
    ["no contexts, none anywhere", segments("a", "b"), [], [[], []]],
  ])("%s", (_label, texts, contexts, expected) => {
    const bySegment = terminalContextsBySegment(texts, contexts);
    expect(texts.map((segment) => bySegment.get(segment.after) ?? [])).toEqual(expected);
  });
});

describe("reservedPictureBox", () => {
  const picture = (size: { width?: number; height?: number }) => ({
    type: "image" as const,
    id: "a",
    name: "a.png",
    mimeType: "image/png",
    sizeBytes: 10,
    ...size,
  });

  it.each([
    [
      "a wide picture is as wide as it is, never over 300 px tall",
      picture({ width: 2000, height: 1299 }),
      undefined,
      { width: "min(100%, 462px)", aspectRatio: "2000 / 1299" },
    ],
    [
      "a small picture keeps its own size",
      picture({ width: 200, height: 100 }),
      undefined,
      { width: "min(100%, 200px)", aspectRatio: "200 / 100" },
    ],
    [
      "the attachment's own size comes before the server's",
      picture({ width: 1000, height: 1000 }),
      { width: 10, height: 10 },
      { width: "min(100%, 300px)", aspectRatio: "1000 / 1000" },
    ],
    [
      "an older message takes the size its header names",
      picture({}),
      { width: 600, height: 300 },
      { width: "min(100%, 600px)", aspectRatio: "600 / 300" },
    ],
    [
      "a message that names no size holds the room its picture's own original has",
      {
        ...picture({}),
        asset: { original: { status: "ready" as const, width: 1200, height: 900 } },
      } as never,
      undefined,
      { width: "min(100%, 400px)", aspectRatio: "1200 / 900" },
    ],
    ["no size known, no room held", picture({}), undefined, null],
  ])("%s", (_label, image, serverSize, expected) => {
    expect(reservedPictureBox(image, serverSize)).toEqual(expected);
  });
});

// The person's message echoed in a run's card, in short (the owner,
// 2026-09-28), and 2026-10-01: "cannot handle images ... it also swallows the
// text it had": the first line of their words, never a picture's label, and
// its pictures in the order the conversation draws them.
describe("echoOfMessage — the person's message as the run's card repeats it", () => {
  it.each([
    {
      name: "words after a picture's label: their first line, the picture apart",
      text: "[Picture 1]\nthis could be almost fullscreen\nand interactive",
      attachments: [image("a")],
      line: "this could be almost fullscreen",
      pictures: ["a"],
    },
    {
      name: "a picture only",
      text: "[Picture 1]",
      attachments: [image("a")],
      line: "",
      pictures: ["a"],
    },
    {
      name: "words around two pictures, in the order written, a note dropped",
      text: "Off:\n[Picture 1]\nNotes on picture 1:\n1. Bigger logo\nand here\n[Picture 2]\nFix both",
      attachments: [image("a"), image("b")],
      line: "Off:",
      pictures: ["a", "b"],
    },
    {
      name: "a picture no label places: before the placed ones, as the conversation draws it",
      text: "[Picture 1]\nLook",
      attachments: [image("a"), image("b")],
      line: "Look",
      pictures: ["b", "a"],
    },
    {
      name: "words alone",
      text: "Just words\non two lines",
      attachments: [],
      line: "Just words",
      pictures: [],
    },
    {
      name: "pictures with no label at all",
      text: "Look at these",
      attachments: [image("a"), image("b"), file("c", "application/pdf")],
      line: "Look at these",
      pictures: ["a", "b"],
    },
  ])("$name", ({ text, attachments, line, pictures }) => {
    const echo = echoOfMessage(text, attachments);
    expect(echo.line).toBe(line);
    expect(echo.pictures.map((picture) => picture.id)).toEqual(pictures);
  });
});

describe("reservedPictureBox in a gallery", () => {
  it("holds a picture side by side with others to the gallery's height", () => {
    expect(
      reservedPictureBox({ width: 2000, height: 1000 }, undefined, GALLERY_PICTURE_MAX_HEIGHT),
    ).toEqual({
      width: `min(100%, ${GALLERY_PICTURE_MAX_HEIGHT * 2}px)`,
      aspectRatio: "2000 / 1000",
    });
  });
});

describe("messagePictureRows", () => {
  type Segment = { readonly kind: string; readonly n: number };
  const words = (after: number): Segment => ({ kind: "text", n: after });
  const picture = (n: number): Segment => ({ kind: "picture", n });
  const shape = (rows: ReturnType<typeof messagePictureRows<Segment>>) =>
    rows.map((row) => (row.kind === "row" ? row.items.map((item) => item.n) : "words"));

  it.each([
    ["one picture is a row of its own", [words(0), picture(1), words(1)], ["words", [1], "words"]],
    [
      "pictures written one after another share a row",
      [words(0), picture(1), picture(2), picture(3)],
      ["words", [1, 2, 3]],
    ],
    [
      "words between pictures part them",
      [picture(1), words(1), picture(2), picture(3)],
      [[1], "words", [2, 3]],
    ],
    ["only words, no rows", [words(0)], ["words"]],
  ])("%s", (_label, segments, expected) => {
    expect(shape(messagePictureRows(segments))).toEqual(expected);
  });
});
