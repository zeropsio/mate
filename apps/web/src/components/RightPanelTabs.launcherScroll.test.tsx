// @vitest-environment happy-dom
/**
 * A launcher taller than its panel scrolls: the card the arrow keys light
 * must be brought into view, or Enter opens a card the person can't see.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RightPanelTabs } from "./RightPanelTabs";

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

let host: HTMLDivElement;
let root: Root;
let scrolled: string[];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  scrolled = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
    scrolled.push((this.textContent ?? "").trim());
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <RightPanelTabs
        mode="inline"
        surfaces={[]}
        activeSurfaceId={null}
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function press(key: string) {
  const launcher = host.querySelector<HTMLElement>('[aria-label="Open a surface"]');
  if (!launcher) throw new Error("no launcher");
  act(() => {
    launcher.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("RightPanelTabs launcher scrolling", () => {
  it.each([
    { keys: ["ArrowDown"], lit: "Terminal" },
    { keys: ["ArrowDown", "ArrowDown"], lit: "Files" },
    { keys: ["ArrowUp"], lit: "MCP" },
  ])("brings the card $keys lights ($lit) into view", ({ keys, lit }) => {
    for (const key of keys) press(key);
    expect(scrolled.at(-1)).toMatch(new RegExp(`^${lit}`));
  });
});
