import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

const feedState = vi.hoisted(() => ({
  browserStream: undefined as unknown,
  lifecycle: undefined as unknown,
}));

const commandSpy = vi.hoisted(() => vi.fn());

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsBrowserStream: () => feedState.browserStream,
  useZeropsLifecycle: () => feedState.lifecycle,
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => commandSpy,
}));

vi.mock("../../state/zeropsCommands", () => ({
  zeropsCommands: { browserInput: Symbol("browserInput") },
}));

import { ZeropsBrowserPanel } from "./ZeropsBrowserPanel";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const FRAME = { type: "frame" as const, data: "AAAA", width: 640, height: 360 };

function findByAttribute(tree: unknown, attribute: string) {
  return visitElements(tree, (element) => attribute in element.props);
}

interface FakePointerEvent {
  readonly currentTarget: {
    getBoundingClientRect(): { width: number; height: number; left: number; top: number };
  };
  readonly clientX: number;
  readonly clientY: number;
}

const RECT = { width: 640, height: 360, left: 0, top: 0 };

function fakePointerEvent(clientX: number, clientY: number): FakePointerEvent {
  return { currentTarget: { getBoundingClientRect: () => RECT }, clientX, clientY };
}

function fakeKeyboardEvent(key: string) {
  let prevented = false;
  return {
    key,
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  };
}

type FakeKeyboardEvent = ReturnType<typeof fakeKeyboardEvent>;

/** The canvas's own handlers come back typed as `unknown` off `props: Record<string, unknown>` — this is the one place that casts them back to callable. */
function pointerHandler(canvas: { readonly props: Record<string, unknown> }, name: string) {
  return canvas.props[name] as (event: FakePointerEvent) => void;
}

function keyHandler(canvas: { readonly props: Record<string, unknown> }, name: string) {
  return canvas.props[name] as (event: FakeKeyboardEvent) => void;
}

describe("ZeropsBrowserPanel", () => {
  beforeEach(() => {
    hooks.reset();
    commandSpy.mockClear();
    feedState.browserStream = undefined;
    feedState.lifecycle = undefined;
  });

  it("panel disables input while the agent drives and enables it on take-over", () => {
    feedState.browserStream = { status: "live", frame: FRAME };
    feedState.lifecycle = {
      threadId: THREAD_REF.threadId,
      recentTools: [{ toolName: "zerops_browser", status: "inProgress", at: new Date() }],
    };

    hooks.beginRender();
    const disabledTree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const canvas = findByAttribute(disabledTree, "data-zerops-browser-input-disabled");
    expect(canvas?.props["data-zerops-browser-input-disabled"]).toBe(true);
    expect(canvas?.props.tabIndex).toBe(-1);

    const takeOverButton = findByAttribute(disabledTree, "data-zerops-browser-take-over");
    expect(takeOverButton).not.toBeNull();
    const onTakeOverClick = takeOverButton!.props.onClick;
    expect(typeof onTakeOverClick).toBe("function");
    (onTakeOverClick as () => void)();

    hooks.beginRender();
    const enabledTree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const enabledCanvas = findByAttribute(enabledTree, "data-zerops-browser-input-disabled");
    expect(enabledCanvas?.props["data-zerops-browser-input-disabled"]).toBe(false);
    expect(enabledCanvas?.props.tabIndex).toBe(0);
  });

  it("a server without subscribeZeropsBrowserStream makes the panel say unavailable, never an error toast", () => {
    feedState.browserStream = "unavailable";
    feedState.lifecycle = undefined;

    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });

    const unavailable = findByAttribute(tree, "data-zerops-browser-unavailable");
    expect(unavailable).not.toBeNull();
    expect(unavailable?.props.children).toBe(
      "Live browser view isn't available on this server yet.",
    );

    // No canvas/input surface mounts, and nothing in this component calls any
    // toast/error-reporting function — the failed subscription is consumed
    // by useZeropsBrowserStream and rendered as a quiet message only.
    expect(findByAttribute(tree, "data-zerops-browser-input-disabled")).toBeNull();
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it("renders nothing for a null thread", () => {
    hooks.beginRender();
    expect(ZeropsBrowserPanel({ threadRef: null })).toBeNull();
  });

  it("says the agent hasn't opened a browser yet when the state is no-browser", () => {
    feedState.browserStream = { status: "no-browser" };
    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    expect(findByAttribute(tree, "data-zerops-browser-unavailable")).toBeNull();
    const body = visitElements(
      tree,
      (element) => element.props.children === "The agent hasn't opened a browser yet.",
    );
    expect(body).not.toBeNull();
  });

  it("shows the agent's driving line with the page it is verifying", () => {
    feedState.browserStream = { status: "live", url: "https://weatherdash.example/", frame: FRAME };
    feedState.lifecycle = {
      threadId: THREAD_REF.threadId,
      recentTools: [{ toolName: "zerops_browser", status: "inProgress", at: new Date() }],
    };
    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const driving = findByAttribute(tree, "data-zerops-browser-driving");
    expect(driving?.props.children).toBe(
      "Agent is driving · verifying https://weatherdash.example/",
    );
  });

  it("sends a hover move as button none, never left — a hover is not a drag", () => {
    feedState.browserStream = { status: "live", frame: FRAME };
    feedState.lifecycle = undefined;
    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const canvas = findByAttribute(tree, "data-zerops-browser-input-disabled")!;

    pointerHandler(canvas, "onPointerDown")(fakePointerEvent(10, 10));
    commandSpy.mockClear();
    pointerHandler(canvas, "onPointerMove")(fakePointerEvent(20, 20));

    expect(commandSpy).toHaveBeenCalledTimes(1);
    const input = commandSpy.mock.calls[0]![0].input;
    expect(input).toMatchObject({ kind: "mouse", eventType: "mouseMoved", button: "none" });
  });

  it("does not forward a hover move made without a button down (only drags are throttled through)", () => {
    feedState.browserStream = { status: "live", frame: FRAME };
    feedState.lifecycle = undefined;
    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const canvas = findByAttribute(tree, "data-zerops-browser-input-disabled")!;

    commandSpy.mockClear();
    pointerHandler(canvas, "onPointerMove")(fakePointerEvent(20, 20));
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it("a press then release both carry button left and clickCount 1", () => {
    feedState.browserStream = { status: "live", frame: FRAME };
    feedState.lifecycle = undefined;
    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const canvas = findByAttribute(tree, "data-zerops-browser-input-disabled")!;

    pointerHandler(canvas, "onPointerDown")(fakePointerEvent(10, 10));
    pointerHandler(canvas, "onPointerUp")(fakePointerEvent(10, 10));

    expect(commandSpy).toHaveBeenCalledTimes(2);
    for (const call of commandSpy.mock.calls) {
      expect(call[0].input).toMatchObject({ kind: "mouse", button: "left", clickCount: 1 });
    }
    expect(commandSpy.mock.calls[0]![0].input.eventType).toBe("mousePressed");
    expect(commandSpy.mock.calls[1]![0].input.eventType).toBe("mouseReleased");
  });

  it("keyDown carries text for a printable character and prevents mate's own default", () => {
    feedState.browserStream = { status: "live", frame: FRAME };
    feedState.lifecycle = undefined;
    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const canvas = findByAttribute(tree, "data-zerops-browser-input-disabled")!;

    const event = fakeKeyboardEvent("a");
    keyHandler(canvas, "onKeyDown")(event);

    expect(event.defaultPrevented).toBe(true);
    const input = commandSpy.mock.calls[0]![0].input;
    expect(input).toEqual({ kind: "keyboard", eventType: "keyDown", key: "a", text: "a" });
  });

  it("keyDown carries no text for a named key like Enter", () => {
    feedState.browserStream = { status: "live", frame: FRAME };
    feedState.lifecycle = undefined;
    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const canvas = findByAttribute(tree, "data-zerops-browser-input-disabled")!;

    keyHandler(canvas, "onKeyDown")(fakeKeyboardEvent("Enter"));

    const input = commandSpy.mock.calls[0]![0].input;
    expect(input).toEqual({ kind: "keyboard", eventType: "keyDown", key: "Enter" });
  });

  it("keyUp also prevents mate's own default", () => {
    feedState.browserStream = { status: "live", frame: FRAME };
    feedState.lifecycle = undefined;
    hooks.beginRender();
    const tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    const canvas = findByAttribute(tree, "data-zerops-browser-input-disabled")!;

    const event = fakeKeyboardEvent("Tab");
    keyHandler(canvas, "onKeyUp")(event);

    expect(event.defaultPrevented).toBe(true);
    const input = commandSpy.mock.calls[0]![0].input;
    expect(input).toEqual({ kind: "keyboard", eventType: "keyUp", key: "Tab" });
  });

  it("resets take-over once the agent starts a fresh zerops_browser call", () => {
    // Mounts straight into an already-in-progress call with take-over
    // already granted (e.g. restored) — must NOT spuriously reset on mount.
    feedState.browserStream = { status: "live", frame: FRAME };
    feedState.lifecycle = {
      threadId: THREAD_REF.threadId,
      recentTools: [{ toolName: "zerops_browser", status: "inProgress", at: new Date() }],
    };
    hooks.beginRender();
    let tree = ZeropsBrowserPanel({ threadRef: THREAD_REF, initialTakeOver: true });
    let canvas = findByAttribute(tree, "data-zerops-browser-input-disabled");
    expect(canvas?.props["data-zerops-browser-input-disabled"]).toBe(false);

    // The agent's call completes.
    feedState.lifecycle = {
      threadId: THREAD_REF.threadId,
      recentTools: [{ toolName: "zerops_browser", status: "completed", at: new Date() }],
    };
    hooks.beginRender();
    ZeropsBrowserPanel({ threadRef: THREAD_REF });

    // A NEW zerops_browser call starts — take-over must not carry forward.
    // A state update made during render settles on the NEXT render, exactly
    // like React's own double-render for this pattern.
    feedState.lifecycle = {
      threadId: THREAD_REF.threadId,
      recentTools: [{ toolName: "zerops_browser", status: "inProgress", at: new Date() }],
    };
    hooks.beginRender();
    ZeropsBrowserPanel({ threadRef: THREAD_REF });
    hooks.beginRender();
    tree = ZeropsBrowserPanel({ threadRef: THREAD_REF });
    canvas = findByAttribute(tree, "data-zerops-browser-input-disabled");
    expect(canvas?.props["data-zerops-browser-input-disabled"]).toBe(true);

    const takeOverButton = findByAttribute(tree, "data-zerops-browser-take-over");
    expect(takeOverButton?.props.children).toBe("Take over");
  });
});
