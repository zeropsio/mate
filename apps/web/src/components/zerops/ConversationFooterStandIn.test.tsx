import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { INLINE_PICTURE_PLACEHOLDER } from "~/lib/composerPictures";
import { ConversationFooterStandIn } from "./ConversationFooterStandIn";

describe("the footer of a conversation that is not open yet", () => {
  it("holds the composer's room: no field, no button, no words", () => {
    const html = renderToStaticMarkup(<ConversationFooterStandIn />);
    expect(html).toContain("data-composer-room-held");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("placeholder");
    expect(html.replace(/<[^>]*>/g, "").trim()).toBe("");
  });

  // A draft of several lines, or with a picture in it, makes a taller composer: the room is its
  // height, its words and pictures laid out unseen, and still nothing to type into or press.
  it("holds the room at the height its draft will take", () => {
    const html = renderToStaticMarkup(
      <ConversationFooterStandIn draft={`First line\nsecond line${INLINE_PICTURE_PLACEHOLDER}`} />,
    );
    expect(html).toContain("First line\nsecond line");
    expect(html).toContain("composer-attachment-slot");
    expect(html).toContain('data-room-held=""');
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<button");
  });
});
