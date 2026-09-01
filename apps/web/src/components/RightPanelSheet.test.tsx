import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-test-sheet": true }, children),
  SheetPopup: ({ children }: { children: ReactNode }) =>
    createElement("section", { "data-test-sheet-popup": true }, children),
  SheetHeader: ({ children, className }: { children: ReactNode; className?: string }) =>
    createElement("header", { className }, children),
  SheetTitle: ({ children }: { children: ReactNode }) => createElement("h2", null, children),
  SheetDescription: ({ children }: { children: ReactNode }) => createElement("p", null, children),
}));

import { RightPanelSheet } from "./RightPanelSheet";

describe("RightPanelSheet", () => {
  it("names and describes the mobile dialog without visible chrome", () => {
    const markup = renderToStaticMarkup(
      <RightPanelSheet open onClose={() => undefined}>
        <div>Panel content</div>
      </RightPanelSheet>,
    );

    expect(markup).toContain('<header class="sr-only">');
    expect(markup).toContain("<h2>Right panel</h2>");
    expect(markup).toContain("<p>Displays project tools and details.</p>");
    expect(markup).toContain("Panel content");
  });
});
