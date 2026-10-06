import { describe, expect, it, vi } from "@effect/vitest";

import { makeZeropsDataPolicy } from "./policy.ts";
import { makeInitialZeropsDataState, reduceZeropsDataState } from "./state.ts";
import {
  AccountEpoch,
  DispatchOrdinal,
  ReceiptOrdinal,
  ZeropsCommandAttemptId,
  ZeropsSharedReadId,
  projectKeyOf,
  queryKeyOf,
  serviceKeyOf,
  type DesiredInterestState,
  type ReadTicket,
  type PlatformObservation,
} from "./types.ts";
import {
  desiredInterest,
  directTicket,
  entityRegistration,
  identity,
  grant,
  project,
  queryRegistration,
  queryTicket,
  scope,
  service,
  stamp,
  verifiedAccess,
} from "./__fixtures__/index.ts";

const policy = makeZeropsDataPolicy();
const reduce = (
  state: ReturnType<typeof makeInitialZeropsDataState>,
  input: Parameters<typeof reduceZeropsDataState>[1],
  selectedPolicy = policy,
) => reduceZeropsDataState(state, input, selectedPolicy).state;

const tick = (
  state: ReturnType<typeof makeInitialZeropsDataState>,
  ordinal: number,
  selectedPolicy = policy,
) =>
  reduce(
    state,
    {
      kind: "access-observation",
      stamp: stamp(ordinal),
      observation: { kind: "access-verification-started", accountEpoch: AccountEpoch.make(1) },
    },
    selectedPolicy,
  );

const fullCoverage = {
  kind: "exhausted-traversal" as const,
  traversedPages: 1,
  observedTotal: null,
  guarantee: "non-atomic" as const,
};

describe("Zerops data model coordination", () => {
  it("crosses registration and read completion markers before observing", () => {
    const id = identity();
    const ticket = directTicket({ kind: "service", ref: service() }, id);
    const registration = entityRegistration("service", id);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id, 1),
    });
    state = reduce(state, { kind: "read-started", ticket });
    state = reduce(state, {
      kind: "registration-completion",
      stamp: stamp(1),
      completion: { kind: "registration-succeeded", request: registration },
    });
    expect(state.interests.get(id.key)?.interest.status).toBe("establishing");
    state = reduce(state, {
      kind: "read-completion",
      stamp: stamp(2),
      completion: { kind: "read-succeeded", ticket },
    });
    expect(state.interests.get(id.key)?.interest).toMatchObject({
      status: "observing",
      guarantee: "source-order-unverified",
      sinceReceiptOrdinal: ReceiptOrdinal.make(2),
    });
  });

  it("keeps the interest reference when an interest-owned read completes while already observing", () => {
    const id = identity();
    const ticket = directTicket({ kind: "service", ref: service() }, id);
    const registration = entityRegistration("service", id);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id, 1),
    });
    state = reduce(state, { kind: "read-started", ticket });
    state = reduce(state, {
      kind: "registration-completion",
      stamp: stamp(1),
      completion: { kind: "registration-succeeded", request: registration },
    });
    state = reduce(state, {
      kind: "read-completion",
      stamp: stamp(2),
      completion: { kind: "read-succeeded", ticket },
    });
    const observing = state.interests.get(id.key)?.interest;
    expect(observing?.status).toBe("observing");

    const followUpTicket = directTicket({ kind: "service", ref: service() }, id, 3, 3, 3);
    state = reduce(state, {
      kind: "read-completion",
      stamp: stamp(4),
      completion: { kind: "read-succeeded", ticket: followUpTicket },
    });
    expect(state.interests.get(id.key)?.interest).toBe(observing);
  });

  it("rejects old account and interest generations, including late callbacks", () => {
    const current = identity(2, 2, 2);
    const old = identity(1, 1, 1);
    let state = reduce(makeInitialZeropsDataState(scope(2)), {
      kind: "interest-upserted",
      interest: desiredInterest(current),
    });
    const before = state;
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(1),
        accessEvidence: null,
        input: {
          kind: "service-identity-observed",
          ref: service(),
          observation: {
            source: "native-push",
            registration: entityRegistration("service", old),
            fields: { hostname: "late" },
            metadata: {},
          },
        },
      },
    });
    expect(state).toBe(before);
    expect(state.inventory.services.size).toBe(0);
  });

  it("rejects a delayed older interest upsert without rolling the generation backward", () => {
    const newer = identity(1, 2, 2, "shared-key");
    const older = identity(1, 1, 1, "shared-key");
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(newer),
    });
    const current = state;
    state = reduce(state, {
      kind: "interest-upserted",
      interest: desiredInterest(older),
    });

    expect(state).toBe(current);
    expect(state.interests.get(newer.key)?.interest.identity).toBe(newer);
  });

  it.each(["release", "replace-generation"] as const)(
    "cancels pending query reads and releases their membership markers on %s",
    (mode) => {
      const initialIdentity = identity(1, 1, 1, `query-${mode}`);
      const descriptor = {
        kind: "services-of-project" as const,
        project: project(),
        schemaVersion: 1 as const,
      };
      const ticket = queryTicket(descriptor, initialIdentity, 1, 0, 1);
      const registration = queryRegistration(descriptor, initialIdentity, ticket);
      let state = reduce(makeInitialZeropsDataState(scope()), {
        kind: "interest-upserted",
        interest: desiredInterest(initialIdentity, 1),
      });
      state = reduce(state, { kind: "read-started", ticket });
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: stamp(1),
          accessEvidence: null,
          input: {
            kind: "query-membership-observed",
            operation: "add",
            member: service(`member-${mode}`),
            registration,
          },
        },
      });
      expect(state.inventory.queries.get(queryKeyOf(descriptor))?.membershipOperations.size).toBe(
        1,
      );

      state =
        mode === "release"
          ? reduce(state, {
              kind: "interest-released",
              key: initialIdentity.key,
              identity: initialIdentity,
            })
          : reduce(state, {
              kind: "interest-upserted",
              interest: desiredInterest(identity(1, 2, 2, initialIdentity.key), 1),
            });

      expect(state.reads.get(ticket.requestId)).toMatchObject({
        status: "failed",
        failure: "cancelled",
      });
      expect(state.inventory.queries.get(queryKeyOf(descriptor))?.membershipOperations.size).toBe(
        0,
      );
      const cancelled = state.reads.get(ticket.requestId);
      state = reduce(state, {
        kind: "read-completion",
        stamp: stamp(2),
        completion: { kind: "read-succeeded", ticket },
      });
      expect(state.reads.get(ticket.requestId)).toBe(cancelled);
    },
  );

  it("cancels a pending shared read when its ownership is released", () => {
    const dependent = identity(1, 1, 1, "shared-dependent");
    const target = { kind: "service" as const, ref: service("shared-target") };
    const baseTicket = directTicket(target, dependent, 1, 0, 1);
    const owner = {
      kind: "shared" as const,
      account: scope(),
      sharedReadId: ZeropsSharedReadId.make("shared-read"),
    };
    const ticket = {
      ...baseTicket,
      owner,
      kind: "hydration" as const,
    } as unknown as ReadTicket;
    const ownership = {
      owner,
      target,
      dependents: new Map([[dependent.key, dependent]]),
      status: "active" as const,
    };
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(dependent),
    });
    state = reduce(state, {
      kind: "shared-read-upserted",
      requestId: ticket.requestId,
      ownership,
    });
    state = reduce(state, { kind: "read-started", ticket });
    state = reduce(state, {
      kind: "shared-read-released",
      requestId: ticket.requestId,
    });

    expect(state.sharedReads.has(ticket.requestId)).toBe(false);
    expect(state.reads.get(ticket.requestId)).toMatchObject({
      status: "failed",
      failure: "cancelled",
    });
  });

  it("bounds completed read diagnostics and removes completion accumulators", () => {
    const tiny = makeZeropsDataPolicy({ retainedCompletedReadsPerAccount: 2 });
    const id = identity();
    let state = reduce(
      makeInitialZeropsDataState(scope()),
      { kind: "interest-upserted", interest: desiredInterest(id) },
      tiny,
    );
    const requestIds = [];
    for (let index = 0; index < 4; index++) {
      const ticket = directTicket(
        { kind: "service", ref: service(`read-service-${index}`) },
        id,
        index + 1,
        index * 2,
        index + 1,
      );
      requestIds.push(ticket.requestId);
      state = reduce(state, { kind: "read-started", ticket }, tiny);
      state = reduce(
        state,
        {
          kind: "observation",
          observation: {
            stamp: stamp(index * 2 + 1),
            accessEvidence: null,
            input: {
              kind: "service-identity-observed",
              ref: ticket.target.ref,
              observation: {
                source: "direct-read",
                ticket,
                fields: { hostname: `host-${index}` },
                metadata: {},
              },
            },
          },
        },
        tiny,
      );
      expect(state.readAccumulators.has(ticket.requestId)).toBe(true);
      state = reduce(
        state,
        {
          kind: "read-completion",
          stamp: stamp(index * 2 + 2),
          completion: { kind: "read-succeeded", ticket },
        },
        tiny,
      );
      expect(state.readAccumulators.has(ticket.requestId)).toBe(false);
    }

    expect([...state.reads.keys()]).toEqual(requestIds.slice(-2));
    expect(state.readAccumulators.size).toBe(0);
  });

  it("bounds project and service records through partial-before-eviction transitions", () => {
    const tiny = makeZeropsDataPolicy({
      retainedProjectsPerAccount: 1,
      retainedServicesPerAccount: 1,
    });
    const id = identity();
    let state = reduce(
      makeInitialZeropsDataState(scope()),
      { kind: "interest-upserted", interest: desiredInterest(id) },
      tiny,
    );
    const projects = [project("retained-project-1"), project("retained-project-2")];
    for (let index = 0; index < projects.length; index++) {
      state = reduce(
        state,
        {
          kind: "observation",
          observation: {
            stamp: stamp(index + 1),
            accessEvidence: null,
            input: {
              kind: "project-identity-observed",
              ref: projects[index]!,
              observation: {
                source: "native-push",
                registration: entityRegistration("project", id),
                fields: { name: `project-${index}` },
                metadata: {},
              },
            },
          },
        },
        tiny,
      );
    }
    expect(state.inventory.projects.size).toBe(2);
    expect(state.retention.pending).toEqual([
      expect.objectContaining({ status: "partial-before-eviction", reason: "project-budget" }),
    ]);

    const services = [
      service("retained-service-1", projects[0]),
      service("retained-service-2", projects[1]),
    ];
    for (let index = 0; index < services.length; index++) {
      state = reduce(
        state,
        {
          kind: "observation",
          observation: {
            stamp: stamp(index + 3),
            accessEvidence: null,
            input: {
              kind: "service-identity-observed",
              ref: services[index]!,
              observation: {
                source: "native-push",
                registration: entityRegistration("service", id),
                fields: { hostname: `service-${index}` },
                metadata: {},
              },
            },
          },
        },
        tiny,
      );
    }
    state = tick(state, 5, tiny);

    expect([...state.inventory.projects.keys()]).toEqual([projectKeyOf(projects[1]!)]);
    expect([...state.inventory.services.keys()]).toEqual([serviceKeyOf(services[1]!)]);
    expect(state.retention.notices.some((notice) => notice.reason === "project-budget")).toBe(true);
    expect(state.retention.notices.some((notice) => notice.reason === "service-budget")).toBe(true);
  });

  it("bounds long pending-baseline membership deltas and fails the affected interest for good", () => {
    const tiny = makeZeropsDataPolicy({ membershipMarkersPerQuery: 2 });
    const id = identity();
    const descriptor = {
      kind: "services-of-project" as const,
      project: project("marker-project"),
      schemaVersion: 1 as const,
    };
    const ticket = queryTicket(descriptor, id, 1, 0, 1);
    const registration = queryRegistration(descriptor, id, ticket);
    let state = reduce(
      makeInitialZeropsDataState(scope()),
      { kind: "interest-upserted", interest: desiredInterest(id, 1) },
      tiny,
    );
    state = reduce(state, { kind: "read-started", ticket }, tiny);
    for (let index = 0; index < 3; index++) {
      state = reduce(
        state,
        {
          kind: "observation",
          observation: {
            stamp: stamp(index + 1),
            accessEvidence: null,
            input: {
              kind: "query-membership-observed",
              operation: "add",
              member: service(`marker-service-${index}`),
              registration,
            },
          },
        },
        tiny,
      );
    }
    const key = queryKeyOf(descriptor);
    expect(state.inventory.queries.get(key)?.membershipOperations.size).toBeGreaterThan(2);
    expect(state.retention.pending).toEqual([
      expect.objectContaining({
        status: "partial-before-eviction",
        reason: "membership-marker-budget",
      }),
    ]);

    state = tick(state, 4, tiny);
    expect(state.inventory.queries.get(key)?.membershipOperations.size).toBeLessThanOrEqual(2);
    expect(state.inventory.queries.get(key)?.coverage).toEqual({
      kind: "partial",
      reason: "budget",
    });
    expect(state.reads.get(ticket.requestId)).toMatchObject({
      status: "failed",
      failure: "cancelled",
    });
    expect(state.interests.get(id.key)?.interest).toMatchObject({
      status: "failed",
      reason: "overflow",
      retryable: false,
      retryAtMs: null,
    });
  });

  describe("failures require a manual attempt and preserve paused or already failed interests", () => {
    const tiny = makeZeropsDataPolicy({ membershipMarkersPerQuery: 1 });
    const servicesQuery = {
      kind: "services-of-project" as const,
      project: project("held-project"),
      schemaVersion: 1 as const,
    };
    const held = {
      paused: { status: "paused", reason: "background" },
      failed: {
        status: "failed",
        reason: "registration churn",
        retryable: true,
        attempts: 1,
        retryAtMs: 5_000,
      },
    } as const;
    const failures = {
      "registration failure": (
        state: ReturnType<typeof makeInitialZeropsDataState>,
        id: ReturnType<typeof identity>,
      ) =>
        reduce(
          state,
          {
            kind: "registration-completion",
            stamp: stamp(1),
            completion: {
              kind: "registration-failed",
              request: entityRegistration("service", id),
              reason: "socket closed",
            },
          },
          tiny,
        ),
      "read failure": (
        state: ReturnType<typeof makeInitialZeropsDataState>,
        id: ReturnType<typeof identity>,
      ) =>
        reduce(
          state,
          {
            kind: "read-completion",
            stamp: stamp(1),
            completion: {
              kind: "read-failed",
              ticket: queryTicket(servicesQuery, id, 1, 0, 1),
              failure: "cancelled",
            },
          },
          tiny,
        ),
      "membership overflow": (
        state: ReturnType<typeof makeInitialZeropsDataState>,
        id: ReturnType<typeof identity>,
      ) => {
        const ticket = queryTicket(servicesQuery, id, 1, 0, 1);
        const registration = queryRegistration(servicesQuery, id, ticket);
        let next = state;
        for (let index = 0; index < 2; index++) {
          next = reduce(
            next,
            {
              kind: "observation",
              observation: {
                stamp: stamp(index + 1),
                accessEvidence: null,
                input: {
                  kind: "query-membership-observed",
                  operation: "add",
                  member: service(`held-service-${index}`),
                  registration,
                },
              },
            },
            tiny,
          );
        }
        return tick(next, 3, tiny);
      },
    } as const;

    it.each(Object.entries(failures))(
      "publishes %s as failed with no scheduled retry",
      (name, apply) => {
        const id = identity();
        let state = reduce(
          makeInitialZeropsDataState(scope()),
          {
            kind: "interest-upserted",
            interest: desiredInterest(id, 1),
          },
          tiny,
        );
        state = reduce(
          state,
          { kind: "read-started", ticket: queryTicket(servicesQuery, id, 1, 0, 1) },
          tiny,
        );
        state = apply(state, id);
        // The runtime stamps a retry on what may pass; lost updates wait for a person.
        expect(state.interests.get(id.key)?.interest).toMatchObject({
          status: "failed",
          retryable: name !== "membership overflow",
          attempts: 1,
          retryAtMs: null,
        });
      },
    );

    it.each(Object.entries(held))("keeps %s after a late successful read", (_, interest) => {
      const id = identity();
      const heldInterest = { ...interest, identity: id } as DesiredInterestState["interest"];
      const ticket = directTicket({ kind: "service", ref: service() }, id);
      let state = reduce(makeInitialZeropsDataState(scope()), {
        kind: "interest-upserted",
        interest: {
          ...desiredInterest(id, 1),
          interest: heldInterest,
          wire: {
            status: "registered",
            receiver: id.receiver,
            subscriptionName: entityRegistration("service", id).subscriptionName,
          },
        },
      });
      state = reduce(state, { kind: "read-started", ticket });
      state = reduce(state, {
        kind: "read-completion",
        stamp: stamp(1),
        completion: { kind: "read-succeeded", ticket },
      });
      expect(state.interests.get(id.key)?.interest).toEqual(heldInterest);
    });

    for (const [holding, interest] of Object.entries(held)) {
      for (const [failure, apply] of Object.entries(failures)) {
        it(`keeps a ${holding} interest ${holding} after a ${failure}`, () => {
          const id = identity();
          const heldInterest = { ...interest, identity: id } as DesiredInterestState["interest"];
          let state = reduce(
            makeInitialZeropsDataState(scope()),
            {
              kind: "interest-upserted",
              interest: { ...desiredInterest(id, 1), interest: heldInterest },
            },
            tiny,
          );
          state = reduce(
            state,
            { kind: "read-started", ticket: queryTicket(servicesQuery, id, 1, 0, 1) },
            tiny,
          );
          state = apply(state, id);
          expect(state.interests.get(id.key)?.interest).toEqual(heldInterest);
        });
      }
    }
  });

  it("immediately removes inactive query state and only its unused member refs", () => {
    const id = identity();
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    const inventoryMember = service("inactive-inventory-member", project("inactive-inventory"));
    const inventoryDescriptor = {
      kind: "services-of-project" as const,
      project: inventoryMember.project,
      schemaVersion: 1 as const,
    };
    const inventoryTicket = queryTicket(inventoryDescriptor, id, 1, 0, 1);
    state = reduce(state, { kind: "read-started", ticket: inventoryTicket });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(1),
        accessEvidence: null,
        input: {
          kind: "query-baseline-observed",
          members: [],
          unresolvedMembers: [inventoryMember],
          observedTotal: 1,
          coverage: fullCoverage,
          source: "direct-read",
          ticket: inventoryTicket,
        },
      },
    });

    state = reduce(state, {
      kind: "inactive-queries-released",
      queryKeys: [queryKeyOf(inventoryDescriptor)],
    });

    expect(state.inventory.queries.has(queryKeyOf(inventoryDescriptor))).toBe(false);
    expect(state.inventory.memberRefs.has(serviceKeyOf(inventoryMember))).toBe(false);
    expect(state.inventory.services.has(serviceKeyOf(inventoryMember))).toBe(true);
    expect(
      reduce(state, {
        kind: "inactive-queries-released",
        queryKeys: [queryKeyOf(inventoryDescriptor)],
      }),
    ).toBe(state);
  });

  it("admits a command, records its outcome, and rejects one once access expired", () => {
    const ref = service();
    const attemptId = ZeropsCommandAttemptId.make("attempt-1");
    const command = {
      kind: "import-services" as const,
      project: ref.project,
      yaml: "services: []",
      attemptId,
      accountEpoch: AccountEpoch.make(1),
      startedAtReceiptOrdinal: ReceiptOrdinal.make(1),
      dispatchOrdinal: DispatchOrdinal.make(1),
    };
    let state = reduce(makeInitialZeropsDataState(scope(), verifiedAccess()), {
      kind: "command-execution-requested",
      stamp: stamp(1),
      request: { command, enqueuedAtMs: 10 },
    });
    expect(state.commands.get(attemptId)?.status).toBe("pending");
    state = reduce(state, {
      kind: "command-completion",
      stamp: stamp(2),
      completion: { kind: "command-accepted", command },
    });
    expect(state.commands.get(attemptId)?.status).toBe("accepted");

    state = reduce(state, {
      kind: "access-observation",
      stamp: stamp(3, 20_000),
      observation: {
        kind: "access-expired",
        accountEpoch: AccountEpoch.make(1),
        expiredAtMs: 20_000,
      },
    });
    const denied = {
      ...command,
      attemptId: ZeropsCommandAttemptId.make("attempt-2"),
      dispatchOrdinal: DispatchOrdinal.make(2),
    };
    state = reduce(state, {
      kind: "command-execution-requested",
      stamp: stamp(4, 20_001),
      request: { command: denied, enqueuedAtMs: 20_001 },
    });
    expect(state.commands.get(denied.attemptId)).toMatchObject({
      status: "rejected",
      reason: "access is expired",
    });
  });

  it("bounds terminal command diagnostics, preserves pending attempts, and leaves an admission slot", () => {
    const tiny = makeZeropsDataPolicy({ retainedCommandAttemptsPerAccount: 3 });
    let state = makeInitialZeropsDataState(scope(), verifiedAccess());
    const completedAttemptIds = [];
    for (let index = 0; index < 4; index++) {
      const command = {
        kind: "import-services" as const,
        project: service(`command-service-${index}`).project,
        yaml: "services: []",
        attemptId: ZeropsCommandAttemptId.make(`retained-command-${index}`),
        accountEpoch: AccountEpoch.make(1),
        startedAtReceiptOrdinal: ReceiptOrdinal.make(index * 2 + 1),
        dispatchOrdinal: DispatchOrdinal.make(index + 1),
      };
      completedAttemptIds.push(command.attemptId);
      state = reduce(
        state,
        {
          kind: "command-execution-requested",
          stamp: stamp(index * 2 + 1),
          request: { command, enqueuedAtMs: index + 1 },
        },
        tiny,
      );
      expect(state.commands.get(command.attemptId)?.status).toBe("pending");
      state = reduce(
        state,
        {
          kind: "command-completion",
          stamp: stamp(index * 2 + 2),
          completion: { kind: "command-accepted", command },
        },
        tiny,
      );
    }

    expect([...state.commands.keys()]).toEqual(completedAttemptIds.slice(-2));
    expect(state.commands.size).toBeLessThan(tiny.retainedCommandAttemptsPerAccount);

    const pending = {
      kind: "import-services" as const,
      project: service("pending-command-service").project,
      yaml: "services: []",
      attemptId: ZeropsCommandAttemptId.make("pending-command"),
      accountEpoch: AccountEpoch.make(1),
      startedAtReceiptOrdinal: ReceiptOrdinal.make(9),
      dispatchOrdinal: DispatchOrdinal.make(5),
    };
    state = reduce(
      state,
      {
        kind: "command-execution-requested",
        stamp: stamp(9),
        request: { command: pending, enqueuedAtMs: 9 },
      },
      tiny,
    );
    expect(state.commands.get(pending.attemptId)?.status).toBe("pending");
    expect(state.commands.size).toBeLessThan(tiny.retainedCommandAttemptsPerAccount);
  });

  it("shuts down with an idempotent fence and rejects all late model work", () => {
    let state = makeInitialZeropsDataState(scope());
    state = reduce(state, { kind: "runtime-closed" });
    const closed = state;
    expect(reduce(state, { kind: "runtime-closed" })).toBe(closed);
    expect(reduce(state, { kind: "interest-upserted", interest: desiredInterest() })).toBe(closed);
  });

  it("retains unrelated records by reference through 10,000 admitted observations", () => {
    const id = identity();
    const stableRef = service("stable");
    const hotRef = service("hot");
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
          ref: stableRef,
          observation: {
            source: "native-push",
            registration: entityRegistration("service", id),
            fields: { hostname: "stable" },
            metadata: {},
          },
        },
      },
    });
    const stableRecord = state.inventory.services.get(serviceKeyOf(stableRef));
    for (let index = 0; index < 10_000; index++) {
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: stamp(index + 2),
          accessEvidence: null,
          input: {
            kind: "service-lifecycle-observed",
            ref: hotRef,
            observation: {
              source: "native-push",
              registration: entityRegistration("service", id),
              fields: { status: index % 2 === 0 ? "RUNNING" : "STOPPED" },
              metadata: {},
            },
          },
        },
      });
    }
    expect(state.inventory.services.get(serviceKeyOf(stableRef))).toBe(stableRecord);
    expect(state.inventory.services.get(serviceKeyOf(hotRef))?.lifecycle).toMatchObject({
      fields: { status: "STOPPED" },
    });
  });

  it("performs no retention sort when every collection is under budget", () => {
    const id = identity();
    const ref = service("under-budget");
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    const sortSpy = vi.spyOn(Array.prototype, "toSorted");
    let callCount = 0;
    try {
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: stamp(1),
          accessEvidence: null,
          input: {
            kind: "service-identity-observed",
            ref,
            observation: {
              source: "native-push",
              registration: entityRegistration("service", id),
              fields: { hostname: "under-budget" },
              metadata: {},
            },
          },
        },
      });
      callCount = sortSpy.mock.calls.length;
    } finally {
      sortSpy.mockRestore();
    }
    expect(callCount).toBe(0);
    expect(state.inventory.services.get(serviceKeyOf(ref))).toBeDefined();
  });
});

describe("unavailable response ordering", () => {
  for (const ref of [project(), service()]) {
    for (const source of ["direct-read", "native-push"] as const) {
      for (const reason of ["forbidden", "not-found"] as const) {
        it(`keeps newer ${source} ${ref.kind} facts ahead of an older ${reason}`, () => {
          const id = identity();
          const target = { kind: ref.kind, ref } as ReadTicket["target"];
          const older = directTicket(target, id, 1, 1, 1);
          const newer = directTicket(target, id, 2, 2, 2);
          let state = reduce(makeInitialZeropsDataState(scope(), verifiedAccess()), {
            kind: "interest-upserted",
            interest: desiredInterest(id),
          });
          const input = {
            kind: `${ref.kind}-lifecycle-observed`,
            ref,
            observation: {
              ...(source === "direct-read"
                ? { source, ticket: newer }
                : { source, registration: entityRegistration(ref.kind, id) }),
              fields: { status: "ACTIVE" },
              metadata: {},
            },
          } as PlatformObservation;
          state = reduce(state, {
            kind: "observation",
            observation: { stamp: stamp(3), accessEvidence: grant(), input },
          });
          const before = state;
          state = reduce(state, {
            kind: "observation",
            observation: {
              stamp: stamp(4),
              accessEvidence: grant(),
              input: {
                kind: "entity-unavailable",
                ref,
                reason,
                ticket: older,
              } as PlatformObservation,
            },
          });
          expect(state.inventory).toBe(before.inventory);
        });
      }
    }
  }
});
