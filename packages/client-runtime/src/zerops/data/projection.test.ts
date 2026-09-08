import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import { selectProjectsOf, selectServicesOf } from "./projection.ts";
import { makeInitialZeropsDataState, reduceZeropsDataState } from "./state.ts";
import { queryKeyOf, serviceKeyOf } from "./types.ts";
import {
  desiredInterest,
  directTicket,
  identity,
  organization,
  project,
  queryTicket,
  scope,
  service,
  stamp,
} from "./__fixtures__/index.ts";

const reduce = (
  state: ReturnType<typeof makeInitialZeropsDataState>,
  input: Parameters<typeof reduceZeropsDataState>[1],
) => reduceZeropsDataState(state, input, DEFAULT_ZEROPS_DATA_POLICY).state;

describe("Zerops data projections", () => {
  it("preserves the exact unresolved member ref and uses a scoped query identity", () => {
    const id = identity();
    const owner = project();
    const ref = service("unresolved", owner);
    const descriptor = {
      kind: "services-of-project" as const,
      project: owner,
      schemaVersion: 1 as const,
    };
    const ticket = queryTicket(descriptor, id);
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
          kind: "query-baseline-observed",
          members: [ref],
          unresolvedMembers: [ref],
          observedTotal: 1,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 1,
            guarantee: "non-atomic",
          },
          source: "direct-read",
          ticket,
        },
      },
    });
    const view = selectServicesOf(state, owner);
    expect(view.query.key).toBe(queryKeyOf(descriptor));
    expect(view.value).toEqual([{ knowledge: "unresolved", ref }]);
    expect(view.value[0]?.knowledge === "unresolved" ? view.value[0].ref.serviceId : null).toBe(
      ref.serviceId,
    );
  });

  it("derives project services from canonical relationships beyond indexed membership", () => {
    const id = identity();
    const owner = project();
    const ref = service("direct-only", owner);
    const ticket = directTicket({ kind: "service", ref }, id);
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
          observation: { source: "direct-read", ticket, fields: { hostname: "api" }, metadata: {} },
        },
      },
    });
    expect(state.inventory.services.has(serviceKeyOf(ref))).toBe(true);
    expect(
      selectServicesOf(state, owner).value.map((entry) =>
        entry.knowledge === "observed" ? entry.record.ref : entry.ref,
      ),
    ).toEqual([ref]);
  });

  it("does not share unresolved query keys across projects", () => {
    const state = makeInitialZeropsDataState(scope());
    const first = selectServicesOf(state, project("one"));
    const second = selectServicesOf(state, project("two"));
    expect(first.query.key).not.toBe(second.query.key);
  });

  it("selects the projects-of-organization query matching the requested statuses, not an arbitrary one", () => {
    const id = identity();
    const activeRef = project("active-only");
    const allRef = project("all");
    const activeDescriptor = {
      kind: "projects-of-organization" as const,
      organization,
      statuses: ["ACTIVE"],
      schemaVersion: 1 as const,
    };
    const allDescriptor = {
      kind: "projects-of-organization" as const,
      organization,
      statuses: [],
      schemaVersion: 1 as const,
    };
    const activeTicket = queryTicket(activeDescriptor, id, 1, 1, 1);
    const allTicket = queryTicket(allDescriptor, id, 2, 2, 2);
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
          kind: "query-baseline-observed",
          members: [activeRef],
          unresolvedMembers: [],
          observedTotal: 1,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 1,
            guarantee: "non-atomic",
          },
          source: "direct-read",
          ticket: activeTicket,
        },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
        accessEvidence: null,
        input: {
          kind: "query-baseline-observed",
          members: [activeRef, allRef],
          unresolvedMembers: [],
          observedTotal: 2,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 2,
            guarantee: "non-atomic",
          },
          source: "direct-read",
          ticket: allTicket,
        },
      },
    });
    const active = selectProjectsOf(state, organization, ["ACTIVE"]);
    expect(active.query.key).toBe(queryKeyOf(activeDescriptor));
    const all = selectProjectsOf(state, organization, []);
    expect(all.query.key).toBe(queryKeyOf(allDescriptor));
  });
});
