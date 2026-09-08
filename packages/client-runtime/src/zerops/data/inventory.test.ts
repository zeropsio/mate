import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import { selectServicesOf } from "./projection.ts";
import { makeInitialZeropsDataState, reduceZeropsDataState } from "./state.ts";
import { queryKeyOf, serviceKeyOf } from "./types.ts";
import {
  desiredInterest,
  directTicket,
  entityRegistration,
  grant,
  identity,
  project,
  queryRegistration,
  queryTicket,
  scope,
  service,
  stamp,
  verifiedAccess,
} from "./__fixtures__/index.ts";

const reduce = (
  state: ReturnType<typeof makeInitialZeropsDataState>,
  input: Parameters<typeof reduceZeropsDataState>[1],
) => reduceZeropsDataState(state, input, DEFAULT_ZEROPS_DATA_POLICY).state;

describe("Zerops inventory model", () => {
  it("keeps a native facet ahead of an older direct read while completing the read", () => {
    const id = identity();
    const ref = service();
    const ticket = directTicket({ kind: "service", ref }, id, 1, 1, 1);
    let state = reduce(makeInitialZeropsDataState(scope(), verifiedAccess()), {
      kind: "interest-upserted",
      interest: desiredInterest(id, 1),
    });
    state = reduce(state, { kind: "read-started", ticket });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
        accessEvidence: null,
        input: {
          kind: "service-lifecycle-observed",
          ref,
          observation: {
            source: "native-push",
            registration: entityRegistration("service", id),
            fields: { status: "FINISHED", updatedAt: null },
            metadata: {},
          },
        },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(3),
        accessEvidence: null,
        input: {
          kind: "service-lifecycle-observed",
          ref,
          observation: {
            source: "direct-read",
            ticket,
            fields: { status: "RUNNING", createdAt: "old" },
            metadata: {},
          },
        },
      },
    });
    state = reduce(state, {
      kind: "read-completion",
      stamp: stamp(4),
      completion: { kind: "read-succeeded", ticket },
    });

    expect(state.inventory.services.get(serviceKeyOf(ref))?.lifecycle).toMatchObject({
      knowledge: "observed",
      fields: { status: "FINISHED", updatedAt: null },
    });
    expect(state.reads.get(ticket.requestId)).toMatchObject({
      status: "succeeded",
      appliedFacets: [],
      suppressedFacets: ["service:lifecycle"],
    });
  });

  it("lets search seed absent fields but preserves direct values and replacement semantics", () => {
    const id = identity();
    const ref = service();
    const descriptor = {
      kind: "services-of-project" as const,
      project: project(),
      schemaVersion: 1 as const,
    };
    const direct = directTicket({ kind: "service", ref }, id, 2, 1, 2);
    const search = queryTicket(descriptor, id, 3, 2, 3);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    for (const [ordinal, ticket, fields] of [
      [1, direct, { hostname: "canonical", type: null }],
      [
        2,
        search,
        { hostname: "stale", type: { versionName: "node", displayName: null, category: null } },
      ],
    ] as const) {
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: stamp(ordinal),
          accessEvidence: null,
          input: {
            kind: "service-identity-observed",
            ref,
            observation:
              ticket === direct
                ? { source: "direct-read", ticket: direct, fields, metadata: {} }
                : { source: "indexed-search", ticket: search, fields, metadata: {} },
          },
        },
      });
    }
    const facet = state.inventory.services.get(serviceKeyOf(ref))?.identity;
    expect(facet?.knowledge === "observed" ? facet.fields : null).toEqual({
      hostname: "canonical",
      type: null,
    });

    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(3),
        accessEvidence: null,
        input: {
          kind: "service-routing-observed",
          ref,
          observation: {
            source: "native-push",
            registration: entityRegistration("service", id),
            fields: { ports: [{ port: 80, protocol: null, scheme: "http", httpSupport: true }] },
            metadata: {},
          },
        },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(4),
        accessEvidence: null,
        input: {
          kind: "service-routing-observed",
          ref,
          observation: {
            source: "native-push",
            registration: entityRegistration("service", id),
            fields: { ports: [], subdomainAccess: null },
            metadata: {},
          },
        },
      },
    });
    expect(state.inventory.services.get(serviceKeyOf(ref))?.routing).toMatchObject({
      fields: { ports: [], subdomainAccess: null },
    });
  });

  it("does not rewrite provenance of an observed facet when search seeds an absent field", () => {
    const id = identity();
    const ref = service();
    const descriptor = {
      kind: "services-of-project" as const,
      project: project(),
      schemaVersion: 1 as const,
    };
    const direct = directTicket({ kind: "service", ref }, id, 1, 1, 1);
    const search = queryTicket(descriptor, id, 2, 2, 2);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(1),
        accessEvidence: null,
        input: {
          kind: "service-identity-observed",
          ref,
          observation: {
            source: "direct-read",
            ticket: direct,
            fields: { hostname: "canonical", type: null },
            metadata: {},
          },
        },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
        accessEvidence: null,
        input: {
          kind: "service-identity-observed",
          ref,
          observation: {
            source: "indexed-search",
            ticket: search,
            fields: { isSystem: true },
            metadata: {},
          },
        },
      },
    });
    const facet = state.inventory.services.get(serviceKeyOf(ref))?.identity;
    expect(facet?.knowledge === "observed" ? facet.source : null).toBe("direct-read");
    expect(facet?.knowledge === "observed" ? facet.stamp : null).toEqual(stamp(1));
    expect(facet?.knowledge === "observed" ? facet.fields : null).toMatchObject({
      hostname: "canonical",
      isSystem: true,
    });
  });

  it("applies only the latest query baseline and overlays intervening membership per ID", () => {
    const id = identity();
    const p = project();
    const a = service("a");
    const b = service("b");
    const descriptor = {
      kind: "services-of-project" as const,
      project: p,
      schemaVersion: 1 as const,
    };
    const older = queryTicket(descriptor, id, 1, 1, 1);
    const newer = queryTicket(descriptor, id, 2, 2, 2);
    const registration = queryRegistration(descriptor, id, older);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(3),
        accessEvidence: null,
        input: { kind: "query-membership-observed", operation: "remove", member: a, registration },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(4),
        accessEvidence: null,
        input: {
          kind: "query-baseline-observed",
          members: [a, b],
          unresolvedMembers: [a, b],
          observedTotal: 2,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 2,
            guarantee: "non-atomic",
          },
          source: "direct-read",
          ticket: newer,
        },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(5),
        accessEvidence: null,
        input: {
          kind: "query-baseline-observed",
          members: [a],
          unresolvedMembers: [a],
          observedTotal: 1,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 1,
            guarantee: "non-atomic",
          },
          source: "direct-read",
          ticket: older,
        },
      },
    });
    const query = state.inventory.queries.get(queryKeyOf(descriptor));
    expect(query?.memberKeys).toEqual([serviceKeyOf(b)]);
    expect(state.inventory.services.has(serviceKeyOf(a))).toBe(true);
    expect(
      selectServicesOf(state, p).value.map((item) =>
        item.knowledge === "observed" ? item.record.ref.serviceId : item.ref.serviceId,
      ),
    ).toEqual([b.serviceId, a.serviceId]);
  });

  it("distinguishes a complete empty snapshot from a partial empty window", () => {
    const id = identity();
    const p = project();
    const a = service("a");
    const descriptor = {
      kind: "services-of-project" as const,
      project: p,
      schemaVersion: 1 as const,
    };
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    const applyBaseline = (
      ordinal: number,
      coverage:
        | {
            readonly kind: "exhausted-traversal";
            readonly traversedPages: number;
            readonly observedTotal: number;
            readonly guarantee: "non-atomic";
          }
        | {
            readonly kind: "partial-window";
            readonly offset: number;
            readonly limit: number;
            readonly traversedPages: number;
            readonly observedTotal: number;
          },
    ) => {
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: stamp(ordinal),
          accessEvidence: null,
          input: {
            kind: "query-baseline-observed",
            members: ordinal === 1 ? [a] : [],
            unresolvedMembers: ordinal === 1 ? [a] : [],
            observedTotal: coverage.observedTotal,
            coverage,
            source: "direct-read",
            ticket: queryTicket(descriptor, id, ordinal, ordinal, ordinal),
          },
        },
      });
    };
    applyBaseline(1, {
      kind: "exhausted-traversal",
      traversedPages: 1,
      observedTotal: 1,
      guarantee: "non-atomic",
    });
    applyBaseline(2, {
      kind: "partial-window",
      offset: 1,
      limit: 1,
      traversedPages: 1,
      observedTotal: 1,
    });
    expect(state.inventory.queries.get(queryKeyOf(descriptor))?.memberKeys).toEqual([
      serviceKeyOf(a),
    ]);
    applyBaseline(3, {
      kind: "exhausted-traversal",
      traversedPages: 1,
      observedTotal: 0,
      guarantee: "non-atomic",
    });
    expect(state.inventory.queries.get(queryKeyOf(descriptor))?.memberKeys).toEqual([]);
    expect(state.inventory.services.has(serviceKeyOf(a))).toBe(true);
  });

  it("requires verified direct evidence to mark unavailable and ignores pushes until a fresh direct reopen", () => {
    const id = identity();
    const ref = service();
    const unavailableTicket = directTicket({ kind: "service", ref }, id, 2, 1, 2);
    let state = reduce(makeInitialZeropsDataState(scope(), verifiedAccess()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
        accessEvidence: grant(),
        input: { kind: "entity-unavailable", ref, reason: "not-found", ticket: unavailableTicket },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(3),
        accessEvidence: null,
        input: {
          kind: "service-identity-observed",
          ref,
          observation: {
            source: "native-push",
            registration: entityRegistration("service", id),
            fields: { hostname: "ignored" },
            metadata: {},
          },
        },
      },
    });
    expect(state.inventory.services.get(serviceKeyOf(ref))?.identity.knowledge).toBe("unavailable");
    const reopen = directTicket({ kind: "service", ref }, id, 3, 3, 3);
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(4),
        accessEvidence: grant(),
        input: {
          kind: "service-identity-observed",
          ref,
          observation: {
            source: "direct-read",
            ticket: reopen,
            fields: { hostname: "restored" },
            metadata: {},
          },
        },
      },
    });
    expect(state.inventory.services.get(serviceKeyOf(ref))?.identity).toMatchObject({
      knowledge: "observed",
      fields: { hostname: "restored" },
    });
  });
});
