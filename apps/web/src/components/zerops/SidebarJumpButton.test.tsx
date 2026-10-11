import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { markupDom } from "../../../test/markupDom";
import { SidebarJumpButton } from "./SidebarJumpButton";

describe("SidebarJumpButton", () => {
  const dom = (shortcut: string | undefined) =>
    markupDom(renderToStaticMarkup(<SidebarJumpButton onJump={() => {}} shortcut={shortcut} />));

  // A field of the menu's own, not a round icon copied from another app (the owner, 2026-10-11):
  // it says what it is, and its key.
  // A Mac modifier is drawn, never typed: its glyph is in a font file of its own.
  it.each([
    { shortcut: "⌘K", keys: "Meta+K /", words: "SearchK", drawn: ["⌘"] },
    { shortcut: "Ctrl+K", keys: "Control+K /", words: "SearchCtrl+K", drawn: [] },
    { shortcut: undefined, keys: "/", words: "Search", drawn: [] },
  ])(
    "is a field that says Search and its key $shortcut, named as $keys",
    ({ shortcut, keys, words, drawn }) => {
      const page = dom(shortcut);
      const button = page.querySelector('[data-zerops-surface="sidebar-jump"]');
      expect(button?.getAttribute("aria-label")).toBe("Search");
      expect(button?.getAttribute("aria-keyshortcuts")).toBe(keys);
      expect(button?.textContent).toBe(words);
      expect(
        [...(button?.querySelectorAll("[data-key]") ?? [])].map((key) =>
          key.getAttribute("data-key"),
        ),
      ).toEqual(drawn);
    },
  );
});
