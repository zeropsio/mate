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
import { MacCommand, ZeropsMacPanel } from "./ZeropsMacPanel";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";

/** The commands the Mate hands out for pairing: the VPN first, then the pairing. */
const PAIR = ["zcli vpn up Prj0AAAAAAAAAAAAAAAAAA", "ssh zcp mac host | sh"];

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

/** The commands the panel offers the person, in order. */
function macCommands(tree: unknown): ReadonlyArray<string> {
  const found: string[] = [];
  visitElements(tree, (element) => {
    if (element.type === MacCommand) found.push(element.props.command as string);
    return false;
  });
  return found;
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
      { status: "not-paired", inUse: false, pairCommands: PAIR },
      "Pair a Mac to build and run macOS apps on it from here.",
    ],
    [
      "the Mac does not answer",
      { status: "unreachable", macName: "Test Mac", inUse: false, pairCommands: PAIR },
      "Test Mac does not answer.",
    ],
    [
      "nothing is open yet",
      { status: "no-app", macName: "Test Mac", inUse: false },
      "Nothing open on Test Mac yet.",
    ],
    [
      "the Mac's pairing predates the view",
      { status: "no-helper", macName: "Test Mac", inUse: false, pairCommands: PAIR },
      "Test Mac was paired before the live view. Pair it again to see it here.",
    ],
    [
      "this Mate cannot show a Mac",
      "unavailable",
      "This Mate's version doesn't include the Mac view yet.",
    ],
  ])("says in one plain line when %s", (_, view, line) => {
    feedState.view = view;
    expect(stateLine(render())).toBe(line);
  });

  it.each([
    [
      "pairing a Mac",
      { status: "not-paired", inUse: false, pairCommands: PAIR },
      ["zcli vpn up Prj0AAAAAAAAAAAAAAAAAA", "ssh zcp mac host | sh"],
    ],
    [
      "reaching a Mac that does not answer, or pairing it again",
      { status: "unreachable", macName: "Test Mac", inUse: false, pairCommands: PAIR },
      ["zcli vpn up Prj0AAAAAAAAAAAAAAAAAA", "ssh zcp mac host | sh"],
    ],
    [
      "pairing again a Mac paired before the live view",
      { status: "no-helper", macName: "Test Mac", inUse: false, pairCommands: PAIR },
      ["ssh zcp mac host | sh"],
    ],
  ])("walks the person through %s, with the Mate's own commands to copy", (_, view, commands) => {
    feedState.view = view;
    expect(macCommands(render())).toEqual(commands);
  });

  it("copies a command for the Mac's Terminal with one press", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    hooks.beginRender();
    const tree = MacCommand({ command: "ssh zcp mac host | sh" });
    const copy = visitElements(tree, (element) => typeof element.props.onClick === "function");
    expect(copy).toBeDefined();
    (copy!.props.onClick as () => void)();
    expect(writeText).toHaveBeenCalledWith("ssh zcp mac host | sh");
    vi.unstubAllGlobals();
  });

  it("on a Mate too old for the Mac view, offers the Mate's own update instead", () => {
    feedState.view = "unavailable";
    const update = visitElements(render(), (element) => element.type === ZeropsMateUpdateControl);
    expect(update?.props.environmentId).toBe(THREAD_REF.environmentId);
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

  it("while someone uses the Mac it says so, and the person's own clicks and typing still reach the app", () => {
    vi.useFakeTimers();
    feedState.view = { ...LIVE, inUse: true };
    const tree = render();
    expect(stateLine(tree)).toBe(
      "Someone is using Test Mac right now. Clicks and typing here still reach the app.",
    );
    const input = canvas(tree)!;
    expect(input.props["aria-disabled"]).toBe(false);
    pointerDown(input, 10, 10);
    expect(commandSpy).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a thread", () => {
    hooks.beginRender();
    expect(ZeropsMacPanel({ threadRef: null })).toBeNull();
  });
});
