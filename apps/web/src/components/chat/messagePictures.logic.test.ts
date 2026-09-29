import { describe, expect, it } from "vite-plus/test";

import type { ChatAttachment } from "~/types";
import { placeMessagePictures, terminalContextsBySegment } from "./messagePictures.logic";

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
        segment.kind === "text"
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
