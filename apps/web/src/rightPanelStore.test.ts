import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DROPPED_RIGHT_PANEL_KINDS } from "./rightPanelKinds";
import {
  migratePersistedRightPanelState,
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";
import {
  accountStorageKey,
  closeAccountLifetime,
  openAccountLifetime,
} from "./zerops/accountLifetime";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

beforeEach(() => {
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("rightPanelStore", () => {
  /**
   * The panel used to open on Zerops by itself the first time a conversation
   * was opened, and each browser kept a per-conversation record that it had.
   * The owner, 2026-09-27: "this right panel keeps being opened on zerops by
   * default (like when I add a new mate etc..) I don't think its necessary".
   * The panel opens only when the person opens it, and whatever shape of that
   * record a browser still carries migrates away.
   */
  it.each([
    {
      name: "beside a panel choice",
      persisted: {
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: false,
            activeSurfaceId: "files",
            surfaces: [{ id: "files", kind: "files" }],
          },
        },
        zeropsDefaultHandledByThreadKey: { "env-1:thread-A": true, "env-1:thread-B": true },
      },
      expected: {
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: false,
            activeSurfaceId: "files",
            surfaces: [{ id: "files", kind: "files" }],
          },
        },
      },
    },
    {
      name: "on its own",
      persisted: { zeropsDefaultHandledByThreadKey: { "env-1:thread-B": true, invalid: false } },
      expected: { byThreadKey: {} },
    },
    {
      name: "as null",
      persisted: { byThreadKey: {}, zeropsDefaultHandledByThreadKey: null },
      expected: { byThreadKey: {} },
    },
    {
      name: "as a string",
      persisted: { byThreadKey: {}, zeropsDefaultHandledByThreadKey: "env-1:thread-A" },
      expected: { byThreadKey: {} },
    },
    {
      name: "as an array",
      persisted: { byThreadKey: {}, zeropsDefaultHandledByThreadKey: ["env-1:thread-A"] },
      expected: { byThreadKey: {} },
    },
  ])(
    "forgets which conversations had the Zerops default, stored $name",
    ({ persisted, expected }) => {
      expect(migratePersistedRightPanelState(persisted)).toStrictEqual(expected);
    },
  );

  it("drops the legacy singleton terminal surface during migration", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            activeSurfaceId: "terminal",
            surfaces: [
              { id: "diff", kind: "diff" },
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
          surfaces: [{ id: "diff", kind: "diff" }],
        },
      },
    });
  });

  it("carries a persisted data surface through the v16 migration unchanged", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "data",
            surfaces: [{ id: "data", kind: "data" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "data",
          surfaces: [{ id: "data", kind: "data" }],
        },
      },
    });
  });

  it("drops persisted preview surfaces and does not reopen an empty panel", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "browser:tab-a",
            surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
          },
          "env-1:thread-B": {
            isOpen: true,
            activeSurfaceId: "browser:tab-a",
            surfaces: [
              { id: "browser:tab-a", kind: "preview", resourceId: "tab-a" },
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
    });
  });

  it("open sets the active panel for a thread", () => {
    useRightPanelStore.getState().open(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refB)).toBeNull();
  });

  it("opening a different kind keeps both surfaces and activates the new one", () => {
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().open(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
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

  it("opens one data surface per service and lets the picker hand over to it", () => {
    useRightPanelStore.getState().open(refA, "data");
    useRightPanelStore.getState().openData(refA, "db");
    useRightPanelStore.getState().openData(refA, "db");
    useRightPanelStore.getState().openData(refA, "cache");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "data:cache",
      surfaces: [
        { id: "data:db", kind: "data", service: "db" },
        { id: "data:cache", kind: "data", service: "cache" },
      ],
    });
  });

  it("opens one surface per change, focuses one already open, and leaves Git alone", () => {
    const change = { groupId: "g-1", repository: "appdev", number: 1 };
    useRightPanelStore.getState().open(refA, "git");
    useRightPanelStore.getState().openChange(refA, change);
    useRightPanelStore.getState().openChange(refA, change);
    useRightPanelStore.getState().openChange(refA, { ...change, number: 2 });
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "change:g-1:appdev:2",
      surfaces: [
        { id: "git", kind: "git" },
        {
          id: "change:g-1:appdev:1",
          kind: "change",
          groupId: "g-1",
          repository: "appdev",
          number: 1,
        },
        {
          id: "change:g-1:appdev:2",
          kind: "change",
          groupId: "g-1",
          repository: "appdev",
          number: 2,
        },
      ],
    });
  });

  it("drops a persisted per-service data surface whose id and service disagree", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "data:db",
            surfaces: [
              { id: "data:db", kind: "data", service: "db" },
              { id: "data:x", kind: "data", service: "db" },
              { id: "data:y", kind: "data" },
            ],
          },
        },
      }).byThreadKey["env-1:thread-A"]?.surfaces,
    ).toEqual([{ id: "data:db", kind: "data", service: "db" }]);
  });

  it("keeps data as a singleton surface", () => {
    useRightPanelStore.getState().open(refA, "data");
    useRightPanelStore.getState().open(refA, "data");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "data",
      surfaces: [{ id: "data", kind: "data" }],
    });
  });

  it("opens the crew board as a singleton surface beside what is open", () => {
    useRightPanelStore.getState().open(refA, "zerops");
    useRightPanelStore.getState().open(refA, "crew");
    useRightPanelStore.getState().open(refA, "crew");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "crew",
      surfaces: [
        { id: "zerops", kind: "zerops" },
        { id: "crew", kind: "crew" },
      ],
    });
  });

  it("opens the MCP tab as a singleton surface beside what is open", () => {
    useRightPanelStore.getState().open(refA, "agents");
    useRightPanelStore.getState().open(refA, "mcp");
    useRightPanelStore.getState().open(refA, "mcp");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "mcp",
      surfaces: [
        { id: "agents", kind: "agents" },
        { id: "mcp", kind: "mcp" },
      ],
    });
  });

  it("opens workspace-root links as the singleton files explorer", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "README.md");
    store.openFile(refA, ".");
    store.openFile(refA, ".");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.activeSurfaceId).toBe("files");
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["file:README.md", "files"]);
    store.closeSurface(refA, "files");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).activeSurfaceId,
    ).toBe("file:README.md");
    store.openFile(refA, ".");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).activeSurfaceId,
    ).toBe("files");
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

  it.each([
    ["generated\\", "generated"],
    ["notes/meeting ", "notes/meeting"],
    [" notes/meeting", "notes/meeting"],
  ])("keeps %j and %j in separate file tabs", (firstPath, secondPath) => {
    useRightPanelStore.getState().openFile(refA, firstPath);
    useRightPanelStore.getState().openFile(refA, secondPath);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toMatchObject([
      { id: `file:${firstPath}`, relativePath: firstPath },
      { id: `file:${secondPath}`, relativePath: secondPath },
    ]);
  });

  it.each([
    ["docs/", "docs"],
    ["docs///", "docs"],
    ["/", "/"],
    ["C:/", "C:/"],
  ])("reuses the folder tab for %j and %j", (linkPath, treePath) => {
    useRightPanelStore.getState().openFile(refA, linkPath);
    useRightPanelStore.getState().openFile(refA, treePath);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toMatchObject([{ id: `file:${treePath}`, relativePath: treePath, revealRequestId: 2 }]);
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
    useRightPanelStore.getState().toggle(refA, "diff");
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
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)?.id).toBe(
      "diff",
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
    useRightPanelStore.getState().open(refA, "diff");
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
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeSurfacesToRight(refA, "diff");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [{ id: "diff", kind: "diff" }],
    });
  });

  it("closing all surfaces closes the panel", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    useRightPanelStore.getState().closeAllSurfaces(refA);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });
});

describe("right panel persistence", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    openAccountLifetime("panel-test");
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  it("hydrates a browser that recorded the Zerops default into its panel state alone", async () => {
    const name = useRightPanelStore.persist.getOptions().name;
    const key = name === undefined ? null : accountStorageKey(name);
    if (key === null) throw new Error("Expected an account-scoped right panel key");
    const byThreadKey = {
      "env-1:thread-A": {
        isOpen: true,
        activeSurfaceId: "files",
        surfaces: [{ id: "files", kind: "files" }],
      },
    };
    // What a browser holds from the last store version that kept the record.
    values.set(
      key,
      JSON.stringify({
        state: {
          byThreadKey,
          zeropsDefaultHandledByThreadKey: { "env-1:thread-A": true, "env-1:thread-B": true },
        },
        version: 17,
      }),
    );

    await useRightPanelStore.persist.rehydrate();

    expect(useRightPanelStore.getState()).not.toHaveProperty("zeropsDefaultHandledByThreadKey");
    expect(useRightPanelStore.getState().byThreadKey).toStrictEqual(byThreadKey);
    const stored: unknown = JSON.parse(values.get(key) ?? "null");
    expect(stored).toStrictEqual({ state: { byThreadKey }, version: expect.any(Number) });
  });
});

describe("service browser tabs", () => {
  it("reuses a service tab, updates its route and keeps other threads isolated", () => {
    const store = useRightPanelStore.getState();
    store.openService(refA, "weatherapp", "https://weather.example/");
    store.openService(refA, "api", "https://api.example/");
    store.openService(refA, "weatherapp", "https://weather.example/new");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces).toHaveLength(2);
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({ service: "weatherapp", url: "https://weather.example/new" });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refB).surfaces,
    ).toHaveLength(0);
    store.closeSurface(refA, state.activeSurfaceId!);
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({ service: "api" });
  });
  it("rejects non-web URLs", () => {
    useRightPanelStore.getState().openService(refA, "app", "javascript:alert(1)");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toHaveLength(0);
  });
});

describe("browser tabs a person opened", () => {
  const panel = (surfaces: ReadonlyArray<{ id: string }>, activeSurfaceId: string) => ({
    byThreadKey: { "env-1:thread-A": { isOpen: true, activeSurfaceId, surfaces } },
  });
  const appdev = {
    id: "service:appdev",
    kind: "browser",
    service: "appdev",
    url: "https://appdev-1-3000.example.app",
  };
  const appstage = {
    id: "service:appstage",
    kind: "browser",
    service: "appstage",
    url: "https://appstage-1-3000.example.app",
  };
  const browser = { id: "browser", kind: "browser" };
  const files = { id: "files", kind: "files" };

  /**
   * Picking Browser used to open a tab for every public address by itself
   * (the owner: "the browser automatically opens all tabs, imo it shouldnt").
   * A tab nobody can tell was asked for goes once, with the store version
   * that stopped opening them.
   */
  it.each([
    {
      name: "drops the address tabs a store before v21 holds, keeping the rest",
      persisted: panel([files, appdev, browser, appstage], "service:appstage"),
      version: 20,
      expected: { isOpen: true, activeSurfaceId: "files", surfaces: [files, browser] },
    },
    {
      name: "closes a panel that held nothing else",
      persisted: panel([appdev, appstage], "service:appdev"),
      version: 20,
      expected: { isOpen: false, activeSurfaceId: null, surfaces: [] },
    },
    {
      name: "keeps the address tabs of the current version",
      persisted: panel([files, appdev], "service:appdev"),
      version: 21,
      expected: { isOpen: true, activeSurfaceId: "service:appdev", surfaces: [files, appdev] },
    },
  ])("$name", ({ persisted, version, expected }) => {
    expect(migratePersistedRightPanelState(persisted, version).byThreadKey).toStrictEqual({
      "env-1:thread-A": expected,
    });
  });

  it("opens each address as its own tab beside the Browser view, only when asked", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "browser");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toEqual([browser]);
    store.openService(refA, "appdev", appdev.url);
    store.openService(refA, "appstage", appstage.url);
    store.openService(refA, "appdev", appdev.url);
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces).toEqual([browser, appdev, appstage]);
    expect(state.activeSurfaceId).toBe("service:appdev");
  });
});
