import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  type ClosedViewEntry,
  type ReopenableSurface,
  useClosedViewStore,
} from "./closedViewStore";
import { planNextReopen, type ReopenOwnerState, reopenClosedView } from "./reopenClosedView";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";
import { closeAccountLifetime } from "./zerops/accountLifetime";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

const DIFF: ReopenableSurface = { id: "diff", kind: "diff" };
const GIT: ReopenableSurface = { id: "git", kind: "git" };
const FILE: ReopenableSurface = {
  id: "file:src/app.ts",
  kind: "file",
  relativePath: "src/app.ts",
  revealLine: 12,
  revealRequestId: 3,
};
const SERVICE: ReopenableSurface = {
  id: "service:app",
  kind: "browser",
  service: "app",
  url: "https://app-1.prg1.zerops.app",
};

const closedSurfaces = () => useClosedViewStore.getState().entries.map((entry) => entry.surface.id);
const panel = (ref = refA) =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);

beforeEach(() => {
  useRightPanelStore.setState({ byThreadKey: {} });
  useClosedViewStore.setState({ entries: [] });
});

describe("the closed-tab history", () => {
  it("remembers a closed tab, newest first, once per tab and thread", () => {
    const { remember } = useClosedViewStore.getState();
    remember({ threadRef: refA, surface: DIFF });
    remember({ threadRef: refA, surface: GIT });
    remember({ threadRef: refB, surface: DIFF });
    remember({ threadRef: refA, surface: DIFF });
    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => `${entry.threadRef.threadId}:${entry.surface.id}`),
    ).toEqual(["thread-A:diff", "thread-B:diff", "thread-A:git"]);
  });

  it("keeps the last twenty", () => {
    for (let index = 0; index < 25; index += 1) {
      useClosedViewStore.getState().remember({
        threadRef: refA,
        surface: { id: `data:svc${index}`, kind: "data", service: `svc${index}` },
      });
    }
    expect(closedSurfaces()).toHaveLength(20);
    expect(closedSurfaces()[0]).toBe("data:svc24");
  });

  it("sends a tab that could not reopen to the back of the line", () => {
    const { remember } = useClosedViewStore.getState();
    remember({ threadRef: refA, surface: DIFF });
    const gitId = remember({ threadRef: refA, surface: GIT });
    useClosedViewStore.getState().defer(gitId);
    expect(closedSurfaces()).toEqual(["diff", "git"]);
  });

  it("forgets everything when the account closes", () => {
    useClosedViewStore.getState().remember({ threadRef: refA, surface: DIFF });
    closeAccountLifetime();
    expect(closedSurfaces()).toEqual([]);
  });
});

describe("closing a tab records it", () => {
  it("records the tab a person closes", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.open(refA, "git");
    store.closeSurface(refA, "diff");
    expect(closedSurfaces()).toEqual(["diff"]);
  });

  it("records closed-together tabs so the one that was showing comes back first", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.open(refA, "git");
    store.open(refA, "zerops");
    store.activateSurface(refA, "git");
    store.closeAllSurfaces(refA);
    expect(closedSurfaces()[0]).toBe("git");
    expect(closedSurfaces()).toHaveLength(3);
  });

  it("records the tabs Close Others and Close to the Right remove", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.open(refA, "git");
    store.open(refA, "zerops");
    store.closeSurfacesToRight(refA, "git");
    expect(closedSurfaces()).toEqual(["zerops"]);
    store.closeOtherSurfaces(refA, "git");
    expect(closedSurfaces()).toEqual(["diff", "zerops"]);
  });

  it("never records a terminal, whose shell is gone once closed", () => {
    const store = useRightPanelStore.getState();
    store.openTerminal(refA, "term-1");
    const [terminal] = panel().surfaces;
    store.closeSurface(refA, terminal!.id);
    expect(closedSurfaces()).toEqual([]);
  });

  it("does not record tabs the app removes on its own", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "files");
    store.reconcileFileSurfaces(refA, false);
    store.open(refB, "diff");
    store.removeThread(refB);
    expect(closedSurfaces()).toEqual([]);
  });
});

describe("planNextReopen", () => {
  const entry = (id: string, surface: ReopenableSurface, ref = refA): ClosedViewEntry => ({
    id,
    threadRef: ref,
    surface,
  });
  const open = (surfaces: RightPanelSurface[]): ThreadRightPanelState => ({
    isOpen: true,
    activeSurfaceId: surfaces[0]?.id ?? null,
    surfaces,
  });
  const closed: ThreadRightPanelState = { isOpen: false, activeSurfaceId: null, surfaces: [] };
  const owner = (overrides: Partial<ReopenOwnerState> = {}): ReopenOwnerState => ({
    ownerExists: true,
    shellLive: true,
    panel: closed,
    ...overrides,
  });

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly entries: ClosedViewEntry[];
    readonly state: (entry: ClosedViewEntry) => ReopenOwnerState;
    readonly drop: string[];
    readonly restore: string | null;
  }> = [
    {
      name: "restores the newest tab",
      entries: [entry("1", DIFF), entry("2", GIT)],
      state: () => owner(),
      drop: [],
      restore: "1",
    },
    {
      name: "drops a tab that is already open and restores the next",
      entries: [entry("1", DIFF), entry("2", GIT)],
      state: () => owner({ panel: open([DIFF]) }),
      drop: ["1"],
      restore: "2",
    },
    {
      name: "restores a tab still listed in a hidden panel",
      entries: [entry("1", DIFF)],
      state: () => owner({ panel: { ...open([DIFF]), isOpen: false } }),
      drop: [],
      restore: "1",
    },
    {
      name: "skips but keeps a tab whose conversation a live list no longer has",
      entries: [entry("1", DIFF, refB), entry("2", GIT)],
      state: (item) => owner({ ownerExists: item.threadRef === refA }),
      drop: [],
      restore: "2",
    },
    {
      name: "waits while the conversation list has not arrived",
      entries: [entry("1", DIFF, refB), entry("2", GIT)],
      state: (item) => owner({ ownerExists: item.threadRef === refA, shellLive: false }),
      drop: [],
      restore: null,
    },
  ];

  it.each(Array.from(cases, (testCase) => ({ title: testCase.name, testCase })))(
    "$title",
    ({ testCase }) => {
      const plan = planNextReopen(testCase.entries, testCase.state);
      expect(plan.drop.map((item) => item.id)).toEqual(testCase.drop);
      expect(plan.restore?.id ?? null).toBe(testCase.restore);
    },
  );
});

describe("reopenClosedView", () => {
  it("puts the closed tab back, as it was, and shows it", () => {
    useRightPanelStore.getState().open(refA, "diff");
    for (const surface of [FILE, SERVICE, GIT]) {
      expect(reopenClosedView({ threadRef: refA, surface }, { workspaceAvailable: true })).toBe(
        true,
      );
      expect(panel().activeSurfaceId).toBe(surface.id);
      expect(panel().surfaces.find((entry) => entry.id === surface.id)).toEqual(surface);
    }
    expect(panel().isOpen).toBe(true);
  });

  it("does not reopen a file tab without the workspace", () => {
    for (const surface of [FILE, { id: "files", kind: "files" } as const]) {
      expect(reopenClosedView({ threadRef: refA, surface }, { workspaceAvailable: false })).toBe(
        false,
      );
    }
    expect(panel().surfaces).toEqual([]);
  });
});
