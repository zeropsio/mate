import { AtomRegistry, type Atom } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, processValue } from "./__fixtures__/account.ts";
import { runningScope } from "./families/process.ts";
import { linkKeys } from "./model.ts";
import { runningWork, type ProjectKey, type RunningWork } from "./projections/processes.ts";
import type { AccountInput } from "./reducer.ts";
import { makeAccountStore, type Projection } from "./store.ts";

const running = runningScope(ORG);

const attach: ReadonlyArray<AccountInput> = [
  {
    kind: "stream",
    key: linkKeys.zerops(ORG),
    now: 0,
    event: { kind: "demand", demanded: true },
  },
  { kind: "stream", key: running, now: 0, event: { kind: "demand", demanded: true } },
  { kind: "stream", key: running, now: 0, event: { kind: "attempt" } },
];

const processRows = (
  ...rows: ReadonlyArray<readonly [id: string, version: number, projectId?: string]>
): AccountInput => ({
  kind: "rows",
  scope: running,
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: rows.map(([id, version, projectId = "p"]) => ({
    family: "process" as const,
    id,
    value: processValue({ id, projectId }),
    revision: { kind: "zerops" as const, version },
  })),
});

describe("makeAccountStore", () => {
  it("publishes a reduction to the keys it changed and to no other", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    attach.forEach(store.dispatch);
    const heard: string[] = [];
    for (const id of ["q1", "q2"])
      registry.subscribe(store.data.fact("process", id), () => heard.push(id));

    store.dispatch(processRows(["q1", 1]));

    expect(heard).toEqual(["q1"]);
    expect(registry.get(store.data.fact("process", "q1"))).toMatchObject({
      kind: "known",
      value: { id: "q1" },
      scope: running,
    });
    expect(registry.get(store.data.fact("process", "q2"))).toEqual({ kind: "unknown" });
  });

  it("recomputes only the busy projects' rows while 100 menu rows are mounted", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const projects = Array.from({ length: 100 }, (_, index) => `project-${index}`);
    liveZerops({ running: [] }).forEach(store.dispatch);

    const derived = new Map<string, number>();
    const counted: Projection<ProjectKey, RunningWork> = {
      ...runningWork,
      derive: (read, key) => {
        derived.set(key.projectId, (derived.get(key.projectId) ?? 0) + 1);
        return runningWork.derive(read, key);
      },
    };
    // A render: every mounted atom is read again whenever it says it changed.
    const mount = <Value>(atom: Atom.Atom<Value>) =>
      registry.subscribe(atom, () => void registry.get(atom), { immediate: true });
    for (const projectId of projects) mount(store.data.project(counted, { orgId: ORG, projectId }));
    derived.clear();

    // A busy project: its deploy's row moves fifty times; one other project starts a build.
    for (let version = 1; version <= 50; version += 1)
      store.dispatch(processRows(["deploy-0", version, "project-0"]));
    store.dispatch(processRows(["build-7", 1, "project-7"]));

    expect([...derived.keys()]).toEqual(["project-0", "project-7"]);
    expect(
      registry.get(store.data.project(counted, { orgId: ORG, projectId: "project-0" })).kind,
    ).toBe("running");
  });
});

describe("derived reader lifetime", () => {
  it("shares holders, releases the last mount, and remounts with current facts", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [] }).forEach(store.dispatch);
    const key = { orgId: ORG, projectId: "p" };
    const atom = store.data.project(runningWork, key);
    const first = registry.mount(atom);
    const second = registry.mount(store.data.project(runningWork, key));
    first();
    expect(registry.getNodes().has(atom)).toBe(true);
    second();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(registry.getNodes().has(atom)).toBe(false);
    store.dispatch(processRows(["work", 1]));
    store.dispatch({
      kind: "stream",
      key: running,
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "definitive-refusal", message: "Not allowed" },
      },
    });
    const refusal = store.state().streams.get(running);
    const remount = registry.mount(atom);
    expect(registry.get(atom).kind).toBe("running");
    remount();
    expect(store.state().streams.get(running)).toBe(refusal);
    expect(refusal?.phase).toBe("refused");
    expect(registry.get(store.data.fact("process", "work")).kind).toBe("known");
    store.close();
    registry.dispose();
    expect(registry.getNodes().size).toBe(0);
    const ended = store.state();
    store.dispatch(processRows(["late", 1]));
    expect(store.state()).toBe(ended);
  });
});
