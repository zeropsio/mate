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
      "an older picture of unknown size holds its room until it arrives",
      image({}),
      ["message-picture-pending"],
      ["Image unavailable"],
    ],
  ])("%s", (_label, picture, present, absent) => {
    const markup = render(picture);
    for (const text of present) expect(markup).toContain(text);
    for (const text of absent) expect(markup).not.toContain(text);
  });
});

it("shows a failed attachment signing with its reason instead of a pending box", () => {
  const html = renderToStaticMarkup(
    <MessagePictureBody
      segments={[
        {
          kind: "picture",
          n: 1,
          notes: [],
          original: null,
          image: {
            type: "image",
            id: "shot",
            name: "shot.png",
            mimeType: "image/png",
            sizeBytes: 10,
          },
        },
      ]}
      dimensions={new Map()}
      states={new Map([["shot", { _tag: "Failure", reason: "Attachment no longer exists" }]])}
      onOpen={() => undefined}
      renderText={() => null}
    />,
  );
  expect(html).toContain("Image unavailable");
  expect(html).toContain("Attachment no longer exists");
  expect(html).not.toContain("message-picture-pending");
});
