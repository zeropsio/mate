import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { markupDom } from "../../../test/markupDom";
import { SidebarJumpButton } from "./SidebarJumpButton";

// The tooltip stands in a portal: here it renders in place, so the markup holds its words.
vi.mock("../ui/tooltip", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
    TooltipTrigger: ({
      render,
      children,
    }: {
      render: React.ReactElement;
      children?: React.ReactNode;
    }) => createElement(render.type, render.props as object, children),
    TooltipPopup: ({ children }: { children?: React.ReactNode }) =>
      createElement("span", { role: "tooltip" }, children),
  };
});

describe("SidebarJumpButton", () => {
  const dom = (shortcut: string | undefined) =>
    markupDom(renderToStaticMarkup(<SidebarJumpButton onJump={() => {}} shortcut={shortcut} />));

  it.each([
    { shortcut: "⌘K", keys: "Meta+K /", tip: "Search ⌘K" },
    { shortcut: "Ctrl+K", keys: "Control+K /", tip: "Search Ctrl+K" },
    { shortcut: undefined, keys: "/", tip: "Search" },
  ])(
    "is named Search, its key $shortcut in its tooltip and named as $keys",
    ({ shortcut, keys, tip }) => {
      const page = dom(shortcut);
      const button = page.querySelector('[data-zerops-surface="sidebar-jump"]');
      expect(button?.getAttribute("aria-label")).toBe("Search");
      expect(button?.getAttribute("aria-keyshortcuts")).toBe(keys);
      expect(button?.textContent).toBe("");
      expect(page.querySelector('[role="tooltip"]')?.textContent).toBe(tip);
    },
  );
});
