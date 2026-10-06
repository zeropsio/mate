import { describe, expect, it } from "@effect/vitest";

import { EMPTY_ADMISSION, makeUnresolvedService } from "./inventory.ts";
import { knownServicesOf, servicesCheckOrdinalOf, servicesSourceOf } from "./known.ts";
import { selectServicesOf } from "./projection.ts";
import { interestKeyOf } from "./runtime.ts";
import { makeInitialZeropsDataState } from "./state.ts";
import type {
  CollectionRead,
  EntityKnowledge,
  InterestState,
  QueryCoverage,
  ServiceRecord,
} from "./types.ts";
import { ReadStartOrdinal } from "./types.ts";
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

describe("inventory knowledge", () => {
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
        project: owner,
      };
    };

    it("is complete though another project's service the organization's read names is unresolved", () => {
      const read = listing([
        {
          status: "observing",
          identity: id,
          guarantee: "source-order-unverified",
          sinceReceiptOrdinal: stamp(1).receiptOrdinal,
        },
      ]);
      const elsewhere = {
        ...read,
        query: { ...read.query, unresolvedMemberKeys: ["service-of-another-project"] },
      } as unknown as typeof read;

      expect(knownServicesOf(elsewhere, 100)).toMatchObject({
        state: "known",
        coverage: "complete",
      });
    });

    it("uses the opened project's complete direct service read as absence evidence", () => {
      const read = listing([
        {
          status: "observing",
          identity: id,
          guarantee: "source-order-unverified",
          sinceReceiptOrdinal: stamp(1).receiptOrdinal,
        },
      ]);
      if (read.query.status !== "observed") throw new Error("Fixture must be observed");
      expect(
        servicesCheckOrdinalOf({ ...read, query: { ...read.query, source: "direct-read" } }),
      ).toBe(4);
    });

    it.each([
      ["only its inventory observes: no lag-free read confirmed anything", ["inventory"], null],
      ["its own lag-free read observes: that read confirms", ["inventory", "check"], 7],
    ] as const)("the confirming read of an absence (§9 C19): %s", (_, feeding, expected) => {
      const observingAs = (kind: "inventory" | "check", at: number): InterestState => ({
        status: "observing",
        identity: {
          ...identity(),
          key: interestKeyOf(
            kind === "inventory"
              ? { kind: "project-inventory", project: owner }
              : { kind: "project-services-check", project: owner },
          ),
        },
        guarantee: "source-order-unverified",
        sinceReceiptOrdinal: stamp(at).receiptOrdinal,
      });
      const read = listing(feeding.map((kind) => observingAs(kind, kind === "inventory" ? 9 : 7)));

      expect(servicesCheckOrdinalOf(read)).toBe(expected);
    });

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
        name: "paused in the background: not current",
        interests: [{ status: "paused", identity: id, reason: "background" }],
        freshness: { kind: "paused", by: "background" },
      },
      {
        name: "recovering: the value kept, stale since it was read, with a coverage gap",
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
            kind: "source-recovering",
            retryAtMs: 8_000,
            coverageGap: true,
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
