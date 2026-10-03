import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { conversationFooter } from "@t3tools/client-runtime/zerops/conversationWriter";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { rememberWriter } from "~/zerops/writerMemory";
import { ConversationFooterStandIn, standInFooter } from "./ConversationFooterStandIn";

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
    // Only remembered, it offers no action: its sign-in comes with the read answer.
    expect(html).not.toContain("<button");
  });

  it("paints the composer where this browser remembers it as the viewer's", () => {
    const html = render("you");
    expect(html).toContain('data-testid="composer"');
    expect(html).not.toContain("only they can run this agent");
  });
});

describe("the footer a conversation stands in with", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    openAccountLifetime("person-a");
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  const MATE = EnvironmentId.make("env-mate");
  const MAIN = scopeThreadRef(MATE, ThreadId.make("thread-main"));
  const CREWMATE = scopeThreadRef(MATE, ThreadId.make("thread-crewmate"));

  // A colleague's crewmate in the viewer's own Mate: neither chat paints the other's answer.
  it.each([
    { name: "a colleague's chat paints its strip", at: CREWMATE, expected: "read-only" },
    {
      name: "the viewer's own chat in the same Mate paints its composer",
      at: MAIN,
      expected: "composer",
    },
    { name: "nothing remembered holds the room", at: null, expected: "held" },
  ] as const)("$name", ({ at, expected }) => {
    rememberWriter(MAIN, "you");
    rememberWriter(CREWMATE, "someone");
    expect(standInFooter(at)).toBe(expected);
  });
});
