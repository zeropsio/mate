/**
 * What one publication costs: every project's services read is projected on each publication, so
 * the account's projections must cost linear time in its size, not projects × interests.
 */
import { describe, expect, it, vi } from "@effect/vitest";

import type { ZeropsDataState } from "./state.ts";
import type { RuntimeInterestDescriptor } from "./types.ts";
import {
  desiredInterest,
  directTicket,
  identity,
  project,
  queryTicket,
  scope,
  service,
  stamp,
} from "./__fixtures__/index.ts";

// The key functions, spied on where the projections import them from.
vi.doMock("./types.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./types.ts")>();
  return { ...actual, projectKeyOf: vi.fn(actual.projectKeyOf) };
});
vi.doMock("./runtime.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime.ts")>();
  return { ...actual, interestKeyOf: vi.fn(actual.interestKeyOf) };
});
const { knownServicesOf } = await import("./known.ts");
const { DEFAULT_ZEROPS_DATA_POLICY } = await import("./policy.ts");
const { selectServicesOf } = await import("./projection.ts");
const { interestKeyOf } = await import("./runtime.ts");
const { makeInitialZeropsDataState, reduceZeropsDataState } = await import("./state.ts");
const { projectKeyOf } = await import("./types.ts");

const reduce = (state: ZeropsDataState, input: Parameters<typeof reduceZeropsDataState>[1]) =>
  reduceZeropsDataState(state, input, DEFAULT_ZEROPS_DATA_POLICY).state;

/** An account of `size` projects, each with its inventory interest, services read and service. */
function accountOf(size: number) {
  const projects = Array.from({ length: size }, (_, index) => project(`project-${index}`));
  let state = makeInitialZeropsDataState(scope());
  projects.forEach((ref, index) => {
    const descriptor: RuntimeInterestDescriptor = { kind: "project-inventory", project: ref };
    const id = identity(1, 1, 1, interestKeyOf(descriptor));
    const member = service(`service-${index}`, ref);
    const ordinal = 2 * index + 1;
    state = reduce(state, {
      kind: "interest-upserted",
      interest: { ...desiredInterest(id), descriptor, key: id.key },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(ordinal),
        accessEvidence: null,
        input: {
          kind: "query-baseline-observed",
          members: [member],
          unresolvedMembers: [member],
          observedTotal: 1,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 1,
            guarantee: "non-atomic",
          },
          source: "direct-read",
          ticket: queryTicket(
            { kind: "services-of-project", project: ref, schemaVersion: 1 },
            id,
            ordinal,
            ordinal,
          ),
        },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(ordinal + 1),
        accessEvidence: null,
        input: {
          kind: "service-identity-observed",
          ref: member,
          observation: {
            source: "direct-read",
            ticket: directTicket({ kind: "service", ref: member }, id, ordinal + 1, ordinal + 1),
            fields: { hostname: `api-${index}` },
            metadata: {},
          },
        },
      },
    });
  });
  return { projects, state };
}

/** Key computations for one publication: every project's services, read as knowledge. */
function keyCallsOfOnePublication(size: number): number {
  const { projects, state } = accountOf(size);
  expect(state.interests.size).toBe(size);
  expect(state.inventory.services.size).toBe(size);
  vi.mocked(projectKeyOf).mockClear();
  vi.mocked(interestKeyOf).mockClear();
  for (const ref of projects) {
    const services = knownServicesOf(selectServicesOf(state, ref), 0);
    expect(services.state).toBe("known");
  }
  return vi.mocked(projectKeyOf).mock.calls.length + vi.mocked(interestKeyOf).mock.calls.length;
}

describe("projection cost", () => {
  it("projection of 40 projects × 40 interests calls the key function O(n), not O(n²)", () => {
    const half = keyCallsOfOnePublication(20);
    const full = keyCallsOfOnePublication(40);

    // Doubling the account doubles a linear cost; a quadratic one quadruples.
    expect(full / half).toBeLessThan(2.5);
  });
});
