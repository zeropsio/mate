import { describe, expect, it } from "@effect/vitest";

import { EMPTY_ADMISSION, makeUnresolvedProject, makeUnresolvedService } from "./inventory.ts";
import {
  knownProjectsOf,
  knownProjectTags,
  knownServicesOf,
  projectsSourceOf,
  servicesSourceOf,
} from "./known.ts";
import { selectProjectsOf, selectServicesOf } from "./projection.ts";
import { interestKeyOf } from "./runtime.ts";
import { makeInitialZeropsDataState } from "./state.ts";
import type {
  CollectionRead,
  EntityKnowledge,
  EntityRead,
  InterestState,
  ProjectRecord,
  QueryCoverage,
  ServiceRecord,
} from "./types.ts";
import { DispatchOrdinal, ReadStartOrdinal } from "./types.ts";
import { identity, organization, project, scope, service, stamp } from "./__fixtures__/index.ts";

const NOW = 5_000;

const observedFacet = <Fields>(fields: Fields, ordinal: number) => ({
  knowledge: "observed" as const,
  fields,
  unresolvedRequiredFields: [] as const,
  source: "indexed-search" as const,
  stamp: stamp(ordinal),
  admission: EMPTY_ADMISSION,
});

const organizationObserving = (): InterestState => ({
  status: "observing",
  identity: { ...identity(), key: interestKeyOf({ kind: "organization-inventory", organization }) },
  guarantee: "source-order-unverified",
  sinceReceiptOrdinal: stamp(1).receiptOrdinal,
});

/** A project whose name and status are read; its presentation is whatever the test gives it. */
const projectRead = (presentation: ProjectRecord["presentation"]): EntityRead<ProjectRecord> => {
  const unresolved = makeUnresolvedProject(project());
  return {
    value: {
      knowledge: "observed",
      record: {
        ...unresolved,
        identity: observedFacet({ name: "Wren", createdAt: null }, 2),
        lifecycle: observedFacet({ status: "ACTIVE" }, 2),
        presentation,
      },
    },
    observation: {
      required: [organizationObserving()],
      optional: [],
      access: { status: "unverified" },
    },
  };
};

describe("inventory knowledge", () => {
  it("an unread organization's projects are unread, never []", () => {
    const read = selectProjectsOf(makeInitialZeropsDataState(scope()), organization);

    expect(knownProjectsOf(read, NOW)).toEqual({ state: "unread", waitingFor: null });
  });

  it("a failed services query is failed with retryAt, never []", () => {
    const owner = project();
    const failed: InterestState = {
      status: "failed",
      identity: {
        ...identity(),
        key: interestKeyOf({ kind: "project-inventory", project: owner }),
      },
      reason: "services read refused",
      retryable: true,
      attempts: 3,
      retryAtMs: 9_000,
    };
    const unread = selectServicesOf(makeInitialZeropsDataState(scope()), owner);
    const read = { ...unread, observation: { ...unread.observation, required: [failed] } };

    expect(knownServicesOf(read, NOW)).toEqual({
      state: "failed",
      failure: { kind: "transport", detail: "services read refused" },
      atMs: NOW,
      attempt: 3,
      retryAtMs: 9_000,
    });
  });

  it("a project's tags the inventory has not read are unread, never []", () => {
    const read = projectRead(makeUnresolvedProject(project()).presentation);

    expect(knownProjectTags(read, NOW)).toEqual({ state: "unread", waitingFor: null });
  });

  it.each<{
    readonly name: string;
    readonly presentation: ProjectRecord["presentation"];
    readonly tags: unknown;
  }>([
    {
      name: "a presentation read without tags leaves them unread",
      presentation: observedFacet({ description: "shop" }, 3),
      tags: { state: "unread", waitingFor: null },
    },
    {
      name: "tags read as none are a known, complete none",
      presentation: observedFacet({ tags: [] }, 3),
      tags: {
        state: "known",
        value: [],
        asOf: { ordinal: 3, atMs: 30 },
        coverage: "complete",
        freshness: { kind: "live" },
      },
    },
    {
      name: "a confirmed denial is gone, never an empty list",
      presentation: {
        knowledge: "unavailable",
        reason: "forbidden",
        previousFields: { tags: ["group:shop"] },
        stamp: stamp(5),
        fence: {
          accountEpoch: scope().epoch,
          readStartOrdinal: ReadStartOrdinal.make(1),
          dispatchOrdinal: DispatchOrdinal.make(1),
          verifiedAccessDeadlineMs: 10_000,
        },
        admission: EMPTY_ADMISSION,
      },
      tags: { state: "gone", evidence: "direct-forbidden", asOf: { ordinal: 5, atMs: 50 } },
    },
  ])("project tags: $name", ({ presentation, tags }) => {
    expect(knownProjectTags(projectRead(presentation), NOW)).toEqual(tags);
  });

  it.each<{
    readonly reason: Extract<
      EntityKnowledge<ProjectRecord>,
      { readonly knowledge: "unavailable" }
    >["reason"];
    readonly evidence: string;
  }>([
    { reason: "forbidden", evidence: "direct-forbidden" },
    { reason: "not-found", evidence: "direct-not-found" },
  ])("an unavailable project ($reason) has tags gone ($evidence)", ({ reason, evidence }) => {
    const read: EntityRead<ProjectRecord> = {
      ...projectRead(makeUnresolvedProject(project()).presentation),
      value: { knowledge: "unavailable", ref: project(), reason, since: stamp(6) },
    };

    expect(knownProjectTags(read, NOW)).toEqual({
      state: "gone",
      evidence,
      asOf: { ordinal: 6, atMs: 60 },
    });
  });

  // The grant machine's denial covers a scope, often the whole account: no read of this project
  // said it is gone, so its tags wait for the grant (§3.4 withheld(access-denied), not gone).
  it.each<{ readonly name: string; readonly read: EntityRead<ProjectRecord> }>([
    {
      name: "the project",
      read: {
        ...projectRead(makeUnresolvedProject(project()).presentation),
        value: {
          knowledge: "unavailable",
          ref: project(),
          reason: "access-revoked",
          since: stamp(6),
        },
      },
    },
    {
      name: "its presentation",
      read: projectRead({
        knowledge: "unavailable",
        reason: "access-revoked",
        previousFields: { tags: ["group:shop"] },
        stamp: stamp(5),
        fence: {
          accountEpoch: scope().epoch,
          readStartOrdinal: ReadStartOrdinal.make(0),
          dispatchOrdinal: DispatchOrdinal.make(1),
          verifiedAccessDeadlineMs: 50,
        },
        admission: EMPTY_ADMISSION,
      }),
    },
  ])("a revoked access to $name leaves the tags waiting for the grant, never gone", ({ read }) => {
    expect(knownProjectTags(read, NOW)).toEqual({ state: "unread", waitingFor: "access-grant" });
  });

  describe("a services listing", () => {
    const owner = project();
    const key = interestKeyOf({ kind: "project-inventory", project: owner });
    const id = { ...identity(), key };
    const progress = {
      requiredRegistrations: 1,
      completedRegistrations: 0,
      requiredReads: 1,
      completedReads: 0,
      crossedReceiptOrdinal: stamp(0).receiptOrdinal,
    };
    const running: EntityKnowledge<ServiceRecord> = {
      knowledge: "observed",
      record: {
        ...makeUnresolvedService(service("api", owner)),
        identity: observedFacet({ hostname: "api" }, 3),
        lifecycle: observedFacet({ status: "ACTIVE" }, 3),
      },
    };
    const listing = (
      interests: ReadonlyArray<InterestState>,
      members: ReadonlyArray<EntityKnowledge<ServiceRecord>> = [running],
      coverage: Exclude<QueryCoverage, { readonly kind: "none" }> = {
        kind: "exhausted-traversal",
        traversedPages: 1,
        observedTotal: members.length,
        guarantee: "non-atomic",
      },
    ): CollectionRead<ServiceRecord> => {
      const unread = selectServicesOf(makeInitialZeropsDataState(scope()), owner);
      return {
        value: members,
        query: {
          ...unread.query,
          status: "observed",
          observedTotal: members.length,
          coverage,
          source: "indexed-search",
          stamp: stamp(4),
          lastAppliedReadStartOrdinal: ReadStartOrdinal.make(1),
        },
        observation: { ...unread.observation, required: interests },
      };
    };

    it.each<{
      readonly name: string;
      readonly interests: ReadonlyArray<InterestState>;
      readonly freshness: unknown;
    }>([
      {
        name: "no interest feeds it: not current, and nothing retries it",
        interests: [],
        freshness: {
          kind: "stale",
          reason: { kind: "source-recovering", retryAtMs: null },
          sinceMs: 40,
        },
      },
      {
        name: "paused because nobody leases it: not current, and nothing retries it",
        interests: [{ status: "paused", identity: id, reason: "no-leases" }],
        freshness: {
          kind: "stale",
          reason: { kind: "source-recovering", retryAtMs: null },
          sinceMs: 40,
        },
      },
      {
        name: "observing: live",
        interests: [
          {
            status: "observing",
            identity: id,
            guarantee: "source-order-unverified",
            sinceReceiptOrdinal: stamp(1).receiptOrdinal,
          },
        ],
        freshness: { kind: "live" },
      },
      {
        name: "establishing: revalidating since it started",
        interests: [
          { status: "establishing", identity: id, startedAtMs: 40, deadlineMs: 900, progress },
        ],
        freshness: { kind: "revalidating", sinceMs: 40 },
      },
      {
        name: "recovering: stale since its value was read, until its retry",
        interests: [
          {
            status: "recovering",
            identity: id,
            reason: "disconnect",
            attempt: 2,
            nextRetryAtMs: 7_000,
            progress,
          },
        ],
        freshness: {
          kind: "stale",
          reason: { kind: "source-recovering", retryAtMs: 7_000 },
          sinceMs: 40,
        },
      },
      {
        name: "paused in the background: not current",
        interests: [{ status: "paused", identity: id, reason: "background" }],
        freshness: { kind: "paused", by: "background" },
      },
      {
        name: "failed: the value kept, stale since it was read, with the retry",
        interests: [
          {
            status: "failed",
            identity: id,
            reason: "gateway",
            retryable: true,
            attempts: 2,
            retryAtMs: 8_000,
          },
        ],
        freshness: {
          kind: "stale",
          reason: {
            kind: "revalidation-failed",
            failure: { kind: "transport", detail: "gateway" },
            attempt: 2,
            retryAtMs: 8_000,
          },
          sinceMs: 40,
        },
      },
      {
        name: "one observing feeder outranks a failed one",
        interests: [
          {
            status: "failed",
            identity: id,
            reason: "gateway",
            retryable: true,
            attempts: 1,
            retryAtMs: null,
          },
          {
            status: "observing",
            identity: {
              ...identity(),
              key: interestKeyOf({
                kind: "project-topology",
                project: owner,
                includeCurrentMetrics: false,
              }),
            },
            guarantee: "source-order-unverified",
            sinceReceiptOrdinal: stamp(1).receiptOrdinal,
          },
        ],
        freshness: { kind: "live" },
      },
    ])("is as current as its best feeding interest (§3.5): $name", ({ interests, freshness }) => {
      expect(knownServicesOf(listing(interests), NOW)).toEqual({
        state: "known",
        value: [running.knowledge === "observed" ? running.record : null],
        asOf: { ordinal: 4, atMs: 40 },
        coverage: "complete",
        freshness,
      });
    });

    it.each<{
      readonly name: string;
      readonly interests: ReadonlyArray<InterestState>;
      readonly known: object;
    }>([
      { name: "no interest feeds it: unread", interests: [], known: { state: "unread" } },
      {
        name: "establishing: reading since it started",
        interests: [
          { status: "establishing", identity: id, startedAtMs: 40, deadlineMs: 900, progress },
        ],
        known: { state: "reading", sinceMs: 40, attempt: 1 },
      },
      {
        name: "recovering: reading, on its attempt",
        interests: [
          {
            status: "recovering",
            identity: id,
            reason: "disconnect",
            attempt: 2,
            nextRetryAtMs: 7_000,
            progress,
          },
        ],
        known: { state: "reading", attempt: 2 },
      },
      {
        name: "paused in the background: waiting to be visible",
        interests: [{ status: "paused", identity: id, reason: "background" }],
        known: { state: "unread", waitingFor: "visible" },
      },
      {
        name: "paused offline: waiting to be online",
        interests: [{ status: "paused", identity: id, reason: "offline" }],
        known: { state: "unread", waitingFor: "online" },
      },
      {
        name: "paused because nobody leases it: unread",
        interests: [{ status: "paused", identity: id, reason: "no-leases" }],
        known: { state: "unread", waitingFor: null },
      },
    ])("an unanswered listing is never [] (§3.5): $name", ({ interests, known }) => {
      const unread = selectServicesOf(makeInitialZeropsDataState(scope()), owner);
      const read = { ...unread, observation: { ...unread.observation, required: interests } };

      expect(knownServicesOf(read, NOW)).toMatchObject(known);
    });

    it.each<{
      readonly name: string;
      readonly coverage: Exclude<QueryCoverage, { readonly kind: "none" }>;
      readonly known: string;
    }>([
      {
        name: "a traversal to the end is complete",
        coverage: {
          kind: "exhausted-traversal",
          traversedPages: 1,
          observedTotal: 1,
          guarantee: "non-atomic",
        },
        known: "complete",
      },
      {
        name: "a window is partial",
        coverage: {
          kind: "partial-window",
          offset: 0,
          limit: 1,
          traversedPages: 1,
          observedTotal: 4,
        },
        known: "partial",
      },
      {
        name: "a read that stopped short is partial",
        coverage: { kind: "partial", reason: "read-failed" },
        known: "partial",
      },
    ])("coverage: $name", ({ coverage, known }) => {
      expect(knownServicesOf(listing([], [running], coverage), NOW)).toMatchObject({
        state: "known",
        coverage: known,
      });
    });

    it("says nothing of an interest that feeds another read", () => {
      const other = interestKeyOf({ kind: "project-inventory", project: project("project-2") });
      const failed: InterestState = {
        status: "failed",
        identity: { ...identity(), key: other },
        reason: "gateway",
        retryable: true,
        attempts: 1,
        retryAtMs: null,
      };

      expect(knownServicesOf(listing([failed]), NOW)).toMatchObject({
        state: "known",
        freshness: { kind: "stale", reason: { kind: "source-recovering", retryAtMs: null } },
      });
    });

    it("is partial while a member is unresolved, so it never says a complete none", () => {
      const pending: EntityKnowledge<ServiceRecord> = {
        knowledge: "unresolved",
        ref: service("db", owner),
      };

      expect(knownServicesOf(listing([], [pending]), NOW)).toMatchObject({
        state: "known",
        value: [],
        coverage: "partial",
      });
    });

    const runningRecord = running.knowledge === "observed" ? running.record : null;
    const unavailableMember = (
      reason: Extract<
        EntityKnowledge<ServiceRecord>,
        { readonly knowledge: "unavailable" }
      >["reason"],
    ): EntityKnowledge<ServiceRecord> => ({
      knowledge: "unavailable",
      ref: service("db", owner),
      reason,
      since: stamp(5),
    });

    // A denial of a scope says nothing about what the scope holds: an account-scope denial is
    // not an empty organization, so a revoked member keeps the listing from a complete none.
    it.each<{
      readonly name: string;
      readonly members: ReadonlyArray<EntityKnowledge<ServiceRecord>>;
      readonly known: object;
    }>([
      {
        name: "a member read as forbidden is gone, and the rest is complete",
        members: [running, unavailableMember("forbidden")],
        known: { state: "known", value: [runningRecord], coverage: "complete" },
      },
      {
        name: "a member read as not found is gone, and the rest is complete",
        members: [running, unavailableMember("not-found")],
        known: { state: "known", value: [runningRecord], coverage: "complete" },
      },
      {
        name: "a member whose access was revoked leaves the rest partial",
        members: [running, unavailableMember("access-revoked")],
        known: { state: "known", value: [runningRecord], coverage: "partial" },
      },
      {
        name: "every member's access revoked waits for the grant, never a complete none",
        members: [unavailableMember("access-revoked")],
        known: { state: "unread", waitingFor: "access-grant" },
      },
    ])("an unavailable member: $name", ({ members, known }) => {
      expect(knownServicesOf(listing([], members), NOW)).toEqual(expect.objectContaining(known));
    });
  });

  describe("the interest a read's currency comes from", () => {
    const owner = project();
    const topology: InterestState = {
      status: "failed",
      identity: {
        ...identity(),
        key: interestKeyOf({
          kind: "project-topology",
          project: owner,
          includeCurrentMetrics: false,
        }),
      },
      reason: "topology refused",
      retryable: true,
      attempts: 1,
      retryAtMs: 9_000,
    };
    const inventory: InterestState = {
      status: "observing",
      identity: {
        ...identity(),
        key: interestKeyOf({ kind: "project-inventory", project: owner }),
      },
      guarantee: "source-order-unverified",
      sinceReceiptOrdinal: stamp(1).receiptOrdinal,
    };
    const observing = organizationObserving();

    it("is the organization's inventory interest for its projects, never another interest", () => {
      const read = selectProjectsOf(makeInitialZeropsDataState(scope()), organization);

      expect(
        projectsSourceOf({
          ...read,
          observation: { ...read.observation, required: [topology, observing] },
        }),
      ).toBe(observing);
      expect(
        projectsSourceOf({ ...read, observation: { ...read.observation, required: [topology] } }),
      ).toBeNull();
    });

    it("is the best-placed of a project's own feeders for its services", () => {
      const read = selectServicesOf(makeInitialZeropsDataState(scope()), owner);

      expect(
        servicesSourceOf({
          ...read,
          observation: { ...read.observation, required: [topology, inventory, observing] },
        }),
      ).toBe(inventory);
    });
  });
});
