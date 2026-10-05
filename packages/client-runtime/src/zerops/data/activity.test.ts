import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import { selectActivity, selectRunningProcessesOf } from "./projection.ts";
import { makeInitialZeropsDataState, reduceZeropsDataState } from "./state.ts";
import { ReceiptOrdinal, processKeyOf, queryKeyOf } from "./types.ts";
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
describe("selectActivity — where the project's newest process history read stands", () => {
  const history = (
    status: "establishing" | "observing" | "failed" | "retrying" | "paused" | null,
    descriptor: { readonly projectId?: string; readonly before?: string | null } = {},
  ) => {
    const state = makeInitialZeropsDataState(scope());
    if (status === null) return state;
    const id = identity(1, 1, 1, "history");
    const base = desiredInterest(id, 1, false);
    const interest =
      status === "establishing"
        ? base.interest
        : status === "observing"
          ? {
              status,
              identity: id,
              guarantee: "source-order-unverified" as const,
              sinceReceiptOrdinal: ReceiptOrdinal.make(1),
            }
          : status === "failed" || status === "retrying"
            ? {
                status: "failed" as const,
                identity: id,
                reason: "boom",
                retryable: status === "retrying",
                attempts: 1,
                retryAtMs: status === "retrying" ? 9 : null,
              }
            : { status, identity: id, reason: "no-leases" as const };
    return reduce(state, {
      kind: "interest-upserted",
      interest: {
        ...base,
        descriptor: {
          kind: "project-process-history",
          project: project(descriptor.projectId),
          before: descriptor.before ?? null,
          limit: 100,
        },
        interest,
      },
    });
  };
  it.each([
    { name: "nobody asks for it", state: history(null), read: "unread" },
    { name: "being read", state: history("establishing"), read: "reading" },
    { name: "read", state: history("observing"), read: "read" },
    { name: "its read failed", state: history("failed"), read: "failed" },
    // Run 12: the socket's routine close every 30 minutes fails its reads with
    // a retry scheduled; a settled card's one read is still on its way.
    { name: "its read failed and is retried", state: history("retrying"), read: "reading" },
    { name: "let go", state: history("paused"), read: "unread" },
    {
      name: "another project's",
      state: history("observing", { projectId: "project-2" }),
      read: "unread",
    },
    { name: "an older window", state: history("observing", { before: "p-9" }), read: "unread" },
  ])("$name: $read", ({ state, read }) => {
    expect(selectActivity(state, project()).processHistory).toBe(read);
  });
});
