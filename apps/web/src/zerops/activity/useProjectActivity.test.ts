import type { InterestState, ProjectActivityRead } from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import { projectActivitySnapshotFromRead } from "./useProjectActivity";

const identity = {} as never;
const OBSERVING: InterestState = {
  status: "observing",
  identity,
  guarantee: "source-order-unverified",
  sinceReceiptOrdinal: 1 as never,
};
const RECOVERING: InterestState = {
  status: "recovering",
  identity,
  reason: "disconnect",
  attempt: 1,
  nextRetryAtMs: 0,
  progress: {
    requiredRegistrations: 1,
    completedRegistrations: 0,
    requiredReads: 1,
    completedReads: 0,
    crossedReceiptOrdinal: 1 as never,
  },
};
const PAUSED: InterestState = { status: "paused", identity, reason: "offline" };

function emptyRead(required: ReadonlyArray<InterestState>): ProjectActivityRead {
  const observation = { required, optional: [], access: { status: "unverified" as const } };
  return {
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
      observation,
    },
    retainedHistory: [],
    observation,
  };
}

describe("projectActivitySnapshotFromRead", () => {
  it("keeps a successfully observed empty activity window distinct from no observation", () => {
    expect(projectActivitySnapshotFromRead(emptyRead([OBSERVING]))).toEqual({
      processes: [],
      atMs: 42,
      live: true,
    });
  });

  it.each([
    { name: "every required interest observing", required: [OBSERVING, OBSERVING], live: true },
    { name: "one required interest recovering", required: [OBSERVING, RECOVERING], live: false },
    { name: "the feed paused", required: [PAUSED], live: false },
    { name: "no required interest at all", required: [], live: false },
  ])("is live only while the feed observes: $name", ({ required, live }) => {
    expect(projectActivitySnapshotFromRead(emptyRead(required)).live).toBe(live);
  });
});
