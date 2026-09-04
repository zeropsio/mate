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
});
