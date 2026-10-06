import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "./__fixtures__/account.ts";
import {
  accountReadsAtom,
  holdProjectHistory,
  holdServiceRead,
  NOT_READ_PROCESSES,
  NOT_READ_SERVICES,
  NOT_READ_USAGE,
  projectProcessesAtom,
  projectUsageAtom,
  projectServicesAtom,
  projectsServicesAtom,
} from "./reads.ts";
import { makeAccountStore } from "./store.ts";
import { usageScope } from "./families/usage.ts";

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
    liveZerops({
      running: [],
      projects: [{ id: "p1" }],
      services: [{ id: "zcp", projectId: "p1" }],
    }).forEach(store.dispatch);
    const atom = projectServicesAtom("p1");
    expect(registry.get(atom)).toEqual(NOT_READ_SERVICES);

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    expect(registry.get(atom).services?.map((service) => service.id)).toEqual(["zcp"]);

    registry.set(accountReadsAtom, { data: store.data, orgId: null, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_SERVICES);
  });
});

describe("projectUsageAtom", () => {
  it("reads a project's resources through the mounted account, and nothing without one", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const atom = projectUsageAtom("p1");
    expect(registry.get(atom)).toEqual(NOT_READ_USAGE);

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_USAGE);
    store.dispatch({
      kind: "stream",
      key: usageScope(ORG, "p1"),
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "definitive-refusal", message: "HTTP 400" },
      },
    });
    expect(registry.get(atom).failure).toBe("HTTP 400");

    registry.set(accountReadsAtom, { data: store.data, orgId: null, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_USAGE);
  });
});

describe("projectsServicesAtom", () => {
  it("reads several projects' services at once through the mounted account", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [],
      projects: [{ id: "p1" }, { id: "p2" }],
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

describe("holdServiceRead", () => {
  it("holds one service's own read through the mounted account, and lets go once", () => {
    const registry = AtomRegistry.make();
    const held: string[] = [];
    registry.set(accountReadsAtom, {
      data: makeAccountStore(registry).data,
      orgId: ORG,
      demandDetail: (demand: { readonly listing?: string; readonly ownerId: string }) => {
        held.push(`${demand.listing} ${demand.ownerId}`);
        return () => void held.splice(held.indexOf(`${demand.listing} ${demand.ownerId}`), 1);
      },
    });
    const release = holdServiceRead(registry, "s1");
    expect(held).toEqual(["service s1"]);
    release();
    release();
    expect(held).toEqual([]);
  });
});
