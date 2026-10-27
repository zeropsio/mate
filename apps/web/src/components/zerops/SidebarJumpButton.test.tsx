import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { markupDom } from "../../../test/markupDom";

// The tip is drawn in place, open, so what it says can be read.
vi.mock("../ui/tooltip", async () => {
  const { cloneElement, createElement, Fragment } = await import("react");
  return {
    Tooltip: ({ children }: { readonly children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    TooltipTrigger: ({
      render,
      children,
    }: {
      readonly render: React.ReactElement;
      readonly children: React.ReactNode;
    }) => cloneElement(render, undefined, children),
    TooltipPopup: ({ children }: { readonly children: React.ReactNode }) =>
      createElement("div", { "data-tip": "" }, children),
  };
});

const { SidebarJumpButton } = await import("./SidebarJumpButton");

describe("SidebarJumpButton", () => {
  const dom = (shortcut: string | undefined) =>
    markupDom(renderToStaticMarkup(<SidebarJumpButton onJump={() => {}} shortcut={shortcut} />));

  // A quiet square in the logo row, not a field across it (the owner, 2026-10-11: "the huge add
  // search is a waste of space"); its words and its key are its tip's. A Mac modifier is drawn,
  // never typed: its glyph is in a font file of its own.
  it.each([
    { shortcut: "⌘K", keys: "Meta+K /", tip: "SearchK", drawn: ["⌘"] },
    { shortcut: "Ctrl+K", keys: "Control+K /", tip: "SearchCtrl+K", drawn: [] },
    { shortcut: undefined, keys: "/", tip: "Search", drawn: [] },
  ])(
    "is a quiet square named Search, its key $shortcut in its tip, named as $keys",
    ({ shortcut, keys, tip, drawn }) => {
      const page = dom(shortcut);
      const button = page.querySelector('[data-zerops-surface="sidebar-jump"]');
      expect(button?.getAttribute("aria-label")).toBe("Search");
      expect(button?.getAttribute("aria-keyshortcuts")).toBe(keys);
      expect(button?.textContent).toBe("");
      const said = page.querySelector("[data-tip]");
      expect(said?.textContent).toBe(tip);
      expect(
        [...(said?.querySelectorAll("[data-key]") ?? [])].map((key) =>
          key.getAttribute("data-key"),
        ),
      ).toEqual(drawn);
    },
  );
});
