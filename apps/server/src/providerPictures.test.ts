import { describe, expect, it } from "vite-plus/test";

import {
  attachmentPathLine,
  claudePictureErrorMessage,
  placeClaudePictures,
  rememberTurnPictures,
  sentPictures,
  turnPictureError,
} from "./providerPictures.ts";

const image = (key: string) => ({ type: "image", source: { type: "base64", data: key } });
const text = (value: string) => ({ type: "text", text: value });

describe("placeClaudePictures", () => {
  it.each([
    [
      "each picture right after its label, the words between as text",
      [
        image("one"),
        image("two"),
        text("Off:\n[Picture 1]\nNotes on picture 1:\n1. Logo\n[Picture 2]\nFix both"),
      ],
      [
        text("Off:\n[Picture 1]"),
        image("one"),
        text("Notes on picture 1:\n1. Logo\n[Picture 2]"),
        image("two"),
        text("Fix both"),
      ],
    ],
    [
      "a slash command keeps its text last",
      [image("one"), text("/review\n[Picture 1]\nthis")],
      [image("one"), text("/review\n[Picture 1]\nthis")],
    ],
    [
      "words after the last picture that start with a slash stay last, unread as a command",
      [image("one"), text("Off:\n[Picture 1]\n/etc/hosts is wrong")],
      [image("one"), text("Off:\n[Picture 1]\n/etc/hosts is wrong")],
    ],
    [
      "a message ending on a picture keeps its text last",
      [image("one"), text("See:\n[Picture 1]")],
      [image("one"), text("See:\n[Picture 1]")],
    ],
    [
      "a skill's leading words and command keep their places",
      [text("Before"), image("one"), text("/skill after\n[Picture 1]\nmore")],
      [text("Before"), image("one"), text("/skill after\n[Picture 1]\nmore")],
    ],
    [
      "a message that places no picture keeps its images first",
      [image("one"), text("Look at this")],
      [image("one"), text("Look at this")],
    ],
    ["words alone stay as they are", [text("Fix it")], [text("Fix it")]],
  ])("%s", (_label, content, expected) => {
    expect(placeClaudePictures(content)).toEqual(expected);
  });
});

describe("claudePictureErrorMessage", () => {
  it.each([
    [
      "a picture of this message over the size names it",
      [
        { label: "Picture 1", bytes: 800_000, width: 1200, height: 800 },
        { label: "Picture 2", bytes: 4_500_000, width: 3210, height: 2118 },
      ],
      "Claude couldn't read Picture 2 (3210 × 2118, 4.3 MB): it reads pictures of at most 2000 px a side and 3.8 MB. Send a smaller copy, or crop it to what matters.",
    ],
    [
      "a picture too wide but light enough is named too",
      [{ label: '"panorama.jpg"', bytes: 900_000, width: 6000, height: 1000 }],
      'Claude couldn\'t read "panorama.jpg" (6000 × 1000, 879 KB): it reads pictures of at most 2000 px a side and 3.8 MB. Send a smaller copy, or crop it to what matters.',
    ],
    [
      "a picture of unknown size over the weight is named by its weight",
      [{ label: '"old.webp"', bytes: 6_000_000 }],
      'Claude couldn\'t read "old.webp" (5.7 MB): it reads pictures of at most 2000 px a side and 3.8 MB. Send a smaller copy, or crop it to what matters.',
    ],
    [
      "pictures within the limits point at the file or an earlier one",
      [{ label: "Picture 1", bytes: 800_000, width: 1200, height: 800 }],
      "Claude couldn't read a picture in this chat. If it is the one you just sent, send it again as a PNG or JPEG; if it is an earlier one, start a new chat to go on without it.",
    ],
    [
      "a message without pictures points at an earlier one",
      [],
      "Claude couldn't read a picture earlier in this chat, and it goes back to it with every message. Start a new chat to go on without it.",
    ],
  ])("%s", (_label, pictures, expected) => {
    expect(claudePictureErrorMessage(pictures)).toBe(expected);
  });
});

describe("sentPictures", () => {
  const picture = (id: string, extra: object = {}) => ({
    type: "image",
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    ...extra,
  });

  it.each([
    [
      "a placed picture by its label, with its size",
      "[Picture 1]",
      [picture("a", { width: 2000, height: 1299 })],
      [{ label: "Picture 1", bytes: 10, width: 2000, height: 1299 }],
    ],
    [
      "an image no label places by its file name",
      "Look",
      [picture("a")],
      [{ label: '"a.png"', bytes: 10 }],
    ],
    [
      "a kept original is no picture Claude reads",
      "[Picture 1]",
      [picture("a"), { ...picture("a-original"), type: "file" }],
      [{ label: "Picture 1", bytes: 10 }],
    ],
  ])("%s", (_label, message, attachments, expected) => {
    expect(sentPictures(message, attachments)).toEqual(expected);
  });
});

describe("the pictures a turn sent", () => {
  const result = (reason: string) => ({ terminal_reason: reason });
  const picture = {
    type: "image",
    id: "a",
    name: "shot.png",
    mimeType: "image/png",
    sizeBytes: 4_500_000,
    width: 3210,
    height: 2118,
  };

  it("names the picture of the turn Claude could not read", () => {
    const turn = {};
    rememberTurnPictures(turn, { input: "Off:\n[Picture 1]", attachments: [picture] });
    expect(turnPictureError(result("image_error"), turn)).toMatch(
      /^Claude couldn't read Picture 1 \(3210 × 2118, 4\.3 MB\)/,
    );
  });

  it("a message steering the turn adds its pictures", () => {
    const turn = {};
    rememberTurnPictures(turn, { input: "Words only", attachments: [] });
    rememberTurnPictures(turn, { input: "[Picture 1]", attachments: [picture] });
    expect(turnPictureError(result("image_error"), turn)).toMatch(/Picture 1 \(3210 × 2118/);
  });

  it.each([
    ["another reason", result("prompt_too_long"), {}],
    ["no turn", result("image_error"), undefined],
  ])("says nothing for %s", (_label, outcome, turn) => {
    expect(turnPictureError(outcome, turn)).toBeUndefined();
  });

  it("a turn it never saw still gets the earlier-picture wording", () => {
    expect(turnPictureError(result("image_error"), {})).toMatch(/earlier in this chat/);
  });
});

describe("attachmentPathLine", () => {
  const attachment = (id: string, type = "image", extra: object = {}) => ({
    type,
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    ...extra,
  });

  it.each([
    [
      "a placed picture by its label",
      "[Picture 1]",
      [attachment("a")],
      0,
      "[Picture 1 is saved at: /attachments/a.png]",
    ],
    [
      "a kept original as its picture's",
      "[Picture 1]",
      [attachment("a"), attachment("a-original", "file")],
      1,
      '[Picture 1\'s original, "a-original.png", is saved at: /attachments/a-original.png]',
    ],
    [
      "pasted text as before",
      "notes",
      [attachment("p", "file", { source: { _tag: "pasted-text" } })],
      0,
      '[Pasted text "p.png" is saved at: /attachments/p.png. Inspect it as needed.]',
    ],
    [
      "any other attachment as before",
      "look",
      [attachment("a")],
      0,
      '[Attached image "a.png" is saved at: /attachments/a.png]',
    ],
  ])("%s", (_label, message, attachments, index, expected) => {
    const target = attachments[index]!;
    expect(
      attachmentPathLine(target, `/attachments/${target.id}.png`, { text: message, attachments }),
    ).toBe(expected);
  });
});
