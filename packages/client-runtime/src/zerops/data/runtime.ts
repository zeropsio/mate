import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Scheduler from "effect/Scheduler";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { createZeropsDataAtoms } from "./atoms.ts";
import { commandAdmissionError, commandTarget } from "./commands.ts";
import { BuildLogTransportError, type BuildLogTransport } from "./logTransport.ts";
import { makeBuildLogRegistry, type BuildLogRegistry } from "./logs.ts";
import { DEFAULT_ZEROPS_DATA_POLICY, type ZeropsDataPolicy } from "./policy.ts";
import {
  makeZeropsResourceBroker,
  type ZeropsResourceAdapter,
  type ZeropsResourceBroker,
  type ZeropsResourceSourceError,
} from "./resources.ts";
import {
  makeInitialZeropsDataState,
  reduceZeropsDataState,
  type RuntimeControlInput,
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
  ZeropsRequestId,
  ZeropsSharedReadId,
  ZeropsWireSubscriptionName,
  organizationKeyOf,
  entityKeyOf,
  projectKeyOf,
  queryKeyOf,
} from "./types.ts";

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
  return descriptor.kind === "organization-inventory"
    ? descriptor.organization
    : descriptor.project.organization;
}

function organizationOfEntityRef(ref: EntityRef): OrganizationRef {
  return ref.kind === "project" ? ref.organization : ref.project.organization;
}

/** Stable desired-work identity. Disposable receiver/interest epochs stay out of this key. */
export function interestKeyOf(descriptor: RuntimeInterestDescriptor): InterestKey {
  switch (descriptor.kind) {
    case "organization-inventory":
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
 * limits. The overflow callback runs while admission is locked and before the
 * rejected event is counted as discarded, so callers can publish recovering
 * state before losing data.
 */
export const makeZeropsBoundedIngress = Effect.fn("ZeropsDataRuntime.makeBoundedIngress")(
  function* <Input>(options: {
    readonly maxEvents: number;
    readonly maxBytes: number;
    readonly maxFrameBytes: number;
    readonly onOverflow: (input: Input) => Effect.Effect<void>;
  }) {
    const queue = yield* Queue.bounded<QueuedIngress<Input>>(options.maxEvents);
    const admission = yield* Semaphore.make(1);
    const counters = yield* Ref.make<ZeropsIngressSnapshot>({
      events: 0,
      bytes: 0,
      peakEvents: 0,
      peakBytes: 0,
      discardedEvents: 0,
    });

    const offer = (input: Input, bytes: number): Effect.Effect<boolean> =>
      admission.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(counters);
          const admissible =
            Number.isSafeInteger(bytes) &&
            bytes >= 0 &&
            bytes <= options.maxFrameBytes &&
            current.events < options.maxEvents &&
            current.bytes + bytes <= options.maxBytes;
          if (!admissible) {
            yield* options.onOverflow(input);
            yield* Ref.update(counters, (state) => ({
              ...state,
              discardedEvents: state.discardedEvents + 1,
            }));
            return false;
          }

          const queued = yield* Queue.offer(queue, { input, bytes, budgeted: true });
          if (!queued) return false;
          yield* Ref.update(counters, (state) => {
            const events = state.events + 1;
            const nextBytes = state.bytes + bytes;
            return {
              ...state,
              events,
              bytes: nextBytes,
              peakEvents: Math.max(state.peakEvents, events),
              peakBytes: Math.max(state.peakBytes, nextBytes),
            };
          });
          return true;
        }),
      );

    const take = Queue.take(queue).pipe(
      Effect.flatMap((entry) =>
        entry.budgeted
          ? admission.withPermit(
              Ref.update(counters, (state) => ({
                ...state,
                events: state.events - 1,
                bytes: state.bytes - entry.bytes,
              })).pipe(Effect.as(entry.input)),
            )
          : Effect.succeed(entry.input),
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

export function planZeropsInterest(descriptor: RuntimeInterestDescriptor): InterestPlan {
  const organization = organizationOfInterest(descriptor);
  const entityUpdate = (entity: "project" | "service" | "process"): PlannedRegistration => ({
    descriptor: { kind: "entity-updates", entity, organization },
    baseline: null,
  });
  if (descriptor.kind === "organization-inventory") {
    const query: QueryDescriptor = {
      kind: "projects-of-organization",
      organization,
      statuses: [],
      schemaVersion: 1,
    };
    return {
      registrations: [
        entityUpdate("project"),
        {
          descriptor: { kind: "query-membership", query },
          baseline: { kind: "query", descriptor: query },
        },
      ],
      directReads: [{ kind: "query", descriptor: query }],
    };
  }

  const project = descriptor.project;
  if (descriptor.kind === "project-inventory" || descriptor.kind === "project-topology") {
    const services: QueryDescriptor = {
      kind: "services-of-project",
      project,
      schemaVersion: 1,
    };
    const processes: QueryDescriptor = {
      kind: "running-processes-of-project",
      project,
      statuses: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"],
      schemaVersion: 1,
    };
    const registrations: PlannedRegistration[] = [
      entityUpdate("project"),
      entityUpdate("service"),
      {
        descriptor: { kind: "query-membership", query: services },
        baseline: { kind: "query", descriptor: services },
      },
    ];
    if (descriptor.kind === "project-topology") {
      registrations.push(entityUpdate("process"), {
        descriptor: { kind: "query-membership", query: processes },
        baseline: { kind: "query", descriptor: processes },
      });
    }
    return {
      registrations,
      directReads: [
        { kind: "project", ref: project },
        { kind: "query", descriptor: services },
        ...(descriptor.kind === "project-topology"
          ? [{ kind: "query" as const, descriptor: processes }]
          : []),
      ],
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
  if (descriptor.kind === "project-activity") {
    const query: QueryDescriptor = {
      kind: "running-processes-of-project",
      project,
      statuses: ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"],
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
      directReads: [{ kind: "query", descriptor: query }],
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

function registrationKeyOf(descriptor: RegistrationDescriptor): string {
  if (descriptor.kind === "entity-updates")
    return JSON.stringify([
      descriptor.kind,
      descriptor.entity,
      organizationKeyOf(descriptor.organization),
    ]);
  return JSON.stringify([descriptor.kind, queryKeyOf(descriptor.query)]);
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
  readonly resourceAdapter?: ZeropsResourceAdapter;
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
    readonly resources: ZeropsResourceBroker;
    readonly logs: BuildLogRegistry;
  };

const leaseError = (
  reason: LeaseAdmissionError["reason"],
  message: string,
): LeaseAdmissionError => ({ _tag: "ZeropsLeaseAdmissionError", reason, message });

const unavailableResource = (): Effect.Effect<never, ZeropsResourceSourceError> =>
  Effect.fail({
    _tag: "ZeropsResourceSourceError",
    kind: "unavailable",
    retryable: false,
  });

const unavailableResourceAdapter: ZeropsResourceAdapter = {
  readRecipeGroup: unavailableResource,
  readProjectCloneSourceRecipe: unavailableResource,
  readOrganizationLocations: unavailableResource,
  readServiceAuthorizedAgents: unavailableResource,
  readOrganizationIntegrationTokenGrants: unavailableResource,
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
  const resources = yield* makeZeropsResourceBroker({
    scope: options.scope,
    adapter: options.resourceAdapter ?? unavailableResourceAdapter,
    access: Ref.get(model).pipe(Effect.map((state) => state.access)),
    maxEntries: policy.activeSharedReadsPerAccount,
  });
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
  let logAccess = Ref.getUnsafe(model).access;
  const runtimeScope = yield* Scope.make();
  // Demand arrives from independently run UI effects; workers retain the account scheduler.
  const forkOwned = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.forkIn(runtimeScope), Effect.provideService(Scheduler.Scheduler, scheduler));
  const closed = yield* Ref.make(false);
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
  const commandSemaphore = yield* Semaphore.make(1);
  const rootAtom = Atom.make(yield* Ref.get(model));
  const unmountRootAtom = options.atomRegistry.mount(rootAtom);
  yield* Scope.addFinalizer(runtimeScope, Effect.sync(unmountRootAtom));
  const atoms = createZeropsDataAtoms(rootAtom);
  const interests = new Map<InterestKey, RuntimeInterest>();
  const leases = new Map<string, RuntimeInterest>();
  const receivers = new Map<string, RuntimeReceiver>();
  // Maps an organization currently being recovered to a "wake" signal for its active
  // scheduleRecovery cycle. A second interest failing while that cycle is asleep toward
  // some other interest's own (later) backoff succeeds this signal instead of starting a
  // competing cycle, so the sleeping loop wakes immediately and can fold the new
  // interest's earlier due time into its next wait — rather than leaving it stranded
  // until whichever interest the cycle already knew about happens to become due.
  const recoveringOrganizations = new Map<string, Deferred.Deferred<void>>();
  const hydrations = new Map<string, RuntimeHydration>();
  const hydrationFailures = new Map<string, { readonly organizationKey: string; count: number }>();
  let receiptOrdinal = 0;
  let readStartOrdinal = 0;
  let dispatchOrdinal = 0;
  let receiverEpoch = 0;
  let interestEpoch = 0;
  let scheduleHydration: (query: QueryKey) => Effect.Effect<void> = () => Effect.void;
  let scheduleRecovery: (receiver: RuntimeReceiver, reason: string) => Effect.Effect<void> = () =>
    Effect.void;
  // Bounded, backoff-capped retry out of the `failed` interest state. Assigned once
  // `establishInterest` exists; referenced from both `establishInterest` and `scheduleRecovery`.
  let scheduleFailedRetry: (
    runtimeInterest: RuntimeInterest,
    identity: InterestIdentity,
    retryAtMs: number,
  ) => Effect.Effect<void> = () => Effect.void;

  let pendingPublication: ZeropsDataState | null = null;
  let publicationEvents = 0;
  const flushPublication = Effect.sync(() => {
    const next = pendingPublication;
    pendingPublication = null;
    publicationEvents = 0;
    if (next !== null) options.atomRegistry.set(rootAtom, next);
  });

  const publish = (next: ZeropsDataState, deferPublication = false): Effect.Effect<void> =>
    Ref.set(model, next).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (next.access !== logAccess) {
            logAccess = next.access;
            logs.reconcileAccess();
          }
          pendingPublication = next;
          publicationEvents += 1;
        }),
      ),
      Effect.andThen(deferPublication ? Effect.void : flushPublication),
    );

  const applyControl = (input: RuntimeControlInput): Effect.Effect<void> =>
    modelLock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(model);
        const reduction = reduceZeropsDataState(current, input, policy);
        if (reduction.state !== current) yield* publish(reduction.state);
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
        yield* flushPublication;
        yield* Deferred.succeed(input.deferred, undefined);
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
              // deserve a fresh set of hydration attempts rather than staying stuck.
              const organizationKey = organizationKeyOf(organizationOfInterest(owner.descriptor));
              for (const [entityKey, record] of hydrationFailures) {
                if (record.organizationKey === organizationKey) hydrationFailures.delete(entityKey);
              }
            }
          }
          if (reduction.state !== current)
            yield* publish(reduction.state, input.kind === "observation");
          return reduction.followUps;
        }),
      );
      yield* Effect.forEach(
        followUps,
        (followUp) =>
          followUp.kind === "hydrate-unresolved-query-members"
            ? scheduleHydration(followUp.query)
            : Effect.void,
        { discard: true },
      );
    });

  const markRecovering = (
    identity: InterestIdentity,
    reason: Extract<DesiredInterestState["interest"], { readonly status: "recovering" }>["reason"],
  ): Effect.Effect<void> =>
    modelLock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(model);
        const desired = current.interests.get(identity.key);
        if (desired === undefined || desired.interest.identity !== identity) return;
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

  yield* Effect.forever(
    Effect.gen(function* () {
      yield* applyIngress(yield* ingress.take);
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

  const awaitIngress = Effect.gen(function* () {
    const deferred = yield* Deferred.make<void>();
    const enqueued = yield* ingress.offerUncounted({ kind: "barrier", deferred, interest: null });
    if (enqueued) yield* Deferred.await(deferred);
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
          target.descriptor.kind === "services-of-project" ||
          target.descriptor.kind === "running-processes-of-project" ||
          target.descriptor.kind === "process-history-window")
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
              Effect.as(true),
            ),
          ),
          Effect.catch((error) =>
            enqueue({
              kind: "read-completion",
              completion: { kind: "read-failed", ticket, failure: failureKind(error) },
              interest: identity,
            }).pipe(Effect.as(false)),
          ),
        ),
      );
      if (parentSignal === undefined) return read;
      // Cancellation also removes work waiting for a read-concurrency slot.
      return Effect.raceFirst(
        read,
        Effect.callback<boolean>((resume) => {
          const abort = () => resume(Effect.succeed(false));
          if (parentSignal.aborted) abort();
          else parentSignal.addEventListener("abort", abort, { once: true });
          return Effect.sync(() => parentSignal.removeEventListener("abort", abort));
        }),
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
        if (
          hydrations.size >= policy.activeSharedReadsPerAccount ||
          (hydrationFailures.get(key)?.count ?? 0) >= policy.hydrationRetryLimit
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
        const work = hydrationSemaphore.withPermit(runRead(ticket, null)).pipe(
          Effect.flatMap((succeeded) =>
            awaitIngress.pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (succeeded) hydrationFailures.delete(key);
                  else
                    hydrationFailures.set(key, {
                      organizationKey: organizationKeyOf(organizationOfEntityRef(target)),
                      count: (hydrationFailures.get(key)?.count ?? 0) + 1,
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
          Effect.flatMap((succeeded) => (succeeded ? Effect.void : scheduleHydration(query))),
          forkOwned,
        );
        hydration.fiber = fiber;
      }
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
            ? null
            : (receiver.registrationOwners.get(event.subscriptionName) ?? null);
        return registration === null
          ? scheduleRecovery(receiver, "malformed receiver frame")
          : Effect.forEach(
              registration.dependents.values(),
              (identity) => markRecovering(identity, "malformed"),
              { discard: true },
            ).pipe(Effect.andThen(scheduleRecovery(receiver, "malformed receiver frame")));
      }
      return scheduleRecovery(receiver, event.reason);
    }).pipe(Effect.catch((error) => scheduleRecovery(receiver, error.message)));
  };

  const ensureReceiver = (receiver: RuntimeReceiver): Effect.Effect<ReceiverHandle, AdapterError> =>
    receiverLock.withPermit(
      Effect.gen(function* () {
        if (receiver.handle !== null) return receiver.handle;
        const handle = yield* context(policy.establishmentDeadlineMs, (requestContext) =>
          options.adapter
            .openReceiver(options.scope, receiver.organization, receiver.identity, requestContext)
            .pipe(Scope.provide(runtimeScope)),
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
          planned.descriptor.kind === "entity-updates"
            ? { ...base, descriptor: planned.descriptor, baselineTicket: null }
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

  const establishInterest = (runtimeInterest: RuntimeInterest): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (yield* Ref.get(closed)) return;
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
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0) return;
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
            const result = yield* context(policy.registrationDeadlineMs, (requestContext) =>
              options.adapter.register(handle, registration.request, requestContext),
            ).pipe(Effect.result);
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
              }).pipe(Effect.andThen(Deferred.interrupt(registration.outcome)), Effect.asVoid),
            ),
          );
        }
        const outcome = yield* Deferred.await(registration.outcome);
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0) return;
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
            return;
          }
          yield* scheduleRecovery(receiver, outcome.error.message);
          return;
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
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0) return;
        const ticket = yield* requestTicket(
          identity,
          target.kind === "query" ? "baseline" : "direct",
          target,
        );
        if (!(yield* admitRead(ticket))) return yield* Effect.fail(readCapacityError());
        const succeeded = yield* runRead(ticket, identity);
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0) return;
        if (!succeeded) {
          yield* scheduleRecovery(receiver, "required direct read failed");
          return;
        }
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(policy.establishmentDeadlineMs),
        orElse: () =>
          Effect.fail({
            _tag: "ZeropsDataAdapterError",
            kind: "timeout",
            message: "The interest establishment deadline expired.",
            retryable: true,
            accountRevocationEvidence: false,
          } satisfies AdapterError),
      }),
      Effect.catch((error: AdapterError) => {
        const receiver = receiverFor(organizationOfInterest(runtimeInterest.descriptor));
        return markRecovering(runtimeInterest.identity, "disconnect").pipe(
          Effect.andThen(scheduleRecovery(receiver, error.message)),
        );
      }),
    );

  scheduleRecovery = (receiver, reason) =>
    Effect.suspend(() => {
      const organizationKey = organizationKeyOf(receiver.organization);
      if (receivers.get(organizationKey) !== receiver) return Effect.void;
      const existingWake = recoveringOrganizations.get(organizationKey);
      if (existingWake !== undefined) {
        // A cycle for this organization is already running (asleep toward some other
        // interest's own backoff). Wake it so it recomputes the next due time from
        // current state — which by now includes whatever just called scheduleRecovery —
        // instead of competing with it or silently doing nothing.
        return Deferred.succeed(existingWake, undefined).pipe(Effect.asVoid);
      }
      recoveringOrganizations.set(organizationKey, Deferred.makeUnsafe<void>());

      // A genuine failure (the receiver itself, or an interest's own re-establishment
      // attempt) replaces the receiver and bumps `recoveryAttempts` for every interest
      // still sharing the organization. This must run only in response to an actual
      // failure — never merely because some other interest's own backoff hasn't elapsed —
      // so it is a plain callable, not something the wait loop below invokes on a timer.
      const prepareCycle = (
        staleReceiver: RuntimeReceiver,
        cycleReason: string,
      ): Effect.Effect<{
        readonly replacement: RuntimeReceiver;
        readonly hidden: boolean;
        readonly minRecoveringRetryAtMs: number | null;
      } | null> =>
        lifecycleLock.withPermit(
          Effect.gen(function* () {
            if ((yield* Ref.get(closed)) || receivers.get(organizationKey) !== staleReceiver)
              return null;
            const affected = [...interests.values()].filter(
              (interest) =>
                organizationKeyOf(organizationOfInterest(interest.descriptor)) ===
                  organizationKey && interest.leases.size > 0,
            );
            if (affected.length === 0) return null;

            const hidden = (yield* Ref.get(currentVisibility)) === "hidden";
            const replacement = makeReceiver(staleReceiver.organization);
            receivers.set(organizationKey, replacement);
            const recoveryReason = cycleReason.includes("overflow")
              ? "overflow"
              : cycleReason.includes("malformed")
                ? "malformed"
                : cycleReason.includes("registration")
                  ? "registration"
                  : "disconnect";
            const now = yield* Clock.currentTimeMillis;
            // Per-interest, not the max across all affected: an interest at its 5th attempt
            // must not force every other interest of the organization onto its own backoff
            // ceiling.
            let minRecoveringRetryAtMs: number | null = null;
            const failedRetries: Array<{
              readonly interest: RuntimeInterest;
              readonly identity: InterestIdentity;
              readonly retryAtMs: number;
            }> = [];
            for (const interest of affected) {
              interest.recoveryAttempts += 1;
              const desired = yield* updateInterestIdentity(interest, replacement);
              const progress =
                desired.interest.status === "establishing"
                  ? desired.interest.progress
                  : {
                      requiredRegistrations: 0,
                      completedRegistrations: 0,
                      requiredReads: 0,
                      completedReads: 0,
                      crossedReceiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
                    };
              yield* applyControl({
                kind: "interest-upserted",
                interest: hidden
                  ? {
                      ...desired,
                      interest: {
                        status: "paused",
                        identity: interest.identity,
                        reason: "background",
                      },
                    }
                  : interest.recoveryAttempts > policy.recoveryAttemptLimit
                    ? (() => {
                        const retryAtMs =
                          now +
                          Math.min(
                            policy.recoveryBackoffStartMs *
                              2 ** Math.max(0, interest.recoveryAttempts - 1),
                            policy.recoveryBackoffMaxMs,
                          );
                        failedRetries.push({ interest, identity: interest.identity, retryAtMs });
                        return {
                          ...desired,
                          interest: {
                            status: "failed" as const,
                            identity: interest.identity,
                            reason: cycleReason,
                            retryable: true,
                            attempts: interest.recoveryAttempts,
                            retryAtMs,
                          },
                        };
                      })()
                    : (() => {
                        const nextRetryAtMs =
                          now +
                          Math.min(
                            policy.recoveryBackoffStartMs *
                              2 ** Math.max(0, interest.recoveryAttempts - 1),
                            policy.recoveryBackoffMaxMs,
                          );
                        minRecoveringRetryAtMs =
                          minRecoveringRetryAtMs === null
                            ? nextRetryAtMs
                            : Math.min(minRecoveringRetryAtMs, nextRetryAtMs);
                        return {
                          ...desired,
                          interest: {
                            status: "recovering" as const,
                            identity: interest.identity,
                            reason: recoveryReason,
                            attempt: interest.recoveryAttempts,
                            nextRetryAtMs,
                            progress,
                          },
                        };
                      })(),
              });
            }
            if (staleReceiver.handle !== null)
              yield* options.adapter.closeReceiver(staleReceiver.handle);
            yield* Effect.forEach(
              failedRetries,
              ({ interest, identity, retryAtMs }) =>
                scheduleFailedRetry(interest, identity, retryAtMs),
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
            return { replacement, hidden, minRecoveringRetryAtMs };
          }),
        );

      return Effect.gen(function* () {
        let prepared = yield* prepareCycle(receiver, reason);
        // Wait out each interest's own backoff in turn, retrying only interests that are
        // actually due. A receiver replacement (and the attempt/backoff bump that comes
        // with it) happens only when a retried interest actually fails again — never
        // merely because a sibling interest simply isn't due yet. That keeps a
        // fast-failing interest from forcing every other interest of the organization
        // through a fresh receiver churn while it waits its own turn.
        while (prepared !== null && !prepared.hidden && prepared.minRecoveringRetryAtMs !== null) {
          const currentReplacement = prepared.replacement;
          // A fresh wake signal for this iteration: a sibling interest failing while this
          // sleep is in progress succeeds it (see the guard above), waking this loop
          // immediately instead of leaving the new interest stranded until whichever
          // interest this iteration's own sleep target was computed from becomes due.
          const iterationWake = Deferred.makeUnsafe<void>();
          recoveringOrganizations.set(organizationKey, iterationWake);
          const beforeSleep = yield* Clock.currentTimeMillis;
          yield* Effect.raceFirst(
            Effect.sleep(
              Duration.millis(Math.max(0, prepared.minRecoveringRetryAtMs - beforeSleep)),
            ),
            Deferred.await(iterationWake),
          );
          const now2 = yield* Clock.currentTimeMillis;
          const retryable = yield* lifecycleLock.withPermit(
            Effect.gen(function* () {
              if (
                (yield* Ref.get(closed)) ||
                (yield* Ref.get(currentVisibility)) === "hidden" ||
                receivers.get(organizationKey) !== currentReplacement
              )
                return [];
              const state = yield* Ref.get(model);
              return [...interests.values()].filter((interest) => {
                const desired = state.interests.get(interest.key);
                return (
                  interest.leases.size > 0 &&
                  organizationKeyOf(organizationOfInterest(interest.descriptor)) ===
                    organizationKey &&
                  interest.identity.receiver.receiverId ===
                    currentReplacement.identity.receiverId &&
                  desired?.interest.status === "recovering" &&
                  // Honour this interest's own backoff: one interest becoming due does not
                  // pull forward another interest whose own nextRetryAtMs hasn't elapsed.
                  desired.interest.nextRetryAtMs <= now2
                );
              });
            }),
          );
          if (
            (yield* Ref.get(closed)) ||
            (yield* Ref.get(currentVisibility)) === "hidden" ||
            receivers.get(organizationKey) !== currentReplacement
          ) {
            // Something else (background pause, shutdown, or a concurrent
            // overflow/malformed-frame signal) already replaced or paused this
            // organization's receiver; let whichever cycle owns that own recovery.
            prepared = null;
            break;
          }
          for (const interest of retryable) {
            yield* establishInterest(interest);
          }
          if (retryable.length > 0) yield* awaitIngress;
          if (receivers.get(organizationKey) !== currentReplacement) {
            prepared = null;
            break;
          }
          const settled = yield* Ref.get(model);
          // Did any interest we just retried fail again? That is the one case that
          // legitimately re-runs the full prepare (bump attempts, maybe replace the
          // receiver) — never a sibling interest that simply wasn't due this round, and
          // never a wake that fired before anything was actually due yet.
          const failedAgain = retryable.some(
            (interest) => settled.interests.get(interest.key)?.interest.status === "recovering",
          );
          if (failedAgain) {
            prepared = yield* prepareCycle(currentReplacement, reason);
            continue;
          }
          let nextWakeMs: number | null = null;
          for (const interest of interests.values()) {
            if (interest.leases.size === 0) continue;
            if (organizationKeyOf(organizationOfInterest(interest.descriptor)) !== organizationKey)
              continue;
            if (interest.identity.receiver.receiverId !== currentReplacement.identity.receiverId)
              continue;
            const desired = settled.interests.get(interest.key);
            if (desired?.interest.status !== "recovering") continue;
            nextWakeMs =
              nextWakeMs === null
                ? desired.interest.nextRetryAtMs
                : Math.min(nextWakeMs, desired.interest.nextRetryAtMs);
          }
          prepared = {
            replacement: currentReplacement,
            hidden: false,
            minRecoveringRetryAtMs: nextWakeMs,
          };
        }
      }).pipe(
        Effect.ensuring(Effect.sync(() => recoveringOrganizations.delete(organizationKey))),
        forkOwned,
        Effect.asVoid,
      );
    });

  scheduleFailedRetry = (runtimeInterest, identity, retryAtMs) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.sleep(Duration.millis(Math.max(0, retryAtMs - now)));
      if (yield* Ref.get(closed)) return;
      if (runtimeInterest.leases.size === 0) return;
      if (runtimeInterest.identity !== identity) return;
      if ((yield* Ref.get(currentVisibility)) === "hidden") return;
      const state = yield* Ref.get(model);
      const desired = state.interests.get(identity.key);
      if (desired === undefined || desired.interest.status !== "failed") return;
      runtimeInterest.recoveryAttempts = 0;
      yield* establishInterest(runtimeInterest);
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
      const now = yield* Clock.currentTimeMillis;
      if (state.access.status === "verified" && state.access.deadlineMs <= now) {
        yield* enqueue({
          kind: "access-observation",
          observation: {
            kind: "access-expired",
            accountEpoch: options.scope.epoch,
            expiredAtMs: now,
          },
          interest: null,
        });
        yield* awaitIngress;
      }
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
      const replacements = new Map<string, RuntimeReceiver>();
      for (const runtimeInterest of toResume) {
        const organization = organizationOfInterest(runtimeInterest.descriptor);
        const organizationKey = organizationKeyOf(organization);
        let receiver = replacements.get(organizationKey);
        if (receiver === undefined) {
          receiver = makeReceiver(organization);
          replacements.set(organizationKey, receiver);
          receivers.set(organizationKey, receiver);
        }
        const desired = yield* updateInterestIdentity(runtimeInterest, receiver);
        yield* applyControl({ kind: "interest-upserted", interest: desired });
      }
      yield* Effect.forEach(
        toResume,
        (runtimeInterest) => establishInterest(runtimeInterest).pipe(forkOwned),
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

  const acquire: ZeropsDataRuntime["acquire"] = (descriptor) =>
    Effect.gen(function* () {
      const leaseScope = yield* Scope.Scope;
      return yield* lifecycleLock.withPermit(
        Effect.gen(function* () {
          if (yield* Ref.get(closed)) {
            return yield* Effect.fail(
              leaseError("runtime-closed", "The Zerops account data runtime is closed."),
            );
          }
          if (
            !accountRefsEqual(organizationOfInterest(descriptor).account, options.scope.account)
          ) {
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
                leaseError(
                  "receiver-capacity",
                  "The organization receiver interest budget is full.",
                ),
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
              required: descriptor.kind !== "project-current-metrics",
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
            yield* establishInterest(runtimeInterest).pipe(forkOwned);
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
              yield* establishInterest(runtimeInterest).pipe(forkOwned);
            }
          }
          const release = releaseLease(leaseId);
          yield* Scope.addFinalizer(leaseScope, release);
          return {
            leaseId: ZeropsLeaseId.make(leaseId),
            interest: key,
            release,
          } satisfies InterestLease;
        }),
      );
    });

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
    commandSemaphore.withPermit(
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
        const outcome = yield* context(policy.httpDeadlineMs, (requestContext) =>
          options.adapter.execute(command, {
            ...requestContext,
            beforeProjectWrite: () =>
              Effect.runPromiseWith(runtimeContext)(checkCommandAdmission(command)),
          }),
        ).pipe(Effect.result);
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
        } else if (command.kind === "create-project-with-mate" && result?.kind === command.kind) {
          createdProject = {
            kind: "project",
            organization: command.organization,
            projectId: ZeropsProjectId.make(result.value.project.id),
          };
        } else if (command.kind === "create-tool-project" && result?.kind === command.kind) {
          createdProject = {
            kind: "project",
            organization: command.organization,
            projectId: ZeropsProjectId.make(result.value.project.id),
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
    nameProjectAgent: (project, name) =>
      runCommand({ kind: "name-project-agent", project, name }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "name-project-agent"
            ? Effect.succeed({ attempt, value: result.value })
            : Effect.fail(missingCommandResult()),
        ),
      ),
    updateProjectGroupTags: (project, next) =>
      runCommand({ kind: "update-project-group-tags", project, next }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "update-project-group-tags"
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
    createProjectWithMate: (input) =>
      runCommand({ kind: "create-project-with-mate", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "create-project-with-mate"
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
    createToolProject: (input) =>
      runCommand({ kind: "create-tool-project", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "create-tool-project"
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
  };

  const observeAccess = (observation: AccessObservation): Effect.Effect<void> =>
    enqueue({ kind: "access-observation", observation, interest: null }).pipe(
      Effect.andThen(awaitIngress),
      Effect.andThen(resources.reconcileAccess),
    );

  const shutdown: ZeropsDataRuntime["shutdown"] = (_reason) =>
    lifecycleLock.withPermit(
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return;
        // Fence publication and clear grants/model first; transport finalizers run afterward.
        yield* Ref.set(closed, true);
        yield* applyControl({ kind: "runtime-closed" });
        yield* ingress.shutdown;
        yield* resources.shutdown;
        logs.shutdown();
        yield* Scope.close(runtimeScope, Exit.void);
        interests.clear();
        leases.clear();
        receivers.clear();
        recoveringOrganizations.clear();
        hydrations.clear();
        hydrationFailures.clear();
      }),
    );

  return {
    scope: options.scope,
    reads: atoms.reads,
    commands,
    resources,
    logs,
    acquire,
    shutdown,
    state: Ref.get(model),
    stateAtom: rootAtom,
    ingress: ingress.snapshot,
    observeAccess,
  } satisfies ManagedZeropsDataRuntime;
});
