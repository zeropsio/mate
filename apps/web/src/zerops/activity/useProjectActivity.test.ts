import { describe, expect, it } from "vite-plus/test";

import { projectActivitySnapshotFromRead } from "./useProjectActivity";

describe("projectActivitySnapshotFromRead", () => {
  it("keeps a successfully observed empty activity window distinct from no observation", () => {
    const snapshot = projectActivitySnapshotFromRead({
      running: {
        value: [],
        query: {
          status: "observed",
          descriptor: {} as never,
          key: "query" as never,
          memberKeys: [],
          unresolvedMemberKeys: [],
          observedTotal: 0,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 0,
            guarantee: "non-atomic",
          },
          source: "direct-read",
          stamp: { receiptOrdinal: 1 as never, observedAtMs: 42 },
          lastAppliedReadStartOrdinal: 1 as never,
          membershipOperations: new Map(),
        },
        observation: { required: [], optional: [], access: { status: "unverified" } },
      },
      retainedHistory: [],
      observation: { required: [], optional: [], access: { status: "unverified" } },
    });

    expect(snapshot).toEqual({ processes: [], atMs: 42 });
  });
});
