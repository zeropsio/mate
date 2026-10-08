// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";

import type { RightPanelSurface } from "../rightPanelStore";
import { ZeropsReviewDialog } from "./zerops/review/ZeropsReviewDialog";
import { RightPanelTabs } from "./RightPanelTabs";

vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

const ALL_AVAILABLE = {
  diff: "available",
  files: "available",
  file: "available",
  terminal: "available",
  agents: "available",
  zerops: "available",
  browser: "available",
  data: "available",
  git: "available",
  crew: "available",
  mcp: "available",
  vault: "available",
} as const;

const FILES_TAB: RightPanelSurface = { id: "files", kind: "files" };

let root: Root;
let container: HTMLDivElement;
const onAdd = vi.fn();
const noop = () => undefined;
const shortcutContext = (terminalFocus = false) => ({
  terminalFocus,
  terminalOpen: terminalFocus,
  isWeb: false,
  isDesktop: true,
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  onAdd.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderPanel(overrides: Partial<ComponentProps<typeof RightPanelTabs>> = {}) {
  await act(async () =>
    root.render(
      <RightPanelTabs
        mode="inline"
        keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
        getShortcutContext={() => shortcutContext()}
        surfaces={[FILES_TAB]}
        activeSurfaceId="files"
        pendingSurfaceIds={new Set()}
        terminalLabelsById={new Map()}
        onActivate={noop}
        onCloseSurface={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurfacesToRight={noop}
        onCloseAllSurfaces={noop}
        onCopyFilePath={noop}
        availability={ALL_AVAILABLE}
        onAdd={onAdd}
        onAddTerminal={noop}
        liveAgentCount={0}
        {...overrides}
      >
        content
      </RightPanelTabs>,
    ),
  );
}

async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

const openMenu = () => document.querySelector('[role="menu"]:not([data-closed])');

describe("the right panel's new-tab shortcut", () => {
  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "opens the add menu on %s, and a letter in it opens that tab",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await renderPanel();
      const event = await press(
        "t",
        platform === "MacIntel" ? { metaKey: true } : { ctrlKey: true },
      );
      expect(event.defaultPrevented).toBe(true);
      expect(openMenu()?.textContent).toContain("Diff");
      await press("d");
      expect(onAdd).toHaveBeenCalledWith("diff");
    },
  );

  it("swallows a held shortcut's repeats", async () => {
    await renderPanel();
    await press("t", { metaKey: true });
    expect((await press("t", { metaKey: true, repeat: true })).defaultPrevented).toBe(true);
    expect(openMenu()).not.toBeNull();
  });

  it("moves to the launcher when no tab is open, since the launcher is the menu", async () => {
    await renderPanel({ surfaces: [], activeSurfaceId: null });
    (document.activeElement as HTMLElement | null)?.blur();
    const event = await press("t", { metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Open a surface");
  });

  it.each(["Win32", "Linux x86_64"])(
    "leaves Ctrl+T for the focused terminal on %s",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await renderPanel({ getShortcutContext: () => shortcutContext(true) });
      const event = await press("t", { ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(openMenu()).toBeNull();
    },
  );

  it("follows a custom binding", async () => {
    await renderPanel({
      keybindings: compileResolvedKeybindingsConfig([{ key: "mod+y", command: "rightPanel.new" }]),
    });
    expect((await press("t", { metaKey: true })).defaultPrevented).toBe(false);
    expect((await press("y", { metaKey: true })).defaultPrevented).toBe(true);
    expect(openMenu()).not.toBeNull();
  });

  it("does not open over another popup or during text composition", async () => {
    await renderPanel();
    expect((await press("t", { metaKey: true, isComposing: true })).defaultPrevented).toBe(false);
    const dialog = document.createElement("div");
    dialog.dataset.slot = "dialog-popup";
    container.append(dialog);
    expect((await press("t", { metaKey: true })).defaultPrevented).toBe(false);
    expect(openMenu()).toBeNull();
  });
});

it("the review wins over the panel launcher's capture shortcut, then the launcher returns on closure", async () => {
  await renderPanel();
  const reviewRoot = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(() =>
      reviewRoot.render(
        <ZeropsReviewDialog
          open
          onOpenChange={noop}
          onClosed={noop}
          from={null}
          labelledBy="review-title"
        >
          <h2 id="review-title">Review change</h2>
        </ZeropsReviewDialog>,
      ),
    );
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
    await press("t", { metaKey: true });
    expect(openMenu()).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
    await act(() => reviewRoot.render(null));
    document.body.focus();
    await press("t", { metaKey: true });
    expect(openMenu()?.textContent).toContain("Diff");
  } finally {
    await act(() => reviewRoot.unmount());
  }
});
