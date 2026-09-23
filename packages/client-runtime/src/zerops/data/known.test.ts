import { describe, expect, it } from "@effect/vitest";

import { EMPTY_ADMISSION, makeUnresolvedProject, makeUnresolvedService } from "./inventory.ts";
import { knownProjectsOf, knownProjectTags, knownServicesOf } from "./known.ts";
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
  });
});
