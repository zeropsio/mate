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
const FAILED: InterestState = {
  status: "failed",
  identity,
  reason: "disconnect",
  attempts: 1,
  retryable: true,
  retryAtMs: null,
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
    processHistory: "unread",
    observation,
  };
}

describe("projectActivitySnapshotFromRead", () => {
  it("keeps a successfully observed empty activity window distinct from no observation", () => {
    expect(projectActivitySnapshotFromRead(emptyRead([OBSERVING]))).toEqual({
      processes: [],
      atMs: 42,
      live: true,
      processHistory: "unread",
    });
  });

  it.each([
    { name: "every required interest observing", required: [OBSERVING, OBSERVING], live: true },
    { name: "one required interest failed", required: [OBSERVING, FAILED], live: false },
    { name: "the feed paused", required: [PAUSED], live: false },
    { name: "no required interest at all", required: [], live: false },
  ])("is live only while the feed observes: $name", ({ required, live }) => {
    expect(projectActivitySnapshotFromRead(emptyRead(required)).live).toBe(live);
  });
});

// Run 12: the Zerops socket closes every 30 minutes and the client reconnects;
// each close failed every read with a retry scheduled, and the deploy card
// said "Zerops isn't answering" at once. A failure the runtime retries ages
// the card's read like any feed that stops observing; one it gives up on is
// the feed's error.
describe("what a failed interest makes of the read", () => {
  it.each([
    { name: "a reconnect the runtime retries is no failure", retryable: true, reason: undefined },
    { name: "a failure it does not retry is one", retryable: false, reason: "disconnect" },
  ])("$name", ({ retryable, reason }) => {
    const snapshot = projectActivitySnapshotFromRead(
      emptyRead([OBSERVING, { ...FAILED, retryable }]),
    );
    expect(snapshot.unavailableReason).toBe(reason);
    expect(snapshot.live).toBe(false);
  });
});
