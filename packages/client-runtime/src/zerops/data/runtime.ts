import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Scheduler from "effect/Scheduler";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { InvalidationBus } from "../knowledge/invalidation.ts";
import { makeGrantDriver, type ZeropsAccessGrant } from "./access/grantDriver.ts";
import { createZeropsDataAtoms } from "./atoms.ts";
import { grantCapabilities } from "./access/capabilities.ts";
import { commandAdmissionError, commandTarget } from "./commands.ts";
import { BuildLogTransportError, type BuildLogTransport } from "./logTransport.ts";
import { makeBuildLogRegistry, type BuildLogRegistry } from "./logs.ts";
import {
  commandDeadlineMs,
  DEFAULT_ZEROPS_DATA_POLICY,
  DEFAULT_ZEROPS_GRANT_POLICY,
  type ZeropsDataPolicy,
} from "./policy.ts";
import {
  makeZeropsCells,
  type ZeropsCellAdapter,
  type ZeropsCells,
  type ZeropsCellSourceError,
} from "./cells.ts";
import {
  makeInitialZeropsDataState,
  reduceZeropsDataState,
  type RuntimeControlInput,
  type ZeropsDataFollowUp,
  type ZeropsDataState,
} from "./state.ts";
import type {
  AccessObservation,
  AccessState,
  AccountRef,
  AccountScope,
  AdapterError,
  CommandAdmissionError,
  CommandCompletionInput,
  DesiredInterestState,
  EntityRef,
  IngestionInput,
  InterestIdentity,
  InterestKey,
  InterestLease,
  EntityQueryDescriptor,
  LeaseAdmissionError,
  OrganizationRef,
  PlatformCommand,
  PlatformCommandIntent,
  PlatformCommandReceipt,
  PlatformCommandResult,
  PlatformObservation,
  ProjectRef,
  QueryDescriptor,
  QueryKey,
  ReadCompletionInput,
  ReadFailureKind,
  ReadTarget,
  ReadTicket,
  ReceiverEvent,
  ReceiverHandle,
  ReceiverIdentity,
  RegistrationCompletionInput,
  RegistrationDescriptor,
  RegistrationRequest,
  RegistrationReceipt,
  RuntimeInterestDescriptor,
  SharedReadOwnership,
  TableQueryDescriptor,
  VerifiedAccessGrant,
  ZeropsDataAdapter,
  ZeropsDataRuntime,
  ZeropsVisibility,
} from "./types.ts";
import {
  DispatchOrdinal,
  InterestEpoch,
  InterestKey as InterestKeySchema,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ReceiverEpoch,
  ZeropsCommandAttemptId,
  ZeropsLeaseId,
  ZeropsProjectId,
  ZeropsReceiverId,
  ZeropsOrganizationId,
  ZeropsRequestId,
  ZeropsSharedReadId,
  ZeropsWireSubscriptionName,
  organizationKeyOf,
  entityKeyOf,
  projectKeyOf,
  queryKeyOf,
  tableEntityOf,
} from "./types.ts";
import {
  activeVersionsDescriptor,
  serviceVariablesDescriptor,
  tableRowsDue,
  tableRowsWanted,
} from "./entityTable.ts";

export function accountRefsEqual(left: AccountRef, right: AccountRef): boolean {
  return left.apiOrigin === right.apiOrigin && left.accountId === right.accountId;
}

function interestIdentitiesEqual(left: InterestIdentity, right: InterestIdentity): boolean {
  return (
    left.key === right.key &&
    left.interestEpoch === right.interestEpoch &&
    left.receiver.accountEpoch === right.receiver.accountEpoch &&
    left.receiver.receiverEpoch === right.receiver.receiverEpoch &&
    left.receiver.receiverId === right.receiver.receiverId
  );
}

function organizationOfInterest(descriptor: RuntimeInterestDescriptor): OrganizationRef {
  return "organization" in descriptor ? descriptor.organization : descriptor.project.organization;
}

function organizationOfEntityRef(ref: EntityRef): OrganizationRef {
  return ref.kind === "project" ? ref.organization : ref.project.organization;
}

const interestKeys = new WeakMap<RuntimeInterestDescriptor, InterestKey>();

/**
 * Stable desired-work identity. Disposable receiver/interest epochs stay out of this key. It is
 * serialized once per descriptor object: descriptors are immutable.
 */
export function interestKeyOf(descriptor: RuntimeInterestDescriptor): InterestKey {
  let key = interestKeys.get(descriptor);
  if (key === undefined) {
    key = serializedInterestKey(descriptor);
    interestKeys.set(descriptor, key);
  }
  return key;
}

function serializedInterestKey(descriptor: RuntimeInterestDescriptor): InterestKey {
  switch (descriptor.kind) {
    case "organization-inventory":
    case "organization-versions":
    case "organization-variables":
      return InterestKeySchema.make(
        JSON.stringify([descriptor.kind, organizationKeyOf(descriptor.organization)]),
      );
    case "project-topology":
      return InterestKeySchema.make(
        JSON.stringify([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          descriptor.includeCurrentMetrics,
        ]),
      );
    case "project-inventory":
    case "project-record":
    case "project-services-check":
    case "project-current-metrics":
      return InterestKeySchema.make(
        JSON.stringify([descriptor.kind, projectKeyOf(descriptor.project)]),
      );
    case "project-activity":
      return InterestKeySchema.make(
        JSON.stringify([descriptor.kind, projectKeyOf(descriptor.project)]),
      );
    case "project-process-history":
      return InterestKeySchema.make(
        JSON.stringify([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          descriptor.before ?? "",
          descriptor.limit,
        ]),
      );
    case "project-metric-history":
      return InterestKeySchema.make(
        JSON.stringify([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          descriptor.window.timeGroupBy,
          descriptor.window.limit,
          descriptor.window.timeZone,
        ]),
      );
  }
}

interface ZeropsIngressSnapshot {
  readonly events: number;
  readonly bytes: number;
  readonly peakEvents: number;
  readonly peakBytes: number;
  readonly discardedEvents: number;
}

interface QueuedIngress<Input> {
  readonly input: Input;
  readonly bytes: number;
  readonly budgeted: boolean;
}

export interface ZeropsBoundedIngress<Input> {
  /** Returns false only after `onOverflow` has made the loss observable. */
  readonly offer: (input: Input, bytes: number) => Effect.Effect<boolean>;
  /** Enqueues an ordering marker without spending or being rejected by data budgets. */
  readonly offerUncounted: (input: Input) => Effect.Effect<boolean>;
  readonly take: Effect.Effect<Input>;
  readonly snapshot: Effect.Effect<ZeropsIngressSnapshot>;
  readonly shutdown: Effect.Effect<void>;
}

/**
 * Account-wide serialized ingress with independent decoded-event and raw-byte
 * limits. The overflow callback runs before the rejected event is counted as
 * discarded, so callers can publish recovering state before losing data.
 *
 * The limits are the counters', never the queue's: a bounded queue suspended an
 * admitted producer that held admission while the one consumer needed admission to
 * count its take, and a burst that filled it stopped every input of the account for
 * good (measured on mate.zerops.io, pass 31). Nothing here waits while holding
 * anything, and an uncounted marker is never refused nor kept waiting.
 */
export const makeZeropsBoundedIngress = Effect.fn("ZeropsDataRuntime.makeBoundedIngress")(
  function* <Input>(options: {
    readonly maxEvents: number;
    readonly maxBytes: number;
    readonly maxFrameBytes: number;
    readonly onOverflow: (input: Input) => Effect.Effect<void>;
  }) {
    const queue = yield* Queue.unbounded<QueuedIngress<Input>>();
    // Overflows publish one at a time; a take never waits for it.
    const overflow = yield* Semaphore.make(1);
    const counters = yield* Ref.make<ZeropsIngressSnapshot>({
      events: 0,
      bytes: 0,
      peakEvents: 0,
      peakBytes: 0,
      discardedEvents: 0,
    });

    const offer = (input: Input, bytes: number): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        // Reserving the budget and queueing the input are one step: an interrupt between them
        // kept the reservation for good, and enough of them overflowed every later offer.
        const admitted = yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const reserved = yield* Ref.modify(counters, (state) => {
              const admissible =
                Number.isSafeInteger(bytes) &&
                bytes >= 0 &&
                bytes <= options.maxFrameBytes &&
                state.events < options.maxEvents &&
                state.bytes + bytes <= options.maxBytes;
              if (!admissible) return [false, state] as const;
              const events = state.events + 1;
              const nextBytes = state.bytes + bytes;
              return [
                true,
                {
                  ...state,
                  events,
                  bytes: nextBytes,
                  peakEvents: Math.max(state.peakEvents, events),
                  peakBytes: Math.max(state.peakBytes, nextBytes),
                },
              ] as const;
            });
            if (!reserved) return "refused" as const;
            if (yield* Queue.offer(queue, { input, bytes, budgeted: true }))
              return "queued" as const;
            // A shut-down queue keeps nothing: the reservation goes back.
            yield* Ref.update(counters, (state) => ({
              ...state,
              events: state.events - 1,
              bytes: state.bytes - bytes,
            }));
            return "closed" as const;
          }),
        );
        if (admitted !== "refused") return admitted === "queued";
        yield* overflow.withPermit(
          options.onOverflow(input).pipe(
            Effect.andThen(
              Ref.update(counters, (state) => ({
                ...state,
                discardedEvents: state.discardedEvents + 1,
              })),
            ),
          ),
        );
        return false;
      });

    // Waiting for an input can be interrupted; taking it and giving its budget back cannot.
    const take = Effect.uninterruptibleMask((restore) =>
      restore(Queue.take(queue)).pipe(
        Effect.tap((entry) =>
          entry.budgeted
            ? Ref.update(counters, (state) => ({
                ...state,
                events: state.events - 1,
                bytes: state.bytes - entry.bytes,
              }))
            : Effect.void,
        ),
        Effect.map((entry) => entry.input),
      ),
    );

    return {
      offer,
      offerUncounted: (input) => Queue.offer(queue, { input, bytes: 0, budgeted: false }),
      take,
      snapshot: Ref.get(counters),
      shutdown: Queue.shutdown(queue),
    } satisfies ZeropsBoundedIngress<Input>;
  },
);

/** Which waiting work a freed permit goes to: `first` work before any `later` work. */
export type ZeropsPermitPriority = "first" | "later";

export interface ZeropsPriorityPermits {
  /**
   * Runs `effect` holding one permit, given back however it ends. While permits are short, no
   * `later` work is admitted while `first` work waits.
   */
  readonly withPermit: (
    priority: ZeropsPermitPriority,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

/**
 * Counting permits with two admission classes. A woken waiter checks its turn again inside an
 * uninterruptible region before it takes a permit, as `Semaphore` does, so work interrupted
 * while it waits neither takes a permit nor keeps later work waiting behind it.
 */
export const makeZeropsPriorityPermits = (permits: number): Effect.Effect<ZeropsPriorityPermits> =>
  Effect.sync(() => {
    let taken = 0;
    /** Work waiting for a permit, counted from its first wait until it takes one or leaves. */
    const waiting: Record<ZeropsPermitPriority, number> = { first: 0, later: 0 };
    const wakers: Record<ZeropsPermitPriority, Set<() => void>> = {
      first: new Set(),
      later: new Set(),
    };
    const admissible = (priority: ZeropsPermitPriority): boolean =>
      taken < permits && (priority === "first" || waiting.first === 0);
    // Over a snapshot, first work ahead: a woken waiter may wait again before the loop ends.
    const wake = (): void => {
      for (const waker of [...wakers.first, ...wakers.later]) waker();
    };
    const turn = (priority: ZeropsPermitPriority): Effect.Effect<void> =>
      Effect.callback<void>((resume) => {
        const waker = () => {
          if (!admissible(priority)) return;
          wakers[priority].delete(waker);
          resume(Effect.void);
        };
        wakers[priority].add(waker);
        return Effect.sync(() => void wakers[priority].delete(waker));
      });
    const release = Effect.sync(() => {
      taken -= 1;
      wake();
    });
    return {
      withPermit:
        (priority) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.uninterruptibleMask((restore) =>
            Effect.suspend(() => {
              let queued = false;
              const leave = () => {
                if (!queued) return;
                queued = false;
                waiting[priority] -= 1;
              };
              const acquire: Effect.Effect<A, E, R> = Effect.suspend(() => {
                if (admissible(priority)) {
                  leave();
                  taken += 1;
                  return restore(effect).pipe(Effect.ensuring(release));
                }
                if (!queued) {
                  queued = true;
                  waiting[priority] += 1;
                }
                return restore(turn(priority)).pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      leave();
                      wake();
                    }),
                  ),
                  Effect.andThen(acquire),
                );
              });
              return acquire;
            }),
          ),
    } satisfies ZeropsPriorityPermits;
  });

type PlannedRegistration = {
  readonly descriptor: RegistrationDescriptor;
  readonly baseline: ReadTarget | null;
};

interface InterestPlan {
  readonly registrations: ReadonlyArray<PlannedRegistration>;
  readonly directReads: ReadonlyArray<ReadTarget>;
}

const queryKeysOfPlan = (plan: InterestPlan): ReadonlyArray<QueryKey> => [
  ...new Set(
    plan.registrations.flatMap((registration) =>
      registration.baseline?.kind === "query" ? [queryKeyOf(registration.baseline.descriptor)] : [],
    ),
  ),
];

/**
 * What an interest registers and reads (DESIGN §4.1). Projects, services and running processes
 * are the organization's, read and subscribed once for every project the way the platform's own
 * app does (`POST /<entity>/search` filtered by `clientId`): a project's inventory, topology or
 * activity shares those registrations, deduplicated by key, and reads nothing of its own. A cold
 * load, and a reconnect, cost the same whatever the number of projects. Only a project's metrics
 * and its process history, which the platform answers per project, are the project's own.
 */
export function planZeropsInterest(descriptor: RuntimeInterestDescriptor): InterestPlan {
  const organization = organizationOfInterest(descriptor);
  const entityUpdate = (entity: "project" | "service" | "process"): PlannedRegistration => ({
    descriptor: { kind: "entity-updates", entity, organization },
    baseline: null,
  });
  const membership = (query: EntityQueryDescriptor): PlannedRegistration => ({
    descriptor: { kind: "query-membership", query },
    baseline: { kind: "query", descriptor: query },
  });
  const projects: EntityQueryDescriptor = {
    kind: "projects-of-organization",
    organization,
    statuses: [],
    schemaVersion: 1,
  };
  const services: EntityQueryDescriptor = {
    kind: "services-of-organization",
    organization,
    schemaVersion: 1,
  };
  const running: EntityQueryDescriptor = {
    kind: "running-processes-of-organization",
    organization,
    statuses: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"],
    schemaVersion: 1,
  };
  const table = (query: TableQueryDescriptor): ReadonlyArray<PlannedRegistration> => [
    {
      descriptor: { kind: "table-updates", entity: tableEntityOf(query), organization },
      baseline: null,
    },
    { descriptor: { kind: "table-list", query }, baseline: { kind: "query", descriptor: query } },
  ];
  if (descriptor.kind === "organization-versions") {
    return { registrations: table(activeVersionsDescriptor(organization)), directReads: [] };
  }
  if (descriptor.kind === "organization-variables") {
    return { registrations: table(serviceVariablesDescriptor(organization)), directReads: [] };
  }
  if (descriptor.kind === "organization-inventory") {
    return {
      registrations: [entityUpdate("project"), membership(projects)],
      // The lag-free list (`GET /client/{id}/project`): a project is there before its create
      // call has returned, while the search behind the registration trails it.
      directReads: [{ kind: "query", descriptor: projects }],
    };
  }
  const activity = [entityUpdate("process"), membership(running)];
  if (descriptor.kind === "project-inventory" || descriptor.kind === "project-topology") {
    return {
      // The project itself is the organization inventory's, which every app holds beside it.
      registrations: [
        entityUpdate("service"),
        membership(services),
        ...(descriptor.kind === "project-topology" ? activity : []),
      ],
      directReads: [],
    };
  }
  const project = descriptor.project;
  if (descriptor.kind === "project-activity") {
    return { registrations: activity, directReads: [] };
  }
  if (descriptor.kind === "project-services-check") {
    return {
      registrations: [],
      directReads: [
        { kind: "query", descriptor: { kind: "services-of-project", project, schemaVersion: 1 } },
      ],
    };
  }
  if (descriptor.kind === "project-record") {
    return {
      registrations: [entityUpdate("project")],
      directReads: [{ kind: "project", ref: project }],
    };
  }
  if (descriptor.kind === "project-current-metrics") {
    const query: QueryDescriptor = {
      kind: "current-metrics-of-project",
      project,
      groupBy: "containerId",
      schemaVersion: 1,
    };
    return {
      registrations: [
        {
          descriptor: { kind: "current-metrics", query },
          baseline: { kind: "query", descriptor: query },
        },
      ],
      directReads: [],
    };
  }
  if (descriptor.kind === "project-process-history") {
    const query: QueryDescriptor = {
      kind: "process-history-window",
      project,
      before: descriptor.before,
      limit: descriptor.limit,
      schemaVersion: 1,
    };
    return {
      registrations: [
        entityUpdate("process"),
        {
          descriptor: { kind: "query-membership", query },
          baseline: { kind: "query", descriptor: query },
        },
      ],
      directReads: [],
    };
  }
  const query: QueryDescriptor = {
    kind: "metric-history-of-project",
    project,
    groupBy: "serviceStackId",
    window: descriptor.window,
    schemaVersion: 1,
  };
  return {
    registrations: [
      {
        descriptor: { kind: "metric-history", query },
        baseline: { kind: "query", descriptor: query },
      },
    ],
    directReads: [],
  };
}

/** How long an id a table is owed waits for its own update frame before it is read. */
const TABLE_READ_GRACE_MS = 1_000;
/** How long a failed table read waits before its kind's next batch. */
const TABLE_READ_RETRY_MS = 30_000;
/** The most ids one table read names. */
const TABLE_READ_BATCH = 500;

function registrationKeyOf(descriptor: RegistrationDescriptor): string {
  if (descriptor.kind === "entity-updates" || descriptor.kind === "table-updates")
    return JSON.stringify([
      descriptor.kind,
      descriptor.entity,
      organizationKeyOf(descriptor.organization),
    ]);
  return JSON.stringify([descriptor.kind, queryKeyOf(descriptor.query)]);
}

/**
 * The organization inventory's own registrations, its project feed and its project list, go
 * first: the sidebar and the projects page read the list before any project in it.
 */
function registrationPriority(organization: OrganizationRef, key: string): ZeropsPermitPriority {
  return planZeropsInterest({ kind: "organization-inventory", organization }).registrations.some(
    (planned) => registrationKeyOf(planned.descriptor) === key,
  )
    ? "first"
    : "later";
}

type RuntimeIngressInput =
  | {
      readonly kind: "observation";
      readonly input: PlatformObservation;
      readonly interest: InterestIdentity | null;
      readonly sharedRegistration?: {
        readonly receiver: RuntimeReceiver;
        readonly registration: RuntimeRegistration;
      };
    }
  | {
      readonly kind: "read-completion";
      readonly completion: ReadCompletionInput;
      readonly interest: InterestIdentity | null;
    }
  | {
      readonly kind: "registration-completion";
      readonly completion: RegistrationCompletionInput;
      readonly interest: InterestIdentity;
    }
  | {
      readonly kind: "command-completion";
      readonly completion: CommandCompletionInput;
      readonly interest: null;
    }
  | {
      readonly kind: "access-observation";
      readonly observation: AccessObservation;
      readonly interest: null;
    }
  | {
      readonly kind: "command-execution-requested";
      readonly request: Extract<
        IngestionInput,
        { readonly kind: "command-execution-requested" }
      >["request"];
      readonly interest: null;
    }
  | {
      readonly kind: "barrier";
      readonly deferred: Deferred.Deferred<void>;
      readonly interest: null;
    };

type RecoveryReason = Extract<
  DesiredInterestState["interest"],
  { readonly status: "recovering" }
>["reason"];

/** An organization's one recovery cycle: what wakes its wait, and a receiver to replace first. */
interface RecoveryCycle {
  wake: Deferred.Deferred<void>;
  replace: { readonly receiver: RuntimeReceiver; readonly reason: string } | null;
}

/** How one establishment attempt ended, for the recovery cycle that ran it. */
type EstablishmentOutcome =
  /** Its registrations and reads completed, or it was superseded or released before they did. */
  | { readonly kind: "done" }
  /** It failed alone: the interest waits out its own backoff on the receiver that serves it. */
  | { readonly kind: "interest-failed" }
  /** The receiver failed under it: the receiver is replaced. */
  | { readonly kind: "receiver-failed"; readonly reason: string };

const establishmentDone: EstablishmentOutcome = { kind: "done" };
const interestFailed: EstablishmentOutcome = { kind: "interest-failed" };
const receiverFailed = (reason: string): EstablishmentOutcome => ({
  kind: "receiver-failed",
  reason,
});

interface RuntimeInterest {
  readonly descriptor: RuntimeInterestDescriptor;
  readonly key: InterestKey;
  readonly leases: Set<string>;
  readonly required: boolean;
  identity: InterestIdentity;
  recoveryAttempts: number;
  readController: AbortController;
}

type PhysicalRegistrationOutcome =
  | { readonly kind: "succeeded"; readonly receipt: RegistrationReceipt }
  | { readonly kind: "failed"; readonly error: AdapterError };

interface RuntimeRegistration {
  readonly key: string;
  readonly planned: PlannedRegistration;
  readonly request: RegistrationRequest;
  readonly ticket: ReadTicket | null;
  readonly outcome: Deferred.Deferred<PhysicalRegistrationOutcome>;
  readonly dependents: Map<InterestKey, InterestIdentity>;
  status: "registering" | "registered" | "failed";
}

interface RuntimeReceiver {
  readonly organization: OrganizationRef;
  readonly identity: ReceiverIdentity;
  handle: ReceiverHandle | null;
  /** Why its last socket login failed, until its recovery cycle retries it. */
  openFailure: AdapterError | null;
  readonly registrations: Map<string, RuntimeRegistration>;
  readonly registrationOwners: Map<string, RuntimeRegistration>;
  registrationAttempts: number;
}

interface RuntimeHydration {
  readonly target: EntityRef;
  readonly requestId: ZeropsRequestId;
  ownership: SharedReadOwnership;
  fiber: Fiber.Fiber<void> | null;
}

export interface ZeropsDataRuntimeOptions {
  readonly scope: AccountScope;
  readonly adapter: ZeropsDataAdapter;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
  readonly makeOpaqueId: () => string;
  readonly policy?: ZeropsDataPolicy;
  readonly initialAccess?: AccessState;
  readonly visibility?: ZeropsVisibility;
  readonly buildLogTransport?: BuildLogTransport;
  readonly logTimers?: {
    readonly setTimer: (callback: () => void, delayMs: number) => unknown;
    readonly clearTimer: (handle: unknown) => void;
  };
}

interface ZeropsDataRuntimeDiagnostics {
  readonly state: Effect.Effect<ZeropsDataState>;
  readonly stateAtom: Atom.Atom<ZeropsDataState>;
  readonly ingress: Effect.Effect<ZeropsIngressSnapshot>;
  readonly observeAccess: (observation: AccessObservation) => Effect.Effect<void>;
}

export type ManagedZeropsDataRuntime = ZeropsDataRuntime &
  ZeropsDataRuntimeDiagnostics & {
    readonly cells: ZeropsCells;
    readonly logs: BuildLogRegistry;
    /** The epoch's access grant, interpreted here (DESIGN §4.2, D16(a)). */
    readonly access: ZeropsAccessGrant;
    /**
     * Hears the account's bus for the caller's scope (DESIGN §6.2): each `inventory` re-reads that
     * organization with `refresh`, on a fresh receiver while the rows already read stay up. Its
     * leases are never re-taken for it: a released lease drops what it read.
     */
    readonly listen: (bus: InvalidationBus) => Effect.Effect<void, never, Scope.Scope>;
  };

const leaseError = (
  reason: LeaseAdmissionError["reason"],
  message: string,
): LeaseAdmissionError => ({ _tag: "ZeropsLeaseAdmissionError", reason, message });

const unavailableResource = (): Effect.Effect<never, ZeropsCellSourceError> =>
  Effect.fail({
    _tag: "ZeropsCellSourceError",
    kind: "unavailable",
    retryable: false,
  });

const unavailableCellAdapter: ZeropsCellAdapter = {
  readOrganizationLocations: unavailableResource,
  readServiceAuthorizedAgents: unavailableResource,
  readServiceMateFlag: unavailableResource,
  readOrganizationIntegrationTokenGrants: unavailableResource,
  readOrganizationMembers: unavailableResource,
  readServiceVariableNames: unavailableResource,
};

const unavailableLogTransport: BuildLogTransport = {
  loadPage: () => Promise.reject(new BuildLogTransportError("closed")),
  openFollow: () => Promise.reject(new BuildLogTransportError("closed")),
  shutdown: () => undefined,
  diagnostics: () => ({ activeFollowers: 0, closed: true }),
};

function registrationInterest(observation: PlatformObservation): InterestIdentity | null {
  if (observation.kind === "query-membership-observed") return observation.registration.identity;
  if (
    observation.kind === "current-metrics-replaced" ||
    observation.kind === "metric-history-window-observed"
  ) {
    return observation.source === "native-push" ? observation.registration.identity : null;
  }
  if ("observation" in observation) {
    const source = observation.observation;
    if (source.source === "native-push") return source.registration.identity;
    if (source.source === "embedded" && source.cause.kind === "native") {
      return source.cause.registration.identity;
    }
  }
  return null;
}

function observationRegistration(observation: PlatformObservation): RegistrationRequest | null {
  if (observation.kind === "query-membership-observed") return observation.registration;
  if (
    (observation.kind === "current-metrics-replaced" ||
      observation.kind === "metric-history-window-observed") &&
    observation.source === "native-push"
  )
    return observation.registration;
  if ("observation" in observation) {
    const source = observation.observation;
    if (source.source === "native-push") return source.registration;
    if (source.source === "embedded" && source.cause.kind === "native")
      return source.cause.registration;
  }
  return null;
}

function retargetRegistrationObservation(
  observation: PlatformObservation,
  identity: InterestIdentity,
): PlatformObservation {
  if (observation.kind === "query-membership-observed")
    return {
      ...observation,
      registration: { ...observation.registration, identity },
    } as PlatformObservation;
  if (
    (observation.kind === "current-metrics-replaced" ||
      observation.kind === "metric-history-window-observed") &&
    observation.source === "native-push"
  )
    return {
      ...observation,
      registration: { ...observation.registration, identity },
    } as PlatformObservation;
  if ("observation" in observation) {
    const source = observation.observation;
    if (source.source === "native-push")
      return {
        ...observation,
        observation: {
          ...source,
          registration: { ...source.registration, identity },
        },
      } as PlatformObservation;
    if (source.source === "embedded" && source.cause.kind === "native")
      return {
        ...observation,
        observation: {
          ...source,
          cause: {
            ...source.cause,
            registration: { ...source.cause.registration, identity },
          },
        },
      } as PlatformObservation;
  }
  return observation;
}

function observationReadTicket(observation: PlatformObservation): ReadTicket | null {
  if (observation.kind === "query-baseline-observed" || observation.kind === "entity-unavailable")
    return observation.ticket;
  if (
    (observation.kind === "current-metrics-replaced" ||
      observation.kind === "metric-history-window-observed") &&
    observation.source === "direct-read"
  )
    return observation.ticket;
  if ("observation" in observation) {
    const source = observation.observation;
    if (source.source === "direct-read" || source.source === "indexed-search") return source.ticket;
    if (source.source === "embedded" && source.cause.kind === "read") return source.cause.ticket;
  }
  return null;
}

/**
 * How a failed hydration is retried: an entity the platform says is not there for this account
 * (403, 404, 410) is `gone` until a recovery or a grant change; a 429 is `throttled` and waits
 * its Retry-After; anything else (a 5xx, the network) backs off.
 */
export type HydrationRefusal =
  | { readonly kind: "gone" }
  | { readonly kind: "throttled"; readonly retryAfterMs: number | undefined }
  | { readonly kind: "transient" };

export function hydrationRefusal(error: AdapterError | null): HydrationRefusal {
  if (error === null) return { kind: "transient" };
  if (
    error.status === 403 ||
    error.status === 404 ||
    error.status === 410 ||
    error.kind === "forbidden" ||
    error.kind === "not-found"
  )
    return { kind: "gone" };
  if (error.status === 429) return { kind: "throttled", retryAfterMs: error.retryAfterMs };
  return { kind: "transient" };
}

function failureKind(error: AdapterError): ReadFailureKind {
  switch (error.kind) {
    case "cancelled":
    case "timeout":
    case "network":
    case "unauthorized":
    case "forbidden":
    case "not-found":
    case "server":
    case "malformed":
    case "incomplete":
      return error.kind;
    default:
      return "network";
  }
}

/**
 * A registration the platform refused with an HTTP error status never took effect: the receiver
 * holds no subscription for it, so its interests may register again on that receiver. One that got
 * no answer, or an answer that could not be read, may have left a subscription nobody owns.
 */
const registrationRefused = (error: AdapterError): boolean => error.status !== undefined;

/** A registration let go because a person asked to try again (Try now). */
const RETRIED_BY_PERSON: AdapterError = {
  _tag: "ZeropsDataAdapterError",
  kind: "cancelled",
  message: "Retried at a person's request.",
  retryable: true,
  accountRevocationEvidence: false,
};

/**
 * A shared registration its sender abandoned in flight — its establishment ran out of time, or it
 * went: the interests waiting on it retry alone, as the sender does, and never strand.
 */
const REGISTRATION_ABANDONED: AdapterError = {
  _tag: "ZeropsDataAdapterError",
  kind: "timeout",
  message: "The shared registration was abandoned by the interest that sent it.",
  retryable: true,
  accountRevocationEvidence: false,
};

/** An interest's establishment that outlived `establishmentDeadlineMs`: its own, not its socket's. */
const ESTABLISHMENT_DEADLINE: AdapterError = {
  _tag: "ZeropsDataAdapterError",
  kind: "timeout",
  message: "The interest establishment deadline expired.",
  retryable: true,
  accountRevocationEvidence: false,
};

/**
 * Creates one account-scoped owner. The returned runtime owns its Effect scope
 * and transports, while the caller continues to own the supplied AtomRegistry.
 */
export const makeZeropsDataRuntime = Effect.fn("ZeropsDataRuntime.make")(function* (
  options: ZeropsDataRuntimeOptions,
) {
  const runtimeContext = yield* Effect.context<never>();
  const scheduler = yield* Scheduler.Scheduler;
  const policy = options.policy ?? DEFAULT_ZEROPS_DATA_POLICY;
  const model = yield* Ref.make(
    makeInitialZeropsDataState(options.scope, options.initialAccess ?? { status: "unverified" }),
  );
  const cells = yield* makeZeropsCells({
    scope: options.scope,
    adapter: options.adapter.cells ?? unavailableCellAdapter,
    access: () => Ref.getUnsafe(model).access,
    maxEntries: policy.activeSharedReadsPerAccount,
  });
  // Every write to an organization's tokens, wherever the app made it, makes its list read again.
  const stopTokenWrites =
    options.adapter.onTokensWritten?.((organizationId) =>
      Effect.runForkWith(runtimeContext)(
        cells.invalidate({
          kind: "tokens",
          account: options.scope,
          organization: {
            kind: "organization",
            account: options.scope.account,
            organizationId: ZeropsOrganizationId.make(organizationId),
          },
        }),
      ),
    ) ?? (() => undefined);
  const logTimers = options.logTimers ?? {
    setTimer: (callback: () => void, delayMs: number) =>
      Effect.runForkWith(runtimeContext)(
        Effect.sleep(Duration.millis(delayMs)).pipe(Effect.andThen(Effect.sync(callback))),
      ),
    clearTimer: (handle: unknown) => {
      if (Fiber.isFiber(handle)) handle.interruptUnsafe();
    },
  };
  const clock = yield* Clock.Clock;
  const logs = makeBuildLogRegistry({
    scope: options.scope,
    access: () => Ref.getUnsafe(model).access,
    now: () => clock.currentTimeMillisUnsafe(),
    transport: options.buildLogTransport ?? unavailableLogTransport,
    policy,
    setTimer: logTimers.setTimer,
    clearTimer: logTimers.clearTimer,
  });
  /** The access the build logs and the cells were last reconciled with. */
  let reconciledAccess = Ref.getUnsafe(model).access;
  const runtimeScope = yield* Scope.make();
  // Demand arrives from independently run UI effects; workers retain the account scheduler.
  const forkOwned = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.forkIn(runtimeScope), Effect.provideService(Scheduler.Scheduler, scheduler));
  const closed = yield* Ref.make(false);
  /** Open while the tab is online: offline, no establishment starts, so no socket login is sent. */
  const network = yield* Latch.make(true);
  const visibility =
    options.visibility ??
    ({ current: Effect.succeed("visible"), changes: Stream.never } satisfies ZeropsVisibility);
  const currentVisibility = yield* Ref.make(yield* visibility.current);
  const visibilitySequence = yield* Ref.make(0);
  const modelLock = yield* Semaphore.make(1);
  const lifecycleLock = yield* Semaphore.make(1);
  const receiverLock = yield* Semaphore.make(1);
  const registrationLock = yield* Semaphore.make(1);
  const readSemaphore = yield* Semaphore.make(policy.readConcurrency);
  const hydrationSemaphore = yield* Semaphore.make(policy.hydrationConcurrency);
  const registrationPermits = yield* makeZeropsPriorityPermits(policy.registrationConcurrency);
  const commandSemaphore = yield* Semaphore.make(1);
  const rootAtom = Atom.make(yield* Ref.get(model));
  const unmountRootAtom = options.atomRegistry.mount(rootAtom);
  yield* Scope.addFinalizer(runtimeScope, Effect.sync(unmountRootAtom));
  const atoms = createZeropsDataAtoms(rootAtom);
  const interests = new Map<InterestKey, RuntimeInterest>();
  const leases = new Map<string, RuntimeInterest>();
  const receivers = new Map<string, RuntimeReceiver>();
  // Each organization being recovered has one cycle. A failure while it runs wakes it instead of
  // starting a competing cycle, so it recomputes its wait from current state, which by then holds
  // the new failure's own due time; one that needs the receiver replaced also says so.
  const recoveryCycles = new Map<string, RecoveryCycle>();
  const hydrations = new Map<string, RuntimeHydration>();
  /** Each entity's failed hydrations, and when the next may start (`retryHydration`). */
  const hydrationFailures = new Map<
    string,
    {
      readonly organizationKey: string;
      readonly query: QueryKey;
      count: number;
      retryAtMs: number;
      /** How the last read failed (`hydrationRefusal`): what its retry waits for. */
      refusal: HydrationRefusal;
    }
  >();
  let receiptOrdinal = 0;
  let readStartOrdinal = 0;
  let dispatchOrdinal = 0;
  let receiverEpoch = 0;
  let interestEpoch = 0;
  let scheduleHydration: (query: QueryKey) => Effect.Effect<void> = () => Effect.void;
  let scheduleTableRead: (
    followUp: Extract<ZeropsDataFollowUp, { readonly kind: "read-table-rows" }>,
  ) => Effect.Effect<void> = () => Effect.void;
  let scheduleRecovery: (receiver: RuntimeReceiver, reason: string) => Effect.Effect<void> = () =>
    Effect.void;
  let recoverSubscription: (
    receiver: RuntimeReceiver,
    registration: RuntimeRegistration,
  ) => Effect.Effect<void> = () => Effect.void;
  let recoverInterest: (
    receiver: RuntimeReceiver,
    identity: InterestIdentity,
    reason: RecoveryReason,
    message: string,
  ) => Effect.Effect<void> = () => Effect.void;
  // Bounded, backoff-capped retry out of the `failed` interest state. Assigned once
  // `establishInterest` exists; referenced from both `establishInterest` and `scheduleRecovery`.
  let scheduleFailedRetry: (
    runtimeInterest: RuntimeInterest,
    identity: InterestIdentity,
    retryAtMs: number,
  ) => Effect.Effect<void> = () => Effect.void;

  let pendingPublication: ZeropsDataState | null = null;
  let publicationEvents = 0;
  /**
   * The atoms notify their subscribers inside `set`, on whichever fiber published: the ingress's
   * one consumer, a command, a scheduler task. The registry reports a subscriber's or a
   * projection's own throw itself and still updates every other one (the `effect` patch); anything
   * that escapes `set` regardless is handed back to be logged, so no fiber or task dies of it.
   */
  const flushPendingPublication = (): { readonly subscriberError: unknown } | null => {
    const next = pendingPublication;
    pendingPublication = null;
    publicationEvents = 0;
    if (next === null) return null;
    try {
      options.atomRegistry.set(rootAtom, next);
      return null;
    } catch (subscriberError) {
      return { subscriberError };
    }
  };
  const logSubscriberError = (failed: { readonly subscriberError: unknown } | null) =>
    failed === null
      ? Effect.void
      : Effect.logError(
          "Zerops data: a subscriber failed while the account published",
          failed.subscriberError,
        );
  const flushPublication = Effect.suspend(() => logSubscriberError(flushPendingPublication()));
  // Every change a task makes reaches the atoms in one publication, after the task: each
  // publication recomputes every projection, so the leases of a whole account taken one by one
  // must not recompute them once per lease.
  const publicationDispatcher = scheduler.makeDispatcher();
  let publicationScheduled = false;
  const publishAfterTask = () => {
    if (publicationScheduled) return;
    publicationScheduled = true;
    publicationDispatcher.scheduleTask(() => {
      publicationScheduled = false;
      const failed = flushPendingPublication();
      if (failed !== null) Effect.runForkWith(runtimeContext)(logSubscriberError(failed));
    }, 0);
  };

  /**
   * Every change of access reaches the build logs and the cells, whatever made it. The
   * atoms hear the change now, after the task, or when the ingress loop flushes its batch.
   */
  const publish = (
    next: ZeropsDataState,
    publication: "now" | "after-task" | "ingress-batch" = "now",
  ): Effect.Effect<void> =>
    Ref.set(model, next).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          pendingPublication = next;
          publicationEvents += 1;
          if (publication === "after-task") publishAfterTask();
          if (next.access === reconciledAccess) return Effect.void;
          reconciledAccess = next.access;
          logs.reconcileAccess();
          return cells.reconcileAccess;
        }),
      ),
      Effect.andThen(publication === "now" ? flushPublication : Effect.void),
    );

  const applyControl = (input: RuntimeControlInput): Effect.Effect<void> =>
    modelLock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(model);
        const reduction = reduceZeropsDataState(current, input, policy);
        if (reduction.state !== current) yield* publish(reduction.state, "after-task");
      }),
    );

  const admitRead = (ticket: ReadTicket): Effect.Effect<boolean> =>
    modelLock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(model);
        const pending = [...current.reads.values()].filter(
          (read) => read.status === "pending",
        ).length;
        if (pending >= policy.queuedReadRequestsPerAccount) return false;
        const reduction = reduceZeropsDataState(current, { kind: "read-started", ticket }, policy);
        if (reduction.state === current) return false;
        yield* publish(reduction.state);
        return true;
      }),
    );

  const readCapacityError = (): AdapterError => ({
    _tag: "ZeropsDataAdapterError",
    kind: "overflow",
    message: "The account read queue is full.",
    retryable: true,
    accountRevocationEvidence: false,
  });

  const stampInput = (
    input: Exclude<RuntimeIngressInput, { readonly kind: "barrier" }>,
    stamp: { readonly receiptOrdinal: ReceiptOrdinal; readonly observedAtMs: number },
    current: ZeropsDataState,
  ): IngestionInput | null => {
    switch (input.kind) {
      case "observation": {
        let observation = input.input;
        if (input.sharedRegistration !== undefined) {
          const { receiver, registration } = input.sharedRegistration;
          if (
            receivers.get(organizationKeyOf(receiver.organization)) !== receiver ||
            receiver.registrations.get(registration.key) !== registration
          )
            return null;
          // Select an owner at ingestion: the original lessee may have released while queued.
          let identity: InterestIdentity | undefined;
          for (const candidate of registration.dependents.values()) {
            if (
              current.interests.get(candidate.key)?.interest.identity === candidate &&
              (interests.get(candidate.key)?.leases.size ?? 0) > 0
            ) {
              identity = candidate;
              break;
            }
          }
          if (identity === undefined) return null;
          observation = retargetRegistrationObservation(observation, identity);
        }
        const accessEvidence: VerifiedAccessGrant | null =
          current.access.status === "verified" && current.access.deadlineMs > stamp.observedAtMs
            ? current.access
            : null;
        return {
          kind: "observation",
          observation: { stamp, input: observation, accessEvidence },
        };
      }
      case "read-completion":
        return { kind: "read-completion", stamp, completion: input.completion };
      case "registration-completion":
        return { kind: "registration-completion", stamp, completion: input.completion };
      case "command-completion":
        return { kind: "command-completion", stamp, completion: input.completion };
      case "access-observation":
        return { kind: "access-observation", stamp, observation: input.observation };
      case "command-execution-requested":
        return { kind: "command-execution-requested", stamp, request: input.request };
    }
  };

  const applyIngress = (input: RuntimeIngressInput): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (input.kind === "barrier") {
        // Whatever the flush does, the command or read waiting on the barrier goes on.
        yield* flushPublication.pipe(Effect.ensuring(Deferred.succeed(input.deferred, undefined)));
        return;
      }
      const followUps = yield* modelLock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(model);
          if (current.closed) return [];
          receiptOrdinal += 1;
          const now = yield* Clock.currentTimeMillis;
          const stamped = stampInput(
            input,
            { receiptOrdinal: ReceiptOrdinal.make(receiptOrdinal), observedAtMs: now },
            current,
          );
          if (stamped === null) return [];
          const reduction = reduceZeropsDataState(current, stamped, policy);
          if (input.interest !== null) {
            const desired = reduction.state.interests.get(input.interest.key)?.interest;
            const owner = interests.get(input.interest.key);
            if (desired?.status === "observing" && owner?.identity === desired.identity) {
              owner.recoveryAttempts = 0;
              // A successful recovery clears the hydration-failure budget for its
              // organization: the transport is healthy again, so unresolved entities
              // deserve a fresh set of hydration attempts rather than staying stuck. Only the
              // recovery itself: every later event would otherwise lift each failed entity's
              // backoff (`retryHydration`) and read it again at once.
              const before = current.interests.get(input.interest.key)?.interest;
              if (before?.status !== "observing" || before.identity !== desired.identity) {
                const organizationKey = organizationKeyOf(organizationOfInterest(owner.descriptor));
                for (const [entityKey, record] of hydrationFailures) {
                  if (record.organizationKey === organizationKey)
                    hydrationFailures.delete(entityKey);
                }
              }
            }
          }
          if (reduction.state !== current)
            yield* publish(reduction.state, input.kind === "observation" ? "ingress-batch" : "now");
          return reduction.followUps;
        }),
      );
      yield* Effect.forEach(
        followUps,
        (followUp) =>
          followUp.kind === "read-table-rows"
            ? scheduleTableRead(followUp)
            : scheduleHydration(followUp.query),
        { discard: true },
      );
    });

  const markRecovering = (
    identity: InterestIdentity,
    reason: RecoveryReason,
  ): Effect.Effect<void> =>
    modelLock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(model);
        const desired = current.interests.get(identity.key);
        if (desired === undefined || desired.interest.identity !== identity) return;
        // A background tab already tore down every receiver (pauseForBackground): a
        // failure signal that was in flight when that happened must not flip this
        // interest from "paused" back to "recovering" against a receiver that no
        // longer exists — scheduleRecovery would then silently decline to run a
        // cycle for it (receivers.get(...) mismatch) and resumeFromBackground would
        // never see it either, since it only looks for "paused"/"failed". Leave it
        // paused; resume re-establishes it like any other paused interest.
        if ((yield* Ref.get(currentVisibility)) === "hidden") {
          if (desired.interest.status === "paused") return;
          const reduction = reduceZeropsDataState(
            current,
            {
              kind: "interest-upserted",
              interest: {
                ...desired,
                interest: { status: "paused", identity, reason: "background" },
              },
            },
            policy,
          );
          if (reduction.state !== current) yield* publish(reduction.state);
          return;
        }
        const priorProgress =
          desired.interest.status === "establishing" || desired.interest.status === "recovering"
            ? desired.interest.progress
            : {
                requiredRegistrations: 0,
                completedRegistrations: 0,
                requiredReads: 0,
                completedReads: 0,
                crossedReceiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
              };
        const attempts =
          desired.interest.status === "recovering" ? desired.interest.attempt + 1 : 1;
        const next: DesiredInterestState = {
          ...desired,
          interest: {
            status: "recovering",
            identity,
            reason,
            attempt: attempts,
            nextRetryAtMs:
              (yield* Clock.currentTimeMillis) +
              Math.min(
                policy.recoveryBackoffStartMs * 2 ** Math.max(0, attempts - 1),
                policy.recoveryBackoffMaxMs,
              ),
            progress: priorProgress,
          },
        };
        const reduction = reduceZeropsDataState(
          current,
          { kind: "interest-upserted", interest: next },
          policy,
        );
        if (reduction.state !== current) yield* publish(reduction.state);
      }),
    );

  const overflowIdentities = (
    input: RuntimeIngressInput,
  ): Effect.Effect<ReadonlyArray<InterestIdentity>> =>
    Effect.gen(function* () {
      const identities = new Map<InterestKey, InterestIdentity>();
      if (input.interest !== null) identities.set(input.interest.key, input.interest);
      if (input.kind === "observation" && input.sharedRegistration !== undefined) {
        for (const [key, identity] of input.sharedRegistration.registration.dependents) {
          identities.set(key, identity);
        }
      }
      const ticket =
        input.kind === "observation"
          ? observationReadTicket(input.input)
          : input.kind === "read-completion"
            ? input.completion.ticket
            : null;
      if (ticket?.owner.kind === "shared") {
        const ownership = (yield* Ref.get(model)).sharedReads.get(ticket.requestId);
        if (ownership !== undefined) {
          for (const [key, identity] of ownership.dependents) identities.set(key, identity);
        }
      }
      return [...identities.values()];
    });

  const recoverOverflow = (input: RuntimeIngressInput): Effect.Effect<void> =>
    Effect.gen(function* () {
      const identities = yield* overflowIdentities(input);
      const affectedReceivers = new Map<string, RuntimeReceiver>();
      for (const identity of identities) {
        yield* markRecovering(identity, "overflow");
        const runtimeInterest = interests.get(identity.key);
        if (runtimeInterest === undefined) continue;
        const organization = organizationOfInterest(runtimeInterest.descriptor);
        const key = organizationKeyOf(organization);
        const receiver = receivers.get(key);
        if (receiver !== undefined) affectedReceivers.set(key, receiver);
      }
      yield* Effect.forEach(
        affectedReceivers.values(),
        (receiver) => scheduleRecovery(receiver, "ingress overflow"),
        { discard: true },
      );
    });

  const ingress = yield* makeZeropsBoundedIngress<RuntimeIngressInput>({
    maxEvents: policy.ingressMaxEventsPerAccount,
    maxBytes: policy.ingressMaxBytesPerAccount,
    maxFrameBytes: policy.ingressMaxFrameBytes,
    onOverflow: recoverOverflow,
  });

  // Every read, write and event of the account completes through this one loop, so it outlives a
  // defect in any one input: the input is logged and the loop goes on.
  yield* Effect.forever(
    Effect.gen(function* () {
      yield* applyIngress(yield* ingress.take).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) => Effect.logError("Zerops data: an input could not be applied", cause),
        ),
      );
      if (
        pendingPublication !== null &&
        (publicationEvents >= policy.ingressPublicationBatchEvents ||
          (yield* ingress.snapshot).events === 0)
      ) {
        yield* flushPublication;
      }
    }),
  ).pipe(forkOwned);

  // Access/command control inputs are never data-observation volume; they must never be
  // discarded by the ingress data budget, so they bypass admission via offerUncounted.
  const bypassesIngressBudget = (
    kind: RuntimeIngressInput["kind"],
  ): kind is "access-observation" | "command-completion" | "command-execution-requested" =>
    kind === "access-observation" ||
    kind === "command-completion" ||
    kind === "command-execution-requested";

  const enqueue = (input: RuntimeIngressInput, bytes = 0): Effect.Effect<void> =>
    bypassesIngressBudget(input.kind)
      ? ingress.offerUncounted(input).pipe(Effect.asVoid)
      : ingress.offer(input, bytes).pipe(Effect.asVoid);

  /** Barriers queued and not yet reached: a shutdown that drops them settles them. */
  const barriers = new Set<Deferred.Deferred<void>>();
  const awaitIngress = Effect.gen(function* () {
    const deferred = yield* Deferred.make<void>();
    barriers.add(deferred);
    const enqueued = yield* ingress.offerUncounted({ kind: "barrier", deferred, interest: null });
    if (enqueued) yield* Deferred.await(deferred);
    barriers.delete(deferred);
  });

  const context = <Value, Error>(
    deadlineMs: number,
    use: (context: {
      readonly abortSignal: AbortSignal;
      readonly deadlineMs: number;
    }) => Effect.Effect<Value, Error>,
    parentSignal?: AbortSignal,
  ): Effect.Effect<Value, Error> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (parentSignal?.aborted) abort();
        else parentSignal?.addEventListener("abort", abort, { once: true });
        return { controller, abort };
      }),
      ({ controller }) =>
        controller.signal.aborted
          ? Effect.interrupt
          : Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) =>
                use({ abortSignal: controller.signal, deadlineMs: now + deadlineMs }),
              ),
            ),
      ({ controller, abort }) =>
        Effect.sync(() => {
          parentSignal?.removeEventListener("abort", abort);
          controller.abort();
        }),
    );

  const makeReceiver = (organization: OrganizationRef): RuntimeReceiver => {
    receiverEpoch += 1;
    return {
      organization,
      identity: {
        accountEpoch: options.scope.epoch,
        receiverEpoch: ReceiverEpoch.make(receiverEpoch),
        receiverId: ZeropsReceiverId.make(options.makeOpaqueId()),
      },
      handle: null,
      openFailure: null,
      registrations: new Map(),
      registrationOwners: new Map(),
      registrationAttempts: 0,
    };
  };

  const receiverFor = (organization: OrganizationRef): RuntimeReceiver => {
    const key = organizationKeyOf(organization);
    const existing = receivers.get(key);
    if (existing !== undefined) return existing;
    const created = makeReceiver(organization);
    receivers.set(key, created);
    return created;
  };

  const updateInterestIdentity = (
    runtimeInterest: RuntimeInterest,
    receiver: RuntimeReceiver,
  ): Effect.Effect<DesiredInterestState> =>
    Effect.gen(function* () {
      runtimeInterest.readController.abort();
      runtimeInterest.readController = new AbortController();
      interestEpoch += 1;
      const identity: InterestIdentity = {
        receiver: receiver.identity,
        interestEpoch: InterestEpoch.make(interestEpoch),
        key: runtimeInterest.key,
      };
      runtimeInterest.identity = identity;
      const plan = planZeropsInterest(runtimeInterest.descriptor);
      const now = yield* Clock.currentTimeMillis;
      return {
        descriptor: runtimeInterest.descriptor,
        key: runtimeInterest.key,
        leases: runtimeInterest.leases.size,
        required: runtimeInterest.required,
        registrationAttemptsOnReceiver: 0,
        interest: {
          status: "establishing",
          identity,
          startedAtMs: now,
          deadlineMs: now + policy.establishmentDeadlineMs,
          progress: {
            requiredRegistrations: plan.registrations.length,
            completedRegistrations: 0,
            requiredReads:
              plan.directReads.length +
              plan.registrations.filter((registration) => registration.baseline !== null).length,
            completedReads: 0,
            crossedReceiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
          },
        },
        wire: { status: "absent" },
      };
    });

  const requestTicket = (
    identity: InterestIdentity,
    kind: ReadTicket["kind"],
    target: ReadTarget,
  ): Effect.Effect<ReadTicket> =>
    Effect.gen(function* () {
      readStartOrdinal += 1;
      dispatchOrdinal += 1;
      const now = yield* Clock.currentTimeMillis;
      const base = {
        requestId: ZeropsRequestId.make(options.makeOpaqueId()),
        owner: { kind: "interest" as const, identity },
        receiptOrdinalAtStart: ReceiptOrdinal.make(receiptOrdinal),
        readStartOrdinal: ReadStartOrdinal.make(readStartOrdinal),
        dispatchOrdinal: DispatchOrdinal.make(dispatchOrdinal),
        startedAtMs: now,
      };
      return (
        target.kind === "query" &&
        (target.descriptor.kind === "projects-of-organization" ||
          target.descriptor.kind === "services-of-organization" ||
          target.descriptor.kind === "services-of-project" ||
          target.descriptor.kind === "running-processes-of-organization" ||
          target.descriptor.kind === "process-history-window" ||
          target.descriptor.kind === "active-versions-of-organization" ||
          target.descriptor.kind === "service-variables-of-organization")
          ? {
              ...base,
              kind: kind as "baseline" | "history",
              target,
              membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(receiptOrdinal),
            }
          : { ...base, kind, target }
      ) as ReadTicket;
    });

  const encodeSize = (value: unknown): number => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return 0;
    }
  };

  const enqueueObservations = (
    observations: ReadonlyArray<PlatformObservation>,
    fallbackInterest: InterestIdentity | null,
  ): Effect.Effect<void> =>
    Effect.forEach(
      observations,
      (observation) =>
        enqueue(
          {
            kind: "observation",
            input: observation,
            interest: registrationInterest(observation) ?? fallbackInterest,
          },
          encodeSize(observation),
        ),
      { discard: true },
    );

  const runRead = (ticket: ReadTicket, identity: InterestIdentity | null): Effect.Effect<boolean> =>
    runReadOutcome(ticket, identity).pipe(Effect.map((outcome) => outcome.succeeded));

  /** A read, and the adapter's error when it failed: a hydration's retry depends on its kind. */
  const runReadOutcome = (
    ticket: ReadTicket,
    identity: InterestIdentity | null,
  ): Effect.Effect<{ readonly succeeded: boolean; readonly error: AdapterError | null }> =>
    Effect.suspend(() => {
      const owner = identity === null ? null : interests.get(identity.key);
      if (identity !== null && (owner?.identity !== identity || owner.leases.size === 0))
        return Effect.interrupt;
      const parentSignal = owner?.readController.signal;
      const read = readSemaphore.withPermit(
        context(
          policy.httpDeadlineMs,
          (requestContext) => options.adapter.read(ticket, requestContext),
          parentSignal,
        ).pipe(
          Effect.flatMap((result) =>
            enqueueObservations(result.observations, identity).pipe(
              Effect.andThen(
                enqueue({
                  kind: "read-completion",
                  completion: { kind: "read-succeeded", ticket },
                  interest: identity,
                }),
              ),
              Effect.as({ succeeded: true, error: null }),
            ),
          ),
          Effect.catch((error) =>
            enqueue({
              kind: "read-completion",
              completion: { kind: "read-failed", ticket, failure: failureKind(error) },
              interest: identity,
            }).pipe(Effect.as({ succeeded: false, error })),
          ),
        ),
      );
      if (parentSignal === undefined) return read;
      // Cancellation also removes work waiting for a read-concurrency slot.
      return Effect.raceFirst(
        read,
        Effect.callback<{ readonly succeeded: boolean; readonly error: AdapterError | null }>(
          (resume) => {
            const abort = () => resume(Effect.succeed({ succeeded: false, error: null }));
            if (parentSignal.aborted) abort();
            else parentSignal.addEventListener("abort", abort, { once: true });
            return Effect.sync(() => parentSignal.removeEventListener("abort", abort));
          },
        ),
      );
    });

  const queryDependents = (query: QueryKey): ReadonlyMap<InterestKey, InterestIdentity> => {
    const dependents = new Map<InterestKey, InterestIdentity>();
    for (const interest of interests.values()) {
      if (interest.leases.size === 0) continue;
      const ownsQuery = planZeropsInterest(interest.descriptor).registrations.some(
        (registration) =>
          registration.baseline?.kind === "query" &&
          queryKeyOf(registration.baseline.descriptor) === query,
      );
      if (ownsQuery) dependents.set(interest.key, interest.identity);
    }
    return dependents;
  };

  const unresolvedRefs = (state: ZeropsDataState, query: QueryKey): ReadonlyArray<EntityRef> => {
    const inventoryQuery = state.inventory.queries.get(query);
    if (inventoryQuery !== undefined) {
      return inventoryQuery.unresolvedMemberKeys.flatMap((key) => {
        const ref = state.inventory.memberRefs.get(key);
        return ref === undefined ? [] : [ref];
      });
    }
    const activityQuery = state.activity.queries.get(query);
    if (activityQuery === undefined) return [];
    return activityQuery.unresolvedMemberKeys.flatMap((key) => {
      const ref = state.activity.memberRefs.get(key);
      return ref === undefined ? [] : [ref];
    });
  };

  const sharedReadTicket = (
    target: ReadTarget,
    owner: Extract<ReadTicket["owner"], { readonly kind: "shared" }>,
    kind: ReadTicket["kind"],
  ): Effect.Effect<ReadTicket> =>
    Effect.gen(function* () {
      readStartOrdinal += 1;
      dispatchOrdinal += 1;
      const now = yield* Clock.currentTimeMillis;
      return {
        requestId: ZeropsRequestId.make(options.makeOpaqueId()),
        owner,
        receiptOrdinalAtStart: ReceiptOrdinal.make(receiptOrdinal),
        readStartOrdinal: ReadStartOrdinal.make(readStartOrdinal),
        dispatchOrdinal: DispatchOrdinal.make(dispatchOrdinal),
        startedAtMs: now,
        kind,
        target,
      } as ReadTicket;
    });

  /**
   * The table reads waiting or in flight, by kind and organization: one loop each, and what
   * wakes it when an id comes due sooner than it sleeps.
   */
  const tableReads = new Map<string, { wake: Deferred.Deferred<void> }>();
  /** When a kind's failed batch may be read again, by kind and organization. */
  const tableReadRetryAt = new Map<string, number>();
  scheduleTableRead = (followUp) =>
    Effect.gen(function* () {
      const organizationKey = organizationKeyOf(followUp.organization);
      const key = `${followUp.entity}:${organizationKey}`;
      const running = tableReads.get(key);
      if (running !== undefined) {
        yield* Deferred.succeed(running.wake, undefined);
        return;
      }
      if (yield* Ref.get(closed)) return;
      const loop = { wake: yield* Deferred.make<void>() };
      tableReads.set(key, loop);
      // One loop per kind and organization: it reads what is due, batched, at most once a
      // grace, and ends when nothing is owed. Ids that arrive while a batch reads, or past its
      // cap, are read by the next round; one that arrives while the loop sleeps wakes it.
      const read = Effect.gen(function* () {
        let lastReadAt = yield* Clock.currentTimeMillis;
        while (true) {
          const before = yield* Clock.currentTimeMillis;
          const batch = tableRowsWanted((yield* Ref.get(model)).table).find(
            (wanted) =>
              wanted.entity === followUp.entity &&
              organizationKeyOf(wanted.organization) === organizationKey,
          );
          if (batch === undefined) return;
          // A grace after the last read and after the first id came due, so ids that arrive
          // together are read together; every bound is absolute, so a wake never postpones it.
          const readAt = Math.max(
            lastReadAt + TABLE_READ_GRACE_MS,
            batch.dueAtMs + TABLE_READ_GRACE_MS,
            tableReadRetryAt.get(key) ?? 0,
          );
          if (readAt > before) {
            const woken = yield* Effect.raceFirst(
              Effect.sleep(Duration.millis(readAt - before)).pipe(Effect.as(false)),
              Deferred.await(loop.wake).pipe(Effect.as(true)),
            );
            if (woken) {
              loop.wake = yield* Deferred.make<void>();
              continue;
            }
          }
          if (yield* Ref.get(closed)) return;
          const now = yield* Clock.currentTimeMillis;
          const ids = tableRowsDue(
            (yield* Ref.get(model)).table,
            followUp.entity,
            followUp.organization,
            now,
          ).slice(0, TABLE_READ_BATCH);
          if (ids.length === 0) continue;
          const streamKind =
            followUp.entity === "app-version" ? "organization-versions" : "organization-variables";
          const dependents = new Map<InterestKey, InterestIdentity>();
          for (const interest of interests.values()) {
            if (
              interest.leases.size > 0 &&
              interest.descriptor.kind === streamKind &&
              organizationKeyOf(interest.descriptor.organization) === organizationKey
            )
              dependents.set(interest.key, interest.identity);
          }
          if (dependents.size === 0) return;
          const list =
            followUp.entity === "app-version"
              ? activeVersionsDescriptor(followUp.organization)
              : serviceVariablesDescriptor(followUp.organization);
          const owner = {
            kind: "shared" as const,
            account: options.scope,
            sharedReadId: ZeropsSharedReadId.make(options.makeOpaqueId()),
          };
          const ticket = yield* sharedReadTicket(
            { kind: "query", descriptor: { ...list, ids } },
            owner,
            "baseline",
          );
          yield* applyControl({
            kind: "shared-read-upserted",
            requestId: ticket.requestId,
            ownership: { owner, target: ticket.target, dependents, status: "active" },
          });
          const admitted = yield* admitRead(ticket);
          const succeeded = admitted ? (yield* runReadOutcome(ticket, null)).succeeded : false;
          if (admitted) yield* awaitIngress;
          yield* applyControl({ kind: "shared-read-released", requestId: ticket.requestId });
          lastReadAt = yield* Clock.currentTimeMillis;
          if (succeeded) tableReadRetryAt.delete(key);
          else tableReadRetryAt.set(key, lastReadAt + TABLE_READ_RETRY_MS);
        }
      });
      yield* read.pipe(Effect.ensuring(Effect.sync(() => tableReads.delete(key))), forkOwned);
    });

  scheduleHydration = (query) =>
    Effect.gen(function* () {
      if (yield* Ref.get(closed)) return;
      const state = yield* Ref.get(model);
      const dependents = queryDependents(query);
      if (dependents.size === 0) return;
      for (const target of unresolvedRefs(state, query)) {
        const key = entityKeyOf(target);
        const existing = hydrations.get(key);
        if (existing !== undefined) {
          const merged = new Map(existing.ownership.dependents);
          let changed = false;
          for (const [interestKey, identity] of dependents) {
            const previous = merged.get(interestKey);
            if (previous === undefined || !interestIdentitiesEqual(previous, identity)) {
              merged.set(interestKey, identity);
              changed = true;
            }
          }
          if (changed) {
            existing.ownership = { ...existing.ownership, dependents: merged };
            yield* applyControl({
              kind: "shared-read-upserted",
              requestId: existing.requestId,
              ownership: existing.ownership,
            });
          }
          continue;
        }
        const failed = hydrationFailures.get(key);
        if (
          hydrations.size >= policy.activeSharedReadsPerAccount ||
          (failed !== undefined &&
            (failed.count >= policy.hydrationRetryLimit ||
              (yield* Clock.currentTimeMillis) < failed.retryAtMs))
        )
          continue;
        const owner = {
          kind: "shared" as const,
          account: options.scope,
          sharedReadId: ZeropsSharedReadId.make(options.makeOpaqueId()),
        };
        const ticket = yield* sharedReadTicket(
          { kind: target.kind, ref: target } as ReadTarget,
          owner,
          "hydration",
        );
        const ownership: SharedReadOwnership = {
          owner,
          target: ticket.target,
          dependents,
          status: "active",
        };
        const hydration: RuntimeHydration = {
          target,
          requestId: ticket.requestId,
          ownership,
          fiber: null,
        };
        hydrations.set(key, hydration);
        // Shared ownership must exist before read-started admission examines the ticket.
        yield* applyControl({
          kind: "shared-read-upserted",
          requestId: ticket.requestId,
          ownership,
        });
        if (!(yield* admitRead(ticket))) {
          yield* applyControl({ kind: "shared-read-released", requestId: ticket.requestId });
          hydrations.delete(key);
          const affectedReceivers = new Map<string, RuntimeReceiver>();
          for (const identity of dependents.values()) {
            yield* markRecovering(identity, "overflow");
            const interest = interests.get(identity.key);
            if (interest === undefined) continue;
            const organization = organizationOfInterest(interest.descriptor);
            const receiver = receivers.get(organizationKeyOf(organization));
            if (receiver !== undefined)
              affectedReceivers.set(organizationKeyOf(organization), receiver);
          }
          yield* Effect.forEach(
            affectedReceivers.values(),
            (receiver) => scheduleRecovery(receiver, "read queue capacity"),
            { discard: true },
          );
          continue;
        }
        const work = hydrationSemaphore.withPermit(runReadOutcome(ticket, null)).pipe(
          Effect.flatMap(({ succeeded, error }) =>
            awaitIngress.pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (succeeded) hydrationFailures.delete(key);
                  else
                    hydrationFailures.set(key, {
                      organizationKey: organizationKeyOf(organizationOfEntityRef(target)),
                      query,
                      count: (hydrationFailures.get(key)?.count ?? 0) + 1,
                      retryAtMs: Number.POSITIVE_INFINITY,
                      refusal: hydrationRefusal(error),
                    });
                }),
              ),
              Effect.andThen(
                applyControl({ kind: "shared-read-released", requestId: ticket.requestId }),
              ),
              Effect.as(succeeded),
            ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (hydrations.get(key) === hydration) hydrations.delete(key);
            }),
          ),
        );
        const fiber = yield* work.pipe(
          Effect.flatMap((succeeded) => (succeeded ? Effect.void : retryHydration(key, query))),
          forkOwned,
        );
        hydration.fiber = fiber;
      }
    });

  /**
   * A failed hydration is read again on the recovery backoff, not at once: a refusal that lasts
   * a moment (a service the platform lists before it serves it) would spend the budget in a few
   * milliseconds. A spent budget waits out the backoff's cap and starts over, so an entity is
   * never left unresolved for good while an interest holds it — its listing would stay partial.
   */
  const retryHydration = (key: string, query: QueryKey): Effect.Effect<void> =>
    Effect.gen(function* () {
      const failed = hydrationFailures.get(key);
      if (failed === undefined) return yield* scheduleHydration(query);
      // The platform said the entity is not there for this account: reading it again changes
      // nothing until a recovery or a grant change drops the record (`observeAccess`).
      if (failed.refusal.kind === "gone") return;
      const spent = failed.count >= policy.hydrationRetryLimit;
      const backoffMs = spent
        ? policy.recoveryBackoffMaxMs
        : Math.min(
            policy.recoveryBackoffStartMs * 2 ** Math.max(0, failed.count - 1),
            policy.recoveryBackoffMaxMs,
          );
      // A 429 waits at least as long as the platform asked.
      const delayMs =
        failed.refusal.kind === "throttled"
          ? Math.max(backoffMs, failed.refusal.retryAfterMs ?? 0)
          : backoffMs;
      // Until then no other trigger starts it: a reset (a recovery, a return to the foreground)
      // drops the record, and with it the wait.
      failed.retryAtMs = (yield* Clock.currentTimeMillis) + delayMs;
      yield* Effect.sleep(Duration.millis(delayMs));
      // A reset, or an attempt it let start, owns the entity's next read now.
      if (hydrationFailures.get(key) !== failed) return;
      if (spent) hydrationFailures.delete(key);
      yield* scheduleHydration(query);
    });

  // Cancels one in-flight hydration outright (not a partial dependent removal, unlike
  // releaseLease's cleanup): used when the receiver serving it is being replaced or paused,
  // so its shared read releases and scheduleHydration starts it fresh after establishment.
  const cancelHydration = (key: string, hydration: RuntimeHydration): Effect.Effect<void> =>
    Effect.gen(function* () {
      hydration.ownership = { ...hydration.ownership, status: "cancelled" };
      yield* applyControl({
        kind: "shared-read-upserted",
        requestId: hydration.requestId,
        ownership: hydration.ownership,
      });
      if (hydration.fiber !== null) yield* Fiber.interrupt(hydration.fiber);
      yield* applyControl({ kind: "shared-read-released", requestId: hydration.requestId });
      hydrations.delete(key);
    });

  const consumeReceiver = (receiver: RuntimeReceiver): Effect.Effect<void> => {
    const handle = receiver.handle;
    if (handle === null) return Effect.void;
    return Stream.runForEach(handle.events, (event: ReceiverEvent) => {
      if (event.kind === "pong") return Effect.void;
      if (event.kind === "observation") {
        const request = observationRegistration(event.input);
        if (request === null)
          return enqueue({ kind: "observation", input: event.input, interest: null }, event.bytes);
        const registration = receiver.registrationOwners.get(request.subscriptionName);
        if (registration === undefined) return Effect.void;
        return enqueue(
          {
            kind: "observation",
            input: event.input,
            interest: null,
            sharedRegistration: { receiver, registration },
          },
          event.bytes,
        );
      }
      if (event.kind === "malformed") {
        const registration =
          event.subscriptionName === undefined
            ? undefined
            : receiver.registrationOwners.get(event.subscriptionName);
        return registration === undefined
          ? scheduleRecovery(receiver, "malformed receiver frame")
          : recoverSubscription(receiver, registration);
      }
      return scheduleRecovery(receiver, event.reason);
    }).pipe(Effect.catch((error) => scheduleRecovery(receiver, error.message)));
  };

  const ensureReceiver = (receiver: RuntimeReceiver): Effect.Effect<ReceiverHandle, AdapterError> =>
    receiverLock.withPermit(
      Effect.gen(function* () {
        if (receiver.handle !== null) return receiver.handle;
        // A failed login, or one abandoned before it answered, is the attempt of every
        // establishment that reaches the receiver until its recovery cycle retries on its
        // backoff: one login per rung, never a burst.
        if (receiver.openFailure !== null) return yield* Effect.fail(receiver.openFailure);
        const handle = yield* context(policy.establishmentDeadlineMs, (requestContext) =>
          options.adapter
            .openReceiver(options.scope, receiver.organization, receiver.identity, requestContext)
            .pipe(Scope.provide(runtimeScope)),
        ).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              receiver.openFailure = error;
            }),
          ),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              receiver.openFailure = {
                _tag: "ZeropsDataAdapterError",
                kind: "timeout",
                message: "The socket login was abandoned before it answered.",
                retryable: true,
                accountRevocationEvidence: false,
              };
            }),
          ),
        );
        // A recovery/pause race may have replaced this receiver while the open call was
        // in flight. Nobody else can close a socket that never landed in `receivers`.
        if (receivers.get(organizationKeyOf(receiver.organization)) !== receiver) {
          yield* options.adapter.closeReceiver(handle);
          return yield* Effect.interrupt;
        }
        receiver.handle = handle;
        // Install the one hot-stream consumer before any registration call is allowed to start.
        yield* consumeReceiver(receiver).pipe(forkOwned);
        yield* Effect.yieldNow;
        return handle;
      }),
    );

  const acquireRegistration = (
    receiver: RuntimeReceiver,
    identity: InterestIdentity,
    planned: PlannedRegistration,
  ): Effect.Effect<
    { readonly registration: RuntimeRegistration; readonly created: boolean },
    AdapterError
  > =>
    registrationLock.withPermit(
      Effect.gen(function* () {
        const key = registrationKeyOf(planned.descriptor);
        const existing = receiver.registrations.get(key);
        if (existing !== undefined && existing.status !== "failed") {
          existing.dependents.set(identity.key, identity);
          if (existing.status === "registering" && existing.ticket?.owner.kind === "shared") {
            yield* applyControl({
              kind: "shared-read-upserted",
              requestId: existing.ticket.requestId,
              ownership: {
                owner: existing.ticket.owner,
                target: existing.ticket.target,
                dependents: new Map(existing.dependents),
                status: "active",
              },
            });
          }
          return { registration: existing, created: false };
        }
        if (receiver.registrationAttempts >= policy.registrationAttemptsPerReceiver) {
          return yield* Effect.fail({
            _tag: "ZeropsDataAdapterError",
            kind: "registration",
            message: "Registration churn budget reached.",
            retryable: true,
            accountRevocationEvidence: false,
          } satisfies AdapterError);
        }
        const owner = {
          kind: "shared" as const,
          account: options.scope,
          sharedReadId: ZeropsSharedReadId.make(options.makeOpaqueId()),
        };
        const ticket =
          planned.baseline === null
            ? null
            : yield* sharedReadTicket(
                planned.baseline,
                owner,
                planned.descriptor.kind === "metric-history" ? "history" : "baseline",
              );
        const base = {
          identity,
          subscriptionName: ZeropsWireSubscriptionName.make(options.makeOpaqueId()),
        };
        const request: RegistrationRequest =
          planned.descriptor.kind === "entity-updates" ||
          planned.descriptor.kind === "table-updates"
            ? ({
                ...base,
                descriptor: planned.descriptor,
                baselineTicket: null,
              } as RegistrationRequest)
            : ({
                ...base,
                descriptor: planned.descriptor,
                baselineTicket: ticket,
              } as RegistrationRequest);
        const registration: RuntimeRegistration = {
          key,
          planned,
          request,
          ticket,
          outcome: yield* Deferred.make<PhysicalRegistrationOutcome>(),
          dependents: new Map([[identity.key, identity]]),
          status: "registering",
        };
        receiver.registrationAttempts += 1;
        receiver.registrations.set(key, registration);
        receiver.registrationOwners.set(request.subscriptionName, registration);
        if (ticket !== null && ticket.owner.kind === "shared") {
          yield* applyControl({
            kind: "shared-read-upserted",
            requestId: ticket.requestId,
            ownership: {
              owner: ticket.owner,
              target: ticket.target,
              dependents: new Map(registration.dependents),
              status: "active",
            },
          });
          if (!(yield* admitRead(ticket))) {
            yield* applyControl({ kind: "shared-read-released", requestId: ticket.requestId });
            receiver.registrations.delete(key);
            receiver.registrationOwners.delete(request.subscriptionName);
            registration.status = "failed";
            return yield* Effect.fail(readCapacityError());
          }
        }
        return { registration, created: true };
      }),
    );

  const enqueueRegistrationObservations = (
    receiver: RuntimeReceiver,
    registration: RuntimeRegistration,
    observations: ReadonlyArray<PlatformObservation>,
  ): Effect.Effect<void> =>
    Effect.suspend(() =>
      receiver.registrations.get(registration.key) !== registration
        ? Effect.void
        : Effect.forEach(
            observations,
            (observation) => {
              if (observationRegistration(observation) === null)
                return enqueue(
                  { kind: "observation", input: observation, interest: null },
                  encodeSize(observation),
                );
              return enqueue(
                {
                  kind: "observation",
                  input: observation,
                  interest: null,
                  sharedRegistration: { receiver, registration },
                },
                encodeSize(observation),
              );
            },
            { discard: true },
          ),
    );

  /**
   * Offline, an establishment waits for the network before it starts, so its deadline starts once
   * the network is back (§4.0, §6.4). One whose interest was paused, given a new identity or
   * released meanwhile is left to whatever did that.
   */
  const establishInterest = (
    runtimeInterest: RuntimeInterest,
  ): Effect.Effect<EstablishmentOutcome> =>
    Effect.suspend(() => {
      const waitedAs = runtimeInterest.identity;
      return network.await.pipe(
        Effect.andThen(Ref.get(model)),
        Effect.flatMap((state) =>
          runtimeInterest.identity === waitedAs &&
          runtimeInterest.leases.size > 0 &&
          state.interests.get(runtimeInterest.key)?.interest.status !== "paused"
            ? establish(runtimeInterest)
            : Effect.succeed(establishmentDone),
        ),
      );
    });

  const establish = (runtimeInterest: RuntimeInterest): Effect.Effect<EstablishmentOutcome> =>
    Effect.gen(function* () {
      if (yield* Ref.get(closed)) return establishmentDone;
      const organization = organizationOfInterest(runtimeInterest.descriptor);
      const receiver = receiverFor(organization);
      if (runtimeInterest.identity.receiver !== receiver.identity) {
        yield* updateInterestIdentity(runtimeInterest, receiver).pipe(
          Effect.flatMap((interest) => applyControl({ kind: "interest-upserted", interest })),
        );
      }
      const identity = runtimeInterest.identity;
      const handle = yield* ensureReceiver(receiver);
      const plan = planZeropsInterest(runtimeInterest.descriptor);
      for (const planned of plan.registrations) {
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0)
          return establishmentDone;
        const logicalTicket =
          planned.baseline === null
            ? null
            : yield* requestTicket(
                identity,
                planned.descriptor.kind === "metric-history" ? "history" : "baseline",
                planned.baseline,
              );
        if (logicalTicket !== null && !(yield* admitRead(logicalTicket))) {
          return yield* Effect.fail(readCapacityError());
        }
        const acquired = yield* acquireRegistration(receiver, identity, planned).pipe(
          Effect.result,
        );
        if (Result.isFailure(acquired)) {
          if (logicalTicket !== null) {
            yield* enqueue({
              kind: "read-completion",
              completion: {
                kind: "read-failed",
                ticket: logicalTicket,
                failure: failureKind(acquired.failure),
              },
              interest: identity,
            });
          }
          return yield* Effect.fail(acquired.failure);
        }
        const { registration, created } = acquired.success;
        const logicalRequest = {
          ...registration.request,
          identity,
          baselineTicket: logicalTicket,
        } as RegistrationRequest;
        const current = yield* Ref.get(model);
        const desired = current.interests.get(identity.key);
        if (desired !== undefined) {
          yield* applyControl({
            kind: "interest-upserted",
            interest: {
              ...desired,
              registrationAttemptsOnReceiver: receiver.registrationAttempts,
              wire: {
                status: "registering",
                receiver: receiver.identity,
                subscriptionName: registration.request.subscriptionName,
              },
            },
          });
        }
        if (created) {
          // Interruption between `registrations.set` (in acquireRegistration) and the
          // `Deferred.succeed` below — a timeoutOrElse racing the network round trip —
          // must not strand the entry in `status: "registering"` forever: anyone sharing
          // this registration key would then block until their own establishment
          // deadline, only to force a spurious extra recovery cycle once that stale
          // timeout finally fires. Delete the entry and fail the deferred.
          yield* Effect.gen(function* () {
            // A bounded number of registrations are in flight across the account, the
            // organization inventory's admitted first. The deadline starts once it is sent.
            const result = yield* registrationPermits
              .withPermit(registrationPriority(receiver.organization, registration.key))(
                context(policy.registrationDeadlineMs, (requestContext) =>
                  options.adapter.register(handle, registration.request, requestContext),
                ),
              )
              .pipe(Effect.result);
            const outcome: PhysicalRegistrationOutcome = Result.isFailure(result)
              ? { kind: "failed", error: result.failure }
              : { kind: "succeeded", receipt: result.success };
            if (outcome.kind === "failed") {
              registration.status = "failed";
              receiver.registrations.delete(registration.key);
              receiver.registrationOwners.delete(registration.request.subscriptionName);
            } else {
              yield* enqueueRegistrationObservations(
                receiver,
                registration,
                outcome.receipt.responseObservations,
              );
              registration.status = "registered";
            }
            if (registration.ticket !== null) {
              yield* enqueue({
                kind: "read-completion",
                completion:
                  outcome.kind === "failed"
                    ? {
                        kind: "read-failed",
                        ticket: registration.ticket,
                        failure: failureKind(outcome.error),
                      }
                    : { kind: "read-succeeded", ticket: registration.ticket },
                interest: null,
              });
              yield* awaitIngress;
              yield* applyControl({
                kind: "shared-read-released",
                requestId: registration.ticket.requestId,
              });
            }
            yield* Deferred.succeed(registration.outcome, outcome);
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                if (receiver.registrations.get(registration.key) === registration) {
                  receiver.registrations.delete(registration.key);
                }
                if (
                  receiver.registrationOwners.get(registration.request.subscriptionName) ===
                  registration
                ) {
                  receiver.registrationOwners.delete(registration.request.subscriptionName);
                }
              }).pipe(
                // Its siblings waiting on it hear it was abandoned, and retry alone as it does.
                Effect.andThen(
                  Deferred.succeed(registration.outcome, {
                    kind: "failed",
                    error: REGISTRATION_ABANDONED,
                  }),
                ),
                Effect.asVoid,
              ),
            ),
          );
        }
        const outcome = yield* Deferred.await(registration.outcome);
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0)
          return establishmentDone;
        if (outcome.kind === "failed") {
          if (logicalTicket !== null)
            yield* enqueue({
              kind: "read-completion",
              completion: {
                kind: "read-failed",
                ticket: logicalTicket,
                failure: failureKind(outcome.error),
              },
              interest: identity,
            });
          yield* enqueue({
            kind: "registration-completion",
            completion: {
              kind: "registration-failed",
              request: logicalRequest,
              reason: outcome.error.message,
            },
            interest: identity,
          });
          if (!runtimeInterest.required) {
            yield* awaitIngress;
            const failedState = yield* Ref.get(model);
            const failed = failedState.interests.get(identity.key);
            if (failed !== undefined && runtimeInterest.identity === identity) {
              runtimeInterest.recoveryAttempts += 1;
              const retryAtMs =
                (yield* Clock.currentTimeMillis) +
                Math.min(
                  policy.recoveryBackoffStartMs *
                    2 ** Math.max(0, runtimeInterest.recoveryAttempts - 1),
                  policy.recoveryBackoffMaxMs,
                );
              yield* applyControl({
                kind: "interest-upserted",
                interest: {
                  ...failed,
                  interest: {
                    status: "failed",
                    identity,
                    reason: outcome.error.message,
                    retryable: true,
                    attempts: runtimeInterest.recoveryAttempts,
                    retryAtMs,
                  },
                },
              });
              yield* scheduleFailedRetry(runtimeInterest, identity, retryAtMs);
            }
            return interestFailed;
          }
          // A refusal left nothing registered: this interest registers again, alone, on the
          // receiver its siblings keep observing on. Without an answer the receiver may hold a
          // subscription nobody owns, whose frames would name no registration: it is replaced.
          // A shared registration whose sender gave up on it (its own deadline) says nothing
          // against an open socket: this interest retries alone too, and sends it afresh.
          if (
            outcome.error === REGISTRATION_ABANDONED &&
            receiver.handle !== null &&
            identity.receiver.receiverId === receiver.identity.receiverId
          ) {
            yield* recoverInterest(receiver, identity, "disconnect", outcome.error.message);
            return interestFailed;
          }
          if (registrationRefused(outcome.error)) {
            yield* recoverInterest(receiver, identity, "registration", outcome.error.message);
            return interestFailed;
          }
          yield* scheduleRecovery(receiver, outcome.error.message);
          return receiverFailed(outcome.error.message);
        }
        if (logicalTicket !== null) {
          yield* enqueue({
            kind: "read-completion",
            completion: { kind: "read-succeeded", ticket: logicalTicket },
            interest: identity,
          });
        }
        yield* enqueue({
          kind: "registration-completion",
          completion: { kind: "registration-succeeded", request: logicalRequest },
          interest: identity,
        });
      }
      for (const target of plan.directReads) {
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0)
          return establishmentDone;
        const ticket = yield* requestTicket(
          identity,
          target.kind === "query" ? "baseline" : "direct",
          target,
        );
        if (!(yield* admitRead(ticket))) return yield* Effect.fail(readCapacityError());
        const succeeded = yield* runRead(ticket, identity);
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0)
          return establishmentDone;
        // A read registers nothing on the receiver: it fails its own interest alone.
        if (!succeeded) {
          yield* recoverInterest(receiver, identity, "disconnect", "required direct read failed");
          return interestFailed;
        }
      }
      return establishmentDone;
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(policy.establishmentDeadlineMs),
        orElse: () => Effect.fail(ESTABLISHMENT_DEADLINE),
      }),
      Effect.catch((error: AdapterError) => {
        const receiver = receiverFor(organizationOfInterest(runtimeInterest.descriptor));
        // One subscription outliving its deadline on a socket that is open says nothing against
        // the socket: it retries alone on its own backoff, and its siblings keep observing. A
        // socket that is dead says so itself (its close, a missed pong) and is replaced then.
        if (
          error === ESTABLISHMENT_DEADLINE &&
          receiver.handle !== null &&
          runtimeInterest.identity.receiver.receiverId === receiver.identity.receiverId
        ) {
          return recoverInterest(
            receiver,
            runtimeInterest.identity,
            "disconnect",
            error.message,
          ).pipe(Effect.as(interestFailed));
        }
        return markRecovering(runtimeInterest.identity, "disconnect").pipe(
          Effect.andThen(scheduleRecovery(receiver, error.message)),
          Effect.as(receiverFailed(error.message)),
        );
      }),
    );

  // A failure took this interest's registrations: it gets a fresh identity on `receiver` and
  // a scheduled exit. While the tab is hidden that exit is the foreground resume; past the
  // attempt limit it is `failed` with its own retry time; otherwise it is `recovering` until
  // its own backoff elapses.
  const reestablishLater = (
    runtimeInterest: RuntimeInterest,
    receiver: RuntimeReceiver,
    failure: {
      readonly hidden: boolean;
      readonly now: number;
      readonly reason: RecoveryReason;
      readonly message: string;
    },
  ): Effect.Effect<{
    readonly failedRetryAtMs: number | null;
    readonly recoveringRetryAtMs: number | null;
  }> =>
    Effect.gen(function* () {
      runtimeInterest.recoveryAttempts += 1;
      const desired = yield* updateInterestIdentity(runtimeInterest, receiver);
      const identity = runtimeInterest.identity;
      const retryAtMs =
        failure.now +
        Math.min(
          policy.recoveryBackoffStartMs * 2 ** Math.max(0, runtimeInterest.recoveryAttempts - 1),
          policy.recoveryBackoffMaxMs,
        );
      if (failure.hidden) {
        yield* applyControl({
          kind: "interest-upserted",
          interest: { ...desired, interest: { status: "paused", identity, reason: "background" } },
        });
        return { failedRetryAtMs: null, recoveringRetryAtMs: null };
      }
      if (runtimeInterest.recoveryAttempts > policy.recoveryAttemptLimit) {
        yield* applyControl({
          kind: "interest-upserted",
          interest: {
            ...desired,
            interest: {
              status: "failed",
              identity,
              reason: failure.message,
              retryable: true,
              attempts: runtimeInterest.recoveryAttempts,
              retryAtMs,
            },
          },
        });
        return { failedRetryAtMs: retryAtMs, recoveringRetryAtMs: null };
      }
      yield* applyControl({
        kind: "interest-upserted",
        interest: {
          ...desired,
          interest: {
            status: "recovering",
            identity,
            reason: failure.reason,
            attempt: runtimeInterest.recoveryAttempts,
            nextRetryAtMs: retryAtMs,
            progress:
              desired.interest.status === "establishing"
                ? desired.interest.progress
                : {
                    requiredRegistrations: 0,
                    completedRegistrations: 0,
                    requiredReads: 0,
                    completedReads: 0,
                    crossedReceiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
                  },
          },
        },
      });
      return { failedRetryAtMs: null, recoveringRetryAtMs: retryAtMs };
    });

  // A receiver-level failure replaces the receiver and bumps `recoveryAttempts` for every interest
  // still sharing the organization: each re-establishes on the replacement on its own backoff.
  // It runs only in response to such a failure, never because some interest's backoff elapsed.
  const replaceReceiver = (
    organizationKey: string,
    staleReceiver: RuntimeReceiver,
    cycleReason: string,
  ): Effect.Effect<void> =>
    lifecycleLock.withPermit(
      Effect.gen(function* () {
        if ((yield* Ref.get(closed)) || receivers.get(organizationKey) !== staleReceiver) return;
        const affected = [...interests.values()].filter(
          (interest) =>
            organizationKeyOf(organizationOfInterest(interest.descriptor)) === organizationKey &&
            interest.leases.size > 0,
        );
        if (affected.length === 0) return;

        const hidden = (yield* Ref.get(currentVisibility)) === "hidden";
        const replacement = makeReceiver(staleReceiver.organization);
        receivers.set(organizationKey, replacement);
        const reason: RecoveryReason = cycleReason.includes("overflow")
          ? "overflow"
          : cycleReason.includes("malformed")
            ? "malformed"
            : cycleReason.includes("registration")
              ? "registration"
              : "disconnect";
        const now = yield* Clock.currentTimeMillis;
        const failedRetries: Array<{
          readonly interest: RuntimeInterest;
          readonly identity: InterestIdentity;
          readonly retryAtMs: number;
        }> = [];
        for (const interest of affected) {
          const outcome = yield* reestablishLater(interest, replacement, {
            hidden,
            now,
            reason,
            message: cycleReason,
          });
          if (outcome.failedRetryAtMs !== null) {
            failedRetries.push({
              interest,
              identity: interest.identity,
              retryAtMs: outcome.failedRetryAtMs,
            });
          }
        }
        if (staleReceiver.handle !== null)
          yield* options.adapter.closeReceiver(staleReceiver.handle);
        yield* Effect.forEach(
          failedRetries,
          ({ interest, identity, retryAtMs }) => scheduleFailedRetry(interest, identity, retryAtMs),
          { discard: true },
        );
        // The replaced receiver's registrations are gone: any hydration still reading
        // through them is stale. Cancel it so scheduleHydration re-runs once the
        // affected interests establish on the replacement.
        const affectedHydrations = [...hydrations.entries()].filter(
          ([, hydration]) =>
            organizationKeyOf(organizationOfEntityRef(hydration.target)) === organizationKey,
        );
        yield* Effect.forEach(
          affectedHydrations,
          ([key, hydration]) => cancelHydration(key, hydration),
          { discard: true },
        );
      }),
    );

  // The earliest backoff among the organization's recovering interests on `receiver`.
  const nextRecoveryAtMs = (
    organizationKey: string,
    receiver: RuntimeReceiver,
    state: ZeropsDataState,
  ): number | null => {
    let next: number | null = null;
    for (const interest of interests.values()) {
      if (interest.leases.size === 0) continue;
      if (organizationKeyOf(organizationOfInterest(interest.descriptor)) !== organizationKey)
        continue;
      if (interest.identity.receiver.receiverId !== receiver.identity.receiverId) continue;
      const desired = state.interests.get(interest.key);
      if (desired?.interest.status !== "recovering") continue;
      next =
        next === null
          ? desired.interest.nextRetryAtMs
          : Math.min(next, desired.interest.nextRetryAtMs);
    }
    return next;
  };

  // The organization's recovery cycle, one round at a time: replace a receiver that failed under
  // it, or wait for the earliest recovering interest to come due (or to be woken) and retry the
  // interests that are due, only those. A retry that fails alone waits out its own next backoff on
  // the same receiver; only a retry that failed at the receiver replaces it. The round that finds
  // nothing left to recover ends the cycle in the same step, so any later failure starts a new one.
  const runRecoveryCycle = (organizationKey: string, cycle: RecoveryCycle): Effect.Effect<void> =>
    Effect.gen(function* () {
      while (true) {
        const round = yield* Effect.sync(
          ():
            | {
                readonly kind: "replace";
                readonly receiver: RuntimeReceiver;
                readonly reason: string;
              }
            | {
                readonly kind: "wait";
                readonly receiver: RuntimeReceiver;
                readonly dueAtMs: number;
              }
            | { readonly kind: "end" } => {
            cycle.wake = Deferred.makeUnsafe<void>();
            if (cycle.replace !== null) {
              const { receiver, reason } = cycle.replace;
              cycle.replace = null;
              return { kind: "replace", receiver, reason };
            }
            const receiver = receivers.get(organizationKey);
            const dueAtMs =
              receiver === undefined ||
              Ref.getUnsafe(closed) ||
              Ref.getUnsafe(currentVisibility) === "hidden"
                ? null
                : nextRecoveryAtMs(organizationKey, receiver, Ref.getUnsafe(model));
            if (receiver === undefined || dueAtMs === null) {
              if (recoveryCycles.get(organizationKey) === cycle)
                recoveryCycles.delete(organizationKey);
              return { kind: "end" };
            }
            return { kind: "wait", receiver, dueAtMs };
          },
        );
        if (round.kind === "end") return;
        if (round.kind === "replace") {
          yield* replaceReceiver(organizationKey, round.receiver, round.reason);
          continue;
        }
        const beforeSleep = yield* Clock.currentTimeMillis;
        yield* Effect.raceFirst(
          Effect.sleep(Duration.millis(Math.max(0, round.dueAtMs - beforeSleep))),
          Deferred.await(cycle.wake),
        );
        // Woken to replace the receiver: nothing retries on it first.
        if (cycle.replace !== null) continue;
        const due = yield* lifecycleLock.withPermit(
          Effect.gen(function* () {
            if (
              (yield* Ref.get(closed)) ||
              (yield* Ref.get(currentVisibility)) === "hidden" ||
              receivers.get(organizationKey) !== round.receiver
            )
              return [];
            const state = yield* Ref.get(model);
            const now = yield* Clock.currentTimeMillis;
            return [...interests.values()].filter((interest) => {
              const desired = state.interests.get(interest.key);
              return (
                interest.leases.size > 0 &&
                organizationKeyOf(organizationOfInterest(interest.descriptor)) ===
                  organizationKey &&
                interest.identity.receiver.receiverId === round.receiver.identity.receiverId &&
                desired?.interest.status === "recovering" &&
                // Each interest's own backoff: one coming due pulls no other forward.
                desired.interest.nextRetryAtMs <= now
              );
            });
          }),
        );
        if (due.length === 0) continue;
        // The retries that came due log in once more, over the receiver they wait on, a bounded
        // number at a time and the organization's project list first: the sidebar and the
        // projects page read it before any project in it.
        round.receiver.openFailure = null;
        const listFirst = [...due].sort(
          (left, right) =>
            Number(right.descriptor.kind === "organization-inventory") -
            Number(left.descriptor.kind === "organization-inventory"),
        );
        // A retry that failed at the receiver has it replaced, and the round's later retries do
        // not start on it. One superseded mid-flight ends in interruption: no failure of the
        // cycle's.
        yield* Effect.forEach(
          listFirst,
          (interest) =>
            Effect.suspend(() =>
              cycle.replace !== null
                ? Effect.void
                : Effect.exit(establishInterest(interest)).pipe(
                    Effect.map((exit) => {
                      if (Exit.isSuccess(exit) && exit.value.kind === "receiver-failed")
                        cycle.replace ??= { receiver: round.receiver, reason: exit.value.reason };
                    }),
                  ),
            ),
          { concurrency: policy.recoveryConcurrency, discard: true },
        );
        yield* awaitIngress;
      }
    });

  // Asks the organization's one recovery cycle to recover on `receiver`, starting it when none
  // runs; `replace` names a receiver-level failure. A running cycle is woken to recompute what is
  // due rather than raced by a second one. It replaces an open receiver at once; a receiver whose
  // socket login failed gets that login retried on the cycle's backoff (one login per rung), and
  // is replaced only when the cycle's own retry is what failed.
  const requestRecovery = (
    receiver: RuntimeReceiver,
    replace: string | null,
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      const organizationKey = organizationKeyOf(receiver.organization);
      if (receivers.get(organizationKey) !== receiver) return Effect.void;
      const running = recoveryCycles.get(organizationKey);
      if (running !== undefined) {
        if (replace !== null && receiver.handle !== null)
          running.replace = { receiver, reason: replace };
        return Deferred.succeed(running.wake, undefined).pipe(Effect.asVoid);
      }
      const cycle: RecoveryCycle = {
        wake: Deferred.makeUnsafe<void>(),
        replace: replace === null ? null : { receiver, reason: replace },
      };
      recoveryCycles.set(organizationKey, cycle);
      return runRecoveryCycle(organizationKey, cycle).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (recoveryCycles.get(organizationKey) === cycle)
              recoveryCycles.delete(organizationKey);
          }),
        ),
        forkOwned,
        Effect.asVoid,
      );
    });

  scheduleRecovery = (receiver, reason) => requestRecovery(receiver, reason);

  // Retries the organization's recovering interests on `receiver` without replacing it.
  const retryOnReceiver = (receiver: RuntimeReceiver): Effect.Effect<void> =>
    requestRecovery(receiver, null);

  // Re-establishes these interests alone on `receiver`, each under a fresh identity on its own
  // backoff (paused while the tab is hidden, `failed` with its own retry past the attempt limit);
  // every other interest keeps observing there. Runs under the lifecycle lock and answers whether
  // any of them now waits for the receiver's recovery cycle.
  const reestablishOnReceiver = (
    receiver: RuntimeReceiver,
    identities: Iterable<InterestIdentity>,
    reason: RecoveryReason,
    message: string,
  ): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const hidden = (yield* Ref.get(currentVisibility)) === "hidden";
      const now = yield* Clock.currentTimeMillis;
      let recovering = false;
      for (const identity of identities) {
        const runtimeInterest = interests.get(identity.key);
        if (
          runtimeInterest === undefined ||
          runtimeInterest.identity !== identity ||
          runtimeInterest.leases.size === 0
        )
          continue;
        const outcome = yield* reestablishLater(runtimeInterest, receiver, {
          hidden,
          now,
          reason,
          message,
        });
        if (outcome.failedRetryAtMs !== null) {
          yield* scheduleFailedRetry(
            runtimeInterest,
            runtimeInterest.identity,
            outcome.failedRetryAtMs,
          );
        }
        recovering ||= outcome.recoveringRetryAtMs !== null;
      }
      return recovering;
    });

  // A malformed frame that names its subscription lost data of that subscription alone. The
  // subscription leaves the receiver, so its later frames are dropped and re-establishment
  // registers it afresh with a new baseline; only the interests it fed re-establish, on the
  // same receiver, and every other interest keeps observing.
  recoverSubscription = (receiver, registration) =>
    lifecycleLock
      .withPermit(
        Effect.gen(function* () {
          const subscriptionName = registration.request.subscriptionName;
          if (
            (yield* Ref.get(closed)) ||
            receivers.get(organizationKeyOf(receiver.organization)) !== receiver ||
            receiver.registrationOwners.get(subscriptionName) !== registration
          )
            return false;
          receiver.registrationOwners.delete(subscriptionName);
          if (receiver.registrations.get(registration.key) === registration)
            receiver.registrations.delete(registration.key);
          return yield* reestablishOnReceiver(
            receiver,
            registration.dependents.values(),
            "malformed",
            "malformed receiver frame",
          );
        }),
      )
      .pipe(Effect.flatMap((recovering) => (recovering ? retryOnReceiver(receiver) : Effect.void)));

  // An interest failed on a receiver that keeps serving the others (a read of its own, or a
  // registration the platform refused): it alone re-establishes there. A receiver replaced or
  // paused meanwhile has already moved it along with every other interest.
  recoverInterest = (receiver, identity, reason, message) =>
    lifecycleLock
      .withPermit(
        Effect.gen(function* () {
          if (
            (yield* Ref.get(closed)) ||
            receivers.get(organizationKeyOf(receiver.organization)) !== receiver
          )
            return false;
          return yield* reestablishOnReceiver(receiver, [identity], reason, message);
        }),
      )
      .pipe(Effect.flatMap((recovering) => (recovering ? retryOnReceiver(receiver) : Effect.void)));

  // The retry leaves `failed` under a fresh identity, so its own failure enters `recovering`
  // and the organization's recovery cycle owns its exit; a failure still arriving under the
  // failed identity is late and changes nothing.
  scheduleFailedRetry = (runtimeInterest, identity, retryAtMs) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.sleep(Duration.millis(Math.max(0, retryAtMs - now)));
      const retrying = yield* lifecycleLock.withPermit(
        Effect.gen(function* () {
          if (yield* Ref.get(closed)) return false;
          if (runtimeInterest.leases.size === 0) return false;
          if (runtimeInterest.identity !== identity) return false;
          if ((yield* Ref.get(currentVisibility)) === "hidden") return false;
          const state = yield* Ref.get(model);
          if (state.interests.get(identity.key)?.interest.status !== "failed") return false;
          runtimeInterest.recoveryAttempts = 0;
          const desired = yield* updateInterestIdentity(
            runtimeInterest,
            receiverFor(organizationOfInterest(runtimeInterest.descriptor)),
          );
          yield* applyControl({ kind: "interest-upserted", interest: desired });
          return true;
        }),
      );
      if (retrying) yield* establishInterest(runtimeInterest);
    }).pipe(forkOwned, Effect.asVoid);

  const pauseForBackground = lifecycleLock.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(closed)) || (yield* Ref.get(currentVisibility)) !== "hidden") return;
      const activeReceivers = [...receivers.values()];
      receivers.clear();
      for (const runtimeInterest of interests.values()) {
        if (runtimeInterest.leases.size === 0) continue;
        runtimeInterest.readController.abort();
        const current = (yield* Ref.get(model)).interests.get(runtimeInterest.key);
        if (current === undefined) continue;
        yield* applyControl({
          kind: "interest-upserted",
          interest: {
            ...current,
            interest: {
              status: "paused",
              identity: runtimeInterest.identity,
              reason: "background",
            },
            wire: { status: "absent" },
          },
        });
      }
      yield* Effect.forEach(
        activeReceivers,
        (receiver) =>
          receiver.handle === null ? Effect.void : options.adapter.closeReceiver(receiver.handle),
        { discard: true },
      );
      // Every receiver just paused: no hydration read has a live registration behind it
      // any more. Cancel them all so scheduleHydration starts fresh once resumed.
      yield* Effect.forEach(
        [...hydrations.entries()],
        ([key, hydration]) => cancelHydration(key, hydration),
        { discard: true },
      );
    }),
  );

  const resumeFromBackground = lifecycleLock.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(closed)) || (yield* Ref.get(currentVisibility)) !== "visible") return;
      const state = yield* Ref.get(model);
      const paused = [...interests.values()].filter((runtimeInterest) => {
        if (runtimeInterest.leases.size === 0) return false;
        return state.interests.get(runtimeInterest.key)?.interest.status === "paused";
      });
      // Foreground return is also a controlled-retry trigger for a leased interest stuck
      // in `failed`: don't wait out the rest of its backoff window behind a hidden tab.
      const failed = [...interests.values()].filter((runtimeInterest) => {
        if (runtimeInterest.leases.size === 0) return false;
        return state.interests.get(runtimeInterest.key)?.interest.status === "failed";
      });
      for (const runtimeInterest of failed) runtimeInterest.recoveryAttempts = 0;
      const toResume = [...paused, ...failed];
      // Foreground return also clears the hydration-failure budget for every organization
      // being resumed, so a stale mid-outage rejection doesn't outlive the outage itself.
      // (Reaching "observing" again resets it too; this covers the interval before that.)
      const resumingOrganizationKeys = new Set<string>(
        toResume.map((runtimeInterest) =>
          organizationKeyOf(organizationOfInterest(runtimeInterest.descriptor)),
        ),
      );
      for (const [entityKey, record] of hydrationFailures) {
        if (resumingOrganizationKeys.has(record.organizationKey))
          hydrationFailures.delete(entityKey);
      }
      // A paused tab has no receivers left, so each organization gets a fresh one. A tab that
      // returned before the pause still holds its live receiver, which keeps serving the
      // interests observing on it: a failed interest retries there rather than replacing it.
      // A visible wake is the first rung, now: a login that failed before it is not the attempt.
      for (const runtimeInterest of toResume) {
        const receiver = receiverFor(organizationOfInterest(runtimeInterest.descriptor));
        receiver.openFailure = null;
        const desired = yield* updateInterestIdentity(runtimeInterest, receiver);
        yield* applyControl({ kind: "interest-upserted", interest: desired });
      }
      yield* Effect.forEach(
        toResume,
        (runtimeInterest) => establishInterest(runtimeInterest).pipe(forkOwned),
        { discard: true },
      );
      // A receiver kept through a short absence can still have interests recovering on it, whose
      // cycle stopped while the tab was hidden: it resumes, retrying whatever came due meanwhile.
      const resumed = yield* Ref.get(model);
      yield* Effect.forEach(
        [...receivers].filter(
          ([organizationKey, receiver]) =>
            nextRecoveryAtMs(organizationKey, receiver, resumed) !== null,
        ),
        ([, receiver]) => retryOnReceiver(receiver),
        { discard: true },
      );
    }),
  );

  const handleVisibility = (next: "visible" | "hidden"): Effect.Effect<void> =>
    Effect.gen(function* () {
      const sequence = yield* Ref.updateAndGet(visibilitySequence, (value) => value + 1);
      yield* Ref.set(currentVisibility, next);
      if (next === "visible") {
        yield* resumeFromBackground;
        return;
      }
      yield* Effect.sleep(Duration.millis(policy.hiddenReceiverPauseAfterMs));
      if (
        sequence === (yield* Ref.get(visibilitySequence)) &&
        (yield* Ref.get(currentVisibility)) === "hidden"
      ) {
        yield* pauseForBackground;
      }
    });

  yield* Stream.runForEach(visibility.changes, (next) =>
    handleVisibility(next).pipe(forkOwned, Effect.asVoid),
  ).pipe(forkOwned);
  if ((yield* Ref.get(currentVisibility)) === "hidden") {
    yield* handleVisibility("hidden").pipe(forkOwned);
  }

  const releaseLease = (leaseId: string): Effect.Effect<void> =>
    lifecycleLock.withPermit(
      Effect.gen(function* () {
        const runtimeInterest = leases.get(leaseId);
        if (runtimeInterest === undefined) return;
        leases.delete(leaseId);
        runtimeInterest.leases.delete(leaseId);
        if (runtimeInterest.leases.size > 0) {
          const current = yield* Ref.get(model);
          const desired = current.interests.get(runtimeInterest.key);
          if (desired !== undefined) {
            yield* applyControl({
              kind: "interest-upserted",
              interest: { ...desired, leases: runtimeInterest.leases.size },
            });
          }
          return;
        }
        interests.delete(runtimeInterest.key);
        runtimeInterest.readController.abort();
        const releasedQueryKeys = queryKeysOfPlan(planZeropsInterest(runtimeInterest.descriptor));
        const remainingQueryKeys = new Set(
          [...interests.values()].flatMap((interest) =>
            interest.leases.size > 0
              ? queryKeysOfPlan(planZeropsInterest(interest.descriptor))
              : [],
          ),
        );
        const inactiveQueryKeys = releasedQueryKeys.filter((key) => !remainingQueryKeys.has(key));
        const organization = organizationOfInterest(runtimeInterest.descriptor);
        const organizationKey = organizationKeyOf(organization);
        const receiver = receivers.get(organizationKey);
        if (receiver !== undefined) {
          for (const [registrationKey, registration] of receiver.registrations) {
            if (!registration.dependents.delete(runtimeInterest.key)) continue;
            if (
              registration.status === "registering" &&
              registration.ticket?.owner.kind === "shared"
            ) {
              if (registration.dependents.size === 0) {
                yield* applyControl({
                  kind: "shared-read-released",
                  requestId: registration.ticket.requestId,
                });
              } else {
                yield* applyControl({
                  kind: "shared-read-upserted",
                  requestId: registration.ticket.requestId,
                  ownership: {
                    owner: registration.ticket.owner,
                    target: registration.ticket.target,
                    dependents: new Map(registration.dependents),
                    status: "active",
                  },
                });
              }
            }
            if (registration.dependents.size === 0) {
              receiver.registrations.delete(registrationKey);
              receiver.registrationOwners.delete(registration.request.subscriptionName);
            }
          }
        }
        for (const [hydrationKey, hydration] of hydrations) {
          if (!hydration.ownership.dependents.has(runtimeInterest.key)) continue;
          const dependents = new Map(hydration.ownership.dependents);
          dependents.delete(runtimeInterest.key);
          if (dependents.size > 0) {
            hydration.ownership = { ...hydration.ownership, dependents };
            yield* applyControl({
              kind: "shared-read-upserted",
              requestId: hydration.requestId,
              ownership: hydration.ownership,
            });
            continue;
          }
          hydration.ownership = {
            ...hydration.ownership,
            dependents,
            status: "cancelled",
          };
          yield* applyControl({
            kind: "shared-read-upserted",
            requestId: hydration.requestId,
            ownership: hydration.ownership,
          });
          if (hydration.fiber !== null) yield* Fiber.interrupt(hydration.fiber);
          yield* applyControl({
            kind: "shared-read-released",
            requestId: hydration.requestId,
          });
          hydrations.delete(hydrationKey);
        }
        yield* applyControl({
          kind: "interest-released",
          key: runtimeInterest.key,
          identity: runtimeInterest.identity,
        });
        if (inactiveQueryKeys.length > 0) {
          yield* applyControl({ kind: "inactive-queries-released", queryKeys: inactiveQueryKeys });
        }
        const hasOtherInterest = [...interests.values()].some(
          (interest) =>
            interest.leases.size > 0 &&
            organizationKeyOf(organizationOfInterest(interest.descriptor)) === organizationKey,
        );
        if (!hasOtherInterest) {
          receivers.delete(organizationKey);
          if (receiver?.handle !== null && receiver?.handle !== undefined) {
            yield* options.adapter.closeReceiver(receiver.handle);
          }
        }
      }),
    );

  const refresh: ZeropsDataRuntime["refresh"] = (organization, refreshOptions) =>
    lifecycleLock.withPermit(
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return;
        const organizationKey = organizationKeyOf(organization);
        // A recovery cycle already owns this organization's receiver and is retrying
        // on its own backoff. An independent replacement here would race it: each
        // one's in-flight establishInterest call loses to the other's receiver swap
        // (the identity/receiver mismatch guards abort it), so neither ever survives
        // long enough to complete a registration — a livelock. While the cycle owns
        // the receiver (its socket is down, or it is about to replace it), wake it
        // instead, which recomputes its wait from current state.
        const activeRecovery = recoveryCycles.get(organizationKey);
        // A person asked (Try now) while some of the organization's subscriptions are not
        // observing — stalled, recovering, or failed past their attempts: every one of them starts
        // over now, past its backoff, on the socket that is open, which none of this replaces. Its
        // registrations still unanswered are let go, so nothing waits on them. A socket that is not
        // open is the recovery cycle's: its login retries on its own backoff. Any other
        // invalidation is a full re-read, below.
        const current = receivers.get(organizationKey);
        const open = current !== undefined && current.handle !== null ? current : null;
        const stalled = yield* Ref.get(model);
        const restarting =
          open === null || refreshOptions?.retry !== true
            ? []
            : [...interests.values()].filter((runtimeInterest) => {
                const status = stalled.interests.get(runtimeInterest.key)?.interest.status;
                return (
                  runtimeInterest.leases.size > 0 &&
                  runtimeInterest.identity.receiver.receiverId === open.identity.receiverId &&
                  (status === "establishing" || status === "recovering" || status === "failed")
                );
              });
        // A socket that is down, or one the cycle is about to replace, is the cycle's to
        // re-read: everything re-registers on the receiver it opens.
        const cycleOwnsReceiver =
          activeRecovery !== undefined && (open === null || activeRecovery.replace !== null);
        if (cycleOwnsReceiver || restarting.length > 0) {
          if (open !== null) {
            for (const registration of [...open.registrations.values()]) {
              if (registration.status !== "registering") continue;
              open.registrations.delete(registration.key);
              const name = registration.request.subscriptionName;
              if (open.registrationOwners.get(name) === registration)
                open.registrationOwners.delete(name);
              yield* Deferred.succeed(registration.outcome, {
                kind: "failed",
                error: RETRIED_BY_PERSON,
              });
            }
            for (const runtimeInterest of restarting) {
              runtimeInterest.recoveryAttempts = 0;
              const desired = yield* updateInterestIdentity(runtimeInterest, open);
              yield* applyControl({ kind: "interest-upserted", interest: desired });
            }
            yield* Effect.forEach(
              restarting,
              (runtimeInterest) => establishInterest(runtimeInterest).pipe(forkOwned),
              { discard: true },
            );
          }
          if (activeRecovery !== undefined) yield* Deferred.succeed(activeRecovery.wake, undefined);
          return;
        }
        const state = yield* Ref.get(model);
        const held = [...interests.values()].filter(
          (runtimeInterest) =>
            runtimeInterest.leases.size > 0 &&
            organizationKeyOf(organizationOfInterest(runtimeInterest.descriptor)) ===
              organizationKey &&
            state.interests.get(runtimeInterest.key)?.interest.status !== "paused",
        );
        if (held.length === 0) return;
        // The replacement is in `receivers` before the stale one closes, so the
        // stale socket's close reaches scheduleRecovery as a receiver that is no
        // longer current and starts no recovery cycle.
        const stale = receivers.get(organizationKey);
        const replacement = makeReceiver(organization);
        receivers.set(organizationKey, replacement);
        for (const runtimeInterest of held) {
          runtimeInterest.recoveryAttempts = 0;
          const desired = yield* updateInterestIdentity(runtimeInterest, replacement);
          yield* applyControl({ kind: "interest-upserted", interest: desired });
        }
        if (stale !== undefined && stale.handle !== null) {
          yield* options.adapter.closeReceiver(stale.handle);
        }
        // The stale receiver's registrations went with it: an in-flight
        // hydration is cancelled so scheduleHydration starts it fresh once the
        // interests are re-established, and the organization's failure budget
        // starts over with them.
        yield* Effect.forEach(
          [...hydrations.entries()].filter(
            ([, hydration]) =>
              organizationKeyOf(organizationOfEntityRef(hydration.target)) === organizationKey,
          ),
          ([key, hydration]) => cancelHydration(key, hydration),
          { discard: true },
        );
        for (const [entityKey, record] of hydrationFailures) {
          if (record.organizationKey === organizationKey) hydrationFailures.delete(entityKey);
        }
        yield* Effect.forEach(
          held,
          (runtimeInterest) => establishInterest(runtimeInterest).pipe(forkOwned),
          { discard: true },
        );
        // A cycle retrying single interests on the replaced socket finds its round's receiver
        // gone and recomputes what is due on this one.
        if (activeRecovery !== undefined) yield* Deferred.succeed(activeRecovery.wake, undefined);
      }),
    );

  /**
   * Admits one lease under the lifecycle lock. An interest that needs establishing is added to
   * `establishments`, which the caller starts once the whole pass is admitted.
   */
  const admitLease = (
    descriptor: RuntimeInterestDescriptor,
    leaseScope: Scope.Scope,
    establishments: Array<RuntimeInterest>,
  ): Effect.Effect<InterestLease, LeaseAdmissionError> =>
    Effect.gen(function* () {
      if (yield* Ref.get(closed)) {
        return yield* Effect.fail(
          leaseError("runtime-closed", "The Zerops account data runtime is closed."),
        );
      }
      if (!accountRefsEqual(organizationOfInterest(descriptor).account, options.scope.account)) {
        return yield* Effect.fail(
          leaseError("account-mismatch", "The requested interest belongs to another account."),
        );
      }
      const key = interestKeyOf(descriptor);
      let runtimeInterest = interests.get(key);
      if (runtimeInterest === undefined) {
        if (interests.size >= policy.activeInterestsPerAccount) {
          return yield* Effect.fail(
            leaseError("account-capacity", "The account interest budget is full."),
          );
        }
        const organization = organizationOfInterest(descriptor);
        const organizationKey = organizationKeyOf(organization);
        const plan = planZeropsInterest(descriptor);
        const plannedQueryKeys = queryKeysOfPlan(plan);
        const activeQueryKeys = new Set(
          [...interests.values()].flatMap((interest) =>
            interest.leases.size > 0
              ? queryKeysOfPlan(planZeropsInterest(interest.descriptor))
              : [],
          ),
        );
        const additionalQueries = plannedQueryKeys.filter(
          (queryKey) => !activeQueryKeys.has(queryKey),
        ).length;
        if (activeQueryKeys.size + additionalQueries > policy.activeQueriesPerAccount) {
          return yield* Effect.fail(
            leaseError("account-capacity", "The account active-query budget is full."),
          );
        }
        const activeHistorySeries = [...interests.values()].filter(
          (interest) =>
            interest.leases.size > 0 && interest.descriptor.kind === "project-metric-history",
        ).length;
        if (
          descriptor.kind === "project-metric-history" &&
          activeHistorySeries >= policy.activeHistorySeriesPerAccount
        ) {
          return yield* Effect.fail(
            leaseError("account-capacity", "The account history-series budget is full."),
          );
        }
        const organizationInterestCount = [...interests.values()].filter(
          (interest) =>
            organizationKeyOf(organizationOfInterest(interest.descriptor)) === organizationKey,
        ).length;
        if (organizationInterestCount >= policy.desiredInterestsPerReceiver) {
          return yield* Effect.fail(
            leaseError("receiver-capacity", "The organization receiver interest budget is full."),
          );
        }
        if (!receivers.has(organizationKey) && receivers.size >= policy.receiversPerAccount) {
          return yield* Effect.fail(
            leaseError("account-capacity", "The account receiver budget is full."),
          );
        }
        const currentReceiver = receivers.get(organizationKey);
        const plannedRegistrationKeys = new Set(
          plan.registrations.map((registration) => registrationKeyOf(registration.descriptor)),
        );
        const additionalRegistrations = [...plannedRegistrationKeys].filter(
          (key) => !currentReceiver?.registrations.has(key),
        ).length;
        const activeRegistrationDemand = [...receivers.values()].reduce(
          (total, receiver) => total + receiver.registrations.size,
          0,
        );
        if (
          activeRegistrationDemand + additionalRegistrations >
          policy.activeRegistrationsPerAccount
        ) {
          return yield* Effect.fail(
            leaseError("account-capacity", "The account registration budget is full."),
          );
        }
        const receiver = receiverFor(organization);
        // Placeholder identity only: updateInterestIdentity below is the single source
        // that mints the real epoch and identity before establishment starts.
        const identity: InterestIdentity = {
          receiver: receiver.identity,
          interestEpoch: InterestEpoch.make(interestEpoch),
          key,
        };
        runtimeInterest = {
          descriptor,
          key,
          leases: new Set(),
          // Metrics and history enrich what the inventory interests hold: their
          // failures retry on their own and never replace the organization receiver.
          required:
            descriptor.kind !== "project-current-metrics" &&
            descriptor.kind !== "project-process-history" &&
            descriptor.kind !== "project-metric-history",
          identity,
          recoveryAttempts: 0,
          readController: new AbortController(),
        };
        interests.set(key, runtimeInterest);
      }
      const leaseId = options.makeOpaqueId();
      runtimeInterest.leases.add(leaseId);
      leases.set(leaseId, runtimeInterest);
      const existing = (yield* Ref.get(model)).interests.get(key);
      if (existing === undefined) {
        const desired = yield* updateInterestIdentity(
          runtimeInterest,
          receiverFor(organizationOfInterest(descriptor)),
        );
        yield* applyControl({ kind: "interest-upserted", interest: desired });
        establishments.push(runtimeInterest);
      } else {
        yield* applyControl({
          kind: "interest-upserted",
          interest: { ...existing, leases: runtimeInterest.leases.size },
        });
        // A fresh lease is a fresh reason to retry a failed interest now, rather than
        // waiting out whatever backoff window a prior lessee's failures left behind.
        // Minting a new identity (as resumeFromBackground does) is required, not
        // optional: without it the still-sleeping scheduleFailedRetry fiber from the
        // earlier failure passes its own identity check at the old retryAtMs and
        // fires a second, concurrent establishment for the same interest.
        if (existing.interest.status === "failed") {
          runtimeInterest.recoveryAttempts = 0;
          const desired = yield* updateInterestIdentity(
            runtimeInterest,
            receiverFor(organizationOfInterest(descriptor)),
          );
          yield* applyControl({ kind: "interest-upserted", interest: desired });
          establishments.push(runtimeInterest);
        }
      }
      const release = releaseLease(leaseId);
      yield* Scope.addFinalizer(leaseScope, release);
      return {
        leaseId: ZeropsLeaseId.make(leaseId),
        interest: key,
        release,
      } satisfies InterestLease;
    });

  const acquireMany: ZeropsDataRuntime["acquireMany"] = (descriptors) =>
    Effect.gen(function* () {
      const leaseScope = yield* Scope.Scope;
      return yield* lifecycleLock.withPermit(
        Effect.gen(function* () {
          const establishments: Array<RuntimeInterest> = [];
          const taken = yield* Effect.forEach(descriptors, (descriptor) =>
            admitLease(descriptor, leaseScope, establishments).pipe(Effect.result),
          );
          yield* Effect.forEach(
            establishments,
            (runtimeInterest) => establishInterest(runtimeInterest).pipe(forkOwned),
            { discard: true },
          );
          return taken;
        }),
      );
    });

  const acquire: ZeropsDataRuntime["acquire"] = (descriptor) =>
    acquireMany([descriptor]).pipe(Effect.flatMap(([taken]) => Effect.fromResult(taken!)));

  /** The grant's account capability now, on its own clocks (`commandAdmissionError`). */
  const accountCapability = Effect.suspend(() =>
    grantCapabilities(grant.grant).check({ kind: "account" }),
  );

  const prepareCommand = (
    intent: PlatformCommandIntent,
  ): Effect.Effect<PlatformCommand, CommandAdmissionError> =>
    modelLock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(model);
        if ((yield* Ref.get(closed)) || current.closed) {
          return yield* Effect.fail({
            _tag: "ZeropsCommandAdmissionError",
            reason: "runtime-closed",
            message: "The Zerops account data runtime is closed.",
          } satisfies CommandAdmissionError);
        }
        const pendingCount = [...current.commands.values()].filter(
          (attempt) => attempt.status === "pending",
        ).length;
        if (
          pendingCount >= policy.queuedCommandRequestsPerAccount ||
          current.commands.size >= policy.retainedCommandAttemptsPerAccount
        ) {
          return yield* Effect.fail({
            _tag: "ZeropsCommandAdmissionError",
            reason: "command-capacity",
            message: "The account command queue is full.",
          } satisfies CommandAdmissionError);
        }
        const now = yield* Clock.currentTimeMillis;
        const admission = commandAdmissionError(
          options.scope,
          current.access,
          commandTarget(intent),
          now,
          yield* accountCapability,
        );
        if (admission !== null) return yield* Effect.fail(admission);
        receiptOrdinal += 1;
        dispatchOrdinal += 1;
        const command: PlatformCommand = {
          ...intent,
          attemptId: ZeropsCommandAttemptId.make(options.makeOpaqueId()),
          accountEpoch: options.scope.epoch,
          startedAtReceiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
          dispatchOrdinal: DispatchOrdinal.make(dispatchOrdinal),
        };
        const stamped: IngestionInput = {
          kind: "command-execution-requested",
          stamp: {
            receiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
            observedAtMs: now,
          },
          request: { command, enqueuedAtMs: now },
        };
        const reduction = reduceZeropsDataState(current, stamped, policy);
        if (reduction.state !== current) yield* publish(reduction.state);
        return command;
      }),
    );

  /**
   * A read the platform answers with a value alone — a token, a token's delegations: admitted as a command is,
   * on the same grant and target, but never queued behind the account's writes, never waiting on
   * its ingress, never counted against its command queue. Run as commands, the Mate-key
   * reconcile's listings filled that queue and refused a New project's close-off (measured live, pass 31).
   */
  const runReadIntent = (
    intent: Extract<
      PlatformCommandIntent,
      { readonly kind: "read-integration-token-grant" | "list-token-delegations" }
    >,
  ): Effect.Effect<
    { readonly attempt: ReturnType<typeof attemptRef>; readonly result: PlatformCommandResult },
    CommandAdmissionError | AdapterError
  > =>
    Effect.gen(function* () {
      const command = yield* modelLock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(model);
          if ((yield* Ref.get(closed)) || current.closed) {
            return yield* Effect.fail({
              _tag: "ZeropsCommandAdmissionError",
              reason: "runtime-closed",
              message: "The Zerops account data runtime is closed.",
            } satisfies CommandAdmissionError);
          }
          const admission = commandAdmissionError(
            options.scope,
            current.access,
            commandTarget(intent),
            yield* Clock.currentTimeMillis,
            yield* accountCapability,
          );
          if (admission !== null) return yield* Effect.fail(admission);
          return {
            ...intent,
            attemptId: ZeropsCommandAttemptId.make(options.makeOpaqueId()),
            accountEpoch: options.scope.epoch,
            startedAtReceiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
            dispatchOrdinal: DispatchOrdinal.make(dispatchOrdinal),
          } satisfies PlatformCommand;
        }),
      );
      const receipt = yield* context(policy.httpDeadlineMs, (requestContext) =>
        options.adapter.execute(command, requestContext),
      );
      if (receipt.result === undefined) return yield* Effect.fail(missingCommandResult());
      return { attempt: attemptRef(command), result: receipt.result };
    });

  const attemptRef = (command: PlatformCommand) => ({
    account: options.scope.account,
    accountEpoch: options.scope.epoch,
    attemptId: command.attemptId,
  });

  const checkCommandAdmission = (
    command: PlatformCommand,
  ): Effect.Effect<void, CommandAdmissionError> =>
    modelLock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(model);
        const now = yield* Clock.currentTimeMillis;
        const admission = commandAdmissionError(
          options.scope,
          current.access,
          commandTarget(command),
          now,
          yield* accountCapability,
        );
        if (admission !== null) return yield* Effect.fail(admission);
        if ((yield* Ref.get(closed)) || current.closed) {
          return yield* Effect.fail({
            _tag: "ZeropsCommandAdmissionError",
            reason: "runtime-closed",
            message: "Account runtime closed before command execution.",
          } satisfies CommandAdmissionError);
        }
      }),
    );

  const executePreparedCommand = (
    command: PlatformCommand,
  ): Effect.Effect<PlatformCommandReceipt, CommandAdmissionError | AdapterError> =>
    commandSemaphore
      .withPermit(
        Effect.gen(function* () {
          const executionAdmission = yield* checkCommandAdmission(command).pipe(Effect.result);
          if (Result.isFailure(executionAdmission)) {
            const failure = executionAdmission.failure;
            yield* enqueue({
              kind: "command-completion",
              completion: { kind: "command-rejected", command, reason: failure.message },
              interest: null,
            });
            yield* awaitIngress;
            return yield* Effect.fail(failure);
          }
          // The guard's refusal between writes reaches the adapter as a thrown
          // cause it wraps in its own error; kept here so the command fails
          // with the admission's reason — "not verified yet" is a wait, not an
          // answer (`commands.ts`).
          let midWriteAdmission: CommandAdmissionError | null = null;
          const outcome = yield* context(
            commandDeadlineMs(command.kind, policy),
            (requestContext) =>
              options.adapter.execute(command, {
                ...requestContext,
                beforeProjectWrite: () =>
                  Effect.runPromiseWith(runtimeContext)(
                    checkCommandAdmission(command).pipe(
                      Effect.tapError((admission) =>
                        Effect.sync(() => {
                          midWriteAdmission = admission;
                        }),
                      ),
                    ),
                  ),
              }),
          ).pipe(Effect.result);
          if (Result.isFailure(outcome) && midWriteAdmission !== null) {
            const admission: CommandAdmissionError = midWriteAdmission;
            yield* enqueue({
              kind: "command-completion",
              completion: { kind: "command-rejected", command, reason: admission.message },
              interest: null,
            });
            yield* awaitIngress;
            return yield* Effect.fail(admission);
          }
          if (Result.isFailure(outcome)) {
            const uncertain = ["uncertain", "timeout", "network", "server"].includes(
              outcome.failure.kind,
            );
            yield* enqueue({
              kind: "command-completion",
              completion: {
                kind: uncertain ? "command-uncertain" : "command-rejected",
                command,
                reason: outcome.failure.message,
              },
              interest: null,
            });
            yield* awaitIngress;
            return yield* Effect.fail(outcome.failure);
          }
          const result = outcome.success.result;
          let createdProject: ProjectRef | null = null;
          if (command.kind === "create-project" && result?.kind === command.kind) {
            createdProject = {
              kind: "project",
              organization: command.organization,
              projectId: ZeropsProjectId.make(result.value.id),
            };
          } else if (command.kind === "import-project" && result?.kind === command.kind) {
            createdProject = {
              kind: "project",
              organization: command.organization,
              projectId: ZeropsProjectId.make(result.value.projectId),
            };
          }
          if (createdProject !== null) {
            yield* enqueue({
              kind: "access-observation",
              observation: {
                kind: "project-access-established",
                accountEpoch: options.scope.epoch,
                project: createdProject,
              },
              interest: null,
            });
          }
          yield* enqueueObservations(outcome.success.observations, null);
          yield* enqueue({
            kind: "command-completion",
            completion: {
              kind: "command-accepted",
              command,
              processRefs: outcome.success.processRefs,
            },
            interest: null,
          });
          yield* awaitIngress;
          return outcome.success;
        }),
      )
      .pipe(
        // Abandoned before it answered — its caller went — it may still have landed: it is
        // uncertain, never left pending against the account's command queue.
        Effect.onInterrupt(() =>
          enqueue({
            kind: "command-completion",
            completion: {
              kind: "command-uncertain",
              command,
              reason: "The request was abandoned before Zerops answered.",
            },
            interest: null,
          }),
        ),
      );

  const startCommand: ZeropsDataRuntime["commands"]["startCommand"] = (intent) =>
    Effect.gen(function* () {
      const command = yield* prepareCommand(intent);
      yield* executePreparedCommand(command).pipe(Effect.ignore, forkOwned);
      return attemptRef(command);
    });

  const missingCommandResult = (): AdapterError => ({
    _tag: "ZeropsDataAdapterError",
    kind: "rejected",
    message: "Zerops command adapter returned no typed result.",
    retryable: false,
    accountRevocationEvidence: false,
  });

  const runCommand = (
    intent: PlatformCommandIntent,
  ): Effect.Effect<
    { readonly attempt: ReturnType<typeof attemptRef>; readonly result: PlatformCommandResult },
    CommandAdmissionError | AdapterError
  > =>
    Effect.gen(function* () {
      const command = yield* prepareCommand(intent);
      const receipt = yield* executePreparedCommand(command);
      if (receipt.result === undefined) return yield* Effect.fail(missingCommandResult());
      return { attempt: attemptRef(command), result: receipt.result };
    });

  const commands: ZeropsDataRuntime["commands"] = {
    startCommand,
    restartService: (service) =>
      runCommand({ kind: "restart-service", service }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "restart-service"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    startService: (service) =>
      runCommand({ kind: "start-service", service }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "start-service"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    startProject: (project) =>
      runCommand({ kind: "start-project", project }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "start-project"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    updateProjectTags: (project, patch) =>
      runCommand({ kind: "update-project-tags", project, patch }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "update-project-tags"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    setProjectMemberRole: (project, input) =>
      runCommand({ kind: "set-project-member-role", project, ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "set-project-member-role"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    importDevelopmentContainer: (input) =>
      runCommand({ kind: "import-development-container", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "import-development-container"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    enableZeropsMate: (service) =>
      runCommand({ kind: "enable-zerops-mate", service }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "enable-zerops-mate"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    enableSubdomainAccess: (service) =>
      runCommand({ kind: "enable-subdomain-access", service }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "enable-subdomain-access"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    createProject: (input) =>
      runCommand({ kind: "create-project", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "create-project"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    importProject: (organization, yaml) =>
      runCommand({ kind: "import-project", organization, yaml }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "import-project"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    importServices: (project, yaml) =>
      runCommand({ kind: "import-services", project, yaml }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "import-services"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    readIntegrationTokenGrant: (input) =>
      runReadIntent({ kind: "read-integration-token-grant", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "read-integration-token-grant"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    setIntegrationTokenProjects: (input) =>
      runCommand({ kind: "set-integration-token-projects", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "set-integration-token-projects"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    listTokenDelegations: (input) =>
      runReadIntent({ kind: "list-token-delegations", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "list-token-delegations"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    deleteTokenDelegation: (input) =>
      runCommand({ kind: "delete-token-delegation", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "delete-token-delegation"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    isolateProjectEnv: (project, keyTokenId) =>
      runCommand({
        kind: "harden-mate",
        project,
        ...(keyTokenId === undefined ? {} : { keyTokenId }),
      }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "harden-mate"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    deleteProject: (input) =>
      runCommand({ kind: "delete-project", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "delete-project"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
  };

  const observeAccess = (observation: AccessObservation): Effect.Effect<void> =>
    enqueue({ kind: "access-observation", observation, interest: null }).pipe(
      Effect.andThen(awaitIngress),
      Effect.andThen(
        observation.kind === "access-verified" || observation.kind === "project-access-established"
          ? retryRefusedHydrations
          : Effect.void,
      ),
    );

  /** A grant changed: every entity the platform refused is read once more under it. */
  const retryRefusedHydrations = Effect.suspend(() => {
    const queries = new Set<QueryKey>();
    for (const [key, record] of hydrationFailures) {
      if (record.refusal.kind !== "gone") continue;
      hydrationFailures.delete(key);
      queries.add(record.query);
    }
    return Effect.forEach(queries, (query) => scheduleHydration(query), { discard: true });
  });

  const grant = yield* makeGrantDriver({
    scope: options.scope,
    policy: DEFAULT_ZEROPS_GRANT_POLICY,
    clock,
    atomRegistry: options.atomRegistry,
    access: Ref.get(model).pipe(Effect.map((state) => state.access)),
    observe: observeAccess,
    // A timer is armed, and a read is sent, in the turn that asked for it.
    fork: (work) =>
      work.pipe(
        Effect.forkIn(runtimeScope, { startImmediately: true }),
        Effect.provideService(Scheduler.Scheduler, scheduler),
      ),
  });

  // The tab's network reaches the runtime through its grant's signals.
  yield* grant.grant.changes.pipe(
    Stream.map(({ machine }) => machine.signals.online),
    Stream.changes,
    Stream.runForEach((online) => (online ? network.open : network.close)),
    forkOwned,
  );

  const listen: ManagedZeropsDataRuntime["listen"] = (bus) =>
    Effect.flatMap(bus.subscribe, (subscription) =>
      Stream.fromSubscription(subscription).pipe(
        Stream.runForEach((invalidation) =>
          invalidation.topic === "inventory"
            ? refresh(invalidation.organization, { retry: invalidation.why === "user-retry" })
            : Effect.void,
        ),
        Effect.forkScoped,
      ),
    ).pipe(Effect.asVoid);

  const shutdown: ZeropsDataRuntime["shutdown"] = (_reason) =>
    lifecycleLock.withPermit(
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return;
        // No round, read or timer of the grant outlives the epoch.
        yield* grant.close;
        // Fence publication and clear grants/model first; transport finalizers run afterward.
        yield* Ref.set(closed, true);
        yield* applyControl({ kind: "runtime-closed" });
        yield* flushPublication;
        yield* ingress.shutdown;
        // What the shutdown dropped is never reached: its waiters are let go now.
        for (const barrier of barriers) yield* Deferred.succeed(barrier, undefined);
        barriers.clear();
        stopTokenWrites();
        yield* cells.shutdown;
        logs.shutdown();
        yield* Scope.close(runtimeScope, Exit.void);
        interests.clear();
        leases.clear();
        receivers.clear();
        recoveryCycles.clear();
        hydrations.clear();
        hydrationFailures.clear();
      }),
    );

  return {
    scope: options.scope,
    reads: atoms.reads,
    commands,
    cells,
    logs,
    acquire,
    refresh,
    acquireMany,
    listen,
    shutdown,
    state: Ref.get(model),
    stateAtom: rootAtom,
    ingress: ingress.snapshot,
    observeAccess,
    access: grant.grant,
  } satisfies ManagedZeropsDataRuntime;
});
