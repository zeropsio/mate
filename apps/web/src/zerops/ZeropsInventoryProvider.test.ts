import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type GrantFailure,
  type InterestIdentity,
  type InterestState,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import {
  accessLapseCopy,
  demandedReads,
  isInterestBlocked,
  retryInvalidations,
} from "./ZeropsInventoryProvider";

const account = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account-a"),
};
const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("org-a"),
};

describe("retryInvalidations", () => {
  const other = { ...organization, organizationId: ZeropsOrganizationId.make("org-b") };
  it.each([
    {
      name: "a grant not held is renewed now",
      granted: false,
      blocked: [],
      want: [{ topic: "access", change: "renew-now" }],
    },
    {
      name: "an organization whose data failed is read again, and a held grant is left alone",
      granted: true,
      blocked: [organization],
      want: [{ topic: "inventory", organization, why: "user-retry" }],
    },
    {
      name: "a grant not held and failed data ask for both",
      granted: false,
      blocked: [organization, other],
      want: [
        { topic: "access", change: "renew-now" },
        { topic: "inventory", organization, why: "user-retry" },
        { topic: "inventory", organization: other, why: "user-retry" },
      ],
    },
    {
      name: "with nothing failed, a check still running asks the grant",
      granted: true,
      blocked: [],
      want: [{ topic: "access", change: "renew-now" }],
    },
  ])("$name", ({ granted, blocked, want }) => {
    expect(retryInvalidations({ granted, blockedOrganizations: blocked })).toEqual(want);
  });
});

describe("what the demanded reads say: loading, trouble and its retry", () => {
  const organization = {
    kind: "organization",
    account: { apiOrigin: "https://api.example.test", accountId: "a" },
    organizationId: "o",
  } as never;
  const identity = {} as InterestIdentity;
  const at = (interest: InterestState | undefined) => [{ organization, projectId: "p", interest }];
  const failed = (retryAtMs: number | null, retryable = true): InterestState => ({
    status: "failed",
    identity,
    reason: "unavailable",
    retryable,
    attempts: 1,
    retryAtMs,
  });
  const establishing: InterestState = {
    status: "establishing",
    identity,
    startedAtMs: 0,
    deadlineMs: 60_000,
    progress: {} as never,
  };
  const observing: InterestState = {
    status: "observing",
    identity,
    guarantee: "source-order-unverified",
    sinceReceiptOrdinal: 0 as never,
  };

  it("a failed read is not loading: only an establishing one is", () => {
    expect([...demandedReads(at(failed(5_000)), new Map(), 0, false).pending]).toEqual([]);
    expect([...demandedReads(at(establishing), new Map(), 0, false).pending]).toEqual(["o"]);
  });

  it("holds one trouble through a retry's establishing, and lets go once it observes", () => {
    let latch: ReturnType<typeof demandedReads>["latch"] = new Map();
    const seen: Array<readonly [number, boolean]> = [];
    for (const interest of [failed(5_000), establishing, failed(9_000), establishing, observing]) {
      const read = demandedReads(at(interest), latch, 0, false);
      latch = read.latch;
      seen.push([read.blockedOrganizations.length, read.retrying]);
    }
    expect(seen).toEqual([
      [1, true],
      [1, true],
      [1, true],
      [1, true],
      [0, true],
    ]);
  });

  it("a failure no retry follows is trouble that is not retrying", () => {
    const read = demandedReads(at(failed(null, false)), new Map(), 0, false);
    expect(read.blockedOrganizations).toHaveLength(1);
    expect(read.retrying).toBe(false);
  });
});

describe("isInterestBlocked", () => {
  const identity = {} as InterestIdentity;
  const progress = {
    requiredRegistrations: 1,
    completedRegistrations: 0,
    requiredReads: 1,
    completedReads: 0,
    crossedReceiptOrdinal: 0 as never,
  } as InterestState extends { readonly progress: infer P } ? P : never;

  const GRACE_MS = 30_000;

  it("is never blocked while undemanded, observing, or paused", () => {
    expect(isInterestBlocked(undefined, 1_000, false)).toBe(false);
    expect(
      isInterestBlocked(
        {
          status: "observing",
          identity,
          guarantee: "source-order-unverified",
          sinceReceiptOrdinal: 0 as never,
        },
        1_000,
        false,
      ),
    ).toBe(false);
    expect(
      isInterestBlocked({ status: "paused", identity, reason: "background" }, 1_000, false),
    ).toBe(false);
  });

  it.each([
    { name: "no retry follows it", retryable: false, attempts: 1, retryAtMs: null, blocked: true },
    {
      name: "past its attempt limit",
      retryable: true,
      attempts: 6,
      retryAtMs: 5_000,
      blocked: true,
    },
    { name: "its retry waits", retryable: true, attempts: 2, retryAtMs: 5_000, blocked: false },
  ])("a failed interest is blocked when $name: $blocked (H5)", ({ blocked, ...failure }) => {
    expect(
      isInterestBlocked(
        { status: "failed", identity, reason: "refused", ...failure },
        1_000,
        false,
      ),
    ).toBe(blocked);
  });

  it("stays unblocked while recovering before its own published retry time plus grace (H5)", () => {
    const state: InterestState = {
      status: "failed",
      identity,
      reason: "disconnect",
      retryable: true,
      attempts: 2,
      retryAtMs: 8_000,
    };
    expect(isInterestBlocked(state, 8_000, false)).toBe(false);
    expect(isInterestBlocked(state, 8_000 + GRACE_MS - 1, false)).toBe(false);
    // Past the runtime's own published retry time by the full grace margin with no state change
    // since: read as a stall, using only the already-published field — no new timer.
    expect(isInterestBlocked(state, 8_000 + GRACE_MS, false)).toBe(true);
  });

  it("never treats a failure whose retry is not stamped yet as already elapsed", () => {
    // The reducer publishes this before the runtime's own backoff stamps a real retry time
    // (registration/malformed failure, membership overflow): a render in that gap must not flip
    // to the error UI.
    const state: InterestState = {
      status: "failed",
      identity,
      reason: "malformed",
      retryable: true,
      attempts: 1,
      retryAtMs: null,
    };
    expect(isInterestBlocked(state, 0, false)).toBe(false);
    expect(isInterestBlocked(state, Date.now(), false)).toBe(false);
  });

  it("stays unblocked while establishing before its own published deadline plus grace", () => {
    const state: InterestState = {
      status: "establishing",
      identity,
      startedAtMs: 0,
      deadlineMs: 10_000,
      progress,
    };
    expect(isInterestBlocked(state, 10_000, false)).toBe(false);
    expect(isInterestBlocked(state, 10_000 + GRACE_MS - 1, false)).toBe(false);
    expect(isInterestBlocked(state, 10_000 + GRACE_MS, false)).toBe(true);
  });

  it("is never blocked while the document is hidden, however long an interest has been stuck", () => {
    const state: InterestState = {
      status: "failed",
      identity,
      reason: "disconnect",
      attempts: 1,
      retryable: true,
      retryAtMs: null,
    };
    expect(isInterestBlocked(state, 8_000 + GRACE_MS + 1_000_000, true)).toBe(false);
  });
});

describe("accessLapseCopy", () => {
  const CHECKING = { sentence: "Checking your Zerops access…", retry: false };
  const NOT_ANSWERING = { sentence: "Zerops isn't answering.", retry: true };
  // One row per lapse reason (DESIGN §3.4): no cause yet, or a failure cause.
  it.each<readonly [string, GrantFailure | null, typeof CHECKING]>([
    ["no renewal failed since the grant", null, CHECKING],
    ["a round timed out", { kind: "timeout", afterMs: 30_000 }, NOT_ANSWERING],
    ["a round failed offline", { kind: "offline" }, NOT_ANSWERING],
    ["Zerops answered 503", { kind: "server", status: 503 }, NOT_ANSWERING],
  ])("%s", (_case, failure, copy) => {
    expect(accessLapseCopy(failure)).toEqual(copy);
  });
});
