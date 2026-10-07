// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ThemeEditorHost } from "./ThemeEditorHost";
import { useThemeEditorStore } from "./themeEditorStore";

const theme = vi.hoisted(() => ({
  theme: "system",
  themeHalves: null,
  setTheme: vi.fn(),
  refreshTheme: vi.fn(),
}));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => theme }));
const open = () =>
  useThemeEditorStore.getState().openThemeEditor({
    editingThemeId: null,
    seedThemeId: null,
    seedName: null,
    initialAppearance: "dark",
  });
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useThemeEditorStore.getState().closeThemeEditor();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  useThemeEditorStore.getState().closeThemeEditor();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the nonmodal theme editor", () => {
  it.each(["X", "Escape"])(
    "closes with %s and waits for a new session before reopening",
    async (method) => {
      await act(() => {
        open();
        root.render(<ThemeEditorHost />);
      });
      await act(async () => {
        await import("./ThemeEditorPanel");
      });
      expect(document.querySelector("[data-theme-editor-panel]")).not.toBeNull();
      await act(() => {
        if (method === "X")
          document
            .querySelector<HTMLButtonElement>('button[aria-label="Close the theme editor"]')!
            .click();
        else
          document
            .querySelector('[role="dialog"]')!
            .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => root.render(<ThemeEditorHost />));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => open());
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    },
  );

  it("lets another popup consume Escape and outside clicks leave the draft open", async () => {
    await act(() => {
      open();
      root.render(<ThemeEditorHost />);
    });
    const popup = document.body.appendChild(document.createElement("div"));
    popup.setAttribute("role", "dialog");
    await act(() =>
      popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(useThemeEditorStore.getState().session).not.toBeNull();
    await act(() => document.body.click());
    expect(useThemeEditorStore.getState().session).not.toBeNull();
  });
});
