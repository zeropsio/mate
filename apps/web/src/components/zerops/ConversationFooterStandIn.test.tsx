import { conversationFooter } from "@t3tools/client-runtime/zerops/conversationWriter";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ConversationFooterStandIn } from "./ConversationFooterStandIn";

const COMPOSER = <textarea aria-label="Message" data-testid="composer" />;
const render = (remembered: Parameters<typeof conversationFooter>[1]) =>
  renderToStaticMarkup(
    <ConversationFooterStandIn
      composer={COMPOSER}
      footer={conversationFooter({ kind: "unknown" }, remembered)}
    />,
  );

describe("the footer of a conversation that is not open yet", () => {
  it.each([
    { remembered: undefined, name: "nothing remembered" },
    { remembered: "nobody-yet", name: "remembered as nobody's yet" },
  ] as const)(
    "holds the composer's room with $name: no field, no button, no words",
    ({ remembered }) => {
      const html = render(remembered);
      expect(html).toContain("data-composer-room-held");
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain("<button");
      expect(html).not.toContain("placeholder");
      expect(html.replace(/<[^>]*>/g, "").trim()).toBe("");
    },
  );

  it("paints someone else's strip at once where this browser remembers it as theirs", () => {
    const html = render("someone");
    expect(html).toContain("only they can run this agent");
    expect(html).not.toContain("<textarea");
    // Nothing on it acts before the conversation opens.
    expect(html).toContain("inert");
  });

  it("paints the composer where this browser remembers it as the viewer's", () => {
    const html = render("you");
    expect(html).toContain('data-testid="composer"');
    expect(html).not.toContain("only they can run this agent");
  });
});
