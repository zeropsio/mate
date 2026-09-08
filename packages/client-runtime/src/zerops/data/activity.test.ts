import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import { selectActivity, selectRunningProcessesOf } from "./projection.ts";
import { makeInitialZeropsDataState, reduceZeropsDataState } from "./state.ts";
import { processKeyOf, queryKeyOf } from "./types.ts";
import {
  desiredInterest,
  directTicket,
  entityRegistration,
  identity,
  process,
  project,
  queryRegistration,
  queryTicket,
  scope,
  stamp,
} from "./__fixtures__/index.ts";

const reduce = (
  state: ReturnType<typeof makeInitialZeropsDataState>,
  input: Parameters<typeof reduceZeropsDataState>[1],
) => reduceZeropsDataState(state, input, DEFAULT_ZEROPS_DATA_POLICY).state;

describe("Zerops activity model", () => {
  it("keeps partial pushed facets unresolved and classifies every running and terminal status", () => {
    const id = identity();
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    const statuses = [
      "PENDING",
      "RUNNING",
      "ROLLBACKING",
      "CANCELING",
      "FINISHED",
      "FAILED",
      "CANCELED",
    ] as const;
    statuses.forEach((status, index) => {
      const ref = process(`process-${status}`);
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: stamp(index * 2 + 1),
          accessEvidence: null,
          input: {
            kind: "process-identity-observed",
            ref,
            observation: {
              source: "native-push",
              registration: entityRegistration("process", id),
              fields: { actionName: `action-${status}` },
              metadata: {},
            },
          },
        },
      });
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: stamp(index * 2 + 2),
          accessEvidence: null,
          input: {
            kind: "process-lifecycle-observed",
            ref,
            observation: {
              source: "native-push",
              registration: entityRegistration("process", id),
              fields: { status },
              metadata: {},
            },
          },
        },
      });
    });
    expect(
      state.activity.processes.get(processKeyOf(process("process-PENDING")))?.identity,
    ).toMatchObject({
      knowledge: "unresolved",
      unresolvedRequiredFields: ["createdAt"],
    });
    expect(selectRunningProcessesOf(state, project()).value).toHaveLength(4);
    expect(selectActivity(state, project()).retainedHistory).toHaveLength(3);
  });

  it("preserves unknown process status as observed data without treating it as running or successful", () => {
    const id = identity();
    const ref = process();
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
          kind: "process-lifecycle-observed",
          ref,
          observation: {
            source: "native-push",
            registration: entityRegistration("process", id),
            fields: { status: { kind: "unknown", raw: "WAITING_FOR_CAPACITY" } },
            metadata: {},
          },
        },
      },
    });
    expect(state.activity.processes.get(processKeyOf(ref))?.lifecycle).toMatchObject({
      knowledge: "observed",
      fields: { status: { kind: "unknown", raw: "WAITING_FOR_CAPACITY" } },
    });
    expect(selectRunningProcessesOf(state, project()).value).toEqual([]);
    expect(selectActivity(state, project()).retainedHistory).toEqual([]);
  });

  it("removes a terminal process from running membership without deleting its canonical record", () => {
    const id = identity();
    const ref = process();
    const descriptor = {
      kind: "running-processes-of-project" as const,
      project: project(),
      statuses: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"] as const,
      schemaVersion: 1 as const,
    };
    const ticket = queryTicket(descriptor, id, 1, 1, 1);
    const registration = queryRegistration(descriptor, id, ticket);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
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
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(3),
        accessEvidence: null,
        input: {
          kind: "process-identity-observed",
          ref,
          observation: {
            source: "native-push",
            registration: entityRegistration("process", id),
            fields: { actionName: "restart", createdAt: "now", serviceIds: [] },
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
          kind: "process-lifecycle-observed",
          ref,
          observation: {
            source: "native-push",
            registration: entityRegistration("process", id),
            fields: { status: "FINISHED", finishedAt: "later" },
            metadata: {},
          },
        },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(5),
        accessEvidence: null,
        input: {
          kind: "query-membership-observed",
          operation: "remove",
          member: ref,
          registration,
        },
      },
    });
    expect(state.activity.queries.get(queryKeyOf(descriptor))?.memberKeys).toEqual([]);
    expect(state.activity.processes.has(processKeyOf(ref))).toBe(true);
    expect(selectActivity(state, project()).retainedHistory).toHaveLength(1);
  });

  it("fences a pre-push direct lifecycle response per facet", () => {
    const id = identity();
    const ref = process();
    const ticket = directTicket({ kind: "process", ref }, id, 1, 1, 1);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, { kind: "read-started", ticket });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
        accessEvidence: null,
        input: {
          kind: "process-lifecycle-observed",
          ref,
          observation: {
            source: "native-push",
            registration: entityRegistration("process", id),
            fields: { status: "FAILED" },
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
          kind: "process-lifecycle-observed",
          ref,
          observation: {
            source: "direct-read",
            ticket,
            fields: { status: "RUNNING" },
            metadata: {},
          },
        },
      },
    });
    expect(state.activity.processes.get(processKeyOf(ref))?.lifecycle).toMatchObject({
      fields: { status: "FAILED" },
    });
  });
});
