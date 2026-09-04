import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  launcherActions,
  type RightPanelAvailability,
  type RightPanelKind,
} from "../rightPanelKinds";
import {
  RightPanelTabs,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
} from "./RightPanelTabs";

function shortcutEvent(
  key: string,
  overrides: Partial<Parameters<typeof surfaceShortcutActionForKey>[1]> = {},
): Parameters<typeof surfaceShortcutActionForKey>[1] {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ...overrides,
  };
}

const ALL_AVAILABLE = {
  diff: "available",
  files: "available",
  file: "available",
  terminal: "available",
  agents: "available",
  zerops: "available",
  browser: "available",
} as const;

function renderLauncher(
  availability: Record<RightPanelKind, RightPanelAvailability> = ALL_AVAILABLE,
) {
  return renderToStaticMarkup(
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
      availability={availability}
      liveAgentCount={0}
    >
      <div>content</div>
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs launcher", () => {
  it("publishes the real shortcut order for available kinds", () => {
    expect(renderLauncher()).toContain('data-surface-launcher-keys="TFDAZB"');
    expect(renderLauncher({ ...ALL_AVAILABLE, zerops: "unknown" })).toContain(
      'data-surface-launcher-keys="TFDAB"',
    );
  });

  it("characterizes the established hint for every unavailable launcher kind", () => {
    const html = renderLauncher({
      diff: "unavailable",
      files: "unavailable",
      file: "unavailable",
      terminal: "unavailable",
      agents: "unavailable",
      zerops: "unavailable",
      browser: "unavailable",
    });
    expect(html.match(/Available when a project is open\./gu)).toHaveLength(2);
    expect(html).toContain("Available for Git repositories.");
    expect(html).toContain("Available from a thread.");
    expect(html.match(/Available in a Zerops project\./gu)).toHaveLength(2);
  });
});

describe("surface shortcuts", () => {
  it("matches real available surface shortcuts case-insensitively", () => {
    const actions = launcherActions({ ...ALL_AVAILABLE, diff: "unavailable" });
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("t"))).toBe(actions[0]);
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("T"))).toBe(actions[0]);
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("d"))).toBeNull();
  });

  it("leaves modified, composing, and already-handled keys out of the real table", () => {
    const actions = launcherActions(ALL_AVAILABLE);
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("t", { metaKey: true }))).toBeNull();
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("t", { isComposing: true })),
    ).toBeNull();
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("t", { defaultPrevented: true })),
    ).toBeNull();
  });
});

describe("surface shortcut typing contexts", () => {
  // Selector-aware stub: closest() answers only tokens the combined selector
  // would actually match, mirroring how the browser resolves it.
  const makeTarget = (matches: string | null) => ({
    closest(selectors: string) {
      if (matches === null || !selectors.includes(matches)) return null;
      return {};
    },
  });

  it("treats form fields and every editable region as typing contexts", () => {
    expect(surfaceShortcutTargetsTypingContext(makeTarget("input"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("textarea"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("select"))).toBe(true);
    // The chat composer is a contenteditable that sits empty until a draft
    // exists; launcher letters claimed from it redirected prompts into shells.
    // The :not clause sees past contenteditable="false" islands to an editable
    // host around them, so nested editors stay protected too.
    expect(surfaceShortcutTargetsTypingContext(makeTarget("[contenteditable]"))).toBe(true);
  });

  it("claims letters when focus sits outside any editable region", () => {
    expect(surfaceShortcutTargetsTypingContext(null)).toBe(false);
    expect(surfaceShortcutTargetsTypingContext(makeTarget(null))).toBe(false);
  });
});
