/**
 * B5, two browsers: whether a Mate's press in the other one is still at it is its hold at HQ and
 * its import's own process — drawn anew the moment its hold runs out, never by its project's age.
 */
import { RegistryContext } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { accountReadsAtom, runningScope, type HqPressValue } from "@t3tools/client-runtime/data";
import { liveZerops, zeropsVersion } from "@t3tools/client-runtime/data/fixtures";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import { usePressesElsewhere } from "./usePressesElsewhere";

const processes = vi.hoisted(() => ({
  /** Each project's processes, as its activity reads them. */
  of: new Map<string, ReadonlyArray<{ readonly id: string; readonly status: string }>>(),
  /** The projects whose processes were asked for, by the last render. */
  asked: [] as ReadonlyArray<string>,
}));
vi.mock("./activity/useProjectsProcesses", () => ({
  useProjectsProcesses: (projectIds: ReadonlyArray<string>) => {
    processes.asked = projectIds;
    return processes.of;
  },
}));

const NOW = Date.parse("2026-10-05T10:00:00.000Z");
/** A Mate whose project lists no container yet. */
const UNA = { key: "p-una", project: { id: "p-una" }, missingContainer: true } as ZeropsCandidate;

let tree: ReactTestRenderer | undefined;
/**
 * What the hook handed back last, and what each render said of Una: a hold running out is drawn
 * anew, not only read anew.
 */
const probe = { said: (_projectId: string): string => "", drawn: [] as Array<string> };
const said = (projectId: string) => probe.said(projectId);
function Probe() {
  const of = usePressesElsewhere([UNA]);
  useLayoutEffect(() => {
    probe.said = of;
    probe.drawn.push(of("p-una"));
  });
  return null;
}

/** HQ's presses as its navigation says them: each held for `heldForMs` from HQ's read. */
const mount = (presses: Readonly<Record<string, HqPressValue>> | null) => {
  const registry = AtomRegistry.make();
  if (presses !== null)
    mountHqNavigation(registry, "org-1", { structure: { ungrouped: [], apps: [] }, presses });
  act(() => {
    tree = create(
      createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)),
    );
  });
  return registry;
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  processes.of = new Map();
  probe.drawn = [];
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePressesElsewhere", () => {
  it("reads a slow press as at it while its hold runs, and as awaiting evidence when it runs out", async () => {
    mount({ "p-una": { kind: "mate", heldForMs: 30_000, until: "2026-10-05T10:00:30.000Z" } });
    expect(said("p-una")).toBe("pressing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(said("p-una")).toBe("unknown");
    expect(probe.drawn.at(-1)).toBe("unknown");
  });

  it("reads a press whose import failed as stopped at once, though its hold still runs", () => {
    processes.of = new Map([["p-una", [{ id: "imp-1", status: "FAILED" }]]]);
    mount({
      "p-una": {
        kind: "mate",
        heldForMs: 30_000,
        until: "2026-10-05T10:00:30.000Z",
        importProcessId: "imp-1",
      },
    });
    expect(processes.asked).toEqual(["p-una"]);
    expect(said("p-una")).toBe("stopped");
  });

  // Run 2 (2026-10-16): a press that went through leaves no record at HQ; its Mate read as half
  // made until its container was listed.
  it("never reads a press HQ let go of as stopped: one that went through leaves no record", () => {
    const registry = mount({
      "p-una": { kind: "mate", heldForMs: 30_000, until: "2026-10-05T10:00:30.000Z" },
    });
    expect(said("p-una")).toBe("pressing");
    act(() => {
      mountHqNavigation(registry, "org-1", { structure: { ungrouped: [], apps: [] }, presses: {} });
    });
    expect(said("p-una")).toBe("unknown");
  });

  it("says nothing either way while HQ has said nothing of presses", () => {
    mount(null);
    expect(said("p-una")).toBe("unknown");
  });
});

it.each(["birth", "mate"] as const)(
  "a fresh %s observer demands HQ's exact import without a press or local history and follows its late answer",
  (owner) => {
    const registry = AtomRegistry.make();
    const structure = (importProcessId?: string) => ({
      apps:
        owner === "birth"
          ? [
              {
                id: "app",
                name: "App",
                projects: [],
                births: [
                  {
                    id: "birth",
                    face: "",
                    projectId: "p-una",
                    ...(importProcessId === undefined ? {} : { importProcessId }),
                  },
                ],
              },
            ]
          : [],
      ungrouped:
        owner === "mate"
          ? [
              {
                projectId: "p-una",
                name: "Una",
                mate: { face: "", ...(importProcessId === undefined ? {} : { importProcessId }) },
              },
            ]
          : [],
    });
    const { store, seed } = mountHqNavigation(registry, "org-1", {
      structure: structure("imp-original"),
      presses: {},
    });
    liveZerops({ running: [] }).forEach(store.dispatch);
    const releases = vi.fn();
    const demand = vi.fn(() => releases);
    registry.set(accountReadsAtom, { ...registry.get(accountReadsAtom)!, demandDetail: demand });
    let revision = 10;
    const answer = (id: string, status: string) =>
      store.dispatch({
        kind: "rows",
        scope: runningScope("org"),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "process",
            id,
            value: {
              id,
              projectId: "p-una",
              status,
              serviceStackIds: [],
              created: "2026-10-28T10:00:00Z",
              actionName: id === "imp-original" ? "stack.create" : "project.create",
            },
            revision: zeropsVersion(revision++),
          },
        ],
      });
    answer("newest-unrelated", "FAILED");
    act(() => {
      tree = create(
        createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)),
      );
    });
    expect(demand.mock.calls).toEqual([
      [{ family: "process", listing: "process", ownerId: "imp-original" }],
    ]);
    expect(said("p-una")).toBe("unknown");
    expect(store.state().operations.size).toBe(0);
    act(() => {
      answer("imp-original", "RUNNING");
    });
    expect(said("p-una")).toBe("pressing");
    act(() => {
      answer("imp-original", "FINISHED");
    });
    expect(said("p-una")).toBe("pressing");
    act(() => {
      answer("imp-original", "FAILED");
    });
    expect(said("p-una")).toBe("stopped");
    act(() => {
      seed({ structure: structure(), presses: {} });
    });
    expect(said("p-una")).toBe("unknown");
    expect(releases).toHaveBeenCalledTimes(1);
    expect(store.state().operations.size).toBe(0);
  },
);
