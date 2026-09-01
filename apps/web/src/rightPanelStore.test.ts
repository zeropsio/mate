import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DROPPED_RIGHT_PANEL_KINDS } from "./rightPanelKinds";
import {
  migratePersistedRightPanelState,
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

beforeEach(() => {
  useRightPanelStore.setState({
    byThreadKey: {},
    zeropsDefaultHandledByThreadKey: {},
  });
});

describe("rightPanelStore", () => {
  it("defaults Zerops once per untouched scoped thread", () => {
    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });
    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "zerops",
      surfaces: [{ id: "zerops", kind: "zerops" }],
    });
    expect(useRightPanelStore.getState().zeropsDefaultHandledByThreadKey).toEqual({
      "env-1:thread-A": true,
    });
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refB)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("does not replace an existing surface and remembers that choice", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });

    useRightPanelStore.getState().closeSurface(refA, "files");
    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("remembers explicit close and Zerops tab removal", () => {
    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });
    useRightPanelStore.getState().close(refA);
    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).isOpen,
    ).toBe(false);

    useRightPanelStore.getState().closeSurface(refA, "zerops");
    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
    expect(useRightPanelStore.getState().zeropsDefaultHandledByThreadKey).toEqual({
      "env-1:thread-A": true,
    });
  });

  it("remembers a tab removal that happens before topology resolves", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().closeSurface(refA, "files");

    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
    expect(useRightPanelStore.getState().zeropsDefaultHandledByThreadKey).toEqual({
      "env-1:thread-A": true,
    });
  });

  it("remembers close-all before topology resolves", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().closeAllSurfaces(refA);

    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "available",
      usesSheet: false,
    });

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
    expect(useRightPanelStore.getState().zeropsDefaultHandledByThreadKey).toEqual({
      "env-1:thread-A": true,
    });
  });

  it.each([
    { topology: "available" as const, usesSheet: true },
    { topology: "unknown" as const, usesSheet: false },
  ])("does not auto-open for $topology with usesSheet=$usesSheet", (input) => {
    useRightPanelStore.getState().ensureZeropsDefault(refA, input);

    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    expect(useRightPanelStore.getState().zeropsDefaultHandledByThreadKey).toEqual({});
  });

  it("remembers unavailable topology without opening a panel", () => {
    useRightPanelStore.getState().ensureZeropsDefault(refA, {
      topology: "unavailable",
      usesSheet: false,
    });

    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    expect(useRightPanelStore.getState().zeropsDefaultHandledByThreadKey).toEqual({
      "env-1:thread-A": true,
    });
  });

  it("migrates prior panel choices as already handled and preserves persisted markers", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: false,
            activeSurfaceId: "files",
            surfaces: [{ id: "files", kind: "files" }],
          },
        },
        zeropsDefaultHandledByThreadKey: {
          "env-1:thread-B": true,
          invalid: false,
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: false,
          activeSurfaceId: "files",
          surfaces: [{ id: "files", kind: "files" }],
        },
      },
      zeropsDefaultHandledByThreadKey: {
        "env-1:thread-A": true,
        "env-1:thread-B": true,
      },
    });
  });

  it("drops the legacy singleton terminal surface during migration", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            activeSurfaceId: "terminal",
            surfaces: [
              { id: "browser:tab-a", kind: "preview", resourceId: "tab-a" },
              { id: "terminal", kind: "terminal" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
        },
      },
      zeropsDefaultHandledByThreadKey: { "env-1:thread-A": true },
    });
  });

  it("upgrades saved single-session terminal surfaces to split-capable surfaces", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "terminal:term-1",
            surfaces: [{ id: "terminal:term-1", kind: "terminal", resourceId: "term-1" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "terminal:term-1",
          surfaces: [
            {
              id: "terminal:term-1",
              kind: "terminal",
              resourceId: "term-1",
              terminalIds: ["term-1"],
              activeTerminalId: "term-1",
            },
          ],
        },
      },
      zeropsDefaultHandledByThreadKey: { "env-1:thread-A": true },
    });
  });

  it("upgrades saved file surfaces with neutral reveal state", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "file:src/index.ts",
            surfaces: [{ id: "file:src/index.ts", kind: "file", relativePath: "src/index.ts" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "file:src/index.ts",
          surfaces: [
            {
              id: "file:src/index.ts",
              kind: "file",
              relativePath: "src/index.ts",
              revealLine: null,
              revealRequestId: 0,
            },
          ],
        },
      },
      zeropsDefaultHandledByThreadKey: { "env-1:thread-A": true },
    });
  });

  it("drops persisted plan surfaces and does not reopen an empty panel", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "plan",
            surfaces: [{ id: "plan", kind: "plan" }],
          },
          "env-1:thread-B": {
            isOpen: true,
            activeSurfaceId: "plan",
            surfaces: [
              { id: "plan", kind: "plan" },
              { id: "diff", kind: "diff" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [],
        },
        "env-1:thread-B": {
          isOpen: true,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
        },
      },
      zeropsDefaultHandledByThreadKey: {
        "env-1:thread-A": true,
        "env-1:thread-B": true,
      },
    });
  });

  it("v12 drops persisted pull-request surfaces and keeps the rest", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "pull-request:project-a:pingdotgg/t3code:4909",
            surfaces: [
              {
                id: "pull-request:project-a:pingdotgg/t3code:4909",
                kind: "pull-request",
                projectId: "project-a",
                repository: "pingdotgg/t3code",
                number: 4909,
              },
              { id: "diff", kind: "diff" },
            ],
          },
          "env-1:thread-B": {
            isOpen: true,
            activeSurfaceId: "pull-request:project-a:pingdotgg/t3code:4910",
            surfaces: [
              {
                id: "pull-request:project-a:pingdotgg/t3code:4910",
                kind: "pull-request",
                projectId: "project-a",
                repository: "pingdotgg/t3code",
                number: 4910,
              },
            ],
          },
          "env-1:thread-C": {
            isOpen: true,
            activeSurfaceId: "zerops",
            surfaces: [{ id: "zerops", kind: "zerops" }],
          },
          "env-1:pull-requests-panel": {
            isOpen: true,
            activeSurfaceId: "diff",
            surfaces: [{ id: "diff", kind: "diff" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
        },
        "env-1:thread-B": {
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [],
        },
        "env-1:thread-C": {
          isOpen: true,
          activeSurfaceId: "zerops",
          surfaces: [{ id: "zerops", kind: "zerops" }],
        },
      },
      zeropsDefaultHandledByThreadKey: {
        "env-1:thread-A": true,
        "env-1:thread-B": true,
        "env-1:thread-C": true,
      },
    });
  });

  it("drops every kind named by the retired-kind migration list", () => {
    const surfaces = DROPPED_RIGHT_PANEL_KINDS.map((kind) => ({ id: kind, kind }));

    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: DROPPED_RIGHT_PANEL_KINDS[0],
            surfaces: [...surfaces, { id: "zerops", kind: "zerops" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "zerops",
          surfaces: [{ id: "zerops", kind: "zerops" }],
        },
      },
      zeropsDefaultHandledByThreadKey: { "env-1:thread-A": true },
    });
  });

  it("open sets the active panel for a thread", () => {
    useRightPanelStore.getState().open(refA, "preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refB)).toBeNull();
  });

  it("opening a different kind keeps both surfaces and activates the new one", () => {
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().open(refA, "preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("preview");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toHaveLength(2);
  });

  it("reopening an inactive singleton activates its existing surface", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().open(refA, "diff");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [
        { id: "diff", kind: "diff" },
        { id: "agents", kind: "agents" },
      ],
    });
  });

  it("keeps files as a singleton surface", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().open(refA, "files");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
  });

  it("replaces the standalone explorer with peer file surfaces", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "README.md");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:README.md",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 2,
        },
        {
          id: "file:README.md",
          kind: "file",
          relativePath: "README.md",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it("updates line reveal requests when reopening a file surface", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 42);
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 87);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: 87,
          revealRequestId: 2,
        },
      ],
    });

    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 3,
        },
      ],
    });
  });

  it("removes persisted file surfaces when their workspace no longer exists", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().openFile(refA, "README.md");

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "agents",
      surfaces: [{ id: "agents", kind: "agents" }],
    });

    useRightPanelStore.getState().openFile(refB, "conductor.json");
    useRightPanelStore.getState().reconcileFileSurfaces(refB, false);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refB)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("close hides the panel without clearing its selected surface", () => {
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().close(refA);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
    expect(
      selectSelectedRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA),
    ).toEqual({ id: "agents", kind: "agents" });
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: "agents",
      surfaces: [{ id: "agents", kind: "agents" }],
    });
  });

  it("toggles empty panel visibility without creating a surface", () => {
    useRightPanelStore.getState().toggleVisibility(refA);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: null,
      surfaces: [],
    });

    useRightPanelStore.getState().toggleVisibility(refA);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  });

  it("toggle hides the panel without discarding the active surface", () => {
    useRightPanelStore.getState().toggle(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
    useRightPanelStore.getState().toggle(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: "diff",
      surfaces: [{ id: "diff", kind: "diff" }],
    });
  });

  it("toggle to a different kind switches active", () => {
    useRightPanelStore.getState().toggle(refA, "preview");
    useRightPanelStore.getState().toggle(refA, "agents");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("agents");
  });

  it("removeThread clears persisted state", () => {
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().removeThread(refA);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
  });

  it("close on never-opened thread is a no-op", () => {
    useRightPanelStore.getState().close(refA);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  });

  it("tracks one surface per browser session", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openBrowser(refA, "tab-b");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["browser:tab-a", "browser:tab-b"]);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "browser:tab-b",
      kind: "preview",
      resourceId: "tab-b",
    });
  });

  it("tracks one surface per terminal session", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().openTerminal(refA, "term-2");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces).toEqual([
      {
        id: "terminal:term-1",
        kind: "terminal",
        resourceId: "term-1",
        terminalIds: ["term-1"],
        activeTerminalId: "term-1",
      },
      {
        id: "terminal:term-2",
        kind: "terminal",
        resourceId: "term-2",
        terminalIds: ["term-2"],
        activeTerminalId: "term-2",
      },
    ]);
    expect(state.activeSurfaceId).toBe("terminal:term-2");
  });

  it("tracks split panes and the active pane within a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
    });

    useRightPanelStore.getState().activateTerminal(refA, "terminal:term-1", "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-2"],
      activeTerminalId: "term-2",
    });
  });

  it("tracks vertical layout for a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2", "vertical");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
      splitDirection: "vertical",
    });
  });

  it("closing the final terminal pane removes its surface and closes the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("closing the active surface activates a neighboring surface", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)?.id).toBe(
      "browser:tab-a",
    );
  });

  it("closing the final surface closes the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("closing other surfaces keeps the selected surface active", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeOtherSurfaces(refA, "file:src/index.ts");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it("closing surfaces to the right activates the selected surface when active was removed", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeSurfacesToRight(refA, "browser:tab-a");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "browser:tab-a",
      surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
    });
  });

  it("closing all surfaces closes the panel", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    useRightPanelStore.getState().closeAllSurfaces(refA);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("reconciles browser surfaces without deleting other surface kinds", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openBrowser(refA, "tab-b");
    useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["tab-b", "tab-c"]);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.map(
        (surface) => surface.id,
      ),
    ).toEqual(["terminal:term-1", "browser:tab-b", "browser:tab-c"]);
  });
});
