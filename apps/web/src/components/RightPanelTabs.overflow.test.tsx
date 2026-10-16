// @vitest-environment happy-dom
/**
 * More tabs than the panel's width holds: the strip scrolls sideways, and the
 * way to open another page never scrolls away with it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";
import { RightPanelTabs } from "./RightPanelTabs";

const ALL_AVAILABLE = {
  diff: "available",
  files: "available",
  file: "available",
  terminal: "available",
  agents: "available",
  zerops: "available",
  browser: "available",
  mac: "available",
  data: "available",
  git: "available",
  crew: "available",
  mcp: "available",
  vault: "available",
  overview: "hidden",
} as const;

const SURFACES = [
  { id: "diff", kind: "diff" },
  { id: "files", kind: "files" },
  { id: "agents", kind: "agents" },
  { id: "zerops", kind: "zerops" },
  { id: "browser", kind: "browser" },
] as unknown as ReadonlyArray<RightPanelSurface>;

/** Each tab is 100 px wide, side by side; the strip shows `stripWidth` of them. */
function layOut(stripWidth: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const element = this as HTMLElement;
    const tabId = element.dataset.tabId;
    const at = tabId === undefined ? -1 : SURFACES.findIndex((surface) => surface.id === tabId);
    const left = at < 0 ? 0 : at * 100;
    const width = element.dataset.slot === "tab-strip-action" ? 24 : at < 0 ? stripWidth : 100;
    return {
      left,
      right: left + width,
      top: 0,
      bottom: 24,
      width,
      height: 24,
      x: left,
      y: 0,
    } as DOMRect;
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function render() {
  act(() => {
    root.render(
      <RightPanelTabs
        mode="inline"
        surfaces={SURFACES}
        activeSurfaceId="browser"
        pendingSurfaceIds={new Set()}
        terminalLabelsById={new Map()}
        onActivate={() => undefined}
        onCloseSurface={() => undefined}
        onCloseOtherSurfaces={() => undefined}
        onCloseSurfacesToRight={() => undefined}
        onCloseAllSurfaces={() => undefined}
        onCopyFilePath={() => undefined}
        onAdd={() => undefined}
        onAddTerminal={() => undefined}
        availability={ALL_AVAILABLE}
        liveAgentCount={0}
      >
        <div>content</div>
      </RightPanelTabs>,
    );
  });
}

describe("RightPanelTabs overflow", () => {
  it("keeps Add a page outside the strip that scrolls, however many tabs are open", () => {
    layOut(250);
    render();
    const strip = host.querySelector("[data-slot='scroll-area-viewport']");
    const add = host.querySelector('[aria-label="Add a page"]');
    expect(strip?.querySelectorAll("[data-tab-id]")).toHaveLength(SURFACES.length);
    expect(add).not.toBeNull();
    expect(strip?.contains(add ?? null)).toBe(false);
  });

  it.each([
    { stripWidth: 450, label: "1 more tab" },
    { stripWidth: 250, label: "3 more tabs" },
  ])("names the tabs the strip cuts off as $label", ({ stripWidth, label }) => {
    layOut(stripWidth);
    render();
    expect(host.querySelector("[data-slot='tab-strip-more']")?.getAttribute("aria-label")).toBe(
      label,
    );
  });

  it.each([
    { stripWidth: 250, folded: true },
    { stripWidth: 600, folded: false },
  ])(
    "folds the tabs other than the open one to their icons once every name no longer fits ($stripWidth px: $folded)",
    ({ stripWidth, folded }) => {
      layOut(stripWidth);
      render();
      const closes = Array.from(host.querySelectorAll("[aria-label^='Close ']"), (button) =>
        button.getAttribute("aria-label"),
      );
      // A folded tab is its icon alone, which opens it: its name is its label, not a close.
      expect(closes).toEqual(
        folded
          ? ["Close Browser"]
          : ["Close Diff", "Close Files", "Close Helpers", "Close Zerops", "Close Browser"],
      );
      expect(host.querySelector("button[aria-label='Diff']") !== null).toBe(folded);
    },
  );
});

describe("the page menu", () => {
  it("says under each page's name what it opens, and gives a page a key only where its name starts with it", async () => {
    layOut(600);
    render();
    const add = host.querySelector<HTMLElement>('[aria-label="Add a page"]');
    await act(async () => {
      add?.click();
    });
    const items = Array.from(document.querySelectorAll("[data-slot='menu-item']"), (item) => ({
      name: item.querySelector("[data-slot='menu-item-text'] > span")?.textContent ?? "",
      opens: item.querySelector("[data-slot='menu-item-description']")?.textContent ?? "",
      key: item.getAttribute("aria-keyshortcuts"),
    }));
    expect(items.map((item) => item.name)).toContain("Vault");
    for (const item of items) {
      expect(item.opens, item.name).not.toBe("");
      if (item.key !== null) expect(item.name.startsWith(item.key), item.name).toBe(true);
    }
  });
});
