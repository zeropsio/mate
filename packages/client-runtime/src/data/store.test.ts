import { AtomRegistry, type Atom } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, processValue } from "./__fixtures__/account.ts";
import { placementsScope, type PlacementValue } from "./families/hqNavigation.ts";
import { mateAttention } from "./projections/mateAttention.ts";
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
  it("derives and publishes only the changed Mate among thirty attention readers", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const scope = placementsScope(ORG);
    const projectIds = Array.from({ length: 30 }, (_, index) => `mate-${index}`);
    const value = (id: string, unseen: number): PlacementValue => ({
      projectId: id,
      appId: null,
      name: id,
      kind: "mate",
      mate: null,
      person: {
        role: "DEVELOPER",
        mayWrite: true,
        mine: false,
        ownerUserId: null,
        waitsOnViewer: false,
        unseen,
      },
      signedInNow: {},
      everSignedIn: {},
    });
    const delivery = (ids: ReadonlyArray<string>, revision: number, unseen = 0): AccountInput => ({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: 0 }],
      reset: false,
      removals: [],
      rows: ids.map((id) => ({
        family: "placement",
        id,
        value: value(id, unseen),
        revision: { kind: "hq", incarnation: "a", revision },
      })),
    });
    store.dispatch(delivery(projectIds, 1));
    const derived: string[] = [];
    const published: string[] = [];
    const counted: typeof mateAttention = {
      ...mateAttention,
      derive: (read, key) => {
        derived.push(key.projectId);
        return mateAttention.derive(read, key);
      },
    };
    const releases = projectIds.map((projectId) => {
      const atom = store.data.project(counted, { orgId: ORG, projectId });
      return registry.subscribe(
        atom,
        () => {
          registry.get(atom);
          published.push(projectId);
        },
        { immediate: true },
      );
    });
    derived.length = 0;
    published.length = 0;
    store.dispatch(delivery([projectIds[0]!], 2, 1));
    expect(derived).toEqual([projectIds[0]]);
    expect(published).toEqual([projectIds[0]]);
    derived.length = 0;
    published.length = 0;
    // A newer delivery still publishes its source metadata without a visible notification.
    store.dispatch(delivery([projectIds[0]!], 3, 1));
    expect(derived).toEqual([projectIds[0]]);
    expect(published).toEqual([]);
    expect(registry.get(store.data.fact("placement", projectIds[0]!))).toMatchObject({
      revision: { revision: 3 },
    });
    derived.length = 0;
    store.dispatch(delivery([projectIds[0]!], 3, 1));
    store.dispatch(delivery([projectIds[0]!], 1));
    expect(derived).toEqual([]);
    expect(published).toEqual([]);
    // Real membership changes still reach every holder of this shared scope.
    store.dispatch(delivery(["new-mate"], 3));
    expect(derived).toEqual(projectIds);
    expect(published).toEqual([]);
    releases.forEach((release) => release());
    store.close();
    registry.dispose();
  });

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
