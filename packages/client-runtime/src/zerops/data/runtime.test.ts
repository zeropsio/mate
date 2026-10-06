import { describe, expect, it } from "@effect/vitest";
import type { Done } from "effect/Cause";
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
  type ZeropsBoundedIngress,
} from "./runtime.ts";
import { makeZeropsDataPolicy } from "./policy.ts";
import {
  projectKeyOf,
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
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

describe("interestKeyOf", () => {
  it("shares identical descriptors and separates project or kind demand", () => {
    const first = {
      kind: "project-topology" as const,
      project: project("project-a"),
    };
    expect(interestKeyOf({ ...first })).toBe(interestKeyOf(first));
    expect(interestKeyOf({ ...first, project: project("project-b") })).not.toBe(
      interestKeyOf(first),
    );
    expect(interestKeyOf({ kind: "project-record", project: first.project })).not.toBe(
      interestKeyOf(first),
    );
  });
});

function makeIdFactory(): () => string {
  let next = 0;
  return () => `opaque-${++next}`;
}

function makeAdapterHarness() {
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
    register: () => {
      registrations += 1;
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

const recordDescriptor: RuntimeInterestDescriptor = {
  kind: "project-record",
  project: project("project-a"),
};

/** Three projects of one organization: three interests on one receiver. */
const threeProjects: ReadonlyArray<RuntimeInterestDescriptor> = ["a", "b", "c"].map((id) => ({
  kind: "project-record",
  project: project(`project-${id}`),
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
        const lease = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(leaseScope));
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
      const first = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(firstScope));
      const second = yield* runtime
        .acquire({ ...recordDescriptor })
        .pipe(Scope.provide(secondScope));

      const observing = yield* waitForState(
        states,
        (state) => state.interests.get(first.interest)?.interest.status === "observing",
      );
      expect(observing.interests.get(first.interest)?.leases).toBe(2);
      expect(second.interest).toBe(first.interest);
      // Its project's feed registered once and its record read once, shared by both leases.
      expect(harness.counts()).toEqual({ opens: 1, registrations: 1, reads: 1, closes: 0 });

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

  it.effect("rejects read admission at the pending-read budget and exposes failure", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        // One project's record holds the one place while another's is asked too.
        policy: makeZeropsDataPolicy({ queuedReadRequestsPerAccount: 1 }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const leases = yield* runtime
        .acquireMany([{ kind: "project-record", project: project("project-b") }, recordDescriptor])
        .pipe(Scope.provide(leaseScope));
      const keys = leases.flatMap((lease) =>
        Result.isSuccess(lease) ? [lease.success.interest] : [],
      );
      const failedState = yield* waitForState(states, (state) =>
        keys.some((key) => state.interests.get(key)?.interest.status === "failed"),
      );

      expect(
        [...failedState.reads.values()].filter((read) => read.status === "pending").length,
      ).toBeLessThanOrEqual(1);
      expect(failedState.sharedReads.size).toBe(0);

      yield* runtime.shutdown("application-close");
      yield* Scope.close(leaseScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
  );

  it.effect("a failure signal that lands after background pause stays paused", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const events = yield* Queue.unbounded<ReceiverEvent>();
      let serviceSubscriptionName: string | undefined;
      let opens = 0;
      const adapter: ZeropsDataAdapter = {
        openReceiver: (_scope, organization, identity) => {
          opens += 1;
          return Effect.map(
            opens === 1 ? Effect.succeed(events) : Queue.unbounded<ReceiverEvent>(),
            (opened) => ({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves" as const,
              events: Stream.fromQueue(opened),
            }),
          );
        },
        register: (_receiver, request) => {
          if (request.descriptor.kind === "entity-updates")
            serviceSubscriptionName = request.subscriptionName;
          return Effect.succeed({ responseObservations: [] });
        },
        read: () => Effect.succeed({ observations: [] }),
        execute: () => Effect.succeed({ observations: [] }),
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
      const projectDescriptor: RuntimeInterestDescriptor = {
        kind: "project-record",
        project: recordDescriptor.project,
      };
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(projectDescriptor).pipe(Scope.provide(leaseScope));
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      expect(serviceSubscriptionName).toBeDefined();
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
      // interest from "paused" into a failed attempt against a receiver that no
      // longer exists in `receivers` — that would silently start no recovery cycle
      // (scheduleRecovery declines) and resumeFromBackground would never see it
      // either, since it only looks for "paused"/"failed".
      yield* Queue.offer(events, {
        kind: "malformed",
        subscriptionName: serviceSubscriptionName as never,
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
      organization: recordDescriptor.project.organization,
    };
    const projectDescriptor: RuntimeInterestDescriptor = {
      kind: "project-record",
      project: recordDescriptor.project,
    };
    const isListQuery = (request: RegistrationRequest) =>
      request.descriptor.kind === "entity-updates";

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
        execute: () => Effect.succeed({ observations: [] }),
        closeReceiver: () => Effect.sync(() => void (closes += 1)),
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        policy: makeZeropsDataPolicy({}),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const organization = yield* runtime
        .acquire(organizationDescriptor)
        .pipe(Scope.provide(leaseScope));
      const projectVariables = yield* runtime
        .acquire(projectDescriptor)
        .pipe(Scope.provide(leaseScope));
      const receiver = yield* Queue.take(opened); // The organization's one socket.
      const observing = yield* waitForState(
        states,
        (state) =>
          state.interests.get(organization.interest)?.interest.status === "observing" &&
          state.interests.get(projectVariables.interest)?.interest.status === "observing",
      );
      return {
        runtime,
        states,
        opened,
        registrations,
        closes: () => closes,
        receiver,
        organization,
        projectVariables,
        observing,
        dispose: Effect.gen(function* () {
          yield* runtime.shutdown("application-close");
          yield* Scope.close(leaseScope, Exit.void);
          unsubscribe();
          registry.dispose();
        }),
      };
    });

    it.effect.each(["named", "unnamed"] as const)(
      "a %s malformed frame reconnects the one socket and re-registers every subscription",
      (naming) =>
        Effect.gen(function* () {
          const rig = yield* setup;
          const sent = rig.registrations.length;
          yield* Queue.offer(
            rig.receiver.events,
            naming === "named"
              ? {
                  kind: "malformed",
                  subscriptionName: rig.registrations.find(isListQuery)!.subscriptionName,
                }
              : { kind: "malformed" },
          );
          const failed = yield* waitForState(rig.states, (state) =>
            [rig.organization.interest, rig.projectVariables.interest].every(
              (key) => state.interests.get(key)?.interest.status === "failed",
            ),
          );
          expect(failed.interests.get(rig.projectVariables.interest)?.interest).toMatchObject({
            reason: expect.stringContaining("Malformed subscription frame."),
            retryAtMs: expect.any(Number),
          });
          yield* TestClock.adjust("1 second");
          yield* Queue.take(rig.opened);
          yield* waitForState(rig.states, (state) =>
            [rig.organization.interest, rig.projectVariables.interest].every(
              (key) => state.interests.get(key)?.interest.status === "observing",
            ),
          );
          expect(rig.closes()).toBe(1);
          expect(rig.registrations).toHaveLength(sent * 2);
          yield* rig.dispose;
        }),
    );
  });

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
        .acquire(recordDescriptor)
        .pipe(Scope.provide(leaseScope), Effect.result);
      expect(result._tag).toBe("Failure");
      yield* Scope.close(leaseScope, Exit.void);
      registry.dispose();
    }),
  );

  it.effect("shutdown finishes while a registration still awaits its answer", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const sent = yield* Deferred.make<void>();
      let interrupted = 0;
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: {
          ...harness.adapter,
          register: () =>
            Deferred.succeed(sent, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Effect.sync(() => interrupted++)),
            ),
        },
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      yield* runtime.acquire(recordDescriptor);
      yield* Deferred.await(sent);
      yield* runtime.shutdown("application-close");
      expect(interrupted).toBe(1);
      expect((yield* runtime.state).closed).toBe(true);
      registry.dispose();
    }),
  );

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
                  observations: [],
                  result: { kind: command.kind, value: created },
                });
              case "import-development-container":
                return Effect.succeed({
                  observations: [],
                  result: { kind: command.kind, value: { serviceName: "zcp", imported: true } },
                });
              case "import-services":
                return Effect.succeed({
                  observations: [],
                  result: { kind: command.kind, value: undefined },
                });
              case "import-project":
                return Effect.succeed({
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
              { organization: recordDescriptor.project.organization, mutationsAllowed: true },
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
          organization: recordDescriptor.project.organization,
          name: created.name,
          tagList: [],
        });
        const createdRef: ProjectRef = {
          kind: "project",
          organization: recordDescriptor.project.organization,
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
          recordDescriptor.project.organization,
          "project:\n  name: Imported",
        );
        const importedRef: ProjectRef = {
          kind: "project",
          organization: recordDescriptor.project.organization,
          projectId: ZeropsProjectId.make(imported.value.projectId),
        };
        const firstQueryScope = yield* Scope.make();
        yield* runtime
          .acquire({ kind: "project-record", project: importedRef })
          .pipe(Scope.provide(firstQueryScope));
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
        yield* Scope.close(firstQueryScope, Exit.void);
        unsubscribeAccess();
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
          { organization: recordDescriptor.project.organization, mutationsAllowed: true },
        ],
        projects: [],
      },
    });
  const importWrite = [recordDescriptor.project.organization, "project: {}"] as const;

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
              observations: [],
              result: { kind: command.kind, value: { projectId: "imported" } },
            } as never),
          ),
        );
        const write = yield* Effect.forkChild(
          Effect.exit(runtime.commands.importProject(...importWrite)),
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
          observations: [],
          result: { kind: command.kind, value: { projectId: "imported" } },
        } as never),
      );
      let armed = true;
      const unsubscribe = registry.subscribe(runtime.stateAtom, () => {
        if (armed) throw new Error("a subscriber's own bug");
      });
      const first = yield* Effect.forkChild(
        Effect.exit(runtime.commands.importProject(...importWrite)),
      );
      for (let turn = 0; turn < 50; turn++) yield* Effect.yieldNow;
      armed = false;
      const second = yield* Effect.forkChild(
        Effect.exit(runtime.commands.importProject(...importWrite)),
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
          observations: [],
          result: { kind: command.kind, value: { projectId: "imported" } },
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
      yield* Effect.exit(runtime.commands.importProject(...importWrite));
      armed = false;
      yield* Effect.exit(runtime.commands.importProject(...importWrite));
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

  it.effect("an interrupted command is no longer counted as pending", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const runtime = yield* commandRuntime(registry, () => Effect.never);
      const write = yield* Effect.forkChild(runtime.commands.importProject(...importWrite));
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
            { organization: recordDescriptor.project.organization, mutationsAllowed: true },
          ],
          projects: [],
        },
      });
      const creation = yield* runtime.commands.createProject({
        organization: recordDescriptor.project.organization,
        name: "Created",
        tagList: [],
      });
      yield* TestClock.adjust("10 millis");
      const continuation = yield* runtime.commands
        .importServices(
          {
            kind: "project",
            organization: recordDescriptor.project.organization,
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
            { organization: recordDescriptor.project.organization, mutationsAllowed: false },
          ],
          projects: [],
        },
      });

      const denied = yield* runtime.commands
        .createProject({
          organization: recordDescriptor.project.organization,
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
                Effect.as({ observations: [] }),
              )
            : Effect.succeed({ observations: [] });
        },
      };
      const service: ServiceRef = {
        kind: "service",
        project: recordDescriptor.project,
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

      const first = yield* runtime.commands.startCommand({
        kind: "import-services",
        project: service.project,
        yaml: "services: []",
      });
      yield* Deferred.await(firstWriteStarted);
      const second = yield* runtime.commands.startCommand({
        kind: "import-services",
        project: service.project,
        yaml: "services: []",
      });
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
              observations: [],
            };
          }),
      };
      const service: ServiceRef = {
        kind: "service",
        project: recordDescriptor.project,
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
        kind: "import-services",
        project: service.project,
        yaml: "services: []",
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
              return { observations: [] };
            }),
        };
        const service: ServiceRef = {
          kind: "service",
          project: recordDescriptor.project,
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
          Effect.flip(runtime.commands.importServices(service.project, "services: []")),
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
                Effect.as({ observations: [] }),
              )
            : Effect.succeed({ observations: [] }),
      };
      const initialAccess = (epoch: number) => ({
        status: "verified" as const,
        account: runtimeScope.account,
        accountEpoch: AccountEpoch.make(epoch),
        verifiedAtMs: 0,
        deadlineMs: 10_000,
        mutationsAllowed: true,
        organizations: [
          { organization: recordDescriptor.project.organization, mutationsAllowed: true },
        ],
        projects: [
          {
            project: recordDescriptor.project,
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
        project: recordDescriptor.project,
        serviceId: ZeropsServiceId.make("service-a"),
      };
      const oldAttempt = yield* oldRuntime.commands.startCommand({
        kind: "import-services",
        project: service.project,
        yaml: "services: []",
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
        kind: "import-services",
        project: service.project,
        yaml: "services: []",
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
      const lease = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(leaseScope));
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
      const lease = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(leaseScope));
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

  it.effect("automatically reconnects dropped receivers with fresh generations", () =>
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
        execute: () => Effect.succeed({ observations: [] }),
        closeReceiver: () => Effect.void,
      };
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        random: () => 0,
        policy: makeZeropsDataPolicy({}),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(leaseScope));
      const firstReceiver = yield* Queue.take(opened);
      const firstObserved = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const firstIdentity = firstObserved.interests.get(lease.interest)!.interest.identity;

      let receiver = firstReceiver;
      for (let incident = 0; incident < 3; incident++) {
        yield* Queue.offer(receiver.events, { kind: "closed", reason: "test disconnect" });
        const failedState = yield* waitForState(states, (state) => {
          const status = state.interests.get(lease.interest)?.interest.status;
          return status === "failed";
        });
        expect(failedState.interests.get(lease.interest)?.interest.status).toBe("failed");
        expect(failedState.interests.get(lease.interest)?.interest).toMatchObject({
          retryAtMs: (yield* Clock.currentTimeMillis) + 1_000,
          reason: expect.stringContaining("updates while disconnected may be missing"),
        });
        yield* TestClock.adjust("999 millis");
        expect(yield* Queue.size(opened)).toBe(0);
        yield* TestClock.adjust("1 millis");
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
      const leases = yield* Effect.forEach(
        [recordDescriptor, recordDescriptor, recordDescriptor],
        (descriptor) => runtime.acquire(descriptor).pipe(Scope.provide(leaseScope)),
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
    "a socket login that %s reconnects once for every interest waiting on it",
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
        const leases = yield* Effect.forEach(
          [recordDescriptor, recordDescriptor, recordDescriptor],
          (descriptor) => runtime.acquire(descriptor).pipe(Scope.provide(leaseScope)),
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
      const lease = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(leaseScope));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");
      yield* Effect.yieldNow;

      expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe("failed");
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
        execute: () => Effect.succeed({ observations: [] }),
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
        }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const unsubscribe = registry.subscribe(runtime.stateAtom, (state) => {
        Queue.offerUnsafe(states, state);
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(leaseScope));
      const firstReceiver = yield* Queue.take(opened);
      const firstObserved = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "observing",
      );
      const firstIdentity = firstObserved.interests.get(lease.interest)!.interest.identity;
      const serviceRegistration = registrations.find(
        (request) => request.descriptor.kind === "entity-updates",
      )!;
      const observation: PlatformObservation = {
        kind: "service-lifecycle-observed",
        ref: {
          kind: "service",
          project: recordDescriptor.project,
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
      const failedState = yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "failed",
      );
      expect(failedState.interests.get(lease.interest)?.interest.status).toBe("failed");
      expect(failedState.interests.get(lease.interest)?.interest).toMatchObject({
        retryAtMs: null,
      });
      expect((yield* runtime.ingress).discardedEvents).toBe(1);

      yield* TestClock.adjust("10 millis");
      yield* runtime.refresh(recordDescriptor.project.organization);
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
      const lease = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(leaseScope));
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
            project: recordDescriptor.project,
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
                project: recordDescriptor.project,
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
          execute: () => Effect.succeed({ observations: [] }),
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
        const lease = yield* runtime.acquire(recordDescriptor).pipe(Scope.provide(leaseScope));

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
  "admits each shared native fact once across 26 consumers of one project and owner release",
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
            kind: "project-record",
            project: project("project-1"),
          })
          .pipe(Scope.provide(i === 0 ? ownerScope : remainingScope));
      }
      yield* waitForState(
        states,
        (state) =>
          state.interests.size === 1 &&
          [...state.interests.values()].every(({ interest }) => interest.status === "observing"),
      );
      const request = [...registrations.values()].find(
        (entry) => entry.descriptor.kind === "entity-updates",
      )!;
      expect(
        [...registrations.values()].filter((entry) => entry.descriptor.kind === "entity-updates"),
      ).toHaveLength(1);
      const ref = project("project-1");
      const { decodeNativeFrame } = yield* Effect.promise(() => import("./platformProtocol.ts"));
      for (const status of ["ACTIVE", "STOPPED"]) {
        received = yield* Deferred.make<void>();
        const raw = yield* encodeTestFrame({
          type: "search",
          subscriptionName: request.subscriptionName,
          data: {
            update: [{ id: ref.projectId, name: "app", status }],
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
        const lifecycle = (yield* runtime.state).inventory.projects.get(
          projectKeyOf(ref),
        )?.lifecycle;
        expect(lifecycle?.knowledge).toBe("observed");
        if (lifecycle?.knowledge === "observed") expect(lifecycle.fields.status).toBe(status);
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
      expect((yield* runtime.state).inventory.projects.size).toBe(101);
      expect(registry.get(runtime.stateAtom)).toBe(yield* runtime.state);
      expect(publications).toBeLessThan(30);
      stopCounting();
      yield* runtime.shutdown("application-close");
      yield* Scope.close(remainingScope, Exit.void);
      unsubscribe();
      registry.dispose();
    }),
);

describe("inventory demand", () => {
  it.effect(
    "holds the organization's inventory reading and registering nothing: its projects are the account store's",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const organization = project("p").organization;
          expect(planZeropsInterest({ kind: "organization-inventory", organization })).toEqual({
            registrations: [],
            directReads: [],
          });
          const registry = AtomRegistry.make();
          const harness = makeAdapterHarness();
          const runtime = yield* makeZeropsDataRuntime({
            scope: runtimeScope,
            adapter: harness.adapter,
            atomRegistry: registry,
            makeOpaqueId: makeIdFactory(),
          });
          const lease = yield* runtime.acquire({ kind: "organization-inventory", organization });
          const state = yield* runtime.state;
          expect(state.interests.get(lease.interest)?.interest.status).toBe("observing");
          expect(harness.counts()).toMatchObject({ opens: 0, registrations: 0, reads: 0 });
          yield* runtime.shutdown("application-close");
          registry.dispose();
        }),
      ),
  );
});

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

describe("registrations", () => {
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
            if (descriptor.kind === "entity-updates") {
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
          { kind: "project-record", project: project("project-a") },
          {
            kind: "project-record",
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
        const variables = yield* runtime.acquire(first!);
        const other = yield* runtime.acquire(second!);
        yield* nextTask;

        expect(published).toHaveLength(1);
        expect([...published[0]!.interests.keys()]).toEqual([variables.interest, other.interest]);
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

describe("a registration two interests share", () => {
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
        .acquire({
          kind: "project-record",
          project: project("project-a"),
        })
        .pipe(Scope.provide(sender));
      yield* settleUntil(runtime, () => false, 20);
      const second = yield* runtime
        .acquire({
          kind: "project-record",
          project: project("project-a"),
        })
        .pipe(Scope.provide(sibling));
      yield* settleUntil(runtime, () => false, 20);

      // The interest whose establishment sent the project's service registrations goes.
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

describe("visible demand transport", () => {
  it.effect("one socket carries the organization's navigation and every drawn project", () =>
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
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const stop = registry.subscribe(runtime.stateAtom, (state) =>
          Queue.offerUnsafe(states, state),
        );
        const navigation = yield* runtime.acquire({
          kind: "organization-inventory",
          organization: project("project-a").organization,
        });
        const drawn = yield* Effect.forEach(
          Array.from({ length: 18 }, (_, index) => project(`project-${index}`)),
          (ref) =>
            runtime.acquire({
              kind: "project-record",
              project: ref,
            }),
        );
        const keys = [navigation.interest, ...drawn.map((lease) => lease.interest)];
        yield* waitForState(states, (state) =>
          keys.every((key) => state.interests.get(key)?.interest.status === "observing"),
        );
        expect(harness.counts().opens).toBe(1);
        const sent = harness.counts().registrations;
        yield* drawn[0]!.release;
        yield* drawn[1]!.release;
        expect(harness.counts()).toMatchObject({ opens: 1, closes: 0, registrations: sent });
        expect((yield* runtime.state).interests.get(drawn[2]!.interest)?.interest.status).toBe(
          "observing",
        );
        yield* runtime.shutdown("application-close");
        stop();
        registry.dispose();
      }),
    ),
  );
  it.effect("a project panel's manual again on a failed socket brings back all it carried", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        let refuseLogin = true;
        const adapter: ZeropsDataAdapter = {
          ...harness.adapter,
          openReceiver: (scope, organization, identity, context) =>
            refuseLogin
              ? Effect.fail({
                  _tag: "ZeropsDataAdapterError",
                  kind: "rejected",
                  message: "socket login refused",
                  retryable: false,
                  accountRevocationEvidence: false,
                } satisfies AdapterError)
              : harness.adapter.openReceiver(scope, organization, identity, context),
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const stop = registry.subscribe(runtime.stateAtom, (state) =>
          Queue.offerUnsafe(states, state),
        );
        const navigation = yield* runtime.acquire({
          kind: "organization-inventory",
          organization: recordDescriptor.project.organization,
        });
        const detail = yield* runtime.acquire(recordDescriptor);
        const all = (status: string) => (state: ZeropsDataState) =>
          [navigation.interest, detail.interest].every(
            (key) => state.interests.get(key)?.interest.status === status,
          );
        yield* waitForState(states, all("failed"));
        refuseLogin = false;
        yield* runtime.refresh(recordDescriptor.project);
        yield* waitForState(states, all("observing"));
        expect(harness.counts().opens).toBe(1);
        yield* runtime.shutdown("application-close");
        stop();
        registry.dispose();
      }),
    ),
  );
  it.effect("a project panel's manual again re-registers only that project on the one socket", () =>
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
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const stop = registry.subscribe(runtime.stateAtom, (state) =>
          Queue.offerUnsafe(states, state),
        );
        const navigation = yield* runtime.acquire({
          kind: "organization-inventory",
          organization: recordDescriptor.project.organization,
        });
        const detail = yield* runtime.acquire(recordDescriptor);
        const observing = (state: ZeropsDataState) =>
          [navigation.interest, detail.interest].every(
            (key) => state.interests.get(key)?.interest.status === "observing",
          );
        const before = yield* waitForState(states, observing);
        const navigationIdentity = before.interests.get(navigation.interest)!.interest.identity;
        const detailIdentity = before.interests.get(detail.interest)!.interest.identity;
        const sent = harness.counts().registrations;
        yield* runtime.refresh(recordDescriptor.project);
        const after = yield* waitForState(
          states,
          (state) =>
            observing(state) &&
            state.interests.get(detail.interest)!.interest.identity !== detailIdentity,
        );
        expect(harness.counts()).toMatchObject({
          opens: 1,
          closes: 0,
          registrations: sent + planZeropsInterest(recordDescriptor).registrations.length,
        });
        expect(after.interests.get(navigation.interest)!.interest.identity).toBe(
          navigationIdentity,
        );
        yield* runtime.shutdown("application-close");
        stop();
        registry.dispose();
      }),
    ),
  );
});

describe("incomplete data says so, with its retry", () => {
  it.effect("retains a refused shared registration until Reconnect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        let attempts = 0;
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: {
            ...harness.adapter,
            register: (receiver, request, context) => {
              if (request.descriptor.kind !== "entity-updates")
                return harness.adapter.register(receiver, request, context);
              attempts += 1;
              return Effect.fail({
                _tag: "ZeropsDataAdapterError",
                kind: "registration",
                message: "subscription refused",
                status: 403,
                retryable: true,
                accountRevocationEvidence: false,
              } satisfies AdapterError);
            },
          },
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const stop = registry.subscribe(runtime.stateAtom, (state) =>
          Queue.offerUnsafe(states, state),
        );
        const first = yield* runtime.acquire({
          kind: "project-record",
          project: recordDescriptor.project,
        });
        yield* waitForState(
          states,
          (state) => state.interests.get(first.interest)?.interest.status === "failed",
        );
        const second = yield* runtime.acquire(recordDescriptor);
        yield* waitForState(
          states,
          (state) => state.interests.get(second.interest)?.interest.status === "failed",
        );
        // A refusal is permanent: no timer sends it again, however long its lease holds.
        yield* TestClock.adjust("2 minutes");
        expect((yield* runtime.state).interests.get(second.interest)?.interest).toMatchObject({
          status: "failed",
          retryable: false,
          retryAtMs: null,
        });
        expect(attempts).toBe(1);
        // Nor does the grant's word on the project: only the person's again asks once more.
        yield* runtime.observeAccess({
          kind: "project-access-established",
          accountEpoch: runtimeScope.epoch,
          project: recordDescriptor.project,
        });
        yield* TestClock.adjust("2 minutes");
        expect(attempts).toBe(1);
        yield* runtime.refresh(recordDescriptor.project);
        yield* waitForState(
          states,
          (state) =>
            attempts === 2 && state.interests.get(second.interest)?.interest.status === "failed",
        );
        expect(attempts).toBe(2);
        yield* runtime.shutdown("application-close");
        stop();
        registry.dispose();
      }),
    ),
  );

  it.effect("no grant round asks a refusal again: a definitive refusal stands", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        let attempts = 0;
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: {
            ...harness.adapter,
            register: (receiver, request, context) => {
              if (request.descriptor.kind !== "entity-updates")
                return harness.adapter.register(receiver, request, context);
              attempts += 1;
              return Effect.fail({
                _tag: "ZeropsDataAdapterError",
                kind: "forbidden",
                message: "list refused",
                status: 403,
                retryable: false,
                accountRevocationEvidence: false,
              } satisfies AdapterError);
            },
          },
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const stop = registry.subscribe(runtime.stateAtom, (state) =>
          Queue.offerUnsafe(states, state),
        );
        const organization = recordDescriptor.project.organization;
        const lease = yield* runtime.acquire(recordDescriptor);
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "failed",
        );
        const round = (verifiedAtMs: number) =>
          runtime.observeAccess({
            kind: "access-verified",
            grant: {
              account: runtimeScope.account,
              accountEpoch: runtimeScope.epoch,
              verifiedAtMs,
              deadlineMs: verifiedAtMs + 15 * 60_000,
              mutationsAllowed: true,
              organizations: [{ organization, mutationsAllowed: true }],
              projects: [],
            },
          });
        expect(attempts).toBe(1);
        yield* round(0);
        yield* TestClock.adjust("12 minutes");
        yield* round(12 * 60_000);
        yield* TestClock.adjust("1 minute");
        expect(attempts).toBe(1);
        yield* runtime.shutdown("application-close");
        stop();
        registry.dispose();
      }),
    ),
  );

  it.effect("a receiver stream that ends without a close frame ends visibly", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        const events = yield* Queue.unbounded<ReceiverEvent, Done>();
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: {
            ...harness.adapter,
            openReceiver: (_scope, organization, identity) =>
              Effect.succeed({
                identity,
                organization,
                delivery: "hot-single-consumer-buffered-before-open-resolves",
                events: Stream.fromQueue(events),
              }),
          },
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const stop = registry.subscribe(runtime.stateAtom, (state) =>
          Queue.offerUnsafe(states, state),
        );
        const lease = yield* runtime.acquire(recordDescriptor);
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        yield* Queue.end(events);
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "failed",
        );
        expect((yield* runtime.state).interests.get(lease.interest)?.interest).toMatchObject({
          status: "failed",
          reason: expect.stringContaining("Reconnect"),
        });
        expect(harness.counts().closes).toBe(1);
        yield* runtime.shutdown("application-close");
        stop();
        registry.dispose();
      }),
    ),
  );
});

it.effect("retains a malformed registration failure for later dependents", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const events = yield* Queue.unbounded<ReceiverEvent>();
      let request: RegistrationRequest | undefined;
      let attempts = 0;
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: {
          ...harness.adapter,
          openReceiver: (_scope, organization, identity) =>
            Effect.succeed({
              identity,
              organization,
              delivery: "hot-single-consumer-buffered-before-open-resolves",
              events: Stream.fromQueue(events),
            }),
          register: (receiver, planned, context) => {
            if (planned.descriptor.kind === "entity-updates") {
              request = planned;
              attempts += 1;
            }
            return harness.adapter.register(receiver, planned, context);
          },
        },
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const stop = registry.subscribe(runtime.stateAtom, (state) =>
        Queue.offerUnsafe(states, state),
      );
      const first = yield* runtime.acquire({
        kind: "project-record",
        project: recordDescriptor.project,
      });
      yield* waitForState(
        states,
        (state) => state.interests.get(first.interest)?.interest.status === "observing",
      );
      yield* Queue.offer(events, {
        kind: "malformed",
        subscriptionName: request!.subscriptionName,
      });
      yield* waitForState(
        states,
        (state) => state.interests.get(first.interest)?.interest.status === "failed",
      );
      const second = yield* runtime.acquire(recordDescriptor);
      const settled = yield* waitForState(states, (state) =>
        ["failed", "observing"].includes(
          state.interests.get(second.interest)?.interest.status ?? "",
        ),
      );
      expect(settled.interests.get(second.interest)?.interest.status).toBe("failed");
      expect(attempts).toBe(1);
      yield* runtime.shutdown("application-close");
      stop();
      registry.dispose();
    }),
  ),
);

it.effect("the establishment deadline closes a registration still awaiting its answer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const sent = yield* Deferred.make<void>();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: {
          ...harness.adapter,
          register: () => Deferred.succeed(sent, undefined).pipe(Effect.andThen(Effect.never)),
        },
        policy: makeZeropsDataPolicy({ establishmentDeadlineMs: 100 }),
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        random: () => 0,
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const stop = registry.subscribe(runtime.stateAtom, (state) =>
        Queue.offerUnsafe(states, state),
      );
      const lease = yield* runtime.acquire(recordDescriptor);
      yield* Deferred.await(sent);
      yield* TestClock.adjust("100 millis");
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "failed",
      );
      expect(harness.counts().closes).toBe(1);
      yield* TestClock.adjust("1 second");
      expect(harness.counts().opens).toBe(2);
      yield* TestClock.adjust("100 millis");
      expect(harness.counts().closes).toBe(2);
      yield* runtime.shutdown("application-close");
      stop();
      registry.dispose();
    }),
  ),
);

it("access demand leaves the one direct read to the grant verifier", () => {
  expect(planZeropsInterest({ kind: "project-access", project: project("p") })).toEqual({
    registrations: [],
    directReads: [],
  });
  expect(interestKeyOf({ kind: "project-access", project: project("p") })).toContain(
    "project-access",
  );
});

it.effect(
  "access-only leases own no platform socket or second read and close with the review",
  () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: harness.adapter,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
      });
      const scope = yield* Scope.make();
      const lease = yield* runtime
        .acquire({ kind: "project-access", project: project("p") })
        .pipe(Scope.provide(scope));
      yield* Effect.yieldNow;
      expect(harness.counts()).toEqual({ opens: 0, registrations: 0, reads: 0, closes: 0 });
      expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe(
        "observing",
      );
      yield* Scope.close(scope, Exit.void);
      expect((yield* runtime.state).interests.get(lease.interest)?.leases ?? 0).toBe(0);
      yield* runtime.shutdown("logout");
      registry.dispose();
    }),
);

it.effect.each(["login", "registration"] as const)(
  "backs off failed receiver %s attempts, caps the delay, and replaces the receiver",
  (stage) =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        const identities: ReceiverHandle["identity"][] = [];
        let attempts = 0;
        const unavailable: AdapterError = {
          _tag: "ZeropsDataAdapterError",
          kind: "server",
          status: 503,
          message: "Unavailable",
          retryable: true,
          accountRevocationEvidence: false,
        };
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          random: () => 0,
          adapter: {
            ...harness.adapter,
            openReceiver: (scope, organization, identity, context) => {
              identities.push(identity);
              if (stage === "login" && ++attempts <= 7) return Effect.fail(unavailable);
              return harness.adapter.openReceiver(scope, organization, identity, context);
            },
            register: (receiver, request, context) => {
              if (stage === "registration" && ++attempts <= 7) return Effect.fail(unavailable);
              return harness.adapter.register(receiver, request, context);
            },
          },
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const stop = registry.subscribe(runtime.stateAtom, (state) =>
          Queue.offerUnsafe(states, state),
        );
        const lease = yield* runtime.acquire(recordDescriptor);
        for (const [index, delay] of [
          1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
        ].entries()) {
          const failed = yield* waitForState(states, (state) => {
            const interest = state.interests.get(lease.interest)?.interest;
            return (
              interest?.status === "failed" && interest.identity.receiver === identities[index]
            );
          });
          expect(failed.interests.get(lease.interest)?.interest).toMatchObject({
            retryAtMs: (yield* Clock.currentTimeMillis) + delay,
          });
          yield* TestClock.adjust(`${delay - 1} millis`);
          expect(identities).toHaveLength(index + 1);
          yield* TestClock.adjust("1 millis");
        }
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        expect(identities).toHaveLength(8);
        expect(new Set(identities.map((identity) => identity.receiverId)).size).toBe(8);
        yield* runtime.shutdown("application-close");
        stop();
        registry.dispose();
      }),
    ),
);

it.effect.each([401, 403] as const)("a %s receiver refusal ends without reconnecting", (status) =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      let attempts = 0;
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        adapter: {
          ...harness.adapter,
          openReceiver: () => {
            attempts += 1;
            return Effect.fail({
              _tag: "ZeropsDataAdapterError",
              kind: "socket-open",
              status,
              message: "Access refused",
              retryable: true,
              accountRevocationEvidence: false,
            } satisfies AdapterError);
          },
        },
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const stop = registry.subscribe(runtime.stateAtom, (state) =>
        Queue.offerUnsafe(states, state),
      );
      const lease = yield* runtime.acquire(recordDescriptor);
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "failed",
      );
      yield* TestClock.adjust("1 minute");
      expect(attempts).toBe(1);
      expect((yield* runtime.state).interests.get(lease.interest)?.interest).toMatchObject({
        retryAtMs: null,
        retryable: false,
      });
      yield* runtime.shutdown("application-close");
      stop();
      registry.dispose();
    }),
  ),
);

it.effect("a reconnect paused in the background resumes in the foreground", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const logins = socketLogins();
      const changes = yield* Queue.unbounded<"visible" | "hidden">();
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        adapter: logins.adapter,
        policy: makeZeropsDataPolicy({ hiddenReceiverPauseAfterMs: 50 }),
        visibility: { current: Effect.succeed("visible"), changes: Stream.fromQueue(changes) },
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const stop = registry.subscribe(runtime.stateAtom, (state) =>
        Queue.offerUnsafe(states, state),
      );
      const lease = yield* runtime.acquire(recordDescriptor);
      const observing = (state: ZeropsDataState) =>
        state.interests.get(lease.interest)?.interest.status === "observing";
      yield* waitForState(states, observing);
      yield* logins.closeSocket;
      yield* waitForState(
        states,
        (state) => state.interests.get(lease.interest)?.interest.status === "failed",
      );
      yield* Queue.offer(changes, "hidden");
      yield* TestClock.adjust("50 millis");
      yield* TestClock.adjust("1 second");
      expect(logins.count()).toBe(1);
      expect((yield* runtime.state).interests.get(lease.interest)?.interest.status).toBe("paused");
      yield* Queue.offer(changes, "visible");
      yield* waitForState(states, observing);
      expect(logins.count()).toBe(2);
      yield* runtime.shutdown("application-close");
      stop();
      registry.dispose();
    }),
  ),
);

it.effect.each(["release", "shutdown", "refresh"] as const)(
  "%s cancels a scheduled receiver reconnect",
  (action) =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const logins = socketLogins();
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          adapter: logins.adapter,
        });
        const states = yield* Queue.unbounded<ZeropsDataState>();
        const stop = registry.subscribe(runtime.stateAtom, (state) =>
          Queue.offerUnsafe(states, state),
        );
        const lease = yield* runtime.acquire(recordDescriptor);
        const observing = (state: ZeropsDataState) =>
          state.interests.get(lease.interest)?.interest.status === "observing";
        yield* waitForState(states, observing);
        yield* logins.closeSocket;
        yield* waitForState(
          states,
          (state) => state.interests.get(lease.interest)?.interest.status === "failed",
        );
        if (action === "release") yield* lease.release;
        else if (action === "shutdown") yield* runtime.shutdown("application-close");
        else {
          yield* runtime.refresh(recordDescriptor.project);
          yield* waitForState(states, observing);
        }
        yield* TestClock.adjust("1 minute");
        expect(logins.count()).toBe(action === "refresh" ? 2 : 1);
        yield* runtime.shutdown("application-close");
        stop();
        registry.dispose();
      }),
    ),
);

describe("an interest that fails alone recovers alone", () => {
  const refused: AdapterError = {
    _tag: "ZeropsDataAdapterError",
    kind: "registration",
    // A refusal that may pass: the platform's conflict, not its 403/404 (or a 5xx, its socket's).
    message: "subscription conflict",
    status: 409,
    retryable: true,
    accountRevocationEvidence: false,
  };
  const isListQuery = (request: RegistrationRequest) =>
    request.descriptor.kind === "entity-updates";
  const settle = Effect.forEach(Array.from({ length: 30 }), () => Effect.yieldNow, {
    discard: true,
  });

  /** A project's variables whose list subscription the platform refuses `refusals` times. */
  const refusing = (
    refusals: number,
    options: {
      readonly visibility?: ZeropsVisibility;
      readonly policy?: Partial<Parameters<typeof makeZeropsDataPolicy>[0]>;
    } = {},
  ) =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      const harness = makeAdapterHarness();
      const attemptsAt: number[] = [];
      const runtime = yield* makeZeropsDataRuntime({
        scope: runtimeScope,
        adapter: {
          ...harness.adapter,
          register: (receiver, request, context) => {
            if (!isListQuery(request)) return harness.adapter.register(receiver, request, context);
            return Effect.flatMap(Clock.currentTimeMillis, (now) => {
              attemptsAt.push(now);
              return attemptsAt.length <= refusals
                ? Effect.fail(refused)
                : Effect.succeed({ responseObservations: [] });
            });
          },
        },
        atomRegistry: registry,
        makeOpaqueId: makeIdFactory(),
        random: () => 0,
        policy: makeZeropsDataPolicy({
          recoveryBackoffStartMs: 100,
          recoveryBackoffMaxMs: 1_000,
          recoveryAttemptLimit: 2,
          hiddenReceiverPauseAfterMs: 10_000,
          ...options.policy,
        }),
        ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
      });
      const states = yield* Queue.unbounded<ZeropsDataState>();
      const stop = registry.subscribe(runtime.stateAtom, (state) =>
        Queue.offerUnsafe(states, state),
      );
      return { runtime, states, harness, attemptsAt, stop, registry };
    });

  it.effect(
    "retries an unavailable interest on its backoff, past its attempt limit on the cap (B4)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const rig = yield* refusing(4);
          const lease = yield* rig.runtime.acquire({
            kind: "project-record",
            project: recordDescriptor.project,
          });
          const failed = yield* waitForState(rig.states, (state) => {
            const interest = state.interests.get(lease.interest)?.interest;
            return interest?.status === "failed" && interest.retryAtMs !== null;
          });
          expect(failed.interests.get(lease.interest)?.interest).toMatchObject({
            status: "failed",
            retryable: true,
            attempts: 1,
            retryAtMs: 100,
          });
          for (let step = 0; step < 30; step++) {
            yield* TestClock.adjust("100 millis");
            yield* settle;
          }
          // 100, then 200 ms; past the limit of two, the 1 s cap, and it stays there.
          expect(rig.attemptsAt).toEqual([0, 100, 300, 1_300, 2_300]);
          yield* waitForState(
            rig.states,
            (state) => state.interests.get(lease.interest)?.interest.status === "observing",
          );
          // One receiver all along: an interest's own failure never replaces its siblings' socket.
          expect(rig.harness.counts().opens).toBe(1);
          yield* rig.runtime.shutdown("application-close");
          rig.stop();
          rig.registry.dispose();
        }),
      ),
  );

  it.effect(
    "a fresh lease waits for the failed interest's scheduled retry, sending nothing sooner",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const rig = yield* refusing(1);
          const descriptor: RuntimeInterestDescriptor = {
            kind: "project-record",
            project: recordDescriptor.project,
          };
          const first = yield* rig.runtime.acquire(descriptor);
          yield* waitForState(rig.states, (state) => {
            const interest = state.interests.get(first.interest)?.interest;
            return interest?.status === "failed" && interest.retryAtMs !== null;
          });
          yield* rig.runtime.acquire(descriptor);
          yield* settle;
          expect(rig.attemptsAt).toEqual([0]);
          yield* TestClock.adjust("100 millis");
          yield* waitForState(
            rig.states,
            (state) => state.interests.get(first.interest)?.interest.status === "observing",
          );
          expect(rig.attemptsAt).toEqual([0, 100]);
          yield* rig.runtime.shutdown("application-close");
          rig.stop();
          rig.registry.dispose();
        }),
      ),
  );

  it.effect(
    "a retry sends again only the failed subscription, never the healthy ones beside it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const rig = yield* refusing(4);
          const lease = yield* rig.runtime.acquire({
            kind: "project-record",
            project: recordDescriptor.project,
          });
          yield* settle;
          const sentBefore = rig.harness.counts().registrations;
          for (let step = 0; step < 40; step++) {
            yield* TestClock.adjust("100 millis");
            yield* settle;
          }
          yield* waitForState(
            rig.states,
            (state) => state.interests.get(lease.interest)?.interest.status === "observing",
          );
          // Four retries of the one failed subscription; the variables feed beside it went once.
          expect(rig.attemptsAt).toHaveLength(5);
          expect(rig.harness.counts().registrations).toBe(sentBefore);
          expect(rig.harness.counts().opens).toBe(1);
          yield* rig.runtime.shutdown("application-close");
          rig.stop();
          rig.registry.dispose();
        }),
      ),
  );

  it.effect("refused retries never held a subscription: past the bound, the socket stays", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rig = yield* refusing(3, { policy: { releasedRegistrationsPerReceiver: 2 } });
        const lease = yield* rig.runtime.acquire({
          kind: "project-record",
          project: recordDescriptor.project,
        });
        for (let step = 0; step < 40; step++) {
          yield* TestClock.adjust("100 millis");
          yield* settle;
        }
        yield* waitForState(
          rig.states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        // Each refusal the platform answered left nothing subscribed on the socket to release.
        expect(rig.harness.counts().opens).toBe(1);
        yield* rig.runtime.shutdown("application-close");
        rig.stop();
        rig.registry.dispose();
      }),
    ),
  );

  it.effect(
    "a retry that comes due while the tab is hidden waits, and runs at once when it shows",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const visibility = yield* Ref.make<"visible" | "hidden">("visible");
          const changes = yield* Queue.unbounded<"visible" | "hidden">();
          const rig = yield* refusing(1, {
            visibility: { current: Ref.get(visibility), changes: Stream.fromQueue(changes) },
          });
          const lease = yield* rig.runtime.acquire({
            kind: "project-record",
            project: recordDescriptor.project,
          });
          yield* waitForState(rig.states, (state) => {
            const interest = state.interests.get(lease.interest)?.interest;
            return interest?.status === "failed" && interest.retryAtMs !== null;
          });
          yield* Ref.set(visibility, "hidden");
          yield* Queue.offer(changes, "hidden");
          yield* settle;
          yield* TestClock.adjust("5 seconds");
          yield* settle;
          expect(rig.attemptsAt).toEqual([0]);

          // Back before its pause: the receiver it waited on is still open, and the retry runs now.
          yield* Ref.set(visibility, "visible");
          yield* Queue.offer(changes, "visible");
          yield* waitForState(
            rig.states,
            (state) => state.interests.get(lease.interest)?.interest.status === "observing",
          );
          expect(rig.attemptsAt).toEqual([0, 5_000]);
          expect(rig.harness.counts().opens).toBe(1);
          yield* rig.runtime.shutdown("application-close");
          rig.stop();
          rig.registry.dispose();
        }),
      ),
  );

  it.effect(
    "a subscription that outlives its deadline is sent again by itself, on a fresh socket",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = AtomRegistry.make();
          const harness = makeAdapterHarness();
          let sent = 0;
          const runtime = yield* makeZeropsDataRuntime({
            scope: runtimeScope,
            adapter: {
              ...harness.adapter,
              register: (receiver, request, context) => {
                if (!isListQuery(request))
                  return harness.adapter.register(receiver, request, context);
                sent += 1;
                // The first send is never answered; its retry is.
                return sent === 1 ? Effect.never : Effect.succeed({ responseObservations: [] });
              },
            },
            atomRegistry: registry,
            makeOpaqueId: makeIdFactory(),
            policy: makeZeropsDataPolicy({
              establishmentDeadlineMs: 1_000,
              recoveryBackoffStartMs: 100,
            }),
          });
          const states = yield* Queue.unbounded<ZeropsDataState>();
          const stop = registry.subscribe(runtime.stateAtom, (state) =>
            Queue.offerUnsafe(states, state),
          );
          const lease = yield* runtime.acquire(recordDescriptor);
          yield* settle;
          yield* TestClock.adjust("1 second");
          yield* settle;
          // A send never answered may have left a subscription nobody owns: its socket reconnects
          // on its first rung (f8c96d60d), and everything it carried registers again.
          yield* TestClock.adjust("1 second");
          yield* waitForState(
            states,
            (state) => state.interests.get(lease.interest)?.interest.status === "observing",
          );
          expect(sent).toBe(2);
          expect(harness.counts().opens).toBe(2);
          yield* runtime.shutdown("application-close");
          stop();
          registry.dispose();
        }),
      ),
  );

  it.effect("a refused interest's Try now re-registers it at once, past its backoff", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rig = yield* refusing(1, { policy: { recoveryBackoffStartMs: 1_000 } });
        const lease = yield* rig.runtime.acquire({
          kind: "project-record",
          project: recordDescriptor.project,
        });
        yield* waitForState(rig.states, (state) => {
          const interest = state.interests.get(lease.interest)?.interest;
          return interest?.status === "failed" && interest.retryAtMs !== null;
        });
        yield* rig.runtime.refresh(recordDescriptor.project);
        yield* waitForState(
          rig.states,
          (state) => state.interests.get(lease.interest)?.interest.status === "observing",
        );
        expect(rig.attemptsAt).toEqual([0, 0]);
        yield* TestClock.adjust("2 seconds");
        yield* settle;
        expect(rig.attemptsAt).toHaveLength(2);
        yield* rig.runtime.shutdown("application-close");
        rig.stop();
        rig.registry.dispose();
      }),
    ),
  );
});

describe("a 429 is answered with patience, never more requests", () => {
  const settle = Effect.forEach(Array.from({ length: 30 }), () => Effect.yieldNow, {
    discard: true,
  });
  const slowDown = (retryAfterMs: number, status = 429): AdapterError => ({
    _tag: "ZeropsDataAdapterError",
    kind: "network",
    message: "slow down",
    status,
    retryAfterMs,
    retryable: true,
    accountRevocationEvidence: false,
  });

  it.effect("an interest's retry waits out its refusal's Retry-After", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        const sentAt: number[] = [];
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: {
            ...harness.adapter,
            register: (receiver, request, context) =>
              request.descriptor.kind === "entity-updates"
                ? Effect.flatMap(Clock.currentTimeMillis, (now) => {
                    sentAt.push(now);
                    return sentAt.length === 1
                      ? Effect.fail({ ...slowDown(5_000, 409), kind: "registration" as const })
                      : Effect.succeed({ responseObservations: [] });
                  })
                : harness.adapter.register(receiver, request, context),
          },
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          random: () => 0,
          policy: makeZeropsDataPolicy({ recoveryBackoffStartMs: 100 }),
        });
        yield* runtime.acquire({
          kind: "project-record",
          project: recordDescriptor.project,
        });
        for (let step = 0; step < 60; step++) {
          yield* TestClock.adjust("100 millis");
          yield* settle;
        }
        // Never before its Retry-After, and not a backoff rung past it.
        expect(sentAt).toHaveLength(2);
        expect(sentAt[1]).toBeGreaterThanOrEqual(5_000);
        expect(sentAt[1]).toBeLessThan(5_000 + 200);
        yield* runtime.shutdown("application-close");
        registry.dispose();
      }),
    ),
  );

  it.effect("a socket refused with a Retry-After logs in again only after it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        const opensAt: number[] = [];
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: {
            ...harness.adapter,
            openReceiver: (...args) =>
              Effect.flatMap(Clock.currentTimeMillis, (now) => {
                opensAt.push(now);
                return opensAt.length === 1
                  ? Effect.fail({ ...slowDown(10_000), kind: "socket-open" as const })
                  : harness.adapter.openReceiver(...args);
              }),
          },
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          random: () => 0,
        });
        yield* runtime.acquire(recordDescriptor);
        for (let step = 0; step < 15; step++) {
          yield* TestClock.adjust("1 second");
          yield* settle;
        }
        expect(opensAt).toEqual([0, 10_000]);
        yield* runtime.shutdown("application-close");
        registry.dispose();
      }),
    ),
  );

  it.effect("every backoff is jittered: a retry may come up to a fifth sooner", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        const harness = makeAdapterHarness();
        const sentAt: number[] = [];
        const runtime = yield* makeZeropsDataRuntime({
          scope: runtimeScope,
          adapter: {
            ...harness.adapter,
            register: (receiver, request, context) =>
              request.descriptor.kind === "entity-updates"
                ? Effect.flatMap(Clock.currentTimeMillis, (now) => {
                    sentAt.push(now);
                    return sentAt.length === 1
                      ? Effect.fail({ ...slowDown(0, 409), kind: "registration" as const })
                      : Effect.succeed({ responseObservations: [] });
                  })
                : harness.adapter.register(receiver, request, context),
          },
          atomRegistry: registry,
          makeOpaqueId: makeIdFactory(),
          random: () => 1,
          policy: makeZeropsDataPolicy({ recoveryBackoffStartMs: 1_000 }),
        });
        yield* runtime.acquire({
          kind: "project-record",
          project: recordDescriptor.project,
        });
        for (let step = 0; step < 15; step++) {
          yield* TestClock.adjust("100 millis");
          yield* settle;
        }
        // Its 1 s rung, a fifth sooner: never a whole second after the failure.
        expect(sentAt).toHaveLength(2);
        expect(sentAt[1]).toBeGreaterThanOrEqual(800);
        expect(sentAt[1]).toBeLessThan(1_000);
        yield* runtime.shutdown("application-close");
        registry.dispose();
      }),
    ),
  );
});
