import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Scheduler from "effect/Scheduler";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import {
  interestKeyOf,
  planZeropsInterest,
  makeZeropsBoundedIngress,
  makeZeropsDataRuntime,
  type ZeropsBoundedIngress,
} from "./runtime.ts";
import { makeZeropsDataPolicy } from "./policy.ts";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProcessId,
  ZeropsProjectId,
  ZeropsServiceId,
  type AccountScope,
  type AdapterError,
  type ProjectRef,
  type PlatformObservation,
  type ReceiverEvent,
  type ReceiverHandle,
  type RegistrationRequest,
  type RuntimeInterestDescriptor,
  type ServiceRef,
  type ZeropsDataAdapter,
} from "./types.ts";
import type { ZeropsDataState } from "./state.ts";

const encodeTestFrame = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const project = (id: string): ProjectRef => ({
  kind: "project",
  organization: {
    kind: "organization",
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-a"),
    },
    organizationId: ZeropsOrganizationId.make("org-a"),
  },
  projectId: ZeropsProjectId.make(id),
});

describe("makeZeropsBoundedIngress", () => {
  it.effect("serializes admitted inputs and accounts bytes after drain", () =>
    Effect.gen(function* () {
      const ingress = yield* makeZeropsBoundedIngress({
        maxEvents: 2,
        maxBytes: 10,
        maxFrameBytes: 8,
        onOverflow: () => Effect.void,
      });

      expect(yield* ingress.offer("a", 4)).toBe(true);
      expect(yield* ingress.offer("b", 6)).toBe(true);
      expect(yield* ingress.take).toBe("a");
      expect(yield* ingress.take).toBe("b");
      expect(yield* ingress.snapshot).toEqual({
        events: 0,
        bytes: 0,
        peakEvents: 2,
        peakBytes: 10,
        discardedEvents: 0,
      });
    }),
  );

  it.effect("publishes overflow before recording a discarded frame", () =>
    Effect.gen(function* () {
      const callbackSnapshots = yield* Ref.make<ReadonlyArray<number>>([]);
      let ingress!: ZeropsBoundedIngress<string>;
      ingress = yield* makeZeropsBoundedIngress({
        maxEvents: 1,
        maxBytes: 8,
        maxFrameBytes: 8,
        onOverflow: (_input: string) =>
          ingress.snapshot.pipe(
            Effect.flatMap((snapshot) =>
              Ref.update(callbackSnapshots, (values) => [...values, snapshot.discardedEvents]),
            ),
          ),
      });

      expect(yield* ingress.offer("kept", 8)).toBe(true);
      expect(yield* ingress.offer("lost", 1)).toBe(false);
      expect(yield* Ref.get(callbackSnapshots)).toEqual([0]);
      expect((yield* ingress.snapshot).discardedEvents).toBe(1);
    }),
  );

  it.effect("rejects an individually oversized decoded frame", () =>
    Effect.gen(function* () {
      const overflows = yield* Ref.make(0);
      const ingress = yield* makeZeropsBoundedIngress({
        maxEvents: 10,
        maxBytes: 100,
        maxFrameBytes: 20,
        onOverflow: () => Ref.update(overflows, (count) => count + 1),
      });

      expect(yield* ingress.offer("oversized", 21)).toBe(false);
      expect(yield* Ref.get(overflows)).toBe(1);
      expect((yield* ingress.snapshot).events).toBe(0);
    }),
  );

  it.effect("never drops an uncounted ordering marker when the data queue is full", () =>
    Effect.gen(function* () {
      const ingress = yield* makeZeropsBoundedIngress({
        maxEvents: 1,
        maxBytes: 8,
        maxFrameBytes: 8,
        onOverflow: () => Effect.void,
      });

      expect(yield* ingress.offer("data", 8)).toBe(true);
      const marker = yield* Effect.forkChild(ingress.offerUncounted("barrier"));
      yield* Effect.yieldNow;
      expect(marker.pollUnsafe()).toBeUndefined();
      expect(yield* ingress.take).toBe("data");
      expect(yield* Fiber.join(marker)).toBe(true);
      expect(yield* ingress.take).toBe("barrier");
      expect(yield* ingress.snapshot).toEqual({
        events: 0,
        bytes: 0,
        peakEvents: 1,
        peakBytes: 8,
        discardedEvents: 0,
      });
    }),
  );
});

describe("interestKeyOf", () => {
  it("shares identical descriptors and separates project or metric-window demand", () => {
    const first = {
      kind: "project-topology" as const,
      project: project("project-a"),
      includeCurrentMetrics: true,
    };
    expect(interestKeyOf({ ...first })).toBe(interestKeyOf(first));
    expect(interestKeyOf({ ...first, project: project("project-b") })).not.toBe(
      interestKeyOf(first),
    );
    expect(interestKeyOf({ ...first, includeCurrentMetrics: false })).not.toBe(
      interestKeyOf(first),
    );
  });

  it("keeps optional current metrics distinct from required topology", () => {
    const ref = project("project-a");
    expect(interestKeyOf({ kind: "project-current-metrics", project: ref })).not.toBe(
      interestKeyOf({ kind: "project-topology", project: ref, includeCurrentMetrics: false }),
    );
  });
});

function makeIdFactory(): () => string {
  let next = 0;
  return () => `opaque-${++next}`;
}

function makeAdapterHarness(options: { readonly failCurrentMetrics?: boolean } = {}) {
  let opens = 0;
  let registrations = 0;
  let reads = 0;
  let closes = 0;
  const adapter: ZeropsDataAdapter = {
    openReceiver: (_scope, organization, identity) => {
      opens += 1;
      return Effect.succeed({
        identity,
        organization,
        delivery: "hot-single-consumer-buffered-before-open-resolves",
        events: Stream.never,
      } satisfies ReceiverHandle);
    },
    register: (_receiver, request) => {
      registrations += 1;
      if (options.failCurrentMetrics && request.descriptor.kind === "current-metrics") {
        return Effect.fail({
          _tag: "ZeropsDataAdapterError",
          kind: "registration",
          message: "metrics unavailable",
          retryable: true,
          accountRevocationEvidence: false,
        } satisfies AdapterError);
      }
      return Effect.succeed({ responseObservations: [] });
    },
    read: () => {
      reads += 1;
      return Effect.succeed({ observations: [] });
    },
    execute: () =>
      Effect.fail({
        _tag: "ZeropsDataAdapterError",
        kind: "rejected",
        message: "not used",
        retryable: false,
        accountRevocationEvidence: false,
      } satisfies AdapterError),
    closeReceiver: () => Effect.sync(() => void (closes += 1)),
  };
  return {
    adapter,
    counts: () => ({ opens, registrations, reads, closes }),
  };
}

const runtimeScope: AccountScope = {
  account: project("project-a").organization.account,
  epoch: AccountEpoch.make(1),
};

const topologyDescriptor: RuntimeInterestDescriptor = {
  kind: "project-topology",
  project: project("project-a"),
  includeCurrentMetrics: false,
};

const unresolvedProcessBaseline = (
  request: RegistrationRequest,
  processId = "process-a",
): PlatformObservation | null => {
  if (
    request.descriptor.kind !== "query-membership" ||
    request.descriptor.query.kind !== "running-processes-of-project" ||
    request.baselineTicket === null
  )
    return null;
  const ref = {
    kind: "process" as const,
    project: request.descriptor.query.project,
    processId: ZeropsProcessId.make(processId),
  };
  return {
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
    source: "indexed-search",
    ticket: request.baselineTicket,
  } as PlatformObservation;
};

const waitForState = (
  states: Queue.Dequeue<ZeropsDataState>,
  predicate: (state: ZeropsDataState) => boolean,
): Effect.Effect<ZeropsDataState> => Queue.take(states).pipe(Effect.repeat({ until: predicate }));

describe("makeZeropsDataRuntime", () => {
  it.effect(
    "keeps account workers on their creation scheduler when demand comes from another caller",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const inherited = yield* Scheduler.Scheduler;
        const scheduler: Scheduler.Scheduler = {
          executionMode: inherited.executionMode,
          shouldYield: (fiber) => inherited.shouldYield(fiber),
          makeDispatcher: () => inherited.makeDispatcher(),
        };
        const seen: Array<Scheduler.Scheduler> = [];
        const harness = makeAdapterHarness();
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: {
            ...harness.adapter,
            register: (...args) =>
              Effect.gen(function* () {
                seen.push(yield* Scheduler.Scheduler);
                return yield* harness.adapter.register(...args);
              }),
            read: (...args) =>
              Effect.gen(function* () {
                seen.push(yield* Scheduler.Scheduler);
                return yield* harness.adapter.read(...args);
              }),
          },
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
        }).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });
        const leaseScope = yield* Scope.make();
        const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        unsubscribe();
        registry.dispose();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((current) => current === scheduler)).toBe(true);
      }),
  );

  it.effect("retains state published before the first reactive subscriber", () =>
    Effect.gen(function* () {
      const scheduled: Array<() => void> = [];
      const registry = AtomRegistry.make({
        scheduleTask: (task) => {
          let active = true;
          scheduled.push(() => {
            if (active) task();
          });
          return () => {
            active = false;
          };
        },
      });
      const harness = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });

      yield* runtime.observeAccess({
        kind: "access-verification-started",
        accountEpoch: runtimeScope.epoch,
      });
      for (const task of scheduled.splice(0)) task();

      expect(registry.get(runtime.stateAtom).access.status).toBe("verifying");

      yield* runtime.shutdown("application-close");
      registry.dispose();
    }),
  );

  it.effect("rejects active query and history-series demand at account capacity", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const queryBounded = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({ activeQueriesPerAccount: 2 }),
      });
      const topologyScope = yield* Scope.make();
      yield* queryBounded.acquire(topologyDescriptor).pipe(Scope.provide(topologyScope));
      const metricsScope = yield* Scope.make();
      const metrics = yield* queryBounded
        .acquire({ kind: "project-current-metrics", project: topologyDescriptor.project })
        .pipe(Scope.provide(metricsScope), Effect.result);
      expect(metrics._tag).toBe("Failure");
      if (metrics._tag === "Failure") expect(metrics.failure.reason).toBe("account-capacity");
      yield* queryBounded.shutdown("application-close");
      yield* Scope.close(topologyScope, Exit.void);
      yield* Scope.close(metricsScope, Exit.void);

      const historyBounded = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          activeQueriesPerAccount: 4,
          activeHistorySeriesPerAccount: 1,
        }),
      });
      const firstScope = yield* Scope.make();
      yield* historyBounded
        .acquire({
          kind: "project-metric-history",
          project: topologyDescriptor.project,
          window: { timeGroupBy: "1m", limit: 10, timeZone: "Europe/Prague" },
        })
        .pipe(Scope.provide(firstScope));
      const secondScope = yield* Scope.make();
      const second = yield* historyBounded
        .acquire({
          kind: "project-metric-history",
          project: topologyDescriptor.project,
          window: { timeGroupBy: "1h", limit: 10, timeZone: "Europe/Prague" },
        })
        .pipe(Scope.provide(secondScope), Effect.result);
      expect(second._tag).toBe("Failure");
      if (second._tag === "Failure") expect(second.failure.reason).toBe("account-capacity");
      yield* historyBounded.shutdown("application-close");
      yield* Scope.close(firstScope, Exit.void);
      yield* Scope.close(secondScope, Exit.void);
      registry.dispose();
    }),
  );

  it.effect("shares identical leases and stops the organization receiver on last release", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const firstScope = yield* Scope.make();
      const secondScope = yield* Scope.make();
      const first = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(firstScope));
      const second = yield* runtime
        .acquire({ ...topologyDescriptor })
        .pipe(Scope.provide(secondScope));

      const observing = yield* waitForState(
        states,
        (state) => state.interests.get(first.interest)?.interest.status === "observing",
      );
      expect(observing.interests.get(first.interest)?.leases).toBe(2);
      expect(second.interest).toBe(first.interest);
      expect(harness.counts()).toEqual({ opens: 1, registrations: 5, reads: 3, closes: 0 });

      yield* first.release;
      expect((yield* runtime.state).interests.get(first.interest)?.leases).toBe(1);
      yield* second.release;
      expect((yield* runtime.state).interests.has(first.interest)).toBe(false);
      expect(harness.counts().closes).toBe(1);

      yield* Scope.close(firstScope, Exit.void);
      yield* Scope.close(secondScope, Exit.void);
      yield* runtime.shutdown("application-close");
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("rejects read admission at the pending-read budget and exposes recovery", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({ queuedReadRequestsPerAccount: 1 }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      const recovering = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "recovering",
      );

      expect(
        [...recovering.reads.values()].filter((read) => read.status === "pending").length,
      ).toBeLessThanOrEqual(1);
      expect(recovering.sharedReads.size).toBe(0);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("shares physical registrations across topology and activity interests", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const topologyScope = yield* Scope.make();
      const activityScope = yield* Scope.make();
      const topology = yield* runtime
        .acquire(topologyDescriptor)
        .pipe(Scope.provide(topologyScope));
      const activity = yield* runtime
        .acquire({ kind: "project-activity", project: topologyDescriptor.project })
        .pipe(Scope.provide(activityScope));

      yield* waitForState(states, (state) => {
        const topologyState = state.interests.get(topology.interest)?.interest.status;
        const activityState = state.interests.get(activity.interest)?.interest.status;
        return topologyState === "observing" && activityState === "observing";
      });
      expect(harness.counts().registrations).toBe(5);

      yield* topology.release;
      expect((yield* runtime.state).interests.has(activity.interest)).toBe(true);
      expect(harness.counts().closes).toBe(0);
      yield* activity.release;
      expect(harness.counts().closes).toBe(1);

      yield* Scope.close(topologyScope, Exit.void);
      yield* Scope.close(activityScope, Exit.void);
      yield* runtime.shutdown("application-close");
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("keeps one hydration alive for the remaining dependent interest", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const allowBaseline = yield* Deferred.make<void>();
      const hydrationStarted = yield* Deferred.make<void>();
      const finishHydration = yield* Deferred.make<void>();
      let processReads = 0;
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) =>
          Effect.succeed({
            identity,
            organization,
            delivery: "hot-single-consumer-buffered-before-open-resolves",
            events: Stream.never,
          }),
        register: (_receiver, request) => {
          const baseline = unresolvedProcessBaseline(request);
          return baseline === null
            ? Effect.succeed({ responseObservations: [] })
            : Deferred.await(allowBaseline).pipe(Effect.as({ responseObservations: [baseline] }));
        },
        read: (ticket) => {
          if (ticket.target.kind !== "process") return Effect.succeed({ observations: [] });
          processReads += 1;
          return Deferred.succeed(hydrationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(finishHydration)),
            Effect.as({ observations: [] }),
          );
        },
        execute: () => Effect.succeed({ processRefs: [], observations: [] }),
        closeReceiver: () => Effect.void,
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const topologyScope = yield* Scope.make();
      const activityScope = yield* Scope.make();
      const topology = yield* runtime
        .acquire(topologyDescriptor)
        .pipe(Scope.provide(topologyScope));
      const activity = yield* runtime
        .acquire({ kind: "project-activity", project: topologyDescriptor.project })
        .pipe(Scope.provide(activityScope));
      yield* Deferred.succeed(allowBaseline, undefined);
      yield* Deferred.await(hydrationStarted);

      expect(processReads).toBe(1);
      const activeHydration = [...(yield* runtime.state).sharedReads.values()].find(
        (ownership) => ownership.target.kind === "process",
      );
      expect(activeHydration?.dependents.size).toBe(2);

      yield* topology.release;
      const retainedHydration = [...(yield* runtime.state).sharedReads.values()].find(
        (ownership) => ownership.target.kind === "process",
      );
      expect(retainedHydration?.dependents.size).toBe(1);
      expect(retainedHydration?.dependents.has(activity.interest)).toBe(true);

      yield* Deferred.succeed(finishHydration, undefined);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(processReads).toBe(1);
      yield* activity.release;
      yield* Scope.close(topologyScope, Exit.void);
      yield* Scope.close(activityScope, Exit.void);
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }),
  );

  it.effect("retries failed hydration within its finite budget", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const secondAttempt = yield* Deferred.make<void>();
      let processReads = 0;
      const adapterError: AdapterError = {
        _tag: "ZeropsDataAdapterError",
        kind: "network",
        message: "first hydration failed",
        retryable: true,
        accountRevocationEvidence: false,
      };
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) =>
          Effect.succeed({
            identity,
            organization,
            delivery: "hot-single-consumer-buffered-before-open-resolves",
            events: Stream.never,
          }),
        register: (_receiver, request) => {
          const baseline = unresolvedProcessBaseline(request);
          return Effect.succeed({ responseObservations: baseline === null ? [] : [baseline] });
        },
        read: (ticket) => {
          if (ticket.target.kind !== "process") return Effect.succeed({ observations: [] });
          processReads += 1;
          return processReads === 1
            ? Effect.fail(adapterError)
            : Deferred.succeed(secondAttempt, undefined).pipe(Effect.as({ observations: [] }));
        },
        execute: () => Effect.succeed({ processRefs: [], observations: [] }),
        closeReceiver: () => Effect.void,
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const leaseScope = yield* Scope.make();
      yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      yield* Deferred.await(secondAttempt);
      expect(processReads).toBe(2);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      registry.dispose();
    }),
  );

  it.effect(
    "resets the hydration-failure budget for an organization once it recovers observing",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const events = yield* Queue.unbounded<ReceiverEvent>();
        let processReads = 0;
        const adapterError: AdapterError = {
          _tag: "ZeropsDataAdapterError",
          kind: "network",
          message: "hydration read always fails",
          retryable: true,
          accountRevocationEvidence: false,
        };
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) =>
            Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            }),
          register: (_receiver, request) => {
            const baseline = unresolvedProcessBaseline(request);
            return Effect.succeed({ responseObservations: baseline === null ? [] : [baseline] });
          },
          read: (ticket) => {
            if (ticket.target.kind !== "process") return Effect.succeed({ observations: [] });
            processReads += 1;
            return Effect.fail(adapterError);
          },
          execute: () => Effect.succeed({ processRefs: [], observations: [] }),
          closeReceiver: () => Effect.void,
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({
            hydrationRetryLimit: 2,
            recoveryAttemptLimit: 5,
            recoveryBackoffStartMs: 10,
            recoveryBackoffMaxMs: 10,
          }),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });
        const activityDescriptor: RuntimeInterestDescriptor = {
          kind: "project-activity",
          project: topologyDescriptor.project,
        };
        const leaseScope = yield* Scope.make();
        const lease = yield* runtime.acquire(activityDescriptor).pipe(Scope.provide(leaseScope));
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        // Every failed read triggers its own automatic retry until the 2-attempt budget
        // is spent; the exact attempt count only depends on that unrelated retry
        // machinery, so record the plateau rather than assert a specific number.
        const afterInitialSettle = processReads;
        expect(afterInitialSettle).toBeGreaterThan(0);

        // Recovery cycle: the interest's transport is replaced and re-established, and
        // reaching "observing" again resets the hydration-failure budget for the whole
        // organization. The resent baseline reports the same unresolved process, so a
        // fresh hydration attempt must run once the budget is clear again — the plateau
        // must move past its exhausted value.
        yield* Queue.offer(events, { kind: "closed", reason: "disconnect" });
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "recovering",
        );
        yield* TestClock.adjust("10 millis");
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(processReads).toBeGreaterThan(afterInitialSettle);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        unsubscribe();
        registry.dispose();
      }),
  );

  it.effect("resets the hydration-failure budget for an organization on foreground resume", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      let processReads = 0;
      const adapterError: AdapterError = {
        _tag: "ZeropsDataAdapterError",
        kind: "network",
        message: "hydration read always fails",
        retryable: true,
        accountRevocationEvidence: false,
      };
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) =>
          Effect.succeed({
            identity,
            organization,
            delivery: "hot-single-consumer-buffered-before-open-resolves",
            events: Stream.never,
          }),
        register: (_receiver, request) => {
          const baseline = unresolvedProcessBaseline(request);
          return Effect.succeed({ responseObservations: baseline === null ? [] : [baseline] });
        },
        read: (ticket) => {
          if (ticket.target.kind !== "process") return Effect.succeed({ observations: [] });
          processReads += 1;
          return Effect.fail(adapterError);
        },
        execute: () => Effect.succeed({ processRefs: [], observations: [] }),
        closeReceiver: () => Effect.void,
      };
      const visibilityState = yield* Ref.make<"visible" | "hidden">("visible");
      const visibilityChanges = yield* Queue.unbounded<"visible" | "hidden">();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          hydrationRetryLimit: 2,
          hiddenReceiverPauseAfterMs: 100,
        }),
        visibility: {
          current: Ref.get(visibilityState),
          changes: Stream.fromQueue(visibilityChanges),
        },
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const activityDescriptor: RuntimeInterestDescriptor = {
        kind: "project-activity",
        project: topologyDescriptor.project,
      };
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(activityDescriptor).pipe(Scope.provide(leaseScope));
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const afterInitialSettle = processReads;
      expect(afterInitialSettle).toBeGreaterThan(0);

      // Background pause, then foreground resume: the resumed interest resends its
      // baseline (same unresolved process), and the resume path itself must reset the
      // organization's hydration-failure budget so a fresh attempt is allowed.
      yield* Ref.set(visibilityState, "hidden");
      yield* Queue.offer(visibilityChanges, "hidden");
      yield* TestClock.adjust("100 millis");
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "paused",
      );

      yield* Ref.set(visibilityState, "visible");
      yield* Queue.offer(visibilityChanges, "visible");
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(processReads).toBeGreaterThan(afterInitialSettle);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect(
    "interrupts an in-flight hydration on background pause and releases the shared read",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const hydrationStarted = yield* Deferred.make<void>();
        let processReads = 0;
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) =>
            Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.never,
            }),
          register: (_receiver, request) => {
            const baseline = unresolvedProcessBaseline(request);
            return Effect.succeed({ responseObservations: baseline === null ? [] : [baseline] });
          },
          read: (ticket) => {
            if (ticket.target.kind !== "process") return Effect.succeed({ observations: [] });
            processReads += 1;
            return Deferred.succeed(hydrationStarted, undefined).pipe(Effect.andThen(Effect.never));
          },
          execute: () => Effect.succeed({ processRefs: [], observations: [] }),
          closeReceiver: () => Effect.void,
        };
        const visibilityState = yield* Ref.make<"visible" | "hidden">("visible");
        const visibilityChanges = yield* Queue.unbounded<"visible" | "hidden">();
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({ hiddenReceiverPauseAfterMs: 100 }),
          visibility: {
            current: Ref.get(visibilityState),
            changes: Stream.fromQueue(visibilityChanges),
          },
        });
        const activityDescriptor: RuntimeInterestDescriptor = {
          kind: "project-activity",
          project: topologyDescriptor.project,
        };
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });
        const leaseScope = yield* Scope.make();
        const _lease = yield* runtime.acquire(activityDescriptor).pipe(Scope.provide(leaseScope));
        yield* Deferred.await(hydrationStarted);
        expect(processReads).toBe(1);
        expect(
          [...(yield* runtime.state).sharedReads.values()].some(
            (ownership) => ownership.target.kind === "process",
          ),
        ).toBe(true);
        // The interest's own direct read of the query (unrelated to hydration) settles a
        // little later and re-touches the same unresolved member; let establishment
        // finish completely so only the pause-triggered cancellation is under test below.
        for (let i = 0; i < 10; i++) yield* Effect.yieldNow;
        // Drop the history accumulated so far (it still shows the active hydration) so the
        // wait below only observes states published from this point forward.
        yield* Queue.takeAll(states);

        yield* Ref.set(visibilityState, "hidden");
        yield* Queue.offer(visibilityChanges, "hidden");
        yield* TestClock.adjust("100 millis");
        yield* waitForState(
          states,
          (state) =>
            ![...state.sharedReads.values()].some(
              (ownership) => ownership.target.kind === "process",
            ),
        );

        expect(
          [...(yield* runtime.state).sharedReads.values()].some(
            (ownership) => ownership.target.kind === "process",
          ),
        ).toBe(false);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        unsubscribe();
        registry.dispose();
      }),
  );

  it.effect(
    "interrupts an in-flight hydration when its organization's receiver is replaced by recovery",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const hydrationStarted = yield* Deferred.make<void>();
        const events = yield* Queue.unbounded<ReceiverEvent>();
        let processReads = 0;
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) =>
            Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            }),
          register: (_receiver, request) => {
            const baseline = unresolvedProcessBaseline(request);
            return Effect.succeed({ responseObservations: baseline === null ? [] : [baseline] });
          },
          read: (ticket) => {
            if (ticket.target.kind !== "process") return Effect.succeed({ observations: [] });
            processReads += 1;
            return Deferred.succeed(hydrationStarted, undefined).pipe(Effect.andThen(Effect.never));
          },
          execute: () => Effect.succeed({ processRefs: [], observations: [] }),
          closeReceiver: () => Effect.void,
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({ recoveryBackoffStartMs: 10, recoveryBackoffMaxMs: 10 }),
        });
        const activityDescriptor: RuntimeInterestDescriptor = {
          kind: "project-activity",
          project: topologyDescriptor.project,
        };
        const leaseScope = yield* Scope.make();
        const _lease = yield* runtime.acquire(activityDescriptor).pipe(Scope.provide(leaseScope));
        yield* Deferred.await(hydrationStarted);
        expect(
          [...(yield* runtime.state).sharedReads.values()].some(
            (ownership) => ownership.target.kind === "process",
          ),
        ).toBe(true);

        yield* Queue.offer(events, { kind: "closed", reason: "disconnect" });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(
          [...(yield* runtime.state).sharedReads.values()].some(
            (ownership) => ownership.target.kind === "process",
          ),
        ).toBe(false);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        registry.dispose();
      }),
  );

  it.effect("fences future leases on idempotent shutdown without disposing the registry", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      yield* runtime.shutdown("logout");
      yield* runtime.shutdown("logout");
      expect((yield* runtime.state).closed).toBe(true);
      expect(registry.get(runtime.stateAtom).closed).toBe(true);

      const leaseScope = yield* Scope.make();
      const result = yield* runtime
        .acquire(topologyDescriptor)
        .pipe(Scope.provide(leaseScope), Effect.result);
      expect(result._tag).toBe("Failure");
      yield* Scope.close(leaseScope, Exit.void);
      registry.dispose();
    }),
  );

  it.effect("keeps required topology observing when optional current metrics fail", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness({ failCurrentMetrics: true });
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const requiredScope = yield* Scope.make();
      const optionalScope = yield* Scope.make();
      const required = yield* runtime
        .acquire(topologyDescriptor)
        .pipe(Scope.provide(requiredScope));
      const optional = yield* runtime
        .acquire({ kind: "project-current-metrics", project: topologyDescriptor.project })
        .pipe(Scope.provide(optionalScope));

      const settled = yield* waitForState(states, (state) => {
        const requiredState = state.interests.get(required.interest)?.interest.status;
        const optionalState = state.interests.get(optional.interest)?.interest.status;
        return requiredState === "observing" && optionalState === "failed";
      });
      expect(settled.interests.get(required.interest)?.required).toBe(true);
      expect(settled.interests.get(optional.interest)?.required).toBe(false);
      expect(settled.interests.get(required.interest)?.interest.status).toBe("observing");

      yield* runtime.shutdown("application-close");
      yield* Scope.close(requiredScope, Exit.void);
      yield* Scope.close(optionalScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect(
    "admits project-scoped continuation writes after an organization-authorized create",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const executed: string[] = [];
        const created = {
          id: "created-project",
          clientId: "org-a",
          name: "Created",
          status: "ACTIVE",
        };
        const base = makeAdapterHarness();
        const adapter: ZeropsDataAdapter = {
          ...base.adapter,
          execute: (command) => {
            executed.push(command.kind);
            switch (command.kind) {
              case "create-project":
                return Effect.succeed({
                  processRefs: [],
                  observations: [],
                  result: { kind: command.kind, value: created },
                });
              case "import-development-container":
                return Effect.succeed({
                  processRefs: [],
                  observations: [],
                  result: { kind: command.kind, value: { serviceName: "zcp" } },
                });
              case "import-services":
                return Effect.succeed({
                  processRefs: [],
                  observations: [],
                  result: { kind: command.kind, value: undefined },
                });
              case "import-project":
                return Effect.succeed({
                  processRefs: [],
                  observations: [],
                  result: { kind: command.kind, value: { projectId: "imported-project" } },
                });
              default:
                return Effect.die(`unexpected command ${command.kind}`);
            }
          },
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          initialAccess: {
            status: "verified",
            account: runtimeScope.account,
            accountEpoch: runtimeScope.epoch,
            verifiedAtMs: 0,
            deadlineMs: 10_000,
            mutationsAllowed: true,
            organizations: [
              { organization: topologyDescriptor.project.organization, mutationsAllowed: true },
            ],
            projects: [],
          },
        });
        expect(registry.get(runtime.reads.access)).toMatchObject({
          status: "verified",
          projects: [],
        });
        const unsubscribeAccess = registry.subscribe(runtime.reads.access, () => undefined);

        const creation = yield* runtime.commands.createProject({
          organization: topologyDescriptor.project.organization,
          name: created.name,
          tagList: [],
        });
        const createdRef: ProjectRef = {
          kind: "project",
          organization: topologyDescriptor.project.organization,
          projectId: ZeropsProjectId.make(creation.value.id),
        };
        expect((yield* runtime.state).access).toMatchObject({
          status: "verified",
          projects: [{ project: createdRef, role: "OWNER", mutationsAllowed: true }],
        });
        expect(registry.get(runtime.reads.access)).toMatchObject({
          status: "verified",
          projects: [{ project: createdRef, role: "OWNER", mutationsAllowed: true }],
        });

        yield* runtime.commands.importDevelopmentContainer({ project: createdRef });
        yield* runtime.commands.importServices(createdRef, "services: []");
        const imported = yield* runtime.commands.importProject(
          topologyDescriptor.project.organization,
          "project:\n  name: Imported",
        );
        const importedRef: ProjectRef = {
          kind: "project",
          organization: topologyDescriptor.project.organization,
          projectId: ZeropsProjectId.make(imported.value.projectId),
        };
        const topologyScope = yield* Scope.make();
        yield* runtime
          .acquire({ kind: "project-topology", project: importedRef, includeCurrentMetrics: false })
          .pipe(Scope.provide(topologyScope));
        expect(executed).toEqual([
          "create-project",
          "import-development-container",
          "import-services",
          "import-project",
        ]);
        const access = (yield* runtime.state).access;
        expect(
          access.status === "verified" &&
            access.projects.some((entry) => entry.project.projectId === importedRef.projectId),
        ).toBe(true);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(topologyScope, Exit.void);
        unsubscribeAccess();
        registry.dispose();
      }),
  );

  it.effect("does not preserve created-project continuation access past the grant deadline", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      let writes = 0;
      const base = makeAdapterHarness();
      const adapter: ZeropsDataAdapter = {
        ...base.adapter,
        execute: (command) => {
          writes += 1;
          return command.kind === "create-project"
            ? Effect.succeed({
                processRefs: [],
                observations: [],
                result: {
                  kind: command.kind,
                  value: {
                    id: "created-project",
                    clientId: "org-a",
                    name: "Created",
                    status: "ACTIVE",
                  },
                },
              })
            : Effect.die("continuation write should not reach the adapter");
        },
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        initialAccess: {
          status: "verified",
          account: runtimeScope.account,
          accountEpoch: runtimeScope.epoch,
          verifiedAtMs: 0,
          deadlineMs: 10,
          mutationsAllowed: true,
          organizations: [
            { organization: topologyDescriptor.project.organization, mutationsAllowed: true },
          ],
          projects: [],
        },
      });
      const creation = yield* runtime.commands.createProject({
        organization: topologyDescriptor.project.organization,
        name: "Created",
        tagList: [],
      });
      yield* TestClock.adjust("10 millis");
      const continuation = yield* runtime.commands
        .importServices(
          {
            kind: "project",
            organization: topologyDescriptor.project.organization,
            projectId: ZeropsProjectId.make(creation.value.id),
          },
          "services: []",
        )
        .pipe(Effect.result);

      expect(continuation).toMatchObject({
        _tag: "Failure",
        failure: { reason: "access-expired" },
      });
      expect(writes).toBe(1);
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("does not fabricate project access when organization create admission fails", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      let writes = 0;
      const base = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: {
          ...base.adapter,
          execute: () => {
            writes += 1;
            return Effect.die("denied create should not reach the adapter");
          },
        },
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        initialAccess: {
          status: "verified",
          account: runtimeScope.account,
          accountEpoch: runtimeScope.epoch,
          verifiedAtMs: 0,
          deadlineMs: 10_000,
          mutationsAllowed: true,
          organizations: [
            { organization: topologyDescriptor.project.organization, mutationsAllowed: false },
          ],
          projects: [],
        },
      });

      const denied = yield* runtime.commands
        .createProject({
          organization: topologyDescriptor.project.organization,
          name: "Denied",
          tagList: [],
        })
        .pipe(Effect.result);

      expect(denied).toMatchObject({ _tag: "Failure", failure: { reason: "access-denied" } });
      expect((yield* runtime.state).access).toMatchObject({ status: "verified", projects: [] });
      expect(writes).toBe(0);
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }),
  );

  it.effect("rechecks access after waiting in the serial command lane", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const firstWriteStarted = yield* Deferred.make<void>();
      const releaseFirstWrite = yield* Deferred.make<void>();
      let writes = 0;
      const base = makeAdapterHarness();
      const adapter: ZeropsDataAdapter = {
        ...base.adapter,
        execute: () => {
          writes += 1;
          return writes === 1
            ? Deferred.succeed(firstWriteStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseFirstWrite)),
                Effect.as({ processRefs: [], observations: [] }),
              )
            : Effect.succeed({ processRefs: [], observations: [] });
        },
      };
      const service: ServiceRef = {
        kind: "service",
        project: topologyDescriptor.project,
        serviceId: ZeropsServiceId.make("service-a"),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        initialAccess: {
          status: "verified",
          account: runtimeScope.account,
          accountEpoch: runtimeScope.epoch,
          verifiedAtMs: 0,
          deadlineMs: 10_000,
          mutationsAllowed: true,
          organizations: [{ organization: service.project.organization, mutationsAllowed: true }],
          projects: [{ project: service.project, role: "ADMIN", mutationsAllowed: true }],
        },
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });

      const first = yield* runtime.commands.startCommand({ kind: "restart-service", service });
      yield* Deferred.await(firstWriteStarted);
      const second = yield* runtime.commands.startCommand({ kind: "restart-service", service });
      expect((yield* runtime.state).commands.get(second.attemptId)?.status).toBe("pending");

      yield* runtime.observeAccess({
        kind: "access-expired",
        accountEpoch: runtimeScope.epoch,
        expiredAtMs: 1,
      });
      yield* waitForState(states, (state) => state.access.status === "expired");
      yield* Deferred.succeed(releaseFirstWrite, undefined);
      const rejected = yield* waitForState(
        states,
        (state) => state.commands.get(second.attemptId)?.status === "rejected",
      );
      expect(rejected.commands.get(second.attemptId)?.status).toBe("rejected");
      expect(writes).toBe(1);
      expect(rejected.commands.get(first.attemptId)?.status).not.toBe("uncertain");

      yield* runtime.shutdown("application-close");
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("rechecks access between writes inside one compound command", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const firstWriteFinished = yield* Deferred.make<void>();
      const allowSecondWrite = yield* Deferred.make<void>();
      let writes = 0;
      const base = makeAdapterHarness();
      const adapter: ZeropsDataAdapter = {
        ...base.adapter,
        execute: (command, context) =>
          Effect.gen(function* () {
            const beforeWrite = context.beforeProjectWrite;
            if (beforeWrite === undefined) return yield* Effect.die("missing write guard");
            const checked = () =>
              Effect.tryPromise({
                try: beforeWrite,
                catch: (cause: unknown): AdapterError => ({
                  _tag: "ZeropsDataAdapterError",
                  kind: "rejected",
                  message:
                    typeof cause === "object" && cause !== null && "message" in cause
                      ? String(cause.message)
                      : "write rejected",
                  retryable: false,
                  accountRevocationEvidence: false,
                }),
              });
            yield* checked();
            writes += 1;
            yield* Deferred.succeed(firstWriteFinished, undefined);
            yield* Deferred.await(allowSecondWrite);
            yield* checked();
            writes += 1;
            return {
              processRefs: [],
              observations: [],
            };
          }),
      };
      const service: ServiceRef = {
        kind: "service",
        project: topologyDescriptor.project,
        serviceId: ZeropsServiceId.make("service-a"),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        initialAccess: {
          status: "verified",
          account: runtimeScope.account,
          accountEpoch: runtimeScope.epoch,
          verifiedAtMs: 0,
          deadlineMs: 10_000,
          mutationsAllowed: true,
          organizations: [{ organization: service.project.organization, mutationsAllowed: true }],
          projects: [{ project: service.project, role: "ADMIN", mutationsAllowed: true }],
        },
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const attempt = yield* runtime.commands.startCommand({
        kind: "enable-zerops-mate",
        service,
      });
      yield* Deferred.await(firstWriteFinished);
      yield* runtime.observeAccess({
        kind: "access-expired",
        accountEpoch: runtimeScope.epoch,
        expiredAtMs: 1,
      });
      yield* waitForState(states, (state) => state.access.status === "expired");
      yield* Deferred.succeed(allowSecondWrite, undefined);
      yield* waitForState(
        states,
        (state) => state.commands.get(attempt.attemptId)?.status === "rejected",
      );

      expect(writes).toBe(1);
      expect((yield* runtime.state).commands.get(attempt.attemptId)?.status).toBe("rejected");

      yield* runtime.shutdown("application-close");
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("fences late callbacks when a reused adapter serves a new account epoch", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const oldStarted = yield* Deferred.make<void>();
      let resolveOld!: () => void;
      const oldResponse = new Promise<void>((resolve) => {
        resolveOld = resolve;
      });
      const base = makeAdapterHarness();
      const adapter: ZeropsDataAdapter = {
        ...base.adapter,
        execute: (command) =>
          Number(command.accountEpoch) === 1
            ? Deferred.succeed(oldStarted, undefined).pipe(
                Effect.andThen(Effect.promise(() => oldResponse)),
                Effect.as({ processRefs: [], observations: [] }),
              )
            : Effect.succeed({ processRefs: [], observations: [] }),
      };
      const initialAccess = (epoch: number) => ({
        status: "verified" as const,
        account: runtimeScope.account,
        accountEpoch: AccountEpoch.make(epoch),
        verifiedAtMs: 0,
        deadlineMs: 10_000,
        mutationsAllowed: true,
        organizations: [
          { organization: topologyDescriptor.project.organization, mutationsAllowed: true },
        ],
        projects: [
          {
            project: topologyDescriptor.project,
            role: "ADMIN" as const,
            mutationsAllowed: true,
          },
        ],
      });
      const oldRuntime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        initialAccess: initialAccess(1),
      });
      const service: ServiceRef = {
        kind: "service",
        project: topologyDescriptor.project,
        serviceId: ZeropsServiceId.make("service-a"),
      };
      const oldAttempt = yield* oldRuntime.commands.startCommand({
        kind: "restart-service",
        service,
      });
      yield* Deferred.await(oldStarted);
      yield* oldRuntime.shutdown("account-replaced");

      const newRuntime = yield* makeZeropsDataRuntime({
        scope: { ...runtimeScope, epoch: AccountEpoch.make(2) },
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        initialAccess: initialAccess(2),
      });
      const newAttempt = yield* newRuntime.commands.startCommand({
        kind: "restart-service",
        service,
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      resolveOld();
      yield* Effect.yieldNow;

      expect(oldAttempt.attemptId).toBe(newAttempt.attemptId);
      expect((yield* oldRuntime.state).commands.size).toBe(0);
      expect((yield* oldRuntime.state).closed).toBe(true);
      expect((yield* newRuntime.state).commands.get(newAttempt.attemptId)?.status).toBe("accepted");
      yield* newRuntime.shutdown("application-close");
      registry.dispose();
    }),
  );

  it.effect("pauses hidden receivers and establishes fresh generations on foreground", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const visibilityState = yield* Ref.make<"visible" | "hidden">("visible");
      const visibilityChanges = yield* Queue.unbounded<"visible" | "hidden">();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          hiddenReceiverPauseAfterMs: 100,
        }),
        visibility: {
          current: Ref.get(visibilityState),
          changes: Stream.fromQueue(visibilityChanges),
        },
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      const first = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const firstIdentity = first.interests.get(lease.interest)!.interest.identity;

      yield* Ref.set(visibilityState, "hidden");
      yield* Queue.offer(visibilityChanges, "hidden");
      yield* TestClock.adjust("99 millis");
      expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe(
        "observing",
      );
      yield* TestClock.adjust("1 millis");
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "paused",
      );
      expect(harness.counts().closes).toBe(1);

      yield* Ref.set(visibilityState, "visible");
      yield* Queue.offer(visibilityChanges, "visible");
      const recovered = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const nextIdentity = recovered.interests.get(lease.interest)!.interest.identity;
      expect(nextIdentity.receiver.receiverEpoch).toBeGreaterThan(
        firstIdentity.receiver.receiverEpoch,
      );
      expect(nextIdentity.interestEpoch).toBeGreaterThan(firstIdentity.interestEpoch);
      expect(harness.counts().opens).toBe(2);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("keeps a healthy receiver push-driven across repeated former repair intervals", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) =>
        Queue.offerUnsafe(states, state),
      );
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const initial = harness.counts();
      yield* TestClock.adjust("5 minutes");
      // An ingestion receipt also proves all clock-triggered work has crossed the worker.
      yield* runtime.observeAccess({
        kind: "access-verification-started",
        accountEpoch: runtimeScope.epoch,
      });
      expect(harness.counts()).toEqual(initial);
      expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe(
        "observing",
      );
      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("renews the retry budget after each successful reconnect with fresh generations", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const opened = yield* Queue.unbounded<{
        readonly handle: ReceiverHandle;
        readonly events: Queue.Queue<import("./types.ts").ReceiverEvent>;
      }>();
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) =>
          Effect.gen(function* () {
            const events = yield* Queue.unbounded<import("./types.ts").ReceiverEvent>();
            const handle: ReceiverHandle = {
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            };
            yield* Queue.offer(opened, { handle, events });
            return handle;
          }),
        register: () => Effect.succeed({ responseObservations: [] }),
        read: () => Effect.succeed({ observations: [] }),
        execute: () => Effect.succeed({ processRefs: [], observations: [] }),
        closeReceiver: () => Effect.void,
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          recoveryAttemptLimit: 2,
          recoveryBackoffStartMs: 10,
          recoveryBackoffMaxMs: 10,
        }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      const firstReceiver = yield* Queue.take(opened);
      const firstObserved = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const firstIdentity = firstObserved.interests.get(lease.interest)!.interest.identity;

      let receiver = firstReceiver;
      for (let incident = 0; incident < 3; incident++) {
        yield* Queue.offer(receiver.events, { kind: "closed", reason: "test disconnect" });
        const recovering = yield* waitForState(states, (state) => {
          const status = state.interests.get(lease.interest)?.interest.status;
          return status === "recovering" || status === "failed";
        });
        expect(recovering.interests.get(lease.interest)?.interest.status).toBe("recovering");
        yield* Effect.yieldNow;
        yield* TestClock.adjust("1 second");
        receiver = yield* Queue.take(opened);
        const recovered = yield* waitForState(states, (state) => {
          const interest = state.interests.get(lease.interest)?.interest;
          return (
            interest?.status === "observing" &&
            interest.identity.receiver.receiverId === receiver.handle.identity.receiverId
          );
        });
        const nextIdentity = recovered.interests.get(lease.interest)!.interest.identity;
        expect(nextIdentity.receiver.receiverEpoch).toBeGreaterThan(
          firstIdentity.receiver.receiverEpoch,
        );
        expect(nextIdentity.interestEpoch).toBeGreaterThan(firstIdentity.interestEpoch);
        expect(nextIdentity.receiver.receiverId).not.toBe(firstIdentity.receiver.receiverId);
      }

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("exhausts repeated receiver failures into an explicit failed interest", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      let opens = 0;
      const adapter: ZeropsDataAdapter = {
        openReceiver: () => {
          opens += 1;
          return Effect.fail({
            _tag: "ZeropsDataAdapterError",
            kind: "socket-open",
            message: "offline",
            retryable: true,
            accountRevocationEvidence: false,
          });
        },
        register: () => Effect.succeed({ responseObservations: [] }),
        read: () => Effect.succeed({ observations: [] }),
        execute: () => Effect.succeed({ processRefs: [], observations: [] }),
        closeReceiver: () => Effect.void,
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          recoveryAttemptLimit: 2,
          recoveryBackoffStartMs: 10,
          recoveryBackoffMaxMs: 10,
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("10 millis");
      yield* Effect.yieldNow;
      yield* TestClock.adjust("10 millis");
      yield* Effect.yieldNow;

      const interest = (yield* runtime.state).interests.get(lease.interest)?.interest;
      expect(interest?.status).toBe("failed");
      expect(interest?.status === "failed" ? interest.attempts : null).toBe(3);
      expect(opens).toBe(3);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      registry.dispose();
    }),
  );

  it.effect(
    "does not let a stale scheduleFailedRetry fiber fire a second establishment after acquire retries a failed interest",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        let opens = 0;
        let reads = 0;
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) => {
            opens += 1;
            if (opens <= 3) {
              return Effect.fail({
                _tag: "ZeropsDataAdapterError",
                kind: "socket-open",
                message: "offline",
                retryable: true,
                accountRevocationEvidence: false,
              });
            }
            return Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.never,
            });
          },
          register: () => Effect.succeed({ responseObservations: [] }),
          read: () => {
            reads += 1;
            return Effect.succeed({ observations: [] });
          },
          execute: () => Effect.succeed({ processRefs: [], observations: [] }),
          closeReceiver: () => Effect.void,
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({
            recoveryAttemptLimit: 2,
            recoveryBackoffStartMs: 10,
            recoveryBackoffMaxMs: 10,
          }),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });

        // Fail three times to reach "failed" (limit 2), same as the sibling test above.
        // scheduleFailedRetry is now sleeping toward that failure's own retryAtMs.
        const firstLeaseScope = yield* Scope.make();
        const firstLease = yield* runtime
          .acquire(topologyDescriptor)
          .pipe(Scope.provide(firstLeaseScope));
        yield* Effect.yieldNow;
        yield* TestClock.adjust("10 millis");
        yield* Effect.yieldNow;
        yield* TestClock.adjust("10 millis");
        yield* waitForState(
          states,
          (state) => state.interests.get(firstLease.interest)?.interest.status === "failed",
        );
        expect(opens).toBe(3);

        // A second acquire (a fresh lessee, or the same one retrying) retries the failed
        // interest immediately, well before the old scheduleFailedRetry fiber's own
        // retryAtMs elapses. Its open (opens #4) succeeds.
        const secondLeaseScope = yield* Scope.make();
        const secondLease = yield* runtime
          .acquire(topologyDescriptor)
          .pipe(Scope.provide(secondLeaseScope));
        expect(secondLease.interest).toBe(firstLease.interest);
        const observing = yield* waitForState(
          states,
          (state) => state.interests.get(firstLease.interest)?.interest.status === "observing",
        );
        expect(opens).toBe(4);
        const identityAfterAcquireRetry = observing.interests.get(firstLease.interest)!.interest
          .identity;
        const readsAfterObserving = reads;

        // Advance well past the original failure's retryAtMs (10ms backoff from when it
        // failed). If the stale scheduleFailedRetry fiber still matched the (unchanged)
        // identity, it would fire a second, concurrent establishInterest here — harmless
        // for opening the receiver (already open) and registering (already registered,
        // deduped by key), but it would still redo the interest's direct reads.
        yield* TestClock.adjust("50 millis");
        for (let i = 0; i < 20; i++) yield* Effect.yieldNow;

        expect(opens).toBe(4);
        expect(reads).toBe(readsAfterObserving);
        const settled = yield* runtime.state;
        expect(settled.interests.get(firstLease.interest)?.interest.status).toBe("observing");
        expect(settled.interests.get(firstLease.interest)?.interest.identity).toEqual(
          identityAfterAcquireRetry,
        );

        yield* runtime.shutdown("application-close");
        yield* Scope.close(firstLeaseScope, Exit.void);
        yield* Scope.close(secondLeaseScope, Exit.void);
        unsubscribe();
        registry.dispose();
      }),
  );

  it.effect(
    "retries a low-attempt interest on its own backoff without replacing the receiver while a higher-attempt sibling is not yet due",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        let opens = 0;
        let closes = 0;
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) => {
            opens += 1;
            if (opens <= 3) {
              return Effect.fail({
                _tag: "ZeropsDataAdapterError",
                kind: "socket-open",
                message: "offline",
                retryable: true,
                accountRevocationEvidence: false,
              });
            }
            return Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.never,
            });
          },
          register: () => Effect.succeed({ responseObservations: [] }),
          read: () => Effect.succeed({ observations: [] }),
          execute: () => Effect.succeed({ processRefs: [], observations: [] }),
          closeReceiver: () =>
            Effect.sync(() => {
              closes += 1;
            }),
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({
            recoveryAttemptLimit: 10,
            recoveryBackoffStartMs: 10,
            recoveryBackoffMaxMs: 1000,
          }),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });

        // Topology fails twice on its own (opens #1 and #2), reaching attempt 2 with a
        // 20ms backoff (10 * 2^1), all before activity ever shows up.
        const topologyScope = yield* Scope.make();
        const topology = yield* runtime
          .acquire(topologyDescriptor)
          .pipe(Scope.provide(topologyScope));
        yield* waitForState(states, (state) => {
          const interest = state.interests.get(topology.interest)?.interest;
          return interest?.status === "recovering" && interest.attempt === 1;
        });
        yield* TestClock.adjust("10 millis");
        // "attempt 2" is published twice in quick succession here: once immediately by
        // markRecovering (display-only, on the still-old receiver identity), and again
        // moments later once the failure's own prepareCycle actually replaces the
        // receiver. Settle past both before reading the receiver identity that matters.
        yield* waitForState(states, (state) => {
          const interest = state.interests.get(topology.interest)?.interest;
          return interest?.status === "recovering" && interest.attempt === 2;
        });
        for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
        const settledAfterSecondFailure = yield* runtime.state;
        const topologyReceiverBeforeWait = settledAfterSecondFailure.interests.get(
          topology.interest,
        )!.interest.identity.receiver.receiverId;
        const opensBeforeActivity = opens;
        const closesBeforeActivity = closes;

        // Activity joins now, sharing the same (still-current) receiver. Its own open
        // (opens #3) also fails, putting it at attempt 1 with a 10ms backoff — due well
        // before topology's own attempt-2 backoff (already elapsed once, next at +20ms
        // from a *later* start).
        const activityScope = yield* Scope.make();
        const activity = yield* runtime
          .acquire({ kind: "project-activity", project: topologyDescriptor.project })
          .pipe(Scope.provide(activityScope));
        yield* waitForState(states, (state) => {
          const interest = state.interests.get(activity.interest)?.interest;
          return interest?.status === "recovering" && interest.attempt === 1;
        });

        // Advance only to activity's own due time. Topology's attempt must stay at 2 (no
        // extra bump from a receiver replacement it had no part in), and the receiver
        // itself must not have been replaced or closed again while only activity was due.
        yield* TestClock.adjust("10 millis");
        yield* waitForState(
          states,
          (state) => state.interests.get(activity.interest)?.interest.status === "observing",
        );
        const afterActivityRetry = yield* runtime.state;
        const topologyAfterActivityRetry = afterActivityRetry.interests.get(
          topology.interest,
        )!.interest;
        expect(topologyAfterActivityRetry.status).toBe("recovering");
        expect(
          topologyAfterActivityRetry.status === "recovering"
            ? topologyAfterActivityRetry.attempt
            : null,
        ).toBe(2);
        // Same receiver *object* throughout: activity retrying its own connection over
        // it (raising `opens`) is expected, but nothing closed or replaced it on
        // topology's behalf while topology itself stayed undue.
        expect(topologyAfterActivityRetry.identity.receiver.receiverId).toBe(
          topologyReceiverBeforeWait,
        );
        expect(opens).toBeGreaterThan(opensBeforeActivity);
        expect(closes).toBe(closesBeforeActivity);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(topologyScope, Exit.void);
        yield* Scope.close(activityScope, Exit.void);
        unsubscribe();
        registry.dispose();
      }),
  );

  it.effect(
    "retries a failed interest on its backoff timer and resets the attempt budget (B4)",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        let opens = 0;
        const events = yield* Queue.unbounded<ReceiverEvent>();
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) => {
            opens += 1;
            if (opens <= 3) {
              return Effect.fail({
                _tag: "ZeropsDataAdapterError",
                kind: "socket-open",
                message: "offline",
                retryable: true,
                accountRevocationEvidence: false,
              });
            }
            return Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            } satisfies ReceiverHandle);
          },
          register: () => Effect.succeed({ responseObservations: [] }),
          read: () => Effect.succeed({ observations: [] }),
          execute: () => Effect.succeed({ processRefs: [], observations: [] }),
          closeReceiver: () => Effect.void,
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({
            recoveryAttemptLimit: 2,
            recoveryBackoffStartMs: 10,
            recoveryBackoffMaxMs: 10,
          }),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });
        const leaseScope = yield* Scope.make();
        const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
        yield* Effect.yieldNow;
        yield* TestClock.adjust("10 millis");
        yield* Effect.yieldNow;
        yield* TestClock.adjust("10 millis");
        yield* Effect.yieldNow;

        const failed = (yield* runtime.state).interests.get(lease.interest)?.interest;
        expect(failed?.status).toBe("failed");
        expect(failed?.status === "failed" ? failed.retryable : null).toBe(true);
        expect(failed?.status === "failed" ? failed.retryAtMs : null).not.toBeNull();
        expect(opens).toBe(3);

        // Advancing the clock past the published retry deadline re-establishes the
        // interest without a new lease or foreground transition.
        yield* TestClock.adjust("10 millis");
        const recovered = yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        expect(recovered.interests.get(lease.interest)?.interest.status).toBe("observing");
        expect(opens).toBe(4);

        // A later failure starts its own attempt budget fresh: it does not immediately
        // re-fail from `recoveryAttempts` left over by the previous failed cycle.
        yield* Queue.offer(events, { kind: "closed", reason: "post-recovery disconnect" });
        const afterDisconnect = yield* waitForState(states, (state) => {
          const status = state.interests.get(lease.interest)?.interest.status;
          return status === "recovering" || status === "failed";
        });
        expect(afterDisconnect.interests.get(lease.interest)?.interest.status).toBe("recovering");

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        unsubscribe();
        registry.dispose();
      }),
  );

  it.effect("bounds the complete multi-stage interest establishment attempt", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      let registrations = 0;
      const base = makeAdapterHarness();
      const adapter: ZeropsDataAdapter = {
        ...base.adapter,
        register: () => {
          registrations += 1;
          return Effect.sleep("40 millis").pipe(Effect.as({ responseObservations: [] }));
        },
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          registrationDeadlineMs: 80,
          establishmentDeadlineMs: 100,
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");
      yield* Effect.yieldNow;

      expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe(
        "recovering",
      );
      expect(registrations).toBe(3);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      registry.dispose();
    }),
  );

  it.effect("marks overflow before discard and recovers through a fresh receiver", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const opened = yield* Queue.unbounded<{
        readonly handle: ReceiverHandle;
        readonly events: Queue.Queue<ReceiverEvent>;
      }>();
      const registrations: RegistrationRequest[] = [];
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) =>
          Effect.gen(function* () {
            const events = yield* Queue.unbounded<ReceiverEvent>();
            const handle: ReceiverHandle = {
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            };
            yield* Queue.offer(opened, { handle, events });
            return handle;
          }),
        register: (_receiver, request) =>
          Effect.sync(() => {
            registrations.push(request);
            return { responseObservations: [] };
          }),
        read: () => Effect.succeed({ observations: [] }),
        execute: () => Effect.succeed({ processRefs: [], observations: [] }),
        closeReceiver: () => Effect.void,
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          ingressMaxEventsPerAccount: 8,
          ingressMaxBytesPerAccount: 100,
          ingressMaxFrameBytes: 10,
          recoveryBackoffStartMs: 10,
          recoveryBackoffMaxMs: 10,
        }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      const firstReceiver = yield* Queue.take(opened);
      const firstObserved = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const firstIdentity = firstObserved.interests.get(lease.interest)!.interest.identity;
      const serviceRegistration = registrations.find(
        (request) =>
          request.descriptor.kind === "entity-updates" && request.descriptor.entity === "service",
      )!;
      const observation: PlatformObservation = {
        kind: "service-lifecycle-observed",
        ref: {
          kind: "service",
          project: topologyDescriptor.project,
          serviceId: ZeropsServiceId.make("service-overflow"),
        },
        observation: {
          source: "native-push",
          registration: serviceRegistration as Extract<
            RegistrationRequest,
            {
              readonly descriptor: {
                readonly kind: "entity-updates";
                readonly entity: "service";
              };
            }
          >,
          fields: { status: "RUNNING", updatedAt: null },
          metadata: {},
        },
      };
      yield* Queue.offer(firstReceiver.events, {
        kind: "observation",
        input: observation,
        bytes: 11,
      });
      const recovering = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "recovering",
      );
      expect(recovering.interests.get(lease.interest)?.interest.status).toBe("recovering");
      expect((yield* runtime.ingress).discardedEvents).toBe(1);

      yield* TestClock.adjust("10 millis");
      const secondReceiver = yield* Queue.take(opened);
      const recovered = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      expect(
        recovered.interests.get(lease.interest)!.interest.identity.receiver.receiverEpoch,
      ).toBeGreaterThan(firstIdentity.receiver.receiverEpoch);
      expect(secondReceiver.handle.identity.receiverId).not.toBe(
        firstReceiver.handle.identity.receiverId,
      );

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("never drops an access-expired control input on ingress overflow (B2)", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const opened = yield* Queue.unbounded<{
        readonly handle: ReceiverHandle;
        readonly events: Queue.Queue<ReceiverEvent>;
      }>();
      const base = makeAdapterHarness();
      const adapter: ZeropsDataAdapter = {
        ...base.adapter,
        openReceiver: (_scope, organization, identity) =>
          Effect.gen(function* () {
            const events = yield* Queue.unbounded<ReceiverEvent>();
            const handle: ReceiverHandle = {
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            };
            yield* Queue.offer(opened, { handle, events });
            return handle;
          }),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        initialAccess: {
          status: "verified",
          account: runtimeScope.account,
          accountEpoch: runtimeScope.epoch,
          verifiedAtMs: 0,
          deadlineMs: 10_000,
          mutationsAllowed: true,
          organizations: [],
          projects: [],
        },
        policy: makeZeropsDataPolicy({ ingressMaxEventsPerAccount: 8 }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      const receiver = yield* Queue.take(opened);
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );

      const observingIdentity = (yield* runtime.state).interests.get(lease.interest)!.interest
        .identity;
      const unrelated = (n: number): PlatformObservation =>
        ({
          kind: "entity-unavailable",
          ref: {
            kind: "service",
            project: topologyDescriptor.project,
            serviceId: ZeropsServiceId.make(`service-flood-${n}`),
          },
          reason: "not-found",
          ticket: {
            requestId: `flood-${n}`,
            owner: { kind: "interest", identity: observingIdentity },
            receiptOrdinalAtStart: 0,
            readStartOrdinal: 0,
            dispatchOrdinal: 0,
            startedAtMs: 0,
            kind: "direct",
            target: {
              kind: "service",
              ref: {
                kind: "service",
                project: topologyDescriptor.project,
                serviceId: ZeropsServiceId.make(`service-flood-${n}`),
              },
            },
          },
        }) as unknown as PlatformObservation;
      for (let n = 0; n < 20; n++) {
        yield* Queue.offer(receiver.events, { kind: "observation", input: unrelated(n), bytes: 4 });
      }
      yield* Effect.yieldNow;
      yield* runtime.observeAccess({
        kind: "access-expired",
        accountEpoch: runtimeScope.epoch,
        expiredAtMs: 1,
      });
      expect((yield* runtime.ingress).discardedEvents).toBeGreaterThan(0);
      expect((yield* runtime.state).access.status).toBe("expired");

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect(
    "closes a receiver socket whose openReceiver resolves after background pause replaced it (B3)",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        let opens = 0;
        const closedIdentities: string[] = [];
        const openedOnce = yield* Deferred.make<void>();
        const openGate = yield* Deferred.make<void>();
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) =>
            Effect.gen(function* () {
              opens += 1;
              if (opens === 1) {
                yield* Deferred.succeed(openedOnce, undefined);
                yield* Deferred.await(openGate);
              }
              return {
                identity,
                organization,
                delivery: "hot-single-consumer-buffered-before-open-resolves",
                events: Stream.never,
              } satisfies ReceiverHandle;
            }),
          register: () => Effect.succeed({ responseObservations: [] }),
          read: () => Effect.succeed({ observations: [] }),
          execute: () => Effect.succeed({ processRefs: [], observations: [] }),
          closeReceiver: (handle) =>
            Effect.sync(() => {
              closedIdentities.push(handle.identity.receiverId);
            }),
        };
        const visibilityState = yield* Ref.make<"visible" | "hidden">("visible");
        const visibilityChanges = yield* Queue.unbounded<"visible" | "hidden">();
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({ hiddenReceiverPauseAfterMs: 100 }),
          visibility: {
            current: Ref.get(visibilityState),
            changes: Stream.fromQueue(visibilityChanges),
          },
        });
        const leaseScope = yield* Scope.make();
        const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));

        // The interest's `openReceiver` call is now blocked inside the adapter.
        yield* Deferred.await(openedOnce);
        expect(opens).toBe(1);

        // A background pause races the in-flight open: it replaces the receiver map entry
        // (still `handle === null` from the pause's point of view) while the open is stuck.
        yield* Ref.set(visibilityState, "hidden");
        yield* Queue.offer(visibilityChanges, "hidden");
        yield* TestClock.adjust("99 millis");
        yield* TestClock.adjust("1 millis");
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe(
          "paused",
        );

        // The stale open now resolves. It must be closed immediately, never adopted.
        yield* Deferred.succeed(openGate, undefined);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(closedIdentities.length).toBe(1);
        expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe(
          "paused",
        );

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        registry.dispose();
      }),
  );
});

it.effect(
  "admits each shared native fact once across 26 topology interests and owner release",
  () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const events = yield* Queue.unbounded<ReceiverEvent>();
      let received = yield* Deferred.make<void>();
      const registrations = new Map<RegistrationRequest["subscriptionName"], RegistrationRequest>();
      const base = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        adapter: {
          ...base.adapter,
          openReceiver: (_scope, organization, identity) =>
            Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events).pipe(
                Stream.tap((event) =>
                  event.kind === "pong" ? Deferred.succeed(received, undefined) : Effect.void,
                ),
              ),
            }),
          register: (_handle, request) =>
            Effect.sync(() => {
              registrations.set(request.subscriptionName, request);
              return { responseObservations: [] };
            }),
        },
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const ownerScope = yield* Scope.make();
      const remainingScope = yield* Scope.make();
      for (let i = 0; i < 26; i++) {
        yield* runtime
          .acquire({
            kind: "project-topology",
            project: project(`project-${i}`),
            includeCurrentMetrics: false,
          })
          .pipe(Scope.provide(i === 0 ? ownerScope : remainingScope));
      }
      yield* waitForState(
        states,
        (state) =>
          state.interests.size === 26 &&
          [...state.interests.values()].every(({ interest }) => interest.status === "observing"),
      );
      const request = [...registrations.values()].find(
        (entry) =>
          entry.descriptor.kind === "entity-updates" && entry.descriptor.entity === "service",
      )!;
      expect(
        [...registrations.values()].filter(
          (entry) =>
            entry.descriptor.kind === "entity-updates" && entry.descriptor.entity === "service",
        ),
      ).toHaveLength(1);
      const ref: ServiceRef = {
        kind: "service",
        project: project("project-1"),
        serviceId: ZeropsServiceId.make("service-1"),
      };
      const { decodeNativeFrame } = yield* Effect.promise(() => import("./platformProtocol.ts"));
      for (const status of ["ACTIVE", "STOPPED"]) {
        received = yield* Deferred.make<void>();
        const raw = yield* encodeTestFrame({
          type: "search",
          subscriptionName: request.subscriptionName,
          data: {
            update: [{ id: ref.serviceId, projectId: ref.project.projectId, name: "app", status }],
          },
        });
        const decoded = decodeNativeFrame(raw, registrations);
        expect(decoded.kind).toBe("observations");
        if (decoded.kind !== "observations") throw new Error("Expected a native observation");
        const before = Number((yield* runtime.state).lastReceiptOrdinal);
        for (const [index, input] of decoded.observations.entries()) {
          yield* Queue.offer(events, {
            kind: "observation",
            input,
            bytes: index === 0 ? raw.length : 0,
          });
        }
        yield* Queue.offer(events, { kind: "pong" });
        yield* Deferred.await(received);
        // Access receipts cross the same serialized ingress after the source has delivered its frame.
        yield* runtime.observeAccess({
          kind: "access-verification-started",
          accountEpoch: runtimeScope.epoch,
        });
        expect(Number((yield* runtime.state).lastReceiptOrdinal) - before - 1).toBe(
          decoded.observations.length,
        );
        const service = registry.get(runtime.reads.service(ref)).value;
        expect(service.knowledge).toBe("observed");
        if (service.knowledge === "observed" && service.record.lifecycle.knowledge === "observed")
          expect(service.record.lifecycle.fields.status).toBe(status);
        yield* Scope.close(ownerScope, Exit.void);
      }
      let publications = 0;
      const stopCounting = registry.subscribe(runtime.stateAtom, () => {
        publications++;
      });
      received = yield* Deferred.make<void>();
      const burst = yield* encodeTestFrame({
        type: "search",
        subscriptionName: request.subscriptionName,
        data: {
          update: Array.from({ length: 100 }, (_, index) => ({
            id: `burst-${index}`,
            projectId: ref.project.projectId,
            name: `app-${index}`,
            status: "ACTIVE",
          })),
        },
      });
      const decodedBurst = decodeNativeFrame(burst, registrations);
      if (decodedBurst.kind !== "observations") throw new Error("Expected a native burst");
      const beforeBurst = Number((yield* runtime.state).lastReceiptOrdinal);
      for (const [index, input] of decodedBurst.observations.entries()) {
        yield* Queue.offer(events, {
          kind: "observation",
          input,
          bytes: index === 0 ? burst.length : 0,
        });
      }
      yield* Queue.offer(events, { kind: "pong" });
      yield* Deferred.await(received);
      yield* runtime.observeAccess({
        kind: "access-verification-started",
        accountEpoch: runtimeScope.epoch,
      });
      expect(Number((yield* runtime.state).lastReceiptOrdinal) - beforeBurst - 1).toBe(
        decodedBurst.observations.length,
      );
      expect((yield* runtime.state).inventory.services.size).toBe(101);
      expect(registry.get(runtime.stateAtom)).toBe(yield* runtime.state);
      expect(publications).toBeLessThan(30);
      stopCounting();
      yield* runtime.shutdown("application-close");
      yield* Scope.close(remainingScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
);

it.effect("reconciles open logs on runtime access denial and the injected deadline", () =>
  Effect.gen(function* () {
    for (const reason of ["denial", "deadline"] as const) {
      const registry = AtomRegistry.make();
      const ref = project("project-a");
      let closes = 0;
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: makeAdapterHarness().adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        initialAccess: {
          status: "verified",
          account: runtimeScope.account,
          accountEpoch: runtimeScope.epoch,
          verifiedAtMs: reason === "denial" ? 0 : 100,
          deadlineMs: reason === "denial" ? 100 : 200,
          mutationsAllowed: true,
          organizations: [{ organization: ref.organization, mutationsAllowed: true }],
          projects: [{ project: ref, role: "OWNER", mutationsAllowed: true }],
        },
        buildLogTransport: {
          loadPage: async () => ({
            lines: [{ id: "line", at: "2026-09-08T00:00:00Z", text: "test line", severity: 6 }],
            rejectedItems: 0,
          }),
          openFollow: async () => ({
            close: () => {
              closes++;
            },
          }),
          shutdown: () => undefined,
          diagnostics: () => ({ activeFollowers: 0, closed: false }),
        },
      });
      const lease = runtime.logs.acquire(
        ref,
        { buildServiceStackId: "build", appVersionId: "version" },
        { follow: true },
      );
      yield* Effect.promise(() => runtime.logs.drain());
      expect(lease.session.getSnapshot().lines).toHaveLength(1);
      if (reason === "denial")
        yield* runtime.observeAccess({
          kind: "access-denied",
          accountEpoch: runtimeScope.epoch,
          scope: { kind: "project", project: ref },
          deniedAtMs: 0,
        });
      yield* TestClock.adjust("100 millis");
      expect(lease.session.getSnapshot()).toMatchObject({ lines: [], error: "access" });
      expect(closes).toBe(1);
      expect(runtime.logs.diagnostics().activeSessions).toBe(0);
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }
  }),
);

describe("inventory demand", () => {
  it("does not register process feeds or process searches for unopened projects", () => {
    const plans = [
      planZeropsInterest({
        kind: "organization-inventory",
        organization: project("p").organization,
      }),
      planZeropsInterest({ kind: "project-inventory", project: project("p") }),
    ];
    for (const plan of plans) {
      expect(
        plan.registrations.some(
          ({ descriptor }) =>
            descriptor.kind === "entity-updates" && descriptor.entity === "process",
        ),
      ).toBe(false);
      expect(
        plan.registrations.some(
          ({ descriptor }) =>
            descriptor.kind === "query-membership" &&
            descriptor.query.kind === "running-processes-of-project",
        ),
      ).toBe(false);
    }
    const inventory = plans[1]!;
    expect(
      inventory.registrations.some(
        ({ descriptor }) => descriptor.kind === "entity-updates" && descriptor.entity === "service",
      ),
    ).toBe(true);
    expect(
      inventory.registrations.some(
        ({ descriptor }) =>
          descriptor.kind === "query-membership" && descriptor.query.kind === "services-of-project",
      ),
    ).toBe(true);
    const topology = planZeropsInterest(topologyDescriptor);
    expect(
      topology.registrations.some(
        ({ descriptor }) =>
          descriptor.kind === "query-membership" &&
          descriptor.query.kind === "running-processes-of-project",
      ),
    ).toBe(true);
    expect(
      interestKeyOf({ kind: "project-inventory", project: topologyDescriptor.project }),
    ).not.toBe(interestKeyOf(topologyDescriptor));
  });
});

it.effect("anchors a renewed service inventory with a direct collection despite stale search", () =>
  Effect.gen(function* () {
    const { decodeRegistrationResponse, decodeEntityQueryPages } = yield* Effect.promise(
      () => import("./platformProtocol.ts"),
    );
    const registry = AtomRegistry.make();
    const states = yield* Queue.unbounded<ZeropsDataState>();
    const base = makeAdapterHarness();
    const ref: ServiceRef = {
      kind: "service",
      project: project("p"),
      serviceId: ZeropsServiceId.make("s"),
    };
    const row = (name: string) => ({
      id: "s",
      projectId: "p",
      name,
      status: "ACTIVE",
      created: "2026-09-01T00:00:00Z",
    });
    let currentName = "First";
    let collectionReads = 0;
    const runtime = yield* makeZeropsDataRuntime({
      scope: runtimeScope,
      atomRegistry: registry,
      makeOpaqueId: makeIdFactory(),
      adapter: {
        ...base.adapter,
        register: (_handle, request) =>
          Effect.succeed({
            responseObservations:
              request.descriptor.kind === "query-membership"
                ? decodeRegistrationResponse(request, { items: [row("Stale index")], total: 1 })
                    .observations
                : [],
          }),
        read: (ticket) =>
          Effect.sync(() => {
            if (
              ticket.target.kind !== "query" ||
              ticket.target.descriptor.kind !== "services-of-project"
            )
              return { observations: [] };
            collectionReads++;
            return {
              observations: decodeEntityQueryPages(ticket.target.descriptor, ticket, [
                { rows: [row(currentName)], totalCount: 1 },
              ]).observations,
            };
          }),
      },
    });
    const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
      Queue.offerUnsafe(states, state);
    });
    for (const name of ["First", "Changed while disconnected"]) {
      currentName = name;
      const scope = yield* Scope.make();
      const lease = yield* runtime
        .acquire({ kind: "project-inventory", project: ref.project })
        .pipe(Scope.provide(scope));
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const read = registry.get(runtime.reads.service(ref));
      expect(read.value.knowledge).toBe("observed");
      if (
        read.value.knowledge === "observed" &&
        read.value.record.identity.knowledge === "observed"
      )
        expect(read.value.record.identity.fields.hostname).toBe(name);
      yield* Scope.close(scope, Exit.void);
    }
    expect(collectionReads).toBe(2);
    yield* TestClock.adjust("5 minutes");
    expect(collectionReads).toBe(2);
    yield* runtime.shutdown("application-close");
    unsubscribe();
    registry.dispose();
  }),
);

it.effect("aborts an in-flight direct inventory baseline when its final lease is released", () =>
  Effect.gen(function* () {
    const registry = AtomRegistry.make();
    const started = yield* Deferred.make<AbortSignal>();
    const base = makeAdapterHarness();
    const runtime = yield* makeZeropsDataRuntime({
      scope: runtimeScope,
      atomRegistry: registry,
      makeOpaqueId: makeIdFactory(),
      adapter: {
        ...base.adapter,
        read: (ticket, context) =>
          ticket.target.kind === "query"
            ? Deferred.succeed(started, context.abortSignal).pipe(
                Effect.andThen(
                  Effect.callback<never, AdapterError>((resume) => {
                    const abort = () =>
                      resume(
                        Effect.fail({
                          _tag: "ZeropsDataAdapterError",
                          kind: "network",
                          message: "Cancelled",
                          retryable: false,
                          accountRevocationEvidence: false,
                        } satisfies AdapterError),
                      );
                    if (context.abortSignal.aborted) abort();
                    else context.abortSignal.addEventListener("abort", abort, { once: true });
                    return Effect.sync(() =>
                      context.abortSignal.removeEventListener("abort", abort),
                    );
                  }),
                ),
              )
            : Effect.succeed({ observations: [] }),
      },
    });
    const scope = yield* Scope.make();
    const lease = yield* runtime
      .acquire({ kind: "project-inventory", project: project("p") })
      .pipe(Scope.provide(scope));
    const signal = yield* Deferred.await(started);
    yield* lease.release;
    expect(signal.aborted).toBe(true);
    expect((yield* runtime.state).interests.has(lease.interest)).toBe(false);
    yield* Scope.close(scope, Exit.void);
    yield* runtime.shutdown("application-close");
    registry.dispose();
  }),
);
