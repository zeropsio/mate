import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ChatImageAttachment } from "~/types";
import { MessagePictureBody } from "./MessagePictures";

const image = (extra: Partial<ChatImageAttachment>): ChatImageAttachment => ({
  type: "image",
  id: "picture-1",
  name: "home-page.png",
  mimeType: "image/png",
  sizeBytes: 1_828_427,
  ...extra,
});

function render(picture: ChatImageAttachment): string {
  return renderToStaticMarkup(
    <MessagePictureBody
      segments={[{ kind: "picture", n: 1, notes: [], image: picture, original: null }]}
      dimensions={new Map()}
      onOpen={() => {}}
      renderText={(segment) => segment.text}
    />,
  );
}

describe("MessagePictureBody", () => {
  it.each([
    [
      "a picture whose address has not arrived holds its room",
      image({ width: 2000, height: 1320 }),
      ["message-picture-pending", "aspect-ratio:2000 / 1320", "width:min(100%, 455px)"],
      ["home-page.png"],
    ],
    [
      "a picture that has arrived holds the same room",
      image({ width: 2000, height: 1320, previewUrl: "blob:picture" }),
      ["<img", "aspect-ratio:2000 / 1320", "width:min(100%, 455px)"],
      ["message-picture-pending"],
    ],
    [
      "a picture of unknown size keeps its accessible placeholder until it arrives",
      image({}),
      ['role="img"', 'aria-label="Picture 1"'],
      ["<img", "home-page.png"],
    ],
  ])("%s", (_label, picture, present, absent) => {
    const markup = render(picture);
    for (const text of present) expect(markup).toContain(text);
    for (const text of absent) expect(markup).not.toContain(text);
  });
});
