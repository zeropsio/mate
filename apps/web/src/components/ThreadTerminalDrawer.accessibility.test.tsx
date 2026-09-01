import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../test/reactElementTree";
import { reactHookHarness as hooks } from "../test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: () => undefined,
    useEffectEvent: (callback: unknown) => callback,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../hooks/useLocalStorage", () => ({
  useLocalStorage: () => [false, vi.fn()],
}));

import ThreadTerminalDrawer, { TerminalDrawerResizeHandle } from "./ThreadTerminalDrawer";

const environmentId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");

function renderDrawer(terminalIds: string[], onHeightChange = vi.fn()) {
  hooks.beginRender();
  return {
    drawer: ThreadTerminalDrawer({
      threadRef: { environmentId, threadId },
      threadId,
      cwd: "/repo",
      height: 240,
      terminalIds,
      activeTerminalId: terminalIds[0] ?? "",
      terminalGroups:
        terminalIds.length === 0 ? [] : [{ id: "group-1", terminalIds: [terminalIds[0] ?? ""] }],
      activeTerminalGroupId: terminalIds.length === 0 ? "" : "group-1",
      focusRequestId: 0,
      onSplitTerminal: vi.fn(),
      onSplitTerminalVertical: vi.fn(),
      onNewTerminal: vi.fn(),
      onActiveTerminalChange: vi.fn(),
      onCloseTerminal: vi.fn(),
      onHeightChange,
      onAddTerminalContext: vi.fn(),
      keybindings: [],
    }),
    onHeightChange,
  };
}

describe("ThreadTerminalDrawer resize handle", () => {
  beforeEach(() => {
    hooks.reset();
  });

  it.each([
    ["empty", []],
    ["active", ["terminal-1"]],
  ])("renders one accessible window splitter in the %s state", (_state, terminalIds) => {
    const { drawer } = renderDrawer(terminalIds);
    const handle = visitElements(drawer, (element) => element.type === TerminalDrawerResizeHandle);

    expect(handle).not.toBeNull();
    const markup = renderToStaticMarkup(handle!);
    expect(markup).toContain('role="separator"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Resize terminal drawer"');
    expect(markup).toContain('aria-orientation="horizontal"');
    expect(markup).toContain('aria-valuemin="180"');
    expect(markup).toContain('aria-valuemax="280"');
    expect(markup).toContain('aria-valuenow="240"');
    expect(markup).toContain("focus-visible:ring-2");
  });

  it("leaves the height and browser key behavior unchanged for ignored keys", () => {
    const onHeightChange = vi.fn();
    const { drawer } = renderDrawer([], onHeightChange);
    const handle = visitElements(drawer, (element) => element.type === TerminalDrawerResizeHandle);
    expect(handle).not.toBeNull();

    const preventDefault = vi.fn();
    const onKeyDown = handle?.props.onKeyDown as (event: {
      key: string;
      preventDefault: () => void;
    }) => void;
    onKeyDown({ key: "PageUp", preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onHeightChange).not.toHaveBeenCalled();
  });

  it("syncs a handled keyboard resize through the drawer height callback", () => {
    const onHeightChange = vi.fn();
    const { drawer } = renderDrawer([], onHeightChange);
    const handle = visitElements(drawer, (element) => element.type === TerminalDrawerResizeHandle);
    expect(handle).not.toBeNull();

    const preventDefault = vi.fn();
    const onKeyDown = handle?.props.onKeyDown as (event: {
      key: string;
      preventDefault: () => void;
    }) => void;
    onKeyDown({ key: "ArrowUp", preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onHeightChange).toHaveBeenCalledWith(256);
  });
});
