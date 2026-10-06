import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "./__fixtures__/account.ts";
import {
  accountReadsAtom,
  holdProjectHistory,
  NOT_READ_PROCESSES,
  NOT_READ_SERVICES,
  projectProcessesAtom,
  projectServicesAtom,
  projectsServicesAtom,
} from "./reads.ts";
import { makeAccountStore } from "./store.ts";

describe("projectProcessesAtom", () => {
  it("reads a project's processes through the mounted account, and nothing without one", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [{ id: "build", projectId: "p1" }] }).forEach(store.dispatch);
    const atom = projectProcessesAtom("p1");
    expect(registry.get(atom)).toEqual(NOT_READ_PROCESSES);

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    expect(registry.get(atom).running.map((process) => process.id)).toEqual(["build"]);

    registry.set(accountReadsAtom, { data: store.data, orgId: null, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_PROCESSES);
  });
});

describe("projectServicesAtom", () => {
  it("reads a project's services through the mounted account, and nothing without one", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], services: [{ id: "zcp", projectId: "p1" }] }).forEach(store.dispatch);
    const atom = projectServicesAtom("p1");
    expect(registry.get(atom)).toEqual(NOT_READ_SERVICES);

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    expect(registry.get(atom).services?.map((service) => service.id)).toEqual(["zcp"]);

    registry.set(accountReadsAtom, { data: store.data, orgId: null, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_SERVICES);
  });
});

describe("projectsServicesAtom", () => {
  it("reads several projects' services at once through the mounted account", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [],
      services: [
        { id: "zcp", projectId: "p1" },
        { id: "db", projectId: "p2" },
      ],
    }).forEach(store.dispatch);
    const atom = projectsServicesAtom("p1,p2");
    expect(registry.get(atom)).toEqual({});

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    const read = registry.get(atom);
    expect([read.p1?.services?.[0]?.id, read.p2?.services?.[0]?.id]).toEqual(["zcp", "db"]);
  });
});

describe("holdProjectHistory", () => {
  it("holds a project's history through whichever account is mounted, and lets go once", () => {
    const registry = AtomRegistry.make();
    const held: string[] = [];
    const reads = (name: string) => ({
      data: makeAccountStore(registry).data,
      orgId: ORG,
      demandDetail: (demand: { readonly ownerId: string }) => {
        held.push(`${name} ${demand.ownerId}`);
        return () => void held.splice(held.indexOf(`${name} ${demand.ownerId}`), 1);
      },
    });
    const release = holdProjectHistory(registry, "p1");
    expect(held).toEqual([]);
    registry.set(accountReadsAtom, reads("first"));
    expect(held).toEqual(["first p1"]);
    registry.set(accountReadsAtom, reads("second"));
    expect(held).toEqual(["second p1"]);
    release();
    release();
    expect(held).toEqual([]);
  });
});
