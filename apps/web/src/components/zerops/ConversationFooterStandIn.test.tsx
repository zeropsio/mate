import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

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
});
