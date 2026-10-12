import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

const feedState = vi.hoisted(() => ({ view: undefined as unknown }));
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

vi.mock("../../zerops/macViewLinks", () => ({
  useMateMacView: () => feedState.view,
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => commandSpy,
}));

vi.mock("../../state/zeropsCommands", () => ({
  zeropsCommands: { macInput: Symbol("macInput") },
}));

import { LiveFrameViewer, type LiveFrameViewerProps } from "./LiveFrameViewer";
import { ZeropsMacPanel } from "./ZeropsMacPanel";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

/** A Retina capture of a 230 × 408 point window. */
const FRAME = {
  type: "frame" as const,
  mimeType: "image/jpeg",
  data: "AAAA",
  width: 460,
  height: 816,
  bounds: { x: 100, y: 50, width: 230, height: 408 },
};
const LIVE = { status: "live", macName: "Test Mac", app: "Counter", inUse: false, frame: FRAME };
/** The canvas as it is laid out: the window at its point size. */
const RECT = { width: 230, height: 408, left: 0, top: 0 };

function render() {
  hooks.beginRender();
  return ZeropsMacPanel({ threadRef: THREAD_REF });
}

function stateLine(tree: unknown): unknown {
  return visitElements(tree, (element) => "data-zerops-mac-line" in element.props)?.props.children;
}

/** The input canvas, inside the live viewer the panel returns. */
function canvas(tree: unknown) {
  const viewer = visitElements(tree, (element) => element.type === LiveFrameViewer);
  if (viewer === null) return null;
  return visitElements(
    LiveFrameViewer(viewer.props as unknown as LiveFrameViewerProps),
    (element) => element.type === "canvas",
  );
}

function pointerDown(target: { readonly props: Record<string, unknown> }, x: number, y: number) {
  (target.props.onPointerDown as (event: unknown) => void)({
    currentTarget: { getBoundingClientRect: () => RECT, setPointerCapture: () => {} },
    clientX: x,
    clientY: y,
    pointerId: 1,
  });
}

function keyDown(
  target: { readonly props: Record<string, unknown> },
  key: string,
  modifiers: { readonly metaKey?: boolean } = {},
) {
  (target.props.onKeyDown as (event: unknown) => void)({
    key,
    ...modifiers,
    preventDefault: () => {},
  });
}

describe("ZeropsMacPanel", () => {
  beforeEach(() => {
    hooks.reset();
    commandSpy.mockClear();
    feedState.view = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [
      "no Mac is paired",
      { status: "not-paired", inUse: false },
      "No Mac is paired with this Mate. Ask it to pair one.",
    ],
    [
      "the Mac does not answer",
      { status: "unreachable", macName: "Test Mac", inUse: false },
      "Test Mac does not answer — is it awake and on the project VPN?",
    ],
    [
      "nothing is open yet",
      { status: "no-app", macName: "Test Mac", inUse: false },
      "Nothing open on Test Mac yet.",
    ],
    [
      "the Mac's pairing predates the view",
      { status: "no-helper", macName: "Test Mac", inUse: false },
      "Run the pairing on the Mac again to see it here.",
    ],
    [
      "this Mate cannot show a Mac",
      "unavailable",
      "The Mac view isn't available on this Mate yet.",
    ],
  ])("says in one plain line when %s", (_, view, line) => {
    feedState.view = view;
    expect(stateLine(render())).toBe(line);
  });

  it("shows no window and takes no input while it reaches the Mac", () => {
    feedState.view = { status: "connecting", macName: "Test Mac", inUse: false };
    const tree = render();
    expect(visitElements(tree, (element) => element.props.label === "Connecting")).not.toBeNull();
    expect(canvas(tree)).toBeNull();
  });

  it("a click on the window sends a click at that pixel of the captured image", () => {
    feedState.view = LIVE;
    pointerDown(canvas(render())!, 115, 204);
    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "click", x: 230, y: 408 },
    });
  });

  it("typing reaches the app as one piece of text once the person pauses", () => {
    vi.useFakeTimers();
    feedState.view = LIVE;
    const input = canvas(render())!;
    keyDown(input, "h");
    keyDown(input, "i");
    expect(commandSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(commandSpy).toHaveBeenCalledTimes(1);
    expect(commandSpy).toHaveBeenCalledWith({
      environmentId: THREAD_REF.environmentId,
      input: { kind: "text", text: "hi" },
    });
  });

  it("a click sends what was typed before it first, keeping their order", () => {
    vi.useFakeTimers();
    feedState.view = LIVE;
    const input = canvas(render())!;
    keyDown(input, "a");
    pointerDown(input, 0, 0);
    expect(commandSpy.mock.calls.map((call) => call[0].input.kind)).toEqual(["text", "click"]);
  });

  it("never types a shortcut or a named key as text", () => {
    vi.useFakeTimers();
    feedState.view = LIVE;
    const input = canvas(render())!;
    keyDown(input, "c", { metaKey: true });
    keyDown(input, "Enter");
    vi.advanceTimersByTime(150);
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it("while someone uses the Mac it keeps showing the window but pauses clicks and typing, saying so", () => {
    vi.useFakeTimers();
    feedState.view = { ...LIVE, inUse: true };
    const tree = render();
    expect(stateLine(tree)).toBe(
      "Someone is using Test Mac right now, so clicks and typing are paused.",
    );
    const input = canvas(tree)!;
    expect(input.props["aria-disabled"]).toBe(true);
    pointerDown(input, 10, 10);
    keyDown(input, "x");
    vi.advanceTimersByTime(150);
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it("renders nothing without a thread", () => {
    hooks.beginRender();
    expect(ZeropsMacPanel({ threadRef: null })).toBeNull();
  });
});
