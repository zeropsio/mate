import { describe, expect, it } from "vite-plus/test";

import { claudePictureErrorMessage, sentPicture } from "./ClaudePictureError.ts";

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

describe("sentPicture", () => {
  const png = (width: number, height: number) => {
    const bytes = new Uint8Array(24);
    bytes.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(18 + 2, height);
    return bytes;
  };

  it.each([
    ["a placed picture is named by its label", true, 2, "shot.png", "Picture 2"],
    ["an image no label places is named by its file", false, 2, "shot.png", '"shot.png"'],
  ])("%s", (_label, placed, n, name, expected) => {
    expect(sentPicture({ placed, n, name, bytes: png(3210, 2118) })).toEqual({
      label: expected,
      bytes: 24,
      width: 3210,
      height: 2118,
    });
  });
});
