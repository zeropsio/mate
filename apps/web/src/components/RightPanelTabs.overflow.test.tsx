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
    const width = at < 0 ? stripWidth : 100;
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
    const add = host.querySelector('[aria-label="Add panel surface"]');
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
    expect(host.querySelector("[data-right-panel-hidden-tabs]")?.getAttribute("aria-label")).toBe(
      label,
    );
  });
});
