import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "./__fixtures__/account.ts";
import { accountReadsAtom, NOT_READ_PROCESSES, projectProcessesAtom } from "./reads.ts";
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
