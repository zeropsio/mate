// @vitest-environment happy-dom

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useClosedViewStore } from "../closedViewStore";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { ReopenClosedViewShortcut } from "./ReopenClosedViewShortcut";

const navigate = vi.fn(async () => undefined);
const route = { environmentId: "env-1", threadId: "thread-A" };
const knownThreads = new Set(["thread-A", "thread-B"]);

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => route,
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => DEFAULT_RESOLVED_KEYBINDINGS,
}));
vi.mock("../state/server", () => ({ primaryServerKeybindingsAtom: {} }));
vi.mock("../state/shell", () => ({ environmentShell: { stateValueAtom: () => ({}) } }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => ({ status: "live" }) } }));
vi.mock("../state/entities", () => ({
  readThreadShell: (ref: { threadId: string }) =>
    knownThreads.has(ref.threadId) ? { projectId: "project-1" } : null,
  readProject: () => ({ id: "project-1" }),
}));

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
const panel = (ref: typeof refA) =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  navigate.mockClear();
  useRightPanelStore.setState({ byThreadKey: {} });
  useClosedViewStore.setState({ entries: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ReopenClosedViewShortcut />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function pressReopen() {
  const event = new KeyboardEvent("keydown", {
    key: "t",
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    document.body.dispatchEvent(event);
    await Promise.resolve();
  });
  return event;
}

describe("Mod+Shift+T", () => {
  it("puts back the tab last closed in the conversation on screen", async () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.open(refA, "git");
    store.closeSurface(refA, "git");
    expect((await pressReopen()).defaultPrevented).toBe(true);
    expect(panel(refA).activeSurfaceId).toBe("git");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the closed tab's own conversation when another is on screen", async () => {
    const store = useRightPanelStore.getState();
    store.open(refB, "zerops");
    store.open(refB, "git");
    store.closeSurface(refB, "zerops");
    await pressReopen();
    expect(panel(refB).surfaces.map((surface) => surface.id)).toContain("zerops");
    expect(navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-1", threadId: "thread-B" },
    });
  });

  it("leaves the chord alone while nothing was closed", async () => {
    expect((await pressReopen()).defaultPrevented).toBe(false);
  });
});
