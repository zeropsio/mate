import { RegistryContext } from "@effect/atom-react";
import { runningScope, type DetailDemand } from "@t3tools/client-runtime/data";
import { liveZerops, ORG, zeropsVersion } from "@t3tools/client-runtime/data/fixtures";
import type { ZeropsProjectCreation } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AccountDataContext, type AccountData } from "./accountData";
import { mountHqNavigation } from "./__fixtures__/hqNavigation";

import {
  creationVerdictTargets,
  settledCreations,
  useProjectCreations,
} from "./useProjectCreations";

describe("creationVerdictTargets", () => {
  it("names every project still on its way up, once each", () => {
    expect(
      creationVerdictTargets([
        { project: { id: "a", name: "a", status: "CREATING" } },
        { project: { id: "a", name: "a", status: "CREATING" } },
        { project: { id: "b", name: "b", status: "NEW" } },
        { project: { id: "c", name: "c", status: "ACTIVE" } },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("names nobody once every project has landed", () => {
    expect(creationVerdictTargets([{ project: { id: "a", name: "a", status: "ACTIVE" } }])).toEqual(
      [],
    );
  });
});

describe("settledCreations", () => {
  it("keeps the creations the platform settled, never one still on its way", () => {
    const settled = settledCreations({
      p1: { processId: "c1", status: "RUNNING", error: null },
      p2: { processId: "c2", status: "FAILED", error: { code: "x", message: "Broke" } },
      p3: { processId: "c3", status: "FINISHED", error: null },
    });
    expect([...settled.keys()]).toEqual(["p2", "p3"]);
  });
});

function mountedAccount(
  data: AccountData["data"],
  demandDetail: AccountData["demandDetail"],
): AccountData {
  const unused = () => {
    throw new Error("This creation reader must only read projections and demand its import.");
  };
  return {
    data,
    orgId: ORG,
    demandDetail,
    renewHeld: unused,
    retry: unused,
    showHq: unused,
    moveOffers: unused,
    handoverCandidates: unused,
    readDetail: unused,
    revalidate: unused,
    retryDetail: unused,
    compare: unused,
    logs: null,
  };
}

let mounted: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = undefined;
  vi.unstubAllGlobals();
});

it.each(["FINISHED", "FAILED", "CANCELED"])(
  "an active project without its container follows its birth's exact import through a late %s answer",
  (terminal) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const registry = AtomRegistry.make();
    const { store } = mountHqNavigation(registry, ORG, {
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "app",
            name: "App",
            projects: [],
            births: [
              { id: "birth", face: "", projectId: "p1", importProcessId: "accepted-import" },
            ],
          },
        ],
      },
      presses: {},
    });
    liveZerops({
      projects: [{ id: "p1", status: "ACTIVE" }],
      running: [
        {
          id: "newer-unrelated",
          projectId: "p1",
          actionName: "project.create",
          created: "2026-10-28T12:00:00Z",
          status: "FAILED",
        },
      ],
    }).forEach(store.dispatch);
    const release = vi.fn();
    const demand = vi.fn((_demand: DetailDemand) => release);
    const account = mountedAccount(store.data, demand);
    const candidates: ReadonlyArray<ZeropsCandidate> = [
      {
        key: "p1",
        group: "unavailable",
        project: { id: "p1", name: "App", status: "ACTIVE" },
        missingContainer: true,
      },
    ];
    let drawn: ReadonlyMap<string, ZeropsProjectCreation> = new Map();
    function Probe() {
      const result = useProjectCreations(candidates);
      useLayoutEffect(() => {
        drawn = result;
      });
      return null;
    }
    act(() => {
      mounted = create(
        createElement(
          RegistryContext.Provider,
          { value: registry },
          createElement(AccountDataContext.Provider, { value: account }, createElement(Probe)),
        ),
      );
    });
    expect([...drawn]).toEqual([]);
    expect(demand.mock.calls).toEqual([
      [
        {
          family: "process",
          listing: "process",
          ownerId: "accepted-import",
        },
      ],
    ]);
    let revision = 10;
    const answer = (status: string) =>
      store.dispatch({
        kind: "rows",
        scope: runningScope(ORG),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "process",
            id: "accepted-import",
            value: {
              id: "accepted-import",
              projectId: "p1",
              status,
              actionName: "stack.create",
              serviceStackIds: [],
              created: "2026-10-28T10:00:00Z",
            },
            revision: zeropsVersion(revision++),
          },
        ],
      });
    act(() => {
      answer("RUNNING");
    });
    expect([...drawn]).toEqual([]);
    act(() => {
      answer(terminal);
    });
    expect([...drawn]).toEqual([
      ["p1", { processId: "accepted-import", status: terminal, error: null }],
    ]);
    expect(demand).toHaveBeenCalledTimes(1);
    expect(store.state().operations.size).toBe(0);
    act(() => {
      mounted?.unmount();
    });
    mounted = undefined;
    expect(release).toHaveBeenCalledTimes(1);
  },
);

it("an active birth without a recorded import stays awaiting evidence despite unrelated project creation failures", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const registry = AtomRegistry.make();
  const { store } = mountHqNavigation(registry, ORG, {
    structure: {
      ungrouped: [],
      apps: [
        {
          id: "app",
          name: "App",
          projects: [],
          births: [{ id: "birth", face: "", projectId: "p1" }],
        },
      ],
    },
    presses: {},
  });
  liveZerops({
    projects: [{ id: "p1", status: "ACTIVE" }],
    running: [
      {
        id: "prior",
        projectId: "p1",
        actionName: "project.create",
        status: "FAILED",
        created: "2026-10-27T10:00:00Z",
      },
      {
        id: "newest",
        projectId: "p1",
        actionName: "project.create",
        status: "FAILED",
        created: "2026-10-28T10:00:00Z",
      },
    ],
  }).forEach(store.dispatch);
  const demand = vi.fn((_demand: DetailDemand) => () => {});
  const account = mountedAccount(store.data, demand);
  let drawn: ReadonlyMap<string, ZeropsProjectCreation> = new Map();
  function Probe() {
    const result = useProjectCreations([
      {
        key: "p1",
        group: "unavailable",
        project: { id: "p1", name: "App", status: "ACTIVE" },
        missingContainer: true,
      },
    ]);
    useLayoutEffect(() => {
      drawn = result;
    });
    return null;
  }
  act(() => {
    mounted = create(
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(AccountDataContext.Provider, { value: account }, createElement(Probe)),
      ),
    );
  });
  expect([...drawn]).toEqual([]);
  expect(demand).not.toHaveBeenCalled();
  expect(store.state().operations.size).toBe(0);
});
