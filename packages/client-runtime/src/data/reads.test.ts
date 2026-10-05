import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "./__fixtures__/account.ts";
import {
  accountReadsAtom,
  holdProjectHistory,
  NOT_READ_PROCESSES,
  projectProcessesAtom,
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
