import { historyScope, runningScope } from "@t3tools/client-runtime/data";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { AtomRegistry } from "effect/reactivity";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { describe, expect, it } from "vite-plus/test";

import {
  type DeployBuildsInput,
  deployBuildLookup,
  projectBuildProcesses,
} from "./useDeployBuilds";
import type { ProjectActivitySnapshot } from "./useProjectActivity";

const BUILDING: ActivityProcess = {
  id: "p1",
  projectId: "proj-1",
  serviceStackIds: ["svc-1"],
  status: "RUNNING",
  actionName: "stack.build",
  created: "2026-09-02T10:00:00.000Z",
  appVersion: { id: "av-1", status: "BUILDING" },
};
const READ: ProjectActivitySnapshot = {
  processes: [BUILDING],
  live: true,
  processHistory: "read",
};
const input = (overrides: Partial<DeployBuildsInput>): DeployBuildsInput => ({
  signedIn: true,
  thread: { projectId: "proj-1" },
  project: "readable",
  snapshot: READ,
  ...overrides,
});

describe("deployBuildLookup — what the thread's project says of a build a deploy named", () => {
  it.each([
    { name: "the store read the project", input: input({}), expected: "running" },
    {
      name: "nothing read of it yet",
      input: input({ snapshot: { processes: undefined, processHistory: "unread" } }),
      expected: "unread",
    },
    {
      name: "the inventory still loading",
      input: input({ project: "loading" }),
      expected: "unread",
    },
    { name: "not signed in", input: input({ signedIn: false }), expected: "unobservable" },
    {
      name: "the thread's project still read",
      input: input({ thread: "reading" }),
      expected: "unread",
    },
    {
      name: "a thread with no project",
      input: input({ thread: "none" }),
      expected: "unobservable",
    },
    {
      name: "a project not readable here",
      input: input({ project: "unreadable" }),
      expected: "unobservable",
    },
    {
      name: "the store cannot read it",
      input: input({ snapshot: { ...READ, unavailableReason: "forbidden" } }),
      expected: "unobservable",
    },
    {
      name: "Zerops out before anything was read: still unread, however long, never unobservable",
      input: input({
        snapshot: {
          processes: undefined,
          processHistory: "reading",
        },
      }),
      expected: "unread",
    },
    {
      name: "Zerops out with the project read: as it was read",
      input: input({ snapshot: READ }),
      expected: "running",
    },
  ] as const)("$name: $expected", ({ input: given, expected }) => {
    expect(deployBuildLookup(given)("av-1")).toBe(expected);
  });
});

it("a chat keeps completed build evidence without rendering transport recovery", () => {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", [{ id: "proj-1", name: "Project", status: "ACTIVE" }]);
  const history = historyScope("org", "proj-1");
  for (const scope of [runningScope("org"), history]) {
    store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
    store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
    store.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members: [],
      rows: [],
    });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
  }
  const read = store.data.project(projectBuildProcesses, { orgId: "org", projectId: "proj-1" });
  let renders = 0;
  const stop = registry.subscribe(read, () => renders++);
  const before = registry.get(read);
  renders = 0;
  for (const key of [runningScope("org"), history]) {
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "parent-lost" } });
  }
  expect(registry.get(read)).toBe(before);
  expect(deployBuildLookup(input({ snapshot: registry.get(read) }))("missing")).toBe(
    "unobservable",
  );
  expect(renders).toBe(0);
  store.dispatch({
    kind: "rows",
    scope: history,
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "process",
        id: BUILDING.id,
        value: { ...BUILDING, status: "FINISHED", appVersion: { id: "av-1", status: "ACTIVE" } },
        revision: { kind: "zerops", version: 2 },
      },
    ],
  });
  expect(deployBuildLookup(input({ snapshot: registry.get(read) }))("av-1")).toBe("finished");
  expect(renders).toBe(1);
  stop();
  registry.dispose();
});
