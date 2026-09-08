import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type AccessState,
  type InterestIdentity,
  type InterestState,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import {
  inventoryProjectRefs,
  isInterestBlocked,
  supplementalAccessFor,
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
const project = (projectId: string): ProjectRef => ({
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make(projectId),
});

describe("inventoryProjectRefs", () => {
  it("includes command-established project access before external membership refresh", () => {
    const existing = project("existing");
    const created = project("created");
    const access: AccessState = {
      status: "verified",
      account,
      accountEpoch: AccountEpoch.make(1),
      verifiedAtMs: 0,
      deadlineMs: 10_000,
      mutationsAllowed: true,
      organizations: [{ organization, mutationsAllowed: true }],
      projects: [
        { project: existing, role: "ADMIN", mutationsAllowed: true },
        { project: created, role: "OWNER", mutationsAllowed: true },
        { project: project("denied"), role: "NO_ACCESS", mutationsAllowed: false },
      ],
    };

    expect(inventoryProjectRefs([{ ref: existing }], access)).toEqual([existing, created]);
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

  it("is blocked once an interest reaches `failed`, regardless of retryAtMs (H5)", () => {
    expect(
      isInterestBlocked(
        {
          status: "failed",
          identity,
          reason: "gone",
          retryable: true,
          attempts: 3,
          retryAtMs: 5_000,
        },
        1_000,
        false,
      ),
    ).toBe(true);
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

  it("stays unblocked while recovering before its own published retry time plus grace (H5)", () => {
    const state: InterestState = {
      status: "recovering",
      identity,
      reason: "disconnect",
      attempt: 2,
      nextRetryAtMs: 8_000,
      progress,
    };
    expect(isInterestBlocked(state, 8_000, false)).toBe(false);
    expect(isInterestBlocked(state, 8_000 + GRACE_MS - 1, false)).toBe(false);
    // Past the runtime's own published retry time by the full grace margin
    // with no state change since: read as a stall, using only the
    // already-published field — no new timer.
    expect(isInterestBlocked(state, 8_000 + GRACE_MS, false)).toBe(true);
  });

  it("never treats a placeholder `nextRetryAtMs: 0` as already elapsed", () => {
    // The reducer emits this before the runtime's own backoff calculation
    // stamps a real retry time (registration/malformed failure, membership
    // overflow) — a render in that gap must not flip to the error UI.
    const state: InterestState = {
      status: "recovering",
      identity,
      reason: "malformed",
      attempt: 1,
      nextRetryAtMs: 0,
      progress,
    };
    expect(isInterestBlocked(state, 0, false)).toBe(false);
    expect(isInterestBlocked(state, Date.now(), false)).toBe(false);
  });

  it("is never blocked while the document is hidden, however long an interest has been stuck", () => {
    const state: InterestState = {
      status: "recovering",
      identity,
      reason: "disconnect",
      attempt: 2,
      nextRetryAtMs: 8_000,
      progress,
    };
    expect(isInterestBlocked(state, 8_000 + GRACE_MS + 1_000_000, true)).toBe(false);
  });
});

describe("supplementalAccessFor", () => {
  const epoch = AccountEpoch.make(1);
  const verifiedAccess: AccessState = {
    status: "verified",
    account,
    accountEpoch: epoch,
    verifiedAtMs: 0,
    deadlineMs: 10_000,
    mutationsAllowed: true,
    organizations: [{ organization, mutationsAllowed: true }],
    projects: [{ project: project("created"), role: "OWNER", mutationsAllowed: true }],
  };

  it("passes access through as-is while verification has not completed a round yet", () => {
    expect(
      supplementalAccessFor({ verificationStatus: "loading", access: verifiedAccess, epoch }),
    ).toBe(verifiedAccess);
    expect(supplementalAccessFor({ verificationStatus: "loading", access: undefined, epoch })).toBe(
      undefined,
    );
  });

  it("keeps a verified access grant once verification is done, regardless of which verification revision produced it (H6)", () => {
    // No `revision`/`admission` field in the input at all: a later
    // verification round elsewhere (e.g. an unrelated candidates refresh)
    // must not drop a command-established project's access mid-flight.
    expect(
      supplementalAccessFor({ verificationStatus: "verified", access: verifiedAccess, epoch }),
    ).toBe(verifiedAccess);
  });

  it("drops access from a different account epoch even once verification is done", () => {
    const otherEpochAccess: AccessState = { ...verifiedAccess, accountEpoch: AccountEpoch.make(2) };
    expect(
      supplementalAccessFor({ verificationStatus: "verified", access: otherEpochAccess, epoch }),
    ).toBeUndefined();
  });

  it("drops non-verified access once verification is done", () => {
    expect(
      supplementalAccessFor({
        verificationStatus: "verified",
        access: { status: "verifying", accountEpoch: epoch, previous: null },
        epoch,
      }),
    ).toBeUndefined();
    expect(
      supplementalAccessFor({ verificationStatus: "verified", access: undefined, epoch }),
    ).toBeUndefined();
  });
});
