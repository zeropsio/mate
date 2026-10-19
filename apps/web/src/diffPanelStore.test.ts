import { openAccountLifetime, closeAccountLifetime } from "./zerops/accountLifetime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

const values = new Map<string, string>();
beforeEach(() => {
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

describe("diffPanelStore", () => {
  beforeEach(() =>
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      diffRenderMode: "stacked",
    }),
  );

  it("keeps the selected render mode in panel and persisted state", async () => {
    useDiffPanelStore.getState().setDiffRenderMode("split");

    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
    expect(
      useDiffPanelStore.persist.getOptions().partialize?.(useDiffPanelStore.getState()),
    ).toMatchObject({ diffRenderMode: "split" });

    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    const persisted = await storage?.getItem(name);
    expect(persisted?.state).toMatchObject({ diffRenderMode: "split" });

    useDiffPanelStore.setState({ diffRenderMode: "stacked" });
    if (persisted) await storage?.setItem(name, persisted);
    await useDiffPanelStore.persist.rehydrate();

    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
  });

  it("defaults each thread to working tree changes without requiring git status", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged" });
  });

  it("defaults to working tree changes before a thread is selected", () => {
    expect(selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, null)).toEqual({
      kind: "unstaged",
    });
  });

  it("preserves an explicit branch selection", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectGitScope(THREAD_REF, "branch", "apidev");
    store.selectGitScope(THREAD_REF, "unstaged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("keeps the repository a thread shows when its comparison base changes", () => {
    const store = useDiffPanelStore.getState();
    store.selectGitScope(THREAD_REF, "branch", "apidev");
    store.selectBranchBaseRef(THREAD_REF, "origin/release");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/release", repository: "apidev" });
  });

  it("an opening forgets what one thread showed and keeps the others", () => {
    const otherThreadRef = scopeThreadRef(
      EnvironmentId.make("environment-1"),
      ThreadId.make("thread-2"),
    );
    const store = useDiffPanelStore.getState();
    store.selectGitScope(THREAD_REF, "branch", "apidev");
    store.selectGitScope(otherThreadRef, "branch", "appdev");

    store.clearSelection(THREAD_REF);

    const { byThreadKey } = useDiffPanelStore.getState();
    expect(Object.values(byThreadKey)).toEqual([
      { kind: "branch", baseRef: null, repository: "appdev" },
    ]);
    expect(selectThreadDiffPanelSelection(byThreadKey, otherThreadRef)).toEqual({
      kind: "branch",
      baseRef: null,
      repository: "appdev",
    });
  });

  it("drops a stored turn's diff, which no longer exists, and keeps the rest", async () => {
    const { name, storage } = useDiffPanelStore.persist.getOptions();
    if (!name) throw new Error("Expected diff panel persistence to have a storage name");
    const otherThreadRef = scopeThreadRef(
      EnvironmentId.make("environment-1"),
      ThreadId.make("thread-2"),
    );
    useDiffPanelStore.getState().selectBranchBaseRef(otherThreadRef, "origin/main");
    const stored = useDiffPanelStore.getState().byThreadKey;
    // Every change is written through: the old record is written after the store forgets.
    useDiffPanelStore.setState({ byThreadKey: {} });
    await storage?.setItem(name, {
      version: 1,
      state: {
        byThreadKey: {
          ...stored,
          turn: { kind: "turn", turnId: "turn-1", filePath: null, revealRequestId: 1 },
        },
        branchBaseRefByThreadKey: {},
        diffRenderMode: "split",
      },
    } as never);
    await useDiffPanelStore.persist.rehydrate();

    expect(useDiffPanelStore.getState().byThreadKey).toEqual(stored);
    expect(useDiffPanelStore.getState().diffRenderMode).toBe("split");
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
  });
});
