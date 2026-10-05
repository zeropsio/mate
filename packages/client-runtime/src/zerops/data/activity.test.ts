import { describe, expect, it } from "@effect/vitest";

import { isTerminalProcess } from "./activity.ts";
import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import { selectRunningProcessesOf } from "./projection.ts";
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
    expect([...state.activity.processes.values()].filter(isTerminalProcess)).toHaveLength(3);
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
    expect(isTerminalProcess(state.activity.processes.get(processKeyOf(ref))!)).toBe(false);
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

describe("a project's running processes after its organization's running read", () => {
  const running = (
    order: ReadonlyArray<"pushed RUNNING" | "read without it" | "read with it">,
  ): ReadonlyArray<string> => {
    const id = identity();
    const ref = process("build");
    const descriptor = {
      kind: "running-processes-of-project" as const,
      project: project(),
      statuses: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"] as const,
      schemaVersion: 1 as const,
    };
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    order.forEach((step, index) => {
      const at = stamp(index + 1);
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: at,
          accessEvidence: null,
          input:
            step === "pushed RUNNING"
              ? {
                  kind: "process-lifecycle-observed",
                  ref,
                  observation: {
                    source: "native-push",
                    registration: entityRegistration("process", id),
                    fields: { status: "RUNNING" },
                    metadata: {},
                  },
                }
              : {
                  kind: "query-baseline-observed",
                  members: step === "read with it" ? [ref] : [],
                  unresolvedMembers: [],
                  observedTotal: step === "read with it" ? 1 : 0,
                  coverage: {
                    kind: "exhausted-traversal",
                    traversedPages: 1,
                    observedTotal: step === "read with it" ? 1 : 0,
                    guarantee: "non-atomic",
                  },
                  source: "indexed-search",
                  ticket: queryTicket(descriptor, id, index + 1, index + 1, index + 1),
                },
        },
      });
    });
    return selectRunningProcessesOf(state, project()).value.map((entry) =>
      entry.knowledge === "observed" ? entry.record.ref.processId : entry.ref.processId,
    );
  };

  it.each([
    // A build that finished while the socket was down: its FINISHED was never pushed.
    [
      "one the read no longer carries, pushed only before it, has finished",
      ["pushed RUNNING", "read without it"],
      [],
    ],
    ["one pushed RUNNING after the read runs", ["read without it", "pushed RUNNING"], ["build"]],
    ["one the read carries runs", ["pushed RUNNING", "read with it"], ["build"]],
  ] as const)("%s", (_, order, expected) => {
    expect(running(order)).toEqual(expected);
  });
});

// A settled operation's card reads the project's newest process history once
// per open: it has to know when that read landed, or failed (pass 36).
