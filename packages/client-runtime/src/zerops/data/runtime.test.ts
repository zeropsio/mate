import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Scheduler from "effect/Scheduler";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  interestKeyOf,
  planZeropsInterest,
  makeZeropsBoundedIngress,
  makeZeropsDataRuntime,
  makeZeropsPriorityPermits,
  type ZeropsBoundedIngress,
  type ZeropsPermitPriority,
} from "./runtime.ts";
import { makeZeropsDataPolicy, type ZeropsDataPolicy } from "./policy.ts";
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
  type DesiredInterestState,
  type InterestLease,
  type ProjectRef,
  type PlatformObservation,
  type ReadTicket,
  type ReceiverEvent,
  type ReceiverHandle,
  type RegistrationRequest,
  type RuntimeInterestDescriptor,
  type ServiceRef,
  type ZeropsDataAdapter,
  type ZeropsVisibility,
} from "./types.ts";
import type { ZeropsDataState } from "./state.ts";
import type { AccessVerifier } from "./access/verifier.ts";

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

  it.effect("takes an uncounted ordering marker at once when the data budget is spent", () =>
    Effect.gen(function* () {
      const ingress = yield* makeZeropsBoundedIngress({
        maxEvents: 1,
        maxBytes: 8,
        maxFrameBytes: 8,
        onOverflow: () => Effect.void,
      });

      expect(yield* ingress.offer("data", 8)).toBe(true);
      expect(yield* ingress.offerUncounted("barrier")).toBe(true);
      expect(yield* ingress.take).toBe("data");
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

  // Measured on mate.zerops.io (pass 31, 2026-10-02): a creation's burst left the queue holding
  // 2047 counted events and one marker; an admitted offer waited for room holding admission, a
  // marker took the room the consumer freed, and the consumer then waited for admission —
  // no input was applied again until the page reloaded.
  it.effect("drains every input when markers and counted data compete for the last room", () =>
    Effect.gen(function* () {
      const ingress = yield* makeZeropsBoundedIngress({
        maxEvents: 2,
        maxBytes: 100,
        maxFrameBytes: 100,
        onOverflow: () => Effect.void,
      });

      expect(yield* ingress.offer("a", 1)).toBe(true);
      expect(yield* ingress.offerUncounted("marker-1")).toBe(true);
      const marker = yield* Effect.forkChild(ingress.offerUncounted("marker-2"));
      yield* Effect.yieldNow;
      const admitted = yield* Effect.forkChild(ingress.offer("b", 1));
      yield* Effect.yieldNow;
      const consumer = yield* Effect.forkChild(Effect.forEach([1, 2, 3, 4], () => ingress.take));
      for (let tick = 0; tick < 50; tick += 1) yield* Effect.yieldNow;

      expect(consumer.pollUnsafe()).toBeDefined();
      expect(yield* Fiber.join(consumer)).toEqual(["a", "marker-1", "marker-2", "b"]);
      expect(yield* Fiber.join(marker)).toBe(true);
      expect(yield* Fiber.join(admitted)).toBe(true);
      expect((yield* ingress.snapshot).events).toBe(0);
    }),
  );
});

describe("makeZeropsBoundedIngress — interrupted producers", () => {
  // Found in review (pass 31): a producer interrupted between reserving its budget and queueing
  // its input kept the reservation for good; enough of them and every later offer overflowed.
  it.live("gives back every reservation of a producer interrupted at any point", () =>
    Effect.gen(function* () {
      for (let ops = 2; ops < 40; ops += 1) {
        const ingress = yield* makeZeropsBoundedIngress<number>({
          maxEvents: 1_000,
          maxBytes: 1_000_000,
          maxFrameBytes: 100,
          onOverflow: () => Effect.void,
        });
        const producer = yield* Effect.forkChild(
          Effect.forEach(
            Array.from({ length: 20 }, (_, index) => index),
            (index) => ingress.offer(index, 7),
            { discard: true },
          ).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, ops)),
          { startImmediately: true },
        );
        yield* Fiber.interrupt(producer);
        while (Option.isSome(yield* Effect.timeoutOption(ingress.take, "1 millis"))) {
          // Drain what was queued: the budget must come back to nothing.
        }
        const { events, bytes } = yield* ingress.snapshot;
        expect({ ops, events, bytes }).toEqual({ ops, events: 0, bytes: 0 });
      }
    }),
  );
});

describe("makeZeropsPriorityPermits", () => {
  it.effect.each([
    [
      "first work ahead of later work that waited longer",
      ["later:a", "later:b", "first:c"],
      ["first:c", "later:a", "later:b"],
    ],
    [
      "first work in arrival order before any later work",
      ["first:a", "later:b", "first:c"],
      ["first:a", "first:c", "later:b"],
    ],
    [
      "later work in arrival order",
      ["later:a", "later:b", "later:c"],
      ["later:a", "later:b", "later:c"],
    ],
  ] as const)("admits %s as the permit frees", ([, arrivals, admitted]) =>
    Effect.gen(function* () {
      const permits = yield* makeZeropsPriorityPermits(1);
      const holder = yield* Deferred.make<void>();
      const order: string[] = [];
      const held = yield* Effect.forkChild(permits.withPermit("later")(Deferred.await(holder)));
      yield* Effect.yieldNow;
      const waiting: Array<Fiber.Fiber<void>> = [];
      for (const arrival of arrivals) {
        const priority = arrival.split(":")[0] as ZeropsPermitPriority;
        waiting.push(
          yield* Effect.forkChild(
            permits.withPermit(priority)(Effect.sync(() => void order.push(arrival))),
          ),
        );
        yield* Effect.yieldNow;
      }
      expect(order).toEqual([]);

      yield* Deferred.succeed(holder, undefined);
      yield* Fiber.join(held);
      for (const fiber of waiting) yield* Fiber.join(fiber);
      expect(order).toEqual(admitted);
    }),
  );

  it.effect("never runs more work at once than it has permits", () =>
    Effect.gen(function* () {
      const permits = yield* makeZeropsPriorityPermits(2);
      let running = 0;
      let peak = 0;
      yield* Effect.forEach(
        ["first", "later", "later", "first", "later", "first"] as const,
        (priority) =>
          permits.withPermit(priority)(
            Effect.gen(function* () {
              running += 1;
              peak = Math.max(peak, running);
              for (let turn = 0; turn < 3; turn++) yield* Effect.yieldNow;
              running -= 1;
            }),
          ),
        { concurrency: "unbounded", discard: true },
      );
      expect(peak).toBe(2);
      expect(running).toBe(0);
    }),
  );

  it.effect.each(["first", "later"] as const)(
    "a %s waiter interrupted before its turn takes no permit and holds no later work back",
    (priority) =>
      Effect.gen(function* () {
        const permits = yield* makeZeropsPriorityPermits(1);
        const holder = yield* Deferred.make<void>();
        const held = yield* Effect.forkChild(permits.withPermit("later")(Deferred.await(holder)));
        yield* Effect.yieldNow;
        const leaving = yield* Effect.forkChild(permits.withPermit(priority)(Effect.void));
        yield* Effect.yieldNow;
        let admitted = false;
        const staying = yield* Effect.forkChild(
          permits.withPermit("later")(Effect.sync(() => void (admitted = true))),
        );
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(leaving);

        yield* Deferred.succeed(holder, undefined);
        yield* Fiber.join(held);
        yield* Fiber.join(staying);
        expect(admitted).toBe(true);
        const probe = yield* Effect.forkChild(permits.withPermit("later")(Effect.void));
        for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
        expect(probe.pollUnsafe()).toBeDefined();
      }),
  );

  it.effect("work that fails or is interrupted while holding a permit gives it back", () =>
    Effect.gen(function* () {
      const permits = yield* makeZeropsPriorityPermits(1);
      const refused = yield* permits
        .withPermit("first")(Effect.fail("refused"))
        .pipe(Effect.result);
      expect(refused).toMatchObject({ _tag: "Failure", failure: "refused" });
      const holding = yield* Effect.forkChild(permits.withPermit("later")(Effect.never));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(holding);

      const probe = yield* Effect.forkChild(permits.withPermit("later")(Effect.void));
      for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
      expect(probe.pollUnsafe()).toBeDefined();
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
    request.descriptor.query.kind !== "running-processes-of-organization" ||
    request.baselineTicket === null
  )
    return null;
  const ref = {
    kind: "process" as const,
    project: project("project-a"),
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

/** Three projects of one organization: three interests on one receiver. */
const threeProjects: ReadonlyArray<RuntimeInterestDescriptor> = ["a", "b", "c"].map((id) => ({
  kind: "project-topology",
  project: project(`project-${id}`),
  includeCurrentMetrics: false,
}));

/** A grant whose rounds never answer: it only carries the tab's network to the runtime. */
const silentVerifier: AccessVerifier = {
  verifyRound: () => Effect.never,
  verifyProject: () => Effect.never,
};

/**
 * Counts socket logins (`openReceiver`): each answers once `answerAfter` of its number does, and
 * the first `failFirst` are refused as a login sent offline would be; `closeSocket` closes the
 * socket of the last one that succeeded.
 */
function socketLogins(
  options: {
    readonly failFirst?: number;
    readonly answerAfter?: (login: number) => Effect.Effect<void>;
  } = {},
) {
  let logins = 0;
  let events: Queue.Queue<ReceiverEvent> | null = null;
  const adapter: ZeropsDataAdapter = {
    ...makeAdapterHarness().adapter,
    openReceiver: (_scope, organization, identity) =>
      Effect.gen(function* () {
        const login = ++logins;
        yield* options.answerAfter?.(login) ?? Effect.void;
        if (login <= (options.failFirst ?? 0)) {
          return yield* Effect.fail({
            _tag: "ZeropsDataAdapterError",
            kind: "socket-open",
            message: "net::ERR_INTERNET_DISCONNECTED",
            retryable: true,
            accountRevocationEvidence: false,
          } satisfies AdapterError);
        }
        const opened = yield* Queue.unbounded<ReceiverEvent>();
        events = opened;
        return {
          identity,
          organization,
          delivery: "hot-single-consumer-buffered-before-open-resolves",
          events: Stream.fromQueue(opened),
        } satisfies ReceiverHandle;
      }),
  };
  return {
    adapter,
    count: () => logins,
    closeSocket: Effect.suspend(() =>
      events === null
        ? Effect.die("no socket is open")
        : Queue.offer(events, { kind: "closed", reason: "network lost" }),
    ),
  };
}

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
        // The topology's two organization queries fill it; the metrics' own is one too many.
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
      // The organization's searches, shared: a project's topology reads nothing of its own.
      expect(harness.counts()).toEqual({ opens: 1, registrations: 4, reads: 0, closes: 0 });

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
      expect(harness.counts().registrations).toBe(4);

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
    "an entity whose reads keep failing is read again on a backoff, and never given up on while its interest is held",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
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
            return Effect.fail({
              _tag: "ZeropsDataAdapterError",
              kind: "network",
              message: "hydration read fails",
              retryable: true,
              accountRevocationEvidence: false,
            } satisfies AdapterError);
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
            recoveryBackoffStartMs: 100,
            recoveryBackoffMaxMs: 1_000,
          }),
        });
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
        const settle = Effect.gen(function* () {
          for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
        });
        yield* settle;
        const observed = processReads;
        expect(observed).toBeGreaterThan(0);

        // The next read waits out the backoff rather than following the failure at once.
        yield* TestClock.adjust("99 millis");
        yield* settle;
        expect(processReads).toBe(observed);
        yield* TestClock.adjust("1 millis");
        yield* settle;
        expect(processReads).toBe(observed + 1);

        // The budget is spent: nothing for the backoff's cap, then the entity is read again.
        yield* TestClock.adjust("999 millis");
        yield* settle;
        expect(processReads).toBe(observed + 1);
        yield* TestClock.adjust("1 millis");
        yield* settle;
        expect(processReads).toBe(observed + 2);

        unsubscribe();
        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        registry.dispose();
      }),
  );

  it.effect.each([
    {
      name: "a 403 is not read again until the grant changes",
      error: { kind: "forbidden", status: 403 },
      reads: { atFirst: 1, afterAMinute: 1, afterGrant: 2 },
    },
    {
      name: "a 404 is not read again until the grant changes",
      error: { kind: "not-found", status: 404 },
      reads: { atFirst: 1, afterAMinute: 1, afterGrant: 2 },
    },
    {
      name: "a 410 is not read again until the grant changes",
      error: { kind: "network", status: 410 },
      reads: { atFirst: 1, afterAMinute: 1, afterGrant: 2 },
    },
    {
      name: "a 5xx backs off and is read again, as before",
      error: { kind: "server", status: 503 },
      reads: { atFirst: 1, afterAMinute: 12, afterGrant: 12 },
    },
  ] as const)("a failed entity read: $name", ({ error, reads }) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
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
          return Effect.fail({
            _tag: "ZeropsDataAdapterError",
            kind: error.kind,
            status: error.status,
            message: "refused",
            retryable: error.status >= 500,
            accountRevocationEvidence: false,
          } satisfies AdapterError);
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
          recoveryBackoffStartMs: 1_000,
          recoveryBackoffMaxMs: 10_000,
        }),
      });
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
      const settle = Effect.gen(function* () {
        for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
      });
      yield* settle;
      const atFirst = processReads;
      for (let second = 0; second < 60; second++) {
        yield* TestClock.adjust("1 second");
        yield* settle;
      }
      const afterAMinute = processReads - atFirst + 1;
      const before = processReads;
      yield* runtime.observeAccess({
        kind: "project-access-established",
        accountEpoch: runtimeScope.epoch,
        project: topologyDescriptor.project,
      });
      yield* settle;
      const afterGrant = afterAMinute + processReads - before;
      expect({ atFirst: atFirst > 0 ? 1 : 0, afterAMinute, afterGrant }).toEqual(reads);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("a 429 waits out the platform's Retry-After before the entity is read again", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
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
          return Effect.fail({
            _tag: "ZeropsDataAdapterError",
            kind: "network",
            status: 429,
            retryAfterMs: 5_000,
            message: "slow down",
            retryable: true,
            accountRevocationEvidence: false,
          } satisfies AdapterError);
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
          hydrationRetryLimit: 3,
          recoveryBackoffStartMs: 100,
          recoveryBackoffMaxMs: 1_000,
        }),
      });
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
      const settle = Effect.gen(function* () {
        for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
      });
      yield* settle;
      const observed = processReads;
      yield* TestClock.adjust("4999 millis");
      yield* settle;
      expect(processReads).toBe(observed);
      yield* TestClock.adjust("1 millis");
      yield* settle;
      expect(processReads).toBe(observed + 1);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
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

  it.effect("a failure signal that lands after background pause stays paused, not recovering", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const events = yield* Queue.unbounded<ReceiverEvent>();
      let processSubscriptionName: string | undefined;
      let opens = 0;
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) => {
          opens += 1;
          return Effect.succeed({
            identity,
            organization,
            delivery: "hot-single-consumer-buffered-before-open-resolves",
            events: Stream.fromQueue(events),
          });
        },
        register: (_receiver, request) => {
          if (
            request.descriptor.kind === "entity-updates" &&
            request.descriptor.entity === "process"
          )
            processSubscriptionName = request.subscriptionName;
          return Effect.succeed({ responseObservations: [] });
        },
        read: () => Effect.succeed({ observations: [] }),
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
        policy: makeZeropsDataPolicy({ hiddenReceiverPauseAfterMs: 50 }),
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
      expect(processSubscriptionName).toBeDefined();
      const opensBeforePause = opens;

      // Background pause tears every receiver down and marks the interest paused.
      yield* Ref.set(visibilityState, "hidden");
      yield* Queue.offer(visibilityChanges, "hidden");
      yield* TestClock.adjust("50 millis");
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "paused",
      );

      // A malformed-frame signal from the old (already-torn-down) receiver's
      // still-running consumer fiber arrives after the pause. It must not flip the
      // interest from "paused" back to "recovering" against a receiver that no
      // longer exists in `receivers` — that would silently start no recovery cycle
      // (scheduleRecovery declines) and resumeFromBackground would never see it
      // either, since it only looks for "paused"/"failed".
      yield* Queue.offer(events, {
        kind: "malformed",
        subscriptionName: processSubscriptionName as never,
      });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const stateAfterStray = registry.get(runtime.stateAtom);
      expect(stateAfterStray.interests.get(lease.interest)?.interest.status).toBe("paused");

      // Foreground resume still recovers cleanly.
      yield* Ref.set(visibilityState, "visible");
      yield* Queue.offer(visibilityChanges, "visible");
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      expect(opens).toBeGreaterThan(opensBeforePause);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  describe("a malformed frame", () => {
    const organizationDescriptor: RuntimeInterestDescriptor = {
      kind: "organization-inventory",
      organization: topologyDescriptor.project.organization,
    };
    const activityDescriptor: RuntimeInterestDescriptor = {
      kind: "project-activity",
      project: topologyDescriptor.project,
    };
    const isActivityQuery = (request: RegistrationRequest) =>
      request.descriptor.kind === "query-membership" &&
      request.descriptor.query.kind === "running-processes-of-organization";

    const setup = Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const opened = yield* Queue.unbounded<{
        readonly handle: ReceiverHandle;
        readonly events: Queue.Queue<ReceiverEvent>;
      }>();
      const registrations: RegistrationRequest[] = [];
      let closes = 0;
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
        closeReceiver: () => Effect.sync(() => void (closes += 1)),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({ recoveryBackoffStartMs: 10, recoveryBackoffMaxMs: 10 }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const organization = yield* runtime
        .acquire(organizationDescriptor)
        .pipe(Scope.provide(leaseScope));
      const activity = yield* runtime.acquire(activityDescriptor).pipe(Scope.provide(leaseScope));
      const receiver = yield* Queue.take(opened);
      const observing = yield* waitForState(
        states,
        (state) =>
          state.interests.get(organization.interest)?.interest.status === "observing" &&
          state.interests.get(activity.interest)?.interest.status === "observing",
      );
      return {
        states,
        opened,
        registrations,
        closes: () => closes,
        receiver,
        organization,
        activity,
        observing,
        dispose: Effect.gen(function* () {
          yield* runtime.shutdown("application-close");
          yield* Scope.close(leaseScope, Exit.void);
          unsubscribe();
          registry.dispose();
        }),
      };
    });

    it.effect("on one subscription re-establishes only its interests on the same receiver", () =>
      Effect.gen(function* () {
        const rig = yield* setup;
        const organizationIdentity = rig.observing.interests.get(rig.organization.interest)!
          .interest.identity;
        const activitySubscription = rig.registrations.find(isActivityQuery)!.subscriptionName;

        yield* Queue.offer(rig.receiver.events, {
          kind: "malformed",
          subscriptionName: activitySubscription,
        });
        const recovering = yield* waitForState(
          rig.states,
          (state) => state.interests.get(rig.activity.interest)?.interest.status === "recovering",
        );
        expect(recovering.interests.get(rig.activity.interest)?.interest).toMatchObject({
          reason: "malformed",
          identity: { receiver: rig.receiver.handle.identity },
        });
        expect(recovering.interests.get(rig.organization.interest)?.interest).toMatchObject({
          status: "observing",
          identity: organizationIdentity,
        });

        yield* TestClock.adjust("10 millis");
        const recovered = yield* waitForState(
          rig.states,
          (state) => state.interests.get(rig.activity.interest)?.interest.status === "observing",
        );
        expect(recovered.interests.get(rig.activity.interest)?.interest.identity.receiver).toEqual(
          rig.receiver.handle.identity,
        );
        expect(recovered.interests.get(rig.organization.interest)?.interest.identity).toBe(
          organizationIdentity,
        );
        // The subscription is registered afresh, with its own baseline.
        expect(rig.registrations.filter(isActivityQuery)).toHaveLength(2);
        expect(yield* Queue.size(rig.opened)).toBe(0);
        expect(rig.closes()).toBe(0);

        yield* rig.dispose;
      }),
    );

    it.effect("with no subscription it can name replaces the whole receiver", () =>
      Effect.gen(function* () {
        const rig = yield* setup;
        const organizationIdentity = rig.observing.interests.get(rig.organization.interest)!
          .interest.identity;

        yield* Queue.offer(rig.receiver.events, { kind: "malformed" });
        yield* waitForState(
          rig.states,
          (state) =>
            state.interests.get(rig.organization.interest)?.interest.status === "recovering",
        );
        yield* TestClock.adjust("10 millis");
        const replacement = yield* Queue.take(rig.opened);
        const recovered = yield* waitForState(
          rig.states,
          (state) =>
            state.interests.get(rig.organization.interest)?.interest.status === "observing" &&
            state.interests.get(rig.activity.interest)?.interest.status === "observing",
        );
        expect(replacement.handle.identity.receiverId).not.toBe(
          rig.receiver.handle.identity.receiverId,
        );
        expect(
          recovered.interests.get(rig.organization.interest)?.interest.identity.receiver,
        ).toEqual(replacement.handle.identity);
        expect(recovered.interests.get(rig.organization.interest)?.interest.identity).not.toEqual(
          organizationIdentity,
        );

        yield* rig.dispose;
      }),
    );
  });

  it.effect(
    "a registration that fails after the background pause leaves its interest to resume",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const registering = yield* Deferred.make<void>();
        const outcome = yield* Deferred.make<void, AdapterError>();
        let queryRegistrations = 0;
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) =>
            Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.never,
            }),
          register: (_receiver, request) => {
            if (request.descriptor.kind !== "query-membership")
              return Effect.succeed({ responseObservations: [] });
            queryRegistrations += 1;
            if (queryRegistrations > 1) return Effect.succeed({ responseObservations: [] });
            return Deferred.succeed(registering, undefined).pipe(
              Effect.andThen(Deferred.await(outcome)),
              Effect.as({ responseObservations: [] }),
            );
          },
          read: () => Effect.succeed({ observations: [] }),
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
          policy: makeZeropsDataPolicy({ hiddenReceiverPauseAfterMs: 50 }),
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
        const lease = yield* runtime
          .acquire({ kind: "project-activity", project: topologyDescriptor.project })
          .pipe(Scope.provide(leaseScope));
        yield* Deferred.await(registering);

        yield* Ref.set(visibilityState, "hidden");
        yield* Queue.offer(visibilityChanges, "hidden");
        yield* TestClock.adjust("50 millis");
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "paused",
        );

        // The registration sent before the pause fails only now, still under the interest's
        // identity: the pause gave it no new one. `recovering` here would have no exit, since
        // the receiver it would recover is gone and resume looks only for paused interests.
        yield* Deferred.fail(outcome, {
          _tag: "ZeropsDataAdapterError",
          kind: "registration",
          message: "socket closed",
          retryable: true,
          accountRevocationEvidence: false,
        } satisfies AdapterError);
        yield* waitForState(states, (state) =>
          [...state.reads.values()].some(
            (read) =>
              read.status === "failed" &&
              read.ticket.owner.kind === "interest" &&
              read.ticket.owner.identity.key === lease.interest,
          ),
        );
        yield* runtime.observeAccess({
          kind: "access-verification-started",
          accountEpoch: runtimeScope.epoch,
        });
        expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe(
          "paused",
        );

        yield* Ref.set(visibilityState, "visible");
        yield* Queue.offer(visibilityChanges, "visible");
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        unsubscribe();
        registry.dispose();
      }),
  );

  it.effect(
    "refresh joins an in-progress recovery cycle for the organization instead of racing it",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        let opens = 0;
        let shouldFailOpen = true;
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) => {
            opens += 1;
            if (shouldFailOpen)
              return Effect.fail({
                _tag: "ZeropsDataAdapterError",
                kind: "network",
                message: "connect refused",
                retryable: true,
                accountRevocationEvidence: false,
              } satisfies AdapterError);
            return Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.never,
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
            recoveryBackoffStartMs: 1000,
            recoveryBackoffMaxMs: 1000,
          }),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });
        const leaseScope = yield* Scope.make();
        const lease = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "recovering",
        );
        // Let the org's own recovery cycle finish its prepare step (receiver
        // replacement, identity bump, backoff computation) and settle into its sleep
        // before refresh joins it — otherwise this would race that unrelated,
        // legitimate identity bump instead of the one under test.
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        const opensAfterFirstFailure = opens;
        const epochWhileRecovering = registry.get(runtime.stateAtom).interests.get(lease.interest)!
          .interest.identity.interestEpoch;

        // A refresh call lands while the org's own recovery cycle is already asleep,
        // waiting out its backoff. It must not open a competing receiver or bump the
        // interest's identity again — that would race the sleeping cycle's own retry,
        // and each side's receiver swap would abort the other's in-flight attempt
        // before it ever completes a registration.
        yield* runtime.refresh(topologyDescriptor.project.organization);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(opens).toBe(opensAfterFirstFailure);
        expect(
          registry.get(runtime.stateAtom).interests.get(lease.interest)!.interest.identity
            .interestEpoch,
        ).toBe(epochWhileRecovering);

        // The organization's own cycle still recovers once its backoff elapses.
        shouldFailOpen = false;
        yield* TestClock.adjust("1000 millis");
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );

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

  describe("a history interest is optional", () => {
    const histories = {
      "process history": {
        descriptor: {
          kind: "project-process-history",
          project: topologyDescriptor.project,
          before: null,
          limit: 20,
        },
        fails: (request: RegistrationRequest) =>
          request.descriptor.kind === "query-membership" &&
          request.descriptor.query.kind === "process-history-window",
      },
      "metric history": {
        descriptor: {
          kind: "project-metric-history",
          project: topologyDescriptor.project,
          window: { timeGroupBy: "1h", limit: 24, timeZone: "UTC" },
        },
        fails: (request: RegistrationRequest) => request.descriptor.kind === "metric-history",
      },
    } as const satisfies Record<
      string,
      {
        readonly descriptor: RuntimeInterestDescriptor;
        readonly fails: (request: RegistrationRequest) => boolean;
      }
    >;

    for (const [name, history] of Object.entries(histories)) {
      it.effect(`keeps topology observing on its receiver when the ${name} fails`, () =>
        Effect.gen(function* () {
          const registry = AtomRegistry.make();
          const harness = makeAdapterHarness();
          let opens = 0;
          const runtime = yield* makeZeropsDataRuntime({
            scope: runtimeScope,
            adapter: {
              ...harness.adapter,
              openReceiver: (...args) => {
                opens += 1;
                return harness.adapter.openReceiver(...args);
              },
              register: (receiver, request, context) => {
                if (!history.fails(request))
                  return harness.adapter.register(receiver, request, context);
                return Effect.fail({
                  _tag: "ZeropsDataAdapterError",
                  kind: "registration",
                  message: "history unavailable",
                  retryable: true,
                  accountRevocationEvidence: false,
                } satisfies AdapterError);
              },
            },
            atomRegistry: registry,
            makeOpaqueId: makeIdFactory(),
          });
          const states = yield* Queue.unbounded<ZeropsDataState>();
          const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
            Queue.offerUnsafe(states, state);
          });
          const leaseScope = yield* Scope.make();
          const topology = yield* runtime
            .acquire(topologyDescriptor)
            .pipe(Scope.provide(leaseScope));
          const observed = yield* waitForState(
            states,
            (state) => state.interests.get(topology.interest)?.interest.status === "observing",
          );
          const topologyIdentity = observed.interests.get(topology.interest)!.interest.identity;
          const historyLease = yield* runtime
            .acquire(history.descriptor)
            .pipe(Scope.provide(leaseScope));
          const settled = yield* waitForState(
            states,
            (state) => state.interests.get(historyLease.interest)?.interest.status === "failed",
          );
          expect(settled.interests.get(historyLease.interest)?.required).toBe(false);
          expect(settled.interests.get(historyLease.interest)?.interest).toMatchObject({
            status: "failed",
            retryAtMs: expect.any(Number),
          });
          expect(settled.interests.get(topology.interest)?.interest).toMatchObject({
            status: "observing",
            identity: topologyIdentity,
          });
          expect(opens).toBe(1);

          yield* runtime.shutdown("application-close");
          yield* Scope.close(leaseScope, Exit.void);
          unsubscribe();
          registry.dispose();
        }),
      );
    }
  });

  it.effect(
    "admits project-scoped continuation writes after an organization-authorized create",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const executed: string[] = [];
        /** Each command's deadline, as the runtime hands it to the adapter (the clock is at 0). */
        const deadlines = new Map<string, number>();
        const created = {
          id: "created-project",
          clientId: "org-a",
          name: "Created",
          status: "ACTIVE",
        };
        const base = makeAdapterHarness();
        const adapter: ZeropsDataAdapter = {
          ...base.adapter,
          execute: (command, context) => {
            executed.push(command.kind);
            deadlines.set(command.kind, context.deadlineMs);
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
                  result: { kind: command.kind, value: { serviceName: "zcp", imported: true } },
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

        yield* runtime.commands.importDevelopmentContainer({
          project: createdRef,
          projectName: "new",
        });
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
        // A command of several requests has a minute, one request its own deadline.
        expect(Object.fromEntries(deadlines)).toEqual({
          "create-project": 15_000,
          "import-development-container": 60_000,
          "import-services": 15_000,
          "import-project": 15_000,
        });
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

  it.effect("project access established re-admits a withheld broker atom", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const base = makeAdapterHarness();
      const adapter: ZeropsDataAdapter = {
        ...base.adapter,
        execute: (command) =>
          command.kind === "create-project"
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
            : Effect.die(`unexpected command ${command.kind}`),
      };
      let reads = 0;
      const unused = Effect.die("this test reads only authorized agents");
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: {
          ...adapter,
          cells: {
            readOrganizationLocations: () => unused,
            readServiceAuthorizedAgents: () =>
              Effect.sync(() => void (reads += 1)).pipe(Effect.as([])),
            readServiceMateFlag: () => unused,
            readOrganizationIntegrationTokenGrants: () => unused,
            readOrganizationMembers: () => unused,
            readServiceVariableNames: () => unused,
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
            { organization: topologyDescriptor.project.organization, mutationsAllowed: true },
          ],
          projects: [],
        },
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.cells
        .acquire({
          kind: "agents",
          account: runtimeScope,
          service: {
            kind: "service",
            project: project("created-project"),
            serviceId: ZeropsServiceId.make("service-a"),
          },
        })
        .pipe(Scope.provide(leaseScope));
      expect(yield* lease.snapshot).toMatchObject({ state: "withheld" });
      expect(reads).toBe(0);

      yield* runtime.commands.createProject({
        organization: topologyDescriptor.project.organization,
        name: "Created",
        tagList: [],
      });

      expect(yield* lease.awaitSettled).toMatchObject({ state: "known", value: [] });
      expect(reads).toBe(1);
      yield* Scope.close(leaseScope, Exit.void);
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }),
  );
  /** A runtime over `execute`, granted one organization, for a command's own life. */
  const commandRuntime = (
    registry: AtomRegistry.AtomRegistry,
    execute: ZeropsDataAdapter["execute"],
  ) =>
    makeZeropsDataRuntime({
      scope: runtimeScope,
      adapter: { ...makeAdapterHarness().adapter, execute },
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
  const tokenWrite = {
    organization: topologyDescriptor.project.organization,
    tokenId: "token-a",
    name: "t",
    projects: [],
  };

  it.effect(
    "a command answered as the runtime shuts down settles rather than waiting for ever",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        let runtime!: Effect.Success<ReturnType<typeof commandRuntime>>;
        runtime = yield* commandRuntime(registry, (command) =>
          // The answer lands just as the account closes: its barrier is queued, then dropped.
          Effect.forkDetach(runtime.shutdown("application-close")).pipe(
            Effect.as({
              processRefs: [],
              observations: [],
              result: { kind: command.kind, value: undefined },
            } as never),
          ),
        );
        const write = yield* Effect.forkChild(
          Effect.exit(runtime.commands.setIntegrationTokenProjects(tokenWrite)),
        );
        for (let turn = 0; turn < 50; turn++) yield* Effect.yieldNow;
        expect(write.pollUnsafe()).toBeDefined();
        registry.dispose();
      }),
  );

  it.effect("a subscriber that throws while the account publishes stops no write", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const runtime = yield* commandRuntime(registry, (command) =>
        Effect.succeed({
          processRefs: [],
          observations: [],
          result: { kind: command.kind, value: undefined },
        } as never),
      );
      let armed = true;
      const unsubscribe = registry.subscribe(runtime.stateAtom, () => {
        if (armed) throw new Error("a subscriber's own bug");
      });
      const first = yield* Effect.forkChild(
        Effect.exit(runtime.commands.setIntegrationTokenProjects(tokenWrite)),
      );
      for (let turn = 0; turn < 50; turn++) yield* Effect.yieldNow;
      armed = false;
      const second = yield* Effect.forkChild(
        Effect.exit(runtime.commands.setIntegrationTokenProjects(tokenWrite)),
      );
      for (let turn = 0; turn < 50; turn++) yield* Effect.yieldNow;

      expect(first.pollUnsafe()).toBeDefined();
      expect(Exit.isSuccess(yield* Fiber.join(first))).toBe(true);
      expect(second.pollUnsafe()).toBeDefined();
      expect(Exit.isSuccess(yield* Fiber.join(second))).toBe(true);
      unsubscribe();
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }),
  );

  // Found in review (pass 31): the registry detaches a parent's children before invalidating
  // them, so one projection's throw left every projection after it reading old state for good.
  it.effect("a projection that throws leaves every other projection of the account live", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const runtime = yield* commandRuntime(registry, (command) =>
        Effect.succeed({
          processRefs: [],
          observations: [],
          result: { kind: command.kind, value: undefined },
        } as never),
      );
      let armed = false;
      const broken = Atom.make((get) => get(runtime.stateAtom).commands.size);
      const healthy = Atom.make((get) => get(runtime.stateAtom).commands.size);
      // Read at once, as every subscriber of the app does.
      const stopBroken = registry.subscribe(
        broken,
        () => {
          if (armed) throw new Error("a projection's own bug");
        },
        { immediate: true },
      );
      const stopHealthy = registry.subscribe(healthy, () => undefined, { immediate: true });
      armed = true;
      yield* Effect.exit(runtime.commands.setIntegrationTokenProjects(tokenWrite));
      armed = false;
      yield* Effect.exit(runtime.commands.setIntegrationTokenProjects(tokenWrite));
      for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;

      const size = registry.get(runtime.stateAtom).commands.size;
      expect(size).toBe(2);
      expect(registry.get(healthy)).toBe(size);
      expect(registry.get(broken)).toBe(size);
      stopBroken();
      stopHealthy();
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }),
  );

  it.effect("a token's read answers beside a stuck write, and is no write itself", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const runtime = yield* commandRuntime(registry, (command) =>
        command.kind === "read-integration-token-grant"
          ? Effect.succeed({
              processRefs: [],
              observations: [],
              result: { kind: command.kind, value: null },
            } as never)
          : Effect.never,
      );
      const write = yield* Effect.forkChild(
        runtime.commands.setIntegrationTokenProjects(tokenWrite),
      );
      for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
      const reading = yield* Effect.forkChild(
        runtime.commands.readIntegrationTokenGrant({
          organization: topologyDescriptor.project.organization,
          tokenId: "token-a",
        }),
      );
      for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;

      expect(reading.pollUnsafe()).toBeDefined();
      expect((yield* Fiber.join(reading)).value).toBeNull();
      const commands = [...registry.get(runtime.stateAtom).commands.values()];
      expect(commands.map((attempt) => attempt.commandKind)).toEqual([
        "set-integration-token-projects",
      ]);
      yield* Fiber.interrupt(write);
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }),
  );

  it.effect("an interrupted command is no longer counted as pending", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const runtime = yield* commandRuntime(registry, () => Effect.never);
      const write = yield* Effect.forkChild(
        runtime.commands.setIntegrationTokenProjects(tokenWrite),
      );
      for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
      yield* Fiber.interrupt(write);
      for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;

      const statuses = [...registry.get(runtime.stateAtom).commands.values()].map(
        (attempt) => attempt.status,
      );
      expect(statuses).toHaveLength(1);
      expect(statuses).not.toContain("pending");
      yield* runtime.shutdown("application-close");
      registry.dispose();
    }),
  );

  it.effect("reads an organization's tokens again whenever a token of it is written", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const base = makeAdapterHarness();
      let reads = 0;
      const listeners = new Set<(organizationId: string) => void>();
      const unused = Effect.die("this test reads only tokens");
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: {
          ...base.adapter,
          onTokensWritten: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          cells: {
            readOrganizationLocations: () => unused,
            readServiceAuthorizedAgents: () => unused,
            readServiceMateFlag: () => unused,
            readOrganizationIntegrationTokenGrants: () =>
              Effect.sync(() => void (reads += 1)).pipe(Effect.as([])),
            readOrganizationMembers: () => unused,
            readServiceVariableNames: () => unused,
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
            { organization: topologyDescriptor.project.organization, mutationsAllowed: true },
          ],
          projects: [],
        },
      });
      const organization = topologyDescriptor.project.organization;
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.cells
        .acquire({ kind: "tokens", account: runtimeScope, organization })
        .pipe(Scope.provide(leaseScope));
      yield* lease.awaitSettled;
      expect(reads).toBe(1);

      // Any write to one of its tokens — a mint, a grant, a delete, from anywhere in the app.
      for (const listener of listeners) listener(organization.organizationId);
      yield* lease.awaitSettled;
      expect(reads).toBe(2);

      yield* runtime.shutdown("application-close");
      expect(listeners.size).toBe(0);
      yield* Scope.close(leaseScope, Exit.void);
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

  it.effect(
    "fails a compound command with the admission's own reason when a verification starts between writes",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const firstWriteFinished = yield* Deferred.make<void>();
        const allowSecondWrite = yield* Deferred.make<void>();
        const base = makeAdapterHarness();
        const adapter: ZeropsDataAdapter = {
          ...base.adapter,
          execute: (_command, context) =>
            Effect.gen(function* () {
              const beforeWrite = context.beforeProjectWrite;
              if (beforeWrite === undefined) return yield* Effect.die("missing write guard");
              const checked = () =>
                Effect.tryPromise({
                  try: beforeWrite,
                  catch: (): AdapterError => ({
                    _tag: "ZeropsDataAdapterError",
                    kind: "rejected",
                    message: "write rejected",
                    retryable: false,
                    accountRevocationEvidence: false,
                  }),
                });
              yield* checked();
              yield* Deferred.succeed(firstWriteFinished, undefined);
              yield* Deferred.await(allowSecondWrite);
              yield* checked();
              return { processRefs: [], observations: [] };
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
        const execution = yield* Effect.forkChild(
          Effect.flip(runtime.commands.enableZeropsMate(service)),
        );
        yield* Deferred.await(firstWriteFinished);
        yield* runtime.observeAccess({
          kind: "access-verification-started",
          accountEpoch: runtimeScope.epoch,
        });
        yield* Deferred.succeed(allowSecondWrite, undefined);
        const failure = yield* Fiber.join(execution);
        // A round in flight is a "not yet" the caller can wait out (the web
        // birth ports' `birthStepFailure`); the adapter's
        // own wrapping of the guard's refusal must not turn it into an answer.
        expect(failure).toMatchObject({
          _tag: "ZeropsCommandAdmissionError",
          reason: "access-unverified",
        });

        yield* runtime.shutdown("application-close");
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

  it.effect(
    "retries a failed interest on the live receiver when the tab returns before a pause",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const opened = yield* Queue.unbounded<{
          readonly handle: ReceiverHandle;
          readonly events: Queue.Queue<ReceiverEvent>;
        }>();
        const registrations: RegistrationRequest[] = [];
        let closes = 0;
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
          register: (_receiver, request) => {
            registrations.push(request);
            return request.descriptor.kind === "current-metrics"
              ? Effect.fail({
                  _tag: "ZeropsDataAdapterError",
                  kind: "registration",
                  message: "metrics unavailable",
                  retryable: true,
                  accountRevocationEvidence: false,
                } satisfies AdapterError)
              : Effect.succeed({ responseObservations: [] });
          },
          read: () => Effect.succeed({ observations: [] }),
          execute: () => Effect.succeed({ processRefs: [], observations: [] }),
          closeReceiver: () => Effect.sync(() => void (closes += 1)),
        };
        const visibilityState = yield* Ref.make<"visible" | "hidden">("visible");
        const visibilityChanges = yield* Queue.unbounded<"visible" | "hidden">();
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
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
        const topology = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
        const metrics = yield* runtime
          .acquire({ kind: "project-current-metrics", project: topologyDescriptor.project })
          .pipe(Scope.provide(leaseScope));
        const live = yield* Queue.take(opened);
        const settled = yield* waitForState(
          states,
          (state) =>
            state.interests.get(topology.interest)?.interest.status === "observing" &&
            state.interests.get(metrics.interest)?.interest.status === "failed",
        );
        const topologyIdentity = settled.interests.get(topology.interest)!.interest.identity;
        const metricsAttempts = registrations.filter(
          (request) => request.descriptor.kind === "current-metrics",
        ).length;

        // Hidden for less than the pause: the receiver stays open, and the return retries
        // only the failed interest, on that same receiver.
        yield* Ref.set(visibilityState, "hidden");
        yield* Queue.offer(visibilityChanges, "hidden");
        yield* Ref.set(visibilityState, "visible");
        yield* Queue.offer(visibilityChanges, "visible");
        yield* waitForState(
          states,
          (state) =>
            state.interests.get(metrics.interest)?.interest.status === "failed" &&
            registrations.filter((request) => request.descriptor.kind === "current-metrics")
              .length > metricsAttempts,
        );
        expect(yield* Queue.size(opened)).toBe(0);
        expect(closes).toBe(0);
        const afterResume = yield* runtime.state;
        expect(afterResume.interests.get(topology.interest)?.interest.identity).toBe(
          topologyIdentity,
        );
        expect(
          afterResume.interests.get(metrics.interest)?.interest.identity.receiver.receiverId,
        ).toBe(live.handle.identity.receiverId);

        // The topology interest is still fed by the receiver it registered on.
        const serviceRegistration = registrations.find(
          (request) =>
            request.descriptor.kind === "entity-updates" && request.descriptor.entity === "service",
        )!;
        const pushed = ZeropsServiceId.make("service-after-resume");
        yield* Queue.offer(live.events, {
          kind: "observation",
          input: {
            kind: "service-lifecycle-observed",
            ref: { kind: "service", project: topologyDescriptor.project, serviceId: pushed },
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
          },
          bytes: 1,
        });
        yield* waitForState(states, (state) =>
          [...state.inventory.services.values()].some((record) => record.ref.serviceId === pushed),
        );

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

  it.effect.each([
    ["an epoch that starts offline", false],
    ["a socket lost while offline", true],
  ] as const)("offline → no socket login attempts; online → one attempt: %s", ([, startOnline]) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const logins = socketLogins();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: logins.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      yield* runtime.access.start({ verifier: silentVerifier, hidden: false, online: startOnline });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const leases = yield* Effect.forEach(threeProjects, (descriptor) =>
        runtime.acquire(descriptor).pipe(Scope.provide(leaseScope)),
      );
      const allObserving = (state: ZeropsDataState) =>
        leases.every(
          (lease) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
      if (startOnline) {
        yield* waitForState(states, allObserving);
        expect(logins.count()).toBe(1);
        yield* runtime.access.signal({ type: "OFFLINE" });
        yield* logins.closeSocket;
      }
      const before = logins.count();

      for (let minute = 0; minute < 10; minute++) {
        yield* Effect.yieldNow;
        yield* TestClock.adjust("1 minute");
      }
      expect(logins.count()).toBe(before);

      yield* runtime.access.signal({ type: "ONLINE" });
      yield* waitForState(states, allObserving);
      yield* TestClock.adjust("1 minute");
      expect(logins.count()).toBe(before + 1);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect.each([
    ["is refused", () => Effect.void, "0 seconds"],
    [
      "gets no answer before the establishment deadline",
      (login: number) => (login === 1 ? Effect.never : Effect.void),
      "60 seconds",
    ],
  ] as const)(
    "a socket login that %s is the one attempt of every interest waiting on it",
    ([, answerAfter, abandonedAfter]) =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const logins = socketLogins({ failFirst: 1, answerAfter });
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: logins.adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });
        const leaseScope = yield* Scope.make();
        const leases = yield* Effect.forEach(threeProjects, (descriptor) =>
          runtime.acquire(descriptor).pipe(Scope.provide(leaseScope)),
        );
        yield* TestClock.adjust(abandonedAfter);
        for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
        expect(logins.count()).toBe(1);

        yield* TestClock.adjust("1 second");
        yield* waitForState(states, (state) =>
          leases.every(
            (lease) => state.interests.get(lease.interest)?.interest.status === "observing",
          ),
        );
        expect(logins.count()).toBe(2);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        unsubscribe();
        registry.dispose();
      }),
  );

  it.effect(
    "a visible wake logs in at once over a receiver whose last socket login failed while hidden",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        /** The recovery cycle's retry, the second login: in flight while the tab hides. */
        const retryAnswers = yield* Deferred.make<void>();
        const logins = socketLogins({
          failFirst: 2,
          answerAfter: (login) => (login === 2 ? Deferred.await(retryAnswers) : Effect.void),
        });
        const visibilityState = yield* Ref.make<"visible" | "hidden">("visible");
        const visibilityChanges = yield* Queue.unbounded<"visible" | "hidden">();
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: logins.adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
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
        const lease = yield* runtime.acquire(threeProjects[0]!).pipe(Scope.provide(leaseScope));
        const settle = Effect.gen(function* () {
          for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
        });
        // The first login is refused; the recovery cycle's retry is in flight when the tab hides.
        yield* TestClock.adjust("1 second");
        yield* settle;
        yield* Ref.set(visibilityState, "hidden");
        yield* Queue.offer(visibilityChanges, "hidden");
        yield* settle;
        yield* Deferred.succeed(retryAnswers, undefined);
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "paused",
        );
        expect(logins.count()).toBe(2);

        // Shown again before the receiver is paused: no time passes before the next login.
        yield* Ref.set(visibilityState, "visible");
        yield* Queue.offer(visibilityChanges, "visible");
        yield* settle;
        expect(logins.count()).toBe(3);
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );

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

  it.effect("recovers a failed interest whose own retry fails while a sibling's cycle sleeps", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const opened = yield* Queue.unbounded<Queue.Queue<ReceiverEvent>>();
      const registrations: RegistrationRequest[] = [];
      let serviceFailures = 0;
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) =>
          Effect.gen(function* () {
            const events = yield* Queue.unbounded<ReceiverEvent>();
            yield* Queue.offer(opened, events);
            return {
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            } satisfies ReceiverHandle;
          }),
        register: (_receiver, request) => {
          registrations.push(request);
          // The first establishment, its one backoff retry and its scheduled retry out of
          // `failed` are refused; the next attempt is accepted.
          if (
            request.descriptor.kind === "entity-updates" &&
            request.descriptor.entity === "service" &&
            serviceFailures < 3
          ) {
            serviceFailures += 1;
            return Effect.fail({
              _tag: "ZeropsDataAdapterError",
              kind: "registration",
              message: "service feed refused",
              retryable: true,
              accountRevocationEvidence: false,
            } satisfies AdapterError);
          }
          return Effect.succeed({ responseObservations: [] });
        },
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
          recoveryAttemptLimit: 1,
          recoveryBackoffStartMs: 10,
          recoveryBackoffMaxMs: 40,
        }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();

      // t=0 refused, t=10 refused again past the attempt limit: `failed`, retry at t=30.
      const topology = yield* runtime.acquire(topologyDescriptor).pipe(Scope.provide(leaseScope));
      for (let index = 0; index < 20; index++) yield* Effect.yieldNow;
      yield* TestClock.adjust("10 millis");
      const failed = yield* waitForState(
        states,
        (state) => state.interests.get(topology.interest)?.interest.status === "failed",
      );
      expect(failed.interests.get(topology.interest)?.interest).toMatchObject({ retryAtMs: 30 });

      // A sibling observes on the same receiver; at t=25 a malformed frame on its own
      // subscription starts a recovery cycle that sleeps until the sibling is due at t=35.
      const organization = yield* runtime
        .acquire({
          kind: "organization-inventory",
          organization: topologyDescriptor.project.organization,
        })
        .pipe(Scope.provide(leaseScope));
      yield* waitForState(
        states,
        (state) => state.interests.get(organization.interest)?.interest.status === "observing",
      );
      let events = yield* Queue.take(opened);
      while ((yield* Queue.size(opened)) > 0) events = yield* Queue.take(opened);
      yield* TestClock.adjust("15 millis");
      const siblingSubscription = registrations.findLast(
        (request) =>
          request.descriptor.kind === "query-membership" &&
          request.descriptor.query.kind === "projects-of-organization",
      )!.subscriptionName;
      yield* Queue.offer(events, { kind: "malformed", subscriptionName: siblingSubscription });
      yield* waitForState(
        states,
        (state) => state.interests.get(organization.interest)?.interest.status === "recovering",
      );

      // t=30 the scheduled retry is refused while the cycle sleeps; the cycle still owes it
      // an exit, so both interests observe once the sibling is due.
      for (let elapsed = 0; elapsed < 100; elapsed += 5) {
        yield* TestClock.adjust("5 millis");
        for (let index = 0; index < 20; index++) yield* Effect.yieldNow;
      }
      expect(serviceFailures).toBe(3);
      const settled = yield* runtime.state;
      expect(settled.interests.get(organization.interest)?.interest.status).toBe("observing");
      expect(settled.interests.get(topology.interest)?.interest.status).toBe("observing");

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
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
      // The deadline bounds the whole attempt: its four registrations were never all sent.
      expect(registrations).toBeLessThan(4);

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
            descriptor.query.kind === "running-processes-of-organization",
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
          descriptor.kind === "query-membership" &&
          descriptor.query.kind === "services-of-organization",
      ),
    ).toBe(true);
    const topology = planZeropsInterest(topologyDescriptor);
    expect(
      topology.registrations.some(
        ({ descriptor }) =>
          descriptor.kind === "query-membership" &&
          descriptor.query.kind === "running-processes-of-organization",
      ),
    ).toBe(true);
    expect(
      interestKeyOf({ kind: "project-inventory", project: topologyDescriptor.project }),
    ).not.toBe(interestKeyOf(topologyDescriptor));
  });
});

it.effect("re-reads an organization's inventory on a fresh receiver and keeps what it holds", () =>
  Effect.gen(function* () {
    const { decodeRegistrationResponse, decodeEntityQueryPages } = yield* Effect.promise(
      () => import("./platformProtocol.ts"),
    );
    const { selectProjectsOf } = yield* Effect.promise(() => import("./projection.ts"));
    const registry = AtomRegistry.make();
    const states = yield* Queue.unbounded<ZeropsDataState>();
    const base = makeAdapterHarness();
    const organization = project("p").organization;
    const row = (name: string) => ({
      id: "p",
      name,
      status: "ACTIVE",
      created: "2026-09-01T00:00:00Z",
    });
    let currentName = "First";
    let opens = 0;
    let closes = 0;
    let baselines = 0;
    const runtime = yield* makeZeropsDataRuntime({
      scope: runtimeScope,
      atomRegistry: registry,
      makeOpaqueId: makeIdFactory(),
      adapter: {
        ...base.adapter,
        openReceiver: (_scope, org, identity) =>
          Effect.sync(() => {
            opens += 1;
            return {
              identity,
              organization: org,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.never,
            } satisfies ReceiverHandle;
          }),
        register: (_handle, request) =>
          Effect.sync(() => {
            if (
              request.descriptor.kind !== "query-membership" ||
              request.descriptor.query.kind !== "projects-of-organization"
            )
              return { responseObservations: [] };
            baselines += 1;
            return {
              responseObservations: decodeRegistrationResponse(request, {
                items: [row(currentName)],
                total: 1,
              }).observations,
            };
          }),
        read: (ticket) =>
          Effect.sync(() => {
            if (
              ticket.target.kind !== "query" ||
              ticket.target.descriptor.kind !== "projects-of-organization"
            )
              return { observations: [] };
            baselines += 1;
            return {
              observations: decodeEntityQueryPages(ticket.target.descriptor, ticket, [
                { rows: [row(currentName)], totalCount: 1 },
              ]).observations,
            };
          }),
        closeReceiver: () => Effect.sync(() => void (closes += 1)),
      },
    });
    const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
      Queue.offerUnsafe(states, state);
    });
    const scope = yield* Scope.make();
    const lease = yield* runtime
      .acquire({ kind: "organization-inventory", organization })
      .pipe(Scope.provide(scope));
    const settled = yield* waitForState(
      states,
      (state) => state.interests.get(lease.interest)?.interest.status === "observing",
    );
    const nameOf = () => {
      const first = registry.get(runtime.reads.projectsOf(organization)).value[0];
      return first?.knowledge === "observed" && first.record.identity.knowledge === "observed"
        ? first.record.identity.fields.name
        : null;
    };
    expect(nameOf()).toBe("First");
    const epochBefore = settled.interests.get(lease.interest)!.interest.identity.interestEpoch;
    const baselinesBefore = baselines;

    // The page keeps its list through the whole re-read: no published state
    // has the project gone from the organization's projects, or the list
    // back to unread.
    currentName = "Renamed while the page held it";
    let heldThroughout = true;
    yield* runtime.refresh(organization);
    yield* waitForState(states, (state) => {
      const read = selectProjectsOf(state, organization);
      if (read.value.length === 0 || read.query.status !== "observed") heldThroughout = false;
      const interest = state.interests.get(lease.interest)?.interest;
      return interest?.status === "observing" && interest.identity.interestEpoch !== epochBefore;
    });
    expect(heldThroughout).toBe(true);
    expect(nameOf()).toBe("Renamed while the page held it");
    expect(baselines).toBeGreaterThan(baselinesBefore);
    expect({ opens, closes }).toEqual({ opens: 2, closes: 1 });
    expect((yield* runtime.state).interests.has(lease.interest)).toBe(true);

    // An organization nobody holds is left alone.
    yield* runtime.refresh({ ...organization, organizationId: ZeropsOrganizationId.make("org-b") });
    expect(opens).toBe(2);

    yield* Scope.close(scope, Exit.void);
    yield* runtime.shutdown("application-close");
    unsubscribe();
    registry.dispose();
  }),
);

it.effect("aborts the organization's in-flight project list when its final lease is released", () =>
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
      .acquire({ kind: "organization-inventory", organization: project("p").organization })
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

/** Lets ready work run until `predicate` holds of the runtime's state, or `turns` run out. */
const settleUntil = (
  runtime: { readonly state: Effect.Effect<ZeropsDataState> },
  predicate: (state: ZeropsDataState) => boolean,
  turns = 200,
): Effect.Effect<ZeropsDataState> =>
  Effect.gen(function* () {
    for (let turn = 0; turn < turns; turn++) {
      const state = yield* runtime.state;
      if (predicate(state)) return state;
      yield* Effect.yieldNow;
    }
    return yield* runtime.state;
  });

describe("a failure's scope: its own interest, or the receiver", () => {
  const organization = project("project-a").organization;
  const listDescriptor: RuntimeInterestDescriptor = {
    kind: "organization-inventory",
    organization,
  };
  const inventoryDescriptors: ReadonlyArray<RuntimeInterestDescriptor> = ["b", "c"].map((id) => ({
    kind: "project-inventory",
    project: project(`project-${id}`),
  }));
  const isProjectList = (request: RegistrationRequest) =>
    request.descriptor.kind === "query-membership" &&
    request.descriptor.query.kind === "projects-of-organization";

  /** A request the platform refused with an HTTP status, as the adapter reports it. */
  const refused = (status: number, kind: AdapterError["kind"]): AdapterError => ({
    _tag: "ZeropsDataAdapterError",
    kind,
    message: `Zerops answered ${status}.`,
    retryable: true,
    accountRevocationEvidence: false,
    status,
  });
  /** A request that brought back no answer the adapter could hold the platform to. */
  const unanswered = (kind: AdapterError["kind"]): AdapterError => ({
    _tag: "ZeropsDataAdapterError",
    kind,
    message: `No answer (${kind}).`,
    retryable: true,
    accountRevocationEvidence: false,
  });
  /** Fails the first `times` requests `matches` with `failure`. */
  const failFirst = <Request>(
    times: number,
    matches: (request: Request) => boolean,
    failure: AdapterError,
  ) => {
    let failed = 0;
    return (request: Request): AdapterError | null => {
      if (!matches(request) || failed >= times) return null;
      failed += 1;
      return failure;
    };
  };

  /**
   * The organization's project list and two projects' inventories on one receiver. `register`
   * and `read` answer each request with the failure it meets, or `null` for an answer.
   */
  const setup = (options: {
    readonly register?: (request: RegistrationRequest) => AdapterError | null;
    /** Registrations that never answer at all. */
    readonly hang?: (request: RegistrationRequest) => boolean;
    readonly read?: (ticket: ReadTicket) => AdapterError | null;
    readonly policy?: Partial<ZeropsDataPolicy>;
    readonly visibility?: ZeropsVisibility;
  }) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const opened = yield* Queue.unbounded<{
        readonly handle: ReceiverHandle;
        readonly events: Queue.Queue<ReceiverEvent>;
      }>();
      const registrations: RegistrationRequest[] = [];
      let closes = 0;
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
          Effect.suspend(() => {
            registrations.push(request);
            if (options.hang?.(request) === true) return Effect.never;
            const failure = options.register?.(request) ?? null;
            return failure === null
              ? Effect.succeed({ responseObservations: [] })
              : Effect.fail(failure);
          }),
        read: (ticket) =>
          Effect.suspend(() => {
            const failure = options.read?.(ticket) ?? null;
            return failure === null ? Effect.succeed({ observations: [] }) : Effect.fail(failure);
          }),
        execute: () => Effect.succeed({ processRefs: [], observations: [] }),
        closeReceiver: () => Effect.sync(() => void (closes += 1)),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          recoveryBackoffStartMs: 10,
          recoveryBackoffMaxMs: 40,
          ...options.policy,
        }),
        ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
      });
      const leaseScope = yield* Scope.make();
      const list = yield* runtime.acquire(listDescriptor).pipe(Scope.provide(leaseScope));
      const inventories = yield* Effect.forEach(inventoryDescriptors, (descriptor) =>
        runtime.acquire(descriptor).pipe(Scope.provide(leaseScope)),
      );
      const first = yield* Queue.take(opened);
      const leases = [list, ...inventories];
      const interestOf = (state: ZeropsDataState, lease: InterestLease) =>
        state.interests.get(lease.interest)?.interest;
      return {
        runtime,
        opened,
        registrations,
        closes: () => closes,
        live: first.handle.identity,
        events: first.events,
        list,
        inventories,
        leases,
        interestOf,
        /** Every lease arrived somewhere: observing, failed, or recovering on a schedule. */
        settled: (state: ZeropsDataState) =>
          leases.every((lease) => {
            const interest = interestOf(state, lease);
            return (
              interest?.status === "observing" ||
              interest?.status === "failed" ||
              (interest?.status === "recovering" && interest.nextRetryAtMs > 0)
            );
          }),
        dispose: Effect.gen(function* () {
          yield* runtime.shutdown("application-close");
          yield* Scope.close(leaseScope, Exit.void);
          registry.dispose();
        }),
      };
    });

  it.effect.each([
    ["429", refused(429, "registration")],
    ["503", refused(503, "server")],
    ["403", refused(403, "forbidden")],
  ] as const)(
    "a project list registration refused with %s retries alone, on the live receiver",
    ([, refusal]) =>
      Effect.gen(function* () {
        const rig = yield* setup({ register: failFirst(2, isProjectList, refusal) });
        const first = yield* settleUntil(
          rig.runtime,
          (state) => rig.settled(state) && rig.interestOf(state, rig.list)?.status === "recovering",
        );
        expect(rig.interestOf(first, rig.list)).toMatchObject({
          status: "recovering",
          attempt: 1,
          nextRetryAtMs: 10,
          identity: { receiver: rig.live },
        });
        const projects = rig.inventories.map((lease) => rig.interestOf(first, lease));
        expect(projects).toEqual([
          expect.objectContaining({
            status: "observing",
            identity: expect.objectContaining({ receiver: rig.live }),
          }),
          expect.objectContaining({
            status: "observing",
            identity: expect.objectContaining({ receiver: rig.live }),
          }),
        ]);

        yield* TestClock.adjust("10 millis");
        const second = yield* settleUntil(rig.runtime, (state) => {
          const list = rig.interestOf(state, rig.list);
          return list?.status === "recovering" && list.attempt === 2 && list.nextRetryAtMs > 10;
        });
        expect(rig.interestOf(second, rig.list)).toMatchObject({
          nextRetryAtMs: 30,
          identity: { receiver: rig.live },
        });

        yield* TestClock.adjust("20 millis");
        const recovered = yield* settleUntil(
          rig.runtime,
          (state) => rig.interestOf(state, rig.list)?.status === "observing",
        );
        expect(rig.interestOf(recovered, rig.list)).toMatchObject({
          status: "observing",
          identity: { receiver: rig.live },
        });
        expect(rig.inventories.map((lease) => rig.interestOf(recovered, lease))).toEqual(projects);
        expect(rig.registrations.filter(isProjectList)).toHaveLength(3);
        expect(yield* Queue.size(rig.opened)).toBe(0);
        expect(rig.closes()).toBe(0);
        yield* rig.dispose;
      }),
  );

  it.effect(
    "the organization's services subscription that outlives its establishment deadline on a live socket recovers alone, never replacing the socket",
    () =>
      Effect.gen(function* () {
        // Live, 2026-10-01: one subscription stuck past its 60 s deadline replaced the org's
        // socket. Shared by every project, the services subscription is retried on its own:
        // the projects waiting on it recover with it, the project list never leaves.
        let hung = true;
        const rig = yield* setup({
          hang: (request) =>
            hung &&
            request.descriptor.kind === "query-membership" &&
            request.descriptor.query.kind === "services-of-organization",
          policy: { establishmentDeadlineMs: 100 },
        });
        yield* settleUntil(
          rig.runtime,
          (state) => rig.interestOf(state, rig.list)?.status === "observing",
        );
        yield* TestClock.adjust("100 millis");
        const first = yield* settleUntil(
          rig.runtime,
          (state) =>
            rig.settled(state) &&
            rig.inventories.every((lease) => rig.interestOf(state, lease)?.status === "recovering"),
        );
        expect(rig.inventories.map((lease) => rig.interestOf(first, lease))).toEqual(
          rig.inventories.map(() =>
            expect.objectContaining({
              status: "recovering",
              identity: expect.objectContaining({ receiver: rig.live }),
            }),
          ),
        );
        expect(rig.interestOf(first, rig.list)).toMatchObject({
          status: "observing",
          identity: { receiver: rig.live },
        });
        expect(rig.closes()).toBe(0);

        hung = false;
        yield* TestClock.adjust("40 millis");
        const recovered = yield* settleUntil(rig.runtime, (state) =>
          rig.inventories.every((lease) => rig.interestOf(state, lease)?.status === "observing"),
        );
        expect(rig.inventories.map((lease) => rig.interestOf(recovered, lease))).toEqual(
          rig.inventories.map(() =>
            expect.objectContaining({ identity: expect.objectContaining({ receiver: rig.live }) }),
          ),
        );
        expect(yield* Queue.size(rig.opened)).toBe(0);
        expect(rig.closes()).toBe(0);
        yield* rig.dispose;
      }),
  );

  it.effect.each([
    [
      "a project's record",
      { kind: "project-record", project: project("project-d") },
      (ticket: ReadTicket) => ticket.target.kind === "project",
    ],
    [
      "a project's lag-free services check",
      { kind: "project-services-check", project: project("project-d") },
      (ticket: ReadTicket) =>
        ticket.target.kind === "query" && ticket.target.descriptor.kind === "services-of-project",
    ],
  ] as const)(
    "%s whose read fails recovers alone, on the live receiver",
    ([, descriptor, isItsRead]) =>
      Effect.gen(function* () {
        const rig = yield* setup({ read: failFirst(1, isItsRead, refused(503, "server")) });
        yield* settleUntil(rig.runtime, (state) =>
          rig.leases.every((lease) => rig.interestOf(state, lease)?.status === "observing"),
        );
        const leaseScope = yield* Scope.make();
        const lease = yield* rig.runtime
          .acquire(descriptor as RuntimeInterestDescriptor)
          .pipe(Scope.provide(leaseScope));
        const first = yield* settleUntil(
          rig.runtime,
          (state) => rig.interestOf(state, lease)?.status === "recovering",
        );
        expect(rig.interestOf(first, lease)).toMatchObject({ identity: { receiver: rig.live } });
        expect(rig.leases.map((held) => rig.interestOf(first, held)?.status)).toEqual(
          rig.leases.map(() => "observing"),
        );

        yield* TestClock.adjust("10 millis");
        const recovered = yield* settleUntil(
          rig.runtime,
          (state) => rig.interestOf(state, lease)?.status === "observing",
        );
        expect(rig.interestOf(recovered, lease)).toMatchObject({
          identity: { receiver: rig.live },
        });
        expect(rig.leases.map((held) => rig.interestOf(recovered, held)?.status)).toEqual(
          rig.leases.map(() => "observing"),
        );
        expect(yield* Queue.size(rig.opened)).toBe(0);
        expect(rig.closes()).toBe(0);
        yield* Scope.close(leaseScope, Exit.void);
        yield* rig.dispose;
      }),
  );

  it.effect.each([
    [
      "an invalidation re-reads every subscription on a socket of its own",
      {},
      { opened: 1, closes: 1, listReRead: true },
    ],
    [
      "Try now restarts only the stalled ones, on the socket that is open",
      { retry: true },
      { opened: 0, closes: 0, listReRead: false },
    ],
  ] as const)(
    "while the organization's services subscription is stalled, %s",
    ([, refreshOptions, expected]) =>
      Effect.gen(function* () {
        // PR #60 review: an accepted creation, a Mate's delete or "not listed yet" invalidates the
        // organization's data to read it again; a stalled sibling must not narrow that to an
        // in-place restart, which leaves the healthy project list unread.
        const rig = yield* setup({
          hang: (request) =>
            request.descriptor.kind === "query-membership" &&
            request.descriptor.query.kind === "services-of-organization",
          policy: { establishmentDeadlineMs: 100 },
        });
        yield* settleUntil(
          rig.runtime,
          (state) => rig.interestOf(state, rig.list)?.status === "observing",
        );
        yield* TestClock.adjust("100 millis");
        yield* settleUntil(
          rig.runtime,
          (state) =>
            rig.settled(state) &&
            rig.inventories.every((lease) => rig.interestOf(state, lease)?.status === "recovering"),
        );
        const sent = rig.registrations.length;

        yield* rig.runtime.refresh(organization, refreshOptions);
        yield* settleUntil(rig.runtime, () => false, 20);

        expect({
          opened: yield* Queue.size(rig.opened),
          closes: rig.closes(),
          listReRead: rig.registrations.slice(sent).some(isProjectList),
        }).toEqual(expected);
        yield* rig.dispose;
      }),
  );

  it.effect.each([
    ["timed out", unanswered("timeout")],
    ["was lost on the network", unanswered("network")],
    ["was cancelled in flight", unanswered("cancelled")],
    ["was answered without a readable confirmation", unanswered("malformed")],
  ] as const)(
    "a project list registration that %s leaves its ownership uncertain and replaces the receiver",
    ([, failure]) =>
      Effect.gen(function* () {
        const rig = yield* setup({ register: failFirst(1, isProjectList, failure) });
        const moved = yield* settleUntil(rig.runtime, (state) =>
          rig.leases.every((lease) => {
            const interest = rig.interestOf(state, lease);
            return (
              interest?.status === "recovering" &&
              interest.identity.receiver.receiverId !== rig.live.receiverId
            );
          }),
        );
        expect(rig.leases.map((lease) => rig.interestOf(moved, lease)?.status)).toEqual([
          "recovering",
          "recovering",
          "recovering",
        ]);
        expect(rig.closes()).toBe(1);

        yield* TestClock.adjust("10 millis");
        const replacement = yield* Queue.take(rig.opened);
        const recovered = yield* settleUntil(rig.runtime, (state) =>
          rig.leases.every((lease) => rig.interestOf(state, lease)?.status === "observing"),
        );
        expect(replacement.handle.identity.receiverId).not.toBe(rig.live.receiverId);
        expect(
          rig.leases.map((lease) => rig.interestOf(recovered, lease)?.identity.receiver),
        ).toEqual([
          replacement.handle.identity,
          replacement.handle.identity,
          replacement.handle.identity,
        ]);
        yield* rig.dispose;
      }),
  );

  it.effect(
    "a project list refused past its attempt limit fails with its own retry, on the live receiver",
    () =>
      Effect.gen(function* () {
        let healed = false;
        const rig = yield* setup({
          register: (request) =>
            isProjectList(request) && !healed ? refused(429, "registration") : null,
          policy: { recoveryAttemptLimit: 2 },
        });
        const first = yield* settleUntil(
          rig.runtime,
          (state) => rig.settled(state) && rig.interestOf(state, rig.list)?.status === "recovering",
        );
        expect(rig.interestOf(first, rig.list)).toMatchObject({
          attempt: 1,
          identity: { receiver: rig.live },
        });
        yield* TestClock.adjust("10 millis");
        yield* settleUntil(rig.runtime, (state) => {
          const list = rig.interestOf(state, rig.list);
          return list?.status === "recovering" && list.attempt === 2 && list.nextRetryAtMs > 10;
        });
        yield* TestClock.adjust("20 millis");
        const failed = yield* settleUntil(
          rig.runtime,
          (state) => rig.interestOf(state, rig.list)?.status === "failed",
        );
        expect(rig.interestOf(failed, rig.list)).toMatchObject({
          status: "failed",
          attempts: 3,
          retryAtMs: 70,
          identity: { receiver: rig.live },
        });
        expect(rig.inventories.map((lease) => rig.interestOf(failed, lease)?.status)).toEqual([
          "observing",
          "observing",
        ]);

        healed = true;
        yield* TestClock.adjust("40 millis");
        const recovered = yield* settleUntil(
          rig.runtime,
          (state) => rig.interestOf(state, rig.list)?.status === "observing",
        );
        expect(rig.interestOf(recovered, rig.list)).toMatchObject({
          status: "observing",
          identity: { receiver: rig.live },
        });
        expect(yield* Queue.size(rig.opened)).toBe(0);
        expect(rig.closes()).toBe(0);
        yield* rig.dispose;
      }),
  );

  it.effect.each([
    ["its socket closes", (): ReceiverEvent => ({ kind: "closed", reason: "network lost" })],
    [
      "a frame arrives for the registration the platform refused",
      (name: RegistrationRequest["subscriptionName"]): ReceiverEvent => ({
        kind: "malformed",
        subscriptionName: name,
      }),
    ],
  ] as const)(
    "while the project list waits out its backoff on a live receiver, %s: the receiver goes at once",
    ([, event]) =>
      Effect.gen(function* () {
        const rig = yield* setup({
          register: failFirst(1, isProjectList, refused(502, "server")),
          policy: { recoveryBackoffStartMs: 1_000, recoveryBackoffMaxMs: 1_000 },
        });
        const waiting = yield* settleUntil(
          rig.runtime,
          (state) => rig.settled(state) && rig.interestOf(state, rig.list)?.status === "recovering",
        );
        expect(rig.interestOf(waiting, rig.list)).toMatchObject({
          identity: { receiver: rig.live },
        });

        // Had the platform registered it after all, the adapter would report its frames as naming
        // a registration it does not hold.
        yield* Queue.offer(
          rig.events,
          event(rig.registrations.find(isProjectList)!.subscriptionName),
        );
        const moved = yield* settleUntil(rig.runtime, (state) =>
          rig.leases.every(
            (lease) =>
              rig.interestOf(state, lease)?.identity.receiver.receiverId !== rig.live.receiverId,
          ),
        );
        expect(rig.leases.map((lease) => rig.interestOf(moved, lease)?.status)).toEqual([
          "recovering",
          "recovering",
          "recovering",
        ]);
        expect(rig.closes()).toBe(1);

        yield* TestClock.adjust("1 second");
        const replacement = yield* Queue.take(rig.opened);
        const recovered = yield* settleUntil(rig.runtime, (state) =>
          rig.leases.every((lease) => rig.interestOf(state, lease)?.status === "observing"),
        );
        expect(
          rig.leases.map((lease) => rig.interestOf(recovered, lease)?.identity.receiver),
        ).toEqual([
          replacement.handle.identity,
          replacement.handle.identity,
          replacement.handle.identity,
        ]);
        yield* rig.dispose;
      }),
  );
  it.effect("a tab back before its pause resumes the project list waiting on its receiver", () =>
    Effect.gen(function* () {
      const visibilityState = yield* Ref.make<"visible" | "hidden">("visible");
      const visibilityChanges = yield* Queue.unbounded<"visible" | "hidden">();
      const rig = yield* setup({
        register: failFirst(1, isProjectList, refused(429, "registration")),
        policy: { hiddenReceiverPauseAfterMs: 1_000 },
        visibility: {
          current: Ref.get(visibilityState),
          changes: Stream.fromQueue(visibilityChanges),
        },
      });
      yield* settleUntil(
        rig.runtime,
        (state) => rig.settled(state) && rig.interestOf(state, rig.list)?.status === "recovering",
      );

      // Hidden through the list's backoff: nothing retries behind a hidden tab.
      yield* Ref.set(visibilityState, "hidden");
      yield* Queue.offer(visibilityChanges, "hidden");
      yield* settleUntil(rig.runtime, () => false, 20);
      yield* TestClock.adjust("100 millis");
      const hidden = yield* settleUntil(rig.runtime, () => false, 20);
      expect(rig.interestOf(hidden, rig.list)?.status).toBe("recovering");
      expect(rig.registrations.filter(isProjectList)).toHaveLength(1);

      // Back long before the receiver would pause: the list retries on the receiver it waits on.
      yield* Ref.set(visibilityState, "visible");
      yield* Queue.offer(visibilityChanges, "visible");
      const shown = yield* settleUntil(
        rig.runtime,
        (state) => rig.interestOf(state, rig.list)?.status === "observing",
      );
      expect(rig.interestOf(shown, rig.list)).toMatchObject({
        status: "observing",
        identity: { receiver: rig.live },
      });
      expect(yield* Queue.size(rig.opened)).toBe(0);
      yield* rig.dispose;
    }),
  );
});

describe("a recovery round", () => {
  it.effect(
    "re-establishes the interests that are due concurrently, under its bound, the project list first",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const opened = yield* Queue.unbounded<{
          readonly handle: ReceiverHandle;
          readonly events: Queue.Queue<ReceiverEvent>;
        }>();
        const release = yield* Deferred.make<void>();
        let gated = false;
        /** The interests with a direct read in flight while reads are held. */
        const reading = new Set<string>();
        let peak = 0;
        /** Answers once released, counting the interests waiting on it meanwhile. */
        const held = <Answer>(interest: string, answer: Answer) =>
          Effect.sync(() => {
            reading.add(interest);
            peak = Math.max(peak, reading.size);
          }).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.ensuring(Effect.sync(() => reading.delete(interest))),
            Effect.as(answer),
          );
        const adapter: ZeropsDataAdapter = {
          ...makeAdapterHarness().adapter,
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
          read: (ticket) => {
            if (!gated || ticket.owner.kind !== "interest")
              return Effect.succeed({ observations: [] });
            return held(ticket.owner.identity.key, { observations: [] });
          },
          // A project's own registration: its current metrics, the one thing it reads alone.
          register: (_receiver, request) =>
            gated && request.descriptor.kind === "current-metrics"
              ? held(request.identity.key, { responseObservations: [] })
              : Effect.succeed({ responseObservations: [] }),
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({
            recoveryConcurrency: 2,
            recoveryBackoffStartMs: 10,
            recoveryBackoffMaxMs: 10,
          }),
        });
        const leaseScope = yield* Scope.make();
        // Leased before the list, the projects come first in the organization's own order.
        const projects = yield* Effect.forEach(["b", "c", "d"], (id) =>
          runtime
            .acquire({ kind: "project-current-metrics", project: project(`project-${id}`) })
            .pipe(Scope.provide(leaseScope)),
        );
        const list = yield* runtime
          .acquire({
            kind: "organization-inventory",
            organization: project("project-a").organization,
          })
          .pipe(Scope.provide(leaseScope));
        const leases = [...projects, list];
        const statuses = (state: ZeropsDataState) =>
          leases.map((lease) => state.interests.get(lease.interest)?.interest.status);
        const first = yield* Queue.take(opened);
        yield* settleUntil(runtime, (state) =>
          statuses(state).every((status) => status === "observing"),
        );

        gated = true;
        yield* Queue.offer(first.events, { kind: "closed", reason: "network lost" });
        yield* settleUntil(runtime, (state) =>
          leases.every((lease) => {
            const interest = state.interests.get(lease.interest)?.interest;
            return (
              interest?.status === "recovering" &&
              interest.identity.receiver.receiverId !== first.handle.identity.receiverId
            );
          }),
        );
        yield* TestClock.adjust("10 millis");
        yield* settleUntil(runtime, () => reading.size === 2);
        // Room for a third establishment to show itself, were the bound not held.
        yield* settleUntil(runtime, () => false, 50);
        expect([...reading].sort()).toEqual([list.interest, projects[0]!.interest].sort());

        yield* Deferred.succeed(release, undefined);
        const recovered = yield* settleUntil(runtime, (state) =>
          statuses(state).every((status) => status === "observing"),
        );
        expect(statuses(recovered)).toEqual(["observing", "observing", "observing", "observing"]);
        expect(peak).toBe(2);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        registry.dispose();
      }),
  );

  it.effect("starts no more of its retries on a receiver that failed under one of them", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const opened = yield* Queue.unbounded<{
        readonly handle: ReceiverHandle;
        readonly events: Queue.Queue<ReceiverEvent>;
      }>();
      const receiversOpened: string[] = [];
      /** How many registrations each receiver was sent, by the order it opened in. */
      const sentTo = new Map<string, number>();
      const adapter: ZeropsDataAdapter = {
        ...makeAdapterHarness().adapter,
        openReceiver: (_scope, organization, identity) =>
          Effect.gen(function* () {
            receiversOpened.push(identity.receiverId);
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
        register: (receiver) =>
          Effect.suspend(() => {
            const sent = (sentTo.get(receiver.identity.receiverId) ?? 0) + 1;
            sentTo.set(receiver.identity.receiverId, sent);
            // The second receiver's first registration never gets its answer.
            return receiversOpened.indexOf(receiver.identity.receiverId) === 1 && sent === 1
              ? Effect.fail({
                  _tag: "ZeropsDataAdapterError",
                  kind: "timeout",
                  message: "Zerops request exceeded its deadline.",
                  retryable: true,
                  accountRevocationEvidence: false,
                } satisfies AdapterError)
              : Effect.succeed({ responseObservations: [] });
          }),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          recoveryConcurrency: 1,
          recoveryBackoffStartMs: 10,
          recoveryBackoffMaxMs: 10,
        }),
      });
      const leaseScope = yield* Scope.make();
      const leases = yield* Effect.forEach(["b", "c", "d"], (id) =>
        runtime
          .acquire({ kind: "project-inventory", project: project(`project-${id}`) })
          .pipe(Scope.provide(leaseScope)),
      );
      const statuses = (state: ZeropsDataState) =>
        leases.map((lease) => state.interests.get(lease.interest)?.interest.status);
      const first = yield* Queue.take(opened);
      yield* settleUntil(runtime, (state) =>
        statuses(state).every((status) => status === "observing"),
      );

      yield* Queue.offer(first.events, { kind: "closed", reason: "network lost" });
      yield* settleUntil(runtime, (state) =>
        statuses(state).every((status) => status === "recovering"),
      );
      // The round's first retry loses its registration's answer: the round's other retries never
      // reach that receiver, and every interest moves to the next one at once.
      yield* TestClock.adjust("10 millis");
      yield* settleUntil(runtime, () => receiversOpened.length === 2);
      const replaced = yield* settleUntil(runtime, (state) =>
        leases.every(
          (lease) =>
            state.interests.get(lease.interest)?.interest.identity.receiver.receiverEpoch === 3,
        ),
      );
      expect(sentTo.get(receiversOpened[1]!)).toBe(1);
      expect(statuses(replaced)).toEqual(["recovering", "recovering", "recovering"]);

      yield* TestClock.adjust("10 millis");
      const recovered = yield* settleUntil(runtime, (state) =>
        statuses(state).every((status) => status === "observing"),
      );
      expect(statuses(recovered)).toEqual(["observing", "observing", "observing"]);
      expect(receiversOpened).toHaveLength(3);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      registry.dispose();
    }),
  );
});

describe("registrations", () => {
  const label = (request: RegistrationRequest): string => {
    const descriptor = request.descriptor;
    if (descriptor.kind === "entity-updates") return `${descriptor.entity} updates`;
    if (descriptor.kind === "current-metrics")
      return `metrics of ${descriptor.query.project.projectId}`;
    return descriptor.kind === "query-membership" ? descriptor.query.kind : descriptor.kind;
  };

  it.effect(
    "are sent a bounded number at a time, the project list's ahead of the projects' already waiting",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const servicesAnswer = yield* Deferred.make<void>();
        const sent: string[] = [];
        let inFlight = 0;
        let peak = 0;
        const adapter: ZeropsDataAdapter = {
          ...makeAdapterHarness().adapter,
          register: (_receiver, request) =>
            Effect.gen(function* () {
              sent.push(label(request));
              inFlight += 1;
              peak = Math.max(peak, inFlight);
              if (label(request).startsWith("metrics of")) yield* Deferred.await(servicesAnswer);
              return { responseObservations: [] };
            }).pipe(Effect.ensuring(Effect.sync(() => void (inFlight -= 1)))),
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          policy: makeZeropsDataPolicy({ registrationConcurrency: 1 }),
        });
        const leaseScope = yield* Scope.make();
        const projects = yield* Effect.forEach(["b", "c", "d"], (id) =>
          runtime
            .acquire({ kind: "project-current-metrics", project: project(`project-${id}`) })
            .pipe(Scope.provide(leaseScope)),
        );
        yield* settleUntil(runtime, () => sent.includes("metrics of project-b"));
        // project-c's and project-d's metrics queue behind project-b's.
        yield* settleUntil(runtime, () => false, 50);
        const list = yield* runtime
          .acquire({
            kind: "organization-inventory",
            organization: project("project-a").organization,
          })
          .pipe(Scope.provide(leaseScope));
        yield* settleUntil(runtime, () => false, 50);
        expect(sent).toEqual(["metrics of project-b"]);

        yield* Deferred.succeed(servicesAnswer, undefined);
        const leases = [...projects, list];
        yield* settleUntil(runtime, (state) =>
          leases.every(
            (lease) => state.interests.get(lease.interest)?.interest.status === "observing",
          ),
        );
        // The list's registration goes ahead of the projects' already waiting; its next one, asked
        // for once that answers, waits its turn.
        expect(sent).toEqual([
          "metrics of project-b",
          "project updates",
          "metrics of project-c",
          "metrics of project-d",
          "projects-of-organization",
        ]);
        expect(peak).toBe(1);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        registry.dispose();
      }),
  );

  it.effect("a registration that waits for its turn is sent with its whole deadline", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const sent: Array<{
        readonly organizationId: string;
        readonly atMs: number;
        readonly remainingMs: number;
      }> = [];
      const adapter: ZeropsDataAdapter = {
        ...makeAdapterHarness().adapter,
        register: (_receiver, request, context) =>
          Effect.gen(function* () {
            const descriptor = request.descriptor;
            if (descriptor.kind === "entity-updates" && descriptor.entity === "service") {
              const now = yield* Clock.currentTimeMillis;
              sent.push({
                organizationId: descriptor.organization.organizationId,
                atMs: now,
                remainingMs: context.deadlineMs - now,
              });
              if (descriptor.organization.organizationId === "org-a")
                yield* Effect.sleep("60 millis");
            }
            return { responseObservations: [] };
          }),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({ registrationConcurrency: 1, registrationDeadlineMs: 100 }),
      });
      const elsewhere = project("project-x");
      const leaseScope = yield* Scope.make();
      yield* runtime
        .acquireMany([
          { kind: "project-inventory", project: project("project-a") },
          {
            kind: "project-inventory",
            project: {
              ...elsewhere,
              organization: {
                ...elsewhere.organization,
                organizationId: ZeropsOrganizationId.make("org-b"),
              },
            },
          },
        ])
        .pipe(Scope.provide(leaseScope));
      yield* settleUntil(runtime, () => sent.length > 0);
      yield* settleUntil(runtime, () => false, 50);
      expect(sent).toEqual([{ organizationId: "org-a", atMs: 0, remainingMs: 100 }]);

      yield* TestClock.adjust("60 millis");
      yield* settleUntil(runtime, () => sent.length > 1);
      expect(sent).toEqual([
        { organizationId: "org-a", atMs: 0, remainingMs: 100 },
        { organizationId: "org-b", atMs: 60, remainingMs: 100 },
      ]);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      registry.dispose();
    }),
  );
});

describe("I8: after resume every leased interest reaches observing or failed(retryAt)", () => {
  const policy = makeZeropsDataPolicy({
    hiddenReceiverPauseAfterMs: 50,
    recoveryAttemptLimit: 2,
    recoveryBackoffStartMs: 10,
    recoveryBackoffMaxMs: 40,
    establishmentDeadlineMs: 200,
    httpDeadlineMs: 100,
  });
  // Each attempt waits at most its backoff and then its establishment deadline; past the
  // attempt limit the interest is failed with a retry time. One more round covers the resume.
  const boundMs =
    (policy.recoveryAttemptLimit + 2) *
    (policy.recoveryBackoffMaxMs + policy.establishmentDeadlineMs);
  const stepMs = 10;
  const descriptors: ReadonlyArray<RuntimeInterestDescriptor> = [
    topologyDescriptor,
    { kind: "project-activity", project: topologyDescriptor.project },
    { kind: "project-current-metrics", project: topologyDescriptor.project },
    {
      kind: "project-process-history",
      project: topologyDescriptor.project,
      before: null,
      limit: 20,
    },
    {
      kind: "project-metric-history",
      project: topologyDescriptor.project,
      window: { timeGroupBy: "1h", limit: 24, timeZone: "UTC" },
    },
  ];
  const isActivityQuery = (request: RegistrationRequest) =>
    request.descriptor.kind === "query-membership" &&
    request.descriptor.query.kind === "running-processes-of-organization";
  const failure = (message: string): AdapterError => ({
    _tag: "ZeropsDataAdapterError",
    kind: "registration",
    message,
    retryable: true,
    accountRevocationEvidence: false,
  });

  // Work sent before the tab hid and settled only after the pause, under the identity the
  // pause left in place.
  const inFlight = ["none", "fails after the pause", "succeeds after the pause"] as const;
  // What the platform does to the attempts the foreground return starts.
  const faults = [
    "none",
    "the receiver fails to open once",
    "a required registration fails once",
    "a required registration fails every time",
    "an optional registration fails every time",
    "a registration never answers once",
    "a direct read fails once",
    "a malformed frame names one subscription",
  ] as const;
  const hiddenFor = ["past the pause", "shorter than the pause"] as const;

  const reached = (interest: DesiredInterestState["interest"] | undefined): boolean =>
    interest?.status === "observing" ||
    (interest?.status === "failed" && interest.retryAtMs !== null);

  for (const pending of inFlight) {
    for (const fault of faults) {
      for (const hidden of hiddenFor) {
        it.effect(`in-flight ${pending}, ${fault}, hidden ${hidden}`, () =>
          Effect.gen(function* () {
            const registry = AtomRegistry.make();
            let resumed = false;
            let opensAfterResume = 0;
            let heldRegistration = false;
            let requiredFailures = 0;
            let hangs = 0;
            let readFailures = 0;
            // Past the bound the platform heals: every interest must then observe, so an
            // interest that visited `failed` and lost its retry is caught.
            let healed = false;
            let liveEvents: Queue.Queue<ReceiverEvent> | null = null;
            let activitySubscription: string | null = null;
            let malformedSent = false;
            const registering = yield* Deferred.make<void>();
            const heldOutcome = yield* Deferred.make<void, AdapterError>();
            const adapter: ZeropsDataAdapter = {
              openReceiver: (_scope, organization, identity) => {
                if (resumed && fault === "the receiver fails to open once") {
                  opensAfterResume += 1;
                  if (opensAfterResume === 1)
                    return Effect.fail({ ...failure("offline"), kind: "socket-open" });
                }
                return Queue.unbounded<ReceiverEvent>().pipe(
                  Effect.map((events) => {
                    liveEvents = events;
                    return {
                      identity,
                      organization,
                      delivery: "hot-single-consumer-buffered-before-open-resolves",
                      events: Stream.fromQueue(events),
                    } satisfies ReceiverHandle;
                  }),
                );
              },
              register: (_receiver, request) => {
                const ok = Effect.succeed({ responseObservations: [] });
                if (isActivityQuery(request)) activitySubscription = request.subscriptionName;
                if (healed) return ok;
                if (!resumed) {
                  if (pending === "none" || heldRegistration || !isActivityQuery(request))
                    return ok;
                  heldRegistration = true;
                  return Deferred.succeed(registering, undefined).pipe(
                    Effect.andThen(Deferred.await(heldOutcome)),
                    Effect.andThen(ok),
                  );
                }
                const isRequired =
                  request.descriptor.kind === "entity-updates" &&
                  request.descriptor.entity === "service";
                if (fault === "a required registration fails once" && isRequired) {
                  requiredFailures += 1;
                  if (requiredFailures === 1) return Effect.fail(failure("service feed refused"));
                }
                if (fault === "a required registration fails every time" && isRequired)
                  return Effect.fail(failure("service feed refused"));
                if (
                  fault === "an optional registration fails every time" &&
                  request.descriptor.kind === "current-metrics"
                )
                  return Effect.fail(failure("metrics unavailable"));
                if (fault === "a registration never answers once" && isRequired) {
                  hangs += 1;
                  if (hangs === 1) return Effect.never;
                }
                return ok;
              },
              read: (ticket) => {
                if (
                  resumed &&
                  !healed &&
                  fault === "a direct read fails once" &&
                  ticket.target.kind === "project"
                ) {
                  readFailures += 1;
                  if (readFailures === 1)
                    return Effect.fail({ ...failure("read refused"), kind: "server" });
                }
                return Effect.succeed({ observations: [] });
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
              policy,
              visibility: {
                current: Ref.get(visibilityState),
                changes: Stream.fromQueue(visibilityChanges),
              },
            });
            const leaseScope = yield* Scope.make();
            const leases = yield* Effect.forEach(descriptors, (descriptor) =>
              runtime.acquire(descriptor).pipe(Scope.provide(leaseScope)),
            );
            const arrived = new Set<string>();
            const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
              if (!resumed) return;
              for (const lease of leases) {
                if (reached(state.interests.get(lease.interest)?.interest)) {
                  arrived.add(lease.interest);
                }
              }
            });
            if (pending !== "none") yield* Deferred.await(registering);
            for (let index = 0; index < 20; index++) yield* Effect.yieldNow;

            yield* Ref.set(visibilityState, "hidden");
            yield* Queue.offer(visibilityChanges, "hidden");
            if (hidden === "past the pause") {
              yield* TestClock.adjust(`${policy.hiddenReceiverPauseAfterMs} millis`);
              for (let index = 0; index < 20; index++) yield* Effect.yieldNow;
            }
            if (pending === "fails after the pause")
              yield* Deferred.fail(heldOutcome, failure("socket closed"));
            if (pending === "succeeds after the pause")
              yield* Deferred.succeed(heldOutcome, undefined);
            for (let index = 0; index < 20; index++) yield* Effect.yieldNow;

            resumed = true;
            yield* Ref.set(visibilityState, "visible");
            yield* Queue.offer(visibilityChanges, "visible");
            for (let elapsed = 0; elapsed <= boundMs; elapsed += stepMs) {
              for (let index = 0; index < 20; index++) yield* Effect.yieldNow;
              const state = yield* runtime.state;
              for (const lease of leases) {
                if (reached(state.interests.get(lease.interest)?.interest)) {
                  arrived.add(lease.interest);
                }
              }
              if (arrived.size === leases.length) {
                if (
                  fault !== "a malformed frame names one subscription" ||
                  malformedSent ||
                  liveEvents === null ||
                  activitySubscription === null
                )
                  break;
                // Once everything has settled, a frame the activity subscription cannot
                // parse sends its interests round again.
                malformedSent = true;
                arrived.clear();
                yield* Queue.offer(liveEvents, {
                  kind: "malformed",
                  subscriptionName: activitySubscription,
                });
              }
              yield* TestClock.adjust(`${stepMs} millis`);
            }

            const final = yield* runtime.state;
            const stranded = leases
              .filter((lease) => !arrived.has(lease.interest))
              .map((lease) => final.interests.get(lease.interest)?.interest);
            expect(stranded).toEqual([]);

            healed = true;
            for (let elapsed = 0; elapsed <= boundMs; elapsed += stepMs) {
              yield* TestClock.adjust(`${stepMs} millis`);
              for (let index = 0; index < 20; index++) yield* Effect.yieldNow;
            }
            const healedState = yield* runtime.state;
            expect(
              leases
                .map((lease) => healedState.interests.get(lease.interest)?.interest)
                .filter((interest) => interest?.status !== "observing"),
            ).toEqual([]);

            yield* runtime.shutdown("application-close");
            yield* Scope.close(leaseScope, Exit.void);
            unsubscribe();
            registry.dispose();
          }),
        );
      }
    }
  }
});

describe("publication: one per task", () => {
  /** Every socket login waits forever, so an establishment publishes nothing of its own. */
  const silentAdapter: ZeropsDataAdapter = {
    ...makeAdapterHarness().adapter,
    openReceiver: () => Effect.never,
  };

  /** Lets the task the calls ran in end, and the ones it scheduled run. */
  const nextTask = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

  const makePublishing = Effect.fnUntraced(function* () {
    const registry = AtomRegistry.make();
    const runtime = yield* makeZeropsDataRuntime({
      scope: runtimeScope,
      adapter: silentAdapter,
      atomRegistry: registry,
      makeOpaqueId: makeIdFactory(),
    });
    const published: Array<ZeropsDataState> = [];
    const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
      published.push(state);
    });
    yield* Effect.addFinalizer(() =>
      runtime.shutdown("application-close").pipe(
        Effect.andThen(
          Effect.sync(() => {
            unsubscribe();
            registry.dispose();
          }),
        ),
      ),
    );
    return { runtime, published };
  });

  it.effect("control changes in one task publish once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { runtime, published } = yield* makePublishing();
        const [first, second] = threeProjects;
        const topology = yield* runtime.acquire(first!);
        const other = yield* runtime.acquire(second!);
        yield* nextTask;

        expect(published).toHaveLength(1);
        expect([...published[0]!.interests.keys()]).toEqual([topology.interest, other.interest]);
      }),
    ),
  );

  it.effect("ingress and control in the same task publish once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { runtime, published } = yield* makePublishing();
        // The observation is queued now; the ingress loop takes it once this task yields.
        const observed = yield* Effect.forkChild(
          runtime.observeAccess({
            kind: "access-verification-started",
            accountEpoch: runtimeScope.epoch,
          }),
          { startImmediately: true },
        );
        const lease = yield* runtime.acquire(threeProjects[0]!);
        yield* Fiber.join(observed);
        yield* nextTask;

        expect(published).toHaveLength(1);
        expect(published[0]!.access.status).toBe("verifying");
        expect([...published[0]!.interests.keys()]).toEqual([lease.interest]);
      }),
    ),
  );

  it.effect("a lease released inside the same task never publishes its interest", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { runtime, published } = yield* makePublishing();
        const kept = yield* runtime.acquire(threeProjects[0]!);
        const dropped = yield* runtime.acquire(threeProjects[1]!);
        yield* dropped.release;
        yield* nextTask;

        expect(published.map((state) => [...state.interests.keys()])).toEqual([[kept.interest]]);
      }),
    ),
  );

  it.effect("an establishment starts for every lease taken by acquireMany", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: harness.adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
        });
        yield* Effect.addFinalizer(() =>
          runtime
            .shutdown("application-close")
            .pipe(Effect.andThen(Effect.sync(() => registry.dispose()))),
        );
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });
        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

        const taken = yield* runtime.acquireMany(threeProjects);
        const leases = taken.map((result) => Result.getOrThrow(result));
        yield* waitForState(states, (state) =>
          leases.every(
            (lease) => state.interests.get(lease.interest)?.interest.status === "observing",
          ),
        );

        expect(new Set(leases.map((lease) => lease.interest)).size).toBe(threeProjects.length);
        expect(harness.counts().opens).toBe(1);
      }),
    ),
  );
});

describe("an organization's reads, whatever its number of projects (DESIGN §4.1)", () => {
  /** What reached the platform: each registration and each read, by what it asked for. */
  const platform = () => {
    const sent: string[] = [];
    let events: Queue.Queue<ReceiverEvent> | null = null;
    const labelOf = (request: RegistrationRequest): string =>
      request.descriptor.kind === "entity-updates"
        ? `${request.descriptor.entity} updates`
        : request.descriptor.kind === "query-membership"
          ? request.descriptor.query.kind
          : request.descriptor.kind;
    const adapter: ZeropsDataAdapter = {
      ...makeAdapterHarness().adapter,
      openReceiver: (_scope, organization, identity) =>
        Effect.gen(function* () {
          sent.push("socket");
          events = yield* Queue.unbounded<ReceiverEvent>();
          return {
            identity,
            organization,
            delivery: "hot-single-consumer-buffered-before-open-resolves",
            events: Stream.fromQueue(events),
          } satisfies ReceiverHandle;
        }),
      register: (_receiver, request) =>
        Effect.sync(() => {
          sent.push(`register ${labelOf(request)}`);
          return { responseObservations: [] };
        }),
      read: (ticket) =>
        Effect.sync(() => {
          sent.push(
            `read ${ticket.target.kind === "query" ? ticket.target.descriptor.kind : ticket.target.kind}`,
          );
          return { observations: [] };
        }),
    };
    return {
      adapter,
      sent,
      drop: Effect.suspend(() =>
        events === null
          ? Effect.die("no socket is open")
          : Queue.offer(events, { kind: "closed", reason: "network lost" }),
      ),
    };
  };

  /** The organization's list, and each project's inventory and activity, as the web app holds them. */
  const openAccount = (count: number) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const { adapter, sent, drop } = platform();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({ recoveryBackoffStartMs: 10, recoveryBackoffMaxMs: 10 }),
      });
      const leaseScope = yield* Scope.make();
      const projects = Array.from({ length: count }, (_, index) => project(`project-${index}`));
      const leases = yield* Effect.forEach(
        [
          { kind: "organization-inventory" as const, organization: projects[0]!.organization },
          ...projects.flatMap((ref) => [
            { kind: "project-inventory" as const, project: ref },
            { kind: "project-activity" as const, project: ref },
          ]),
        ],
        (descriptor) => runtime.acquire(descriptor).pipe(Scope.provide(leaseScope)),
      );
      const observing = (state: ZeropsDataState) =>
        leases.every(
          (lease) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
      yield* settleUntil(runtime, observing, 2_000);
      const close = Effect.gen(function* () {
        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        registry.dispose();
      });
      return { runtime, sent, drop, observing, close };
    });

  const ORGANIZATION_CALLS = [
    "socket",
    "register project updates",
    "register projects-of-organization",
    "register service updates",
    "register services-of-organization",
    "register process updates",
    "register running-processes-of-organization",
    "read projects-of-organization",
  ];

  it.effect.each([1, 6, 40])(
    "a cold load of %i projects sends the organization's searches once, none of a project's own",
    (count) =>
      Effect.gen(function* () {
        const account = yield* openAccount(count);

        expect(account.observing(yield* account.runtime.state)).toBe(true);
        expect([...account.sent].sort()).toEqual([...ORGANIZATION_CALLS].sort());

        yield* account.close;
      }),
  );

  it.effect.each([1, 6, 40])(
    "a dropped socket with %i projects comes back with the organization's searches once",
    (count) =>
      Effect.gen(function* () {
        const account = yield* openAccount(count);
        const before = account.sent.length;

        yield* account.drop;
        yield* settleUntil(account.runtime, (state) => !account.observing(state), 2_000);
        yield* TestClock.adjust("10 millis");
        const recovered = yield* settleUntil(account.runtime, account.observing, 5_000);

        expect(account.observing(recovered)).toBe(true);
        expect(account.sent.slice(before).sort()).toEqual([...ORGANIZATION_CALLS].sort());

        yield* account.close;
      }),
  );
});

describe("a registration every project shares", () => {
  it.effect("whose sender ran out of time leaves its siblings to recover, never stranded", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      let sent = 0;
      const adapter: ZeropsDataAdapter = {
        ...makeAdapterHarness().adapter,
        // The first registration never answers; every later one does at once.
        register: () =>
          ++sent === 1 ? Effect.never : Effect.succeed({ responseObservations: [] }),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({
          establishmentDeadlineMs: 100,
          registrationDeadlineMs: 1_000,
          recoveryBackoffStartMs: 10,
          recoveryBackoffMaxMs: 10,
        }),
      });
      const leases = yield* Scope.make();
      const first = yield* runtime
        .acquire({ kind: "project-activity", project: project("project-a") })
        .pipe(Scope.provide(leases));
      yield* settleUntil(runtime, () => false, 20);
      const second = yield* runtime
        .acquire({ kind: "project-activity", project: project("project-b") })
        .pipe(Scope.provide(leases));
      yield* settleUntil(runtime, () => false, 20);

      for (let step = 0; step < 30; step++) {
        yield* TestClock.adjust("50 millis");
        yield* settleUntil(runtime, () => false, 20);
      }
      const state = yield* runtime.state;

      expect(
        [first, second].map((lease) => state.interests.get(lease.interest)?.interest.status),
      ).toEqual(["observing", "observing"]);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leases, Exit.void);
      registry.dispose();
    }),
  );

  it.effect("survives the release of the interest that happened to send it", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const answer = yield* Deferred.make<void>();
      const adapter: ZeropsDataAdapter = {
        ...makeAdapterHarness().adapter,
        register: () => Deferred.await(answer).pipe(Effect.as({ responseObservations: [] })),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const sender = yield* Scope.make();
      const sibling = yield* Scope.make();
      const first = yield* runtime
        .acquire({ kind: "project-activity", project: project("project-a") })
        .pipe(Scope.provide(sender));
      yield* settleUntil(runtime, () => false, 20);
      const second = yield* runtime
        .acquire({ kind: "project-activity", project: project("project-b") })
        .pipe(Scope.provide(sibling));
      yield* settleUntil(runtime, () => false, 20);

      // The interest whose establishment sent the organization's process registrations goes.
      yield* first.release;
      yield* Deferred.succeed(answer, undefined);
      const settled = yield* settleUntil(
        runtime,
        (state) => state.interests.get(second.interest)?.interest.status === "observing",
        2_000,
      );

      expect(settled.interests.get(second.interest)?.interest.status).toBe("observing");

      yield* runtime.shutdown("application-close");
      yield* Scope.close(sibling, Exit.void);
      yield* Scope.close(sender, Exit.void);
      registry.dispose();
    }),
  );
});

it.effect(
  "anchors a renewed service inventory: a reconnect's search says what changed while down",
  () =>
    Effect.gen(function* () {
      const { decodeRegistrationResponse } = yield* Effect.promise(
        () => import("./platformProtocol.ts"),
      );
      const registry = AtomRegistry.make();
      const ref: ServiceRef = {
        kind: "service",
        project: project("p"),
        serviceId: ZeropsServiceId.make("s"),
      };
      let currentName = "First";
      let events: Queue.Queue<ReceiverEvent> | null = null;
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({ recoveryBackoffStartMs: 10, recoveryBackoffMaxMs: 10 }),
        adapter: {
          ...makeAdapterHarness().adapter,
          openReceiver: (_scope, organization, identity) =>
            Effect.gen(function* () {
              events = yield* Queue.unbounded<ReceiverEvent>();
              return {
                identity,
                organization,
                delivery: "hot-single-consumer-buffered-before-open-resolves",
                events: Stream.fromQueue(events),
              } satisfies ReceiverHandle;
            }),
          register: (_handle, request) =>
            Effect.sync(() => ({
              responseObservations:
                request.descriptor.kind === "query-membership" &&
                request.descriptor.query.kind === "services-of-organization"
                  ? decodeRegistrationResponse(request, {
                      items: [{ id: "s", projectId: "p", name: currentName, status: "ACTIVE" }],
                      totalHits: 1,
                    }).observations
                  : [],
            })),
        },
      });
      const scope = yield* Scope.make();
      const lease = yield* runtime
        .acquire({ kind: "project-inventory", project: ref.project })
        .pipe(Scope.provide(scope));
      const observing = (state: ZeropsDataState) =>
        state.interests.get(lease.interest)?.interest.status === "observing";
      const nameOf = () => {
        const read = registry.get(runtime.reads.service(ref));
        return read.value.knowledge === "observed" &&
          read.value.record.identity.knowledge === "observed"
          ? read.value.record.identity.fields.hostname
          : null;
      };
      yield* settleUntil(runtime, observing, 2_000);
      expect(nameOf()).toBe("First");

      // Renamed while the socket was down: no push of it ever arrives.
      currentName = "Changed while disconnected";
      yield* Queue.offer(events!, { kind: "closed", reason: "network lost" });
      yield* settleUntil(runtime, (state) => !observing(state), 2_000);
      yield* TestClock.adjust("10 millis");
      yield* settleUntil(runtime, observing, 2_000);

      expect(nameOf()).toBe("Changed while disconnected");

      yield* runtime.shutdown("application-close");
      yield* Scope.close(scope, Exit.void);
      registry.dispose();
    }),
);

describe("opening a Mate on a loaded organization", () => {
  it.effect("adds no call of the organization's: only the project's own metrics", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const sent: string[] = [];
      const adapter: ZeropsDataAdapter = {
        ...makeAdapterHarness().adapter,
        register: (_receiver, request) =>
          Effect.sync(() => {
            sent.push(
              request.descriptor.kind === "entity-updates"
                ? `${request.descriptor.entity} updates`
                : request.descriptor.kind === "query-membership"
                  ? request.descriptor.query.kind
                  : request.descriptor.kind,
            );
            return { responseObservations: [] };
          }),
        read: (ticket) =>
          Effect.sync(() => {
            sent.push(`read ${ticket.target.kind}`);
            return { observations: [] };
          }),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const leases = yield* Scope.make();
      const projects = ["a", "b", "c"].map((id) => project(`project-${id}`));
      const resting = yield* Effect.forEach(
        [
          { kind: "organization-inventory" as const, organization: projects[0]!.organization },
          ...projects.flatMap((ref) => [
            { kind: "project-inventory" as const, project: ref },
            { kind: "project-activity" as const, project: ref },
          ]),
        ],
        (descriptor) => runtime.acquire(descriptor).pipe(Scope.provide(leases)),
      );
      const observing = (state: ZeropsDataState, held: ReadonlyArray<InterestLease>) =>
        held.every((lease) => state.interests.get(lease.interest)?.interest.status === "observing");
      yield* settleUntil(runtime, (state) => observing(state, resting), 2_000);
      const atRest = sent.length;

      // The Mate's conversation: its topology and activity, then its live usage.
      const open = yield* Effect.forEach(
        [
          {
            kind: "project-topology" as const,
            project: projects[1]!,
            includeCurrentMetrics: false,
          },
          { kind: "project-activity" as const, project: projects[1]! },
          { kind: "project-current-metrics" as const, project: projects[1]! },
        ],
        (descriptor) => runtime.acquire(descriptor).pipe(Scope.provide(leases)),
      );
      yield* settleUntil(runtime, (state) => observing(state, open), 2_000);

      expect(sent.slice(atRest)).toEqual(["current-metrics"]);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leases, Exit.void);
      registry.dispose();
    }),
  );
});

describe("the entity table's reads by id", () => {
  it.effect("reads a new id at once while another waits out its back-off", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const events = yield* Queue.unbounded<ReceiverEvent>();
      const { decodeRegistrationResponse } = yield* Effect.promise(
        () => import("./platformProtocol.ts"),
      );
      const { decodeTableSearch } = yield* Effect.promise(() => import("./tableProtocol.ts"));
      let list: RegistrationRequest | undefined;
      const reads: Array<ReadonlyArray<string>> = [];
      const readAt: number[] = [];
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) =>
          Effect.succeed({
            identity,
            organization,
            delivery: "hot-single-consumer-buffered-before-open-resolves",
            events: Stream.fromQueue(events),
          }),
        register: (_receiver, request) => {
          if (request.descriptor.kind === "table-list") list = request;
          return Effect.succeed({
            responseObservations:
              request.descriptor.kind === "table-list"
                ? decodeRegistrationResponse(request, { items: [], totalHits: 0 }).observations
                : [],
          });
        },
        read: (ticket) => {
          const ids =
            (ticket.target as { readonly descriptor: { readonly ids?: string[] } }).descriptor
              .ids ?? [];
          reads.push(ids);
          // The platform never lists u-9.
          const found = ids.filter((id) => id !== "u-9");
          return Effect.map(
            Clock.currentTimeMillis,
            (now) => (
              readAt.push(now),
              {
                observations: decodeTableSearch(ticket, {
                  items: found.map((id) => ({
                    id,
                    serviceStackId: `service-of-${id}`,
                    key: "ZCP_MATE_ENABLED",
                    content: "1",
                  })),
                  totalHits: found.length,
                }).observations,
              }
            ),
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
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const organization = topologyDescriptor.project.organization;
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime
        .acquire({ kind: "organization-variables", organization })
        .pipe(Scope.provide(leaseScope));
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const add = (id: string) =>
        Queue.offer(events, {
          kind: "observation",
          input: {
            kind: "table-membership-observed",
            operation: "add",
            id,
            registration: list as never,
          },
          bytes: 1,
        });
      const settleFibers = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
        discard: true,
      });
      yield* add("u-9");
      yield* settleFibers;
      // Read at the grace, then past the index's lag: absent, it now waits out its back-off.
      for (let second = 0; second < 12; second += 1) {
        yield* TestClock.adjust("1 second");
        yield* settleFibers;
      }
      expect(reads).toEqual([["u-9"], ["u-9"]]);

      yield* add("u-2");
      yield* settleFibers;
      yield* TestClock.adjust("1 second");
      yield* waitForState(states, (state) => state.table.rows["user-data"].get("u-2")?.row != null);
      expect({ reads, readAt }).toEqual({
        reads: [["u-9"], ["u-9"], ["u-2"]],
        readAt: [1_000, 11_000, 13_000],
      });

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );
  it.effect("reads the rows its list's frames named without one, batched once after a grace", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const events = yield* Queue.unbounded<ReceiverEvent>();
      const { decodeRegistrationResponse } = yield* Effect.promise(
        () => import("./platformProtocol.ts"),
      );
      const { decodeTableSearch } = yield* Effect.promise(() => import("./tableProtocol.ts"));
      const { activeVersionOf } = yield* Effect.promise(() => import("./entityTable.ts"));
      let list: RegistrationRequest | undefined;
      const reads: Array<ReadonlyArray<string>> = [];
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) =>
          Effect.succeed({
            identity,
            organization,
            delivery: "hot-single-consumer-buffered-before-open-resolves",
            events: Stream.fromQueue(events),
          }),
        register: (_receiver, request) => {
          if (request.descriptor.kind === "table-list") list = request;
          return Effect.succeed({
            responseObservations:
              request.descriptor.kind === "table-list"
                ? decodeRegistrationResponse(request, { items: [], totalHits: 0 }).observations
                : [],
          });
        },
        read: (ticket) => {
          const descriptor = (ticket.target as { readonly descriptor: { readonly ids?: string[] } })
            .descriptor;
          reads.push(descriptor.ids ?? []);
          return Effect.succeed({
            observations: decodeTableSearch(ticket, {
              items: (descriptor.ids ?? []).map((id) => ({
                id,
                serviceStackId: `service-of-${id}`,
                status: "ACTIVE",
                source: "CLI",
              })),
              totalHits: descriptor.ids?.length ?? 0,
            }).observations,
          });
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
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const organization = topologyDescriptor.project.organization;
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime
        .acquire({ kind: "organization-versions", organization })
        .pipe(Scope.provide(leaseScope));
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      for (const id of ["v-1", "v-2"])
        yield* Queue.offer(events, {
          kind: "observation",
          input: {
            kind: "table-membership-observed",
            operation: "add",
            id,
            registration: list as never,
          },
          bytes: 1,
        });
      yield* Effect.yieldNow;
      expect(reads).toEqual([]);

      yield* TestClock.adjust("1 second");
      yield* waitForState(
        states,
        (state) =>
          activeVersionOf(state.table, organization, "v-1").row !== null &&
          activeVersionOf(state.table, organization, "v-2").row !== null,
      );
      expect(reads).toEqual([["v-1", "v-2"]]);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );
  it.effect(
    "reads ids that arrive while a batch reads in the next round, never stranding them",
    () =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const events = yield* Queue.unbounded<ReceiverEvent>();
        const { decodeRegistrationResponse } = yield* Effect.promise(
          () => import("./platformProtocol.ts"),
        );
        const { decodeTableSearch } = yield* Effect.promise(() => import("./tableProtocol.ts"));
        const { activeVersionOf } = yield* Effect.promise(() => import("./entityTable.ts"));
        let list: RegistrationRequest | undefined;
        const reads: Array<ReadonlyArray<string>> = [];
        const gate = yield* Deferred.make<void>();
        const adapter: ZeropsDataAdapter = {
          openReceiver: (_scope, organization, identity) =>
            Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            }),
          register: (_receiver, request) => {
            if (request.descriptor.kind === "table-list") list = request;
            return Effect.succeed({
              responseObservations:
                request.descriptor.kind === "table-list"
                  ? decodeRegistrationResponse(request, { items: [], totalHits: 0 }).observations
                  : [],
            });
          },
          read: (ticket) => {
            const descriptor = (
              ticket.target as { readonly descriptor: { readonly ids?: string[] } }
            ).descriptor;
            reads.push(descriptor.ids ?? []);
            return (reads.length === 1 ? Deferred.await(gate) : Effect.void).pipe(
              Effect.as({
                observations: decodeTableSearch(ticket, {
                  items: (descriptor.ids ?? []).map((id) => ({
                    id,
                    serviceStackId: `service-of-${id}`,
                    status: "ACTIVE",
                    source: "CLI",
                  })),
                  totalHits: descriptor.ids?.length ?? 0,
                }).observations,
              }),
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
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
          Queue.offerUnsafe(states, state);
        });
        const organization = topologyDescriptor.project.organization;
        const leaseScope = yield* Scope.make();
        const lease = yield* runtime
          .acquire({ kind: "organization-versions", organization })
          .pipe(Scope.provide(leaseScope));
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        const add = (id: string) =>
          Queue.offer(events, {
            kind: "observation",
            input: {
              kind: "table-membership-observed",
              operation: "add",
              id,
              registration: list as never,
            },
            bytes: 1,
          });
        const settleFibers = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
          discard: true,
        });
        yield* add("v-1");
        yield* settleFibers;
        yield* TestClock.adjust("1 second");
        yield* settleFibers;
        // The first batch is still reading when the second id arrives.
        expect(reads).toEqual([["v-1"]]);
        yield* add("v-2");
        yield* settleFibers;
        yield* Deferred.succeed(gate, undefined);
        yield* settleFibers;
        yield* TestClock.adjust("1 second");
        yield* waitForState(
          states,
          (state) => activeVersionOf(state.table, organization, "v-2").row !== null,
        );
        expect(reads).toEqual([["v-1"], ["v-2"]]);

        yield* runtime.shutdown("application-close");
        yield* Scope.close(leaseScope, Exit.void);
        unsubscribe();
        registry.dispose();
      }),
  );
});
