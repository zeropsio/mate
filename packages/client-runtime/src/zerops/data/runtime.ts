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
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { InvalidationBus } from "../knowledge/invalidation.ts";
import {
  doublingLadder,
  onLastRung,
  rungMs,
  soonerJittered,
  type RetryLadder,
} from "../knowledge/retryPolicy.ts";
import { makeGrantDriver, type ZeropsAccessGrant } from "./access/grantDriver.ts";
import { bridgedServicesOf, createZeropsDataAtoms } from "./atoms.ts";
import type { ServiceDeployObserved } from "./deployedVersion.ts";
import { grantCapabilities } from "./access/capabilities.ts";
import { commandAdmissionError, commandTarget } from "./commands.ts";
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
  ServiceRef,
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
  ZeropsRequestId,
  ZeropsSharedReadId,
  ZeropsWireSubscriptionName,
  organizationKeyOf,
  entityKeyOf,
  projectKeyOf,
  queryKeyOf,
} from "./types.ts";
import {
  serviceVariablesDescriptor,
  TABLE_READ_RETRY_MS,
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

/** The organization a read asks of, for its Retry-After. */
function organizationOfReadTarget(target: ReadTarget): OrganizationRef | null {
  if (target.kind !== "query") return organizationOfEntityRef(target.ref);
  const descriptor = target.descriptor as {
    readonly organization?: OrganizationRef;
    readonly project?: ProjectRef;
  };
  return descriptor.organization ?? descriptor.project?.organization ?? null;
}

function entityIdOf(ref: ReadEntityRef): string {
  return ref.kind === "project" ? ref.projectId : ref.serviceId;
}

function organizationOfEntityRef(ref: ReadEntityRef): OrganizationRef {
  return ref.kind === "project" ? ref.organization : ref.project.organization;
}

/** The entities the runtime reads: projects and their services. */
type ReadEntityRef = ProjectRef | ServiceRef;

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
      return InterestKeySchema.make(
        JSON.stringify([descriptor.kind, organizationKeyOf(descriptor.organization)]),
      );
    case "project-variables":
      return InterestKeySchema.make(
        JSON.stringify([
          descriptor.kind,
          projectKeyOf(descriptor.project),
          [...descriptor.serviceIds].sort(),
        ]),
      );
    case "project-topology":
      return InterestKeySchema.make(
        JSON.stringify([descriptor.kind, projectKeyOf(descriptor.project)]),
      );
    case "project-inventory":
    case "project-record":
    case "project-access":
      return InterestKeySchema.make(
        JSON.stringify([descriptor.kind, projectKeyOf(descriptor.project)]),
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
 * discarded, so callers can publish failure before losing data.
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
 * An interest that registers and reads nothing of its own: a project's access (the grant's), the
 * organization's inventory, whose projects are the account store's — it holds the organization
 * for its projects' reads — and a project's inventory or topology, whose services are the account
 * store's too (`data/families/service.ts`): they hold the project for its variables', versions'
 * and metrics' reads. It observes from the moment it is held.
 */
const readsNothing = (
  descriptor: RuntimeInterestDescriptor,
): descriptor is Extract<
  RuntimeInterestDescriptor,
  {
    readonly kind:
      | "organization-inventory"
      | "project-access"
      | "project-inventory"
      | "project-topology";
  }
> =>
  descriptor.kind === "organization-inventory" ||
  descriptor.kind === "project-access" ||
  descriptor.kind === "project-inventory" ||
  descriptor.kind === "project-topology";

/**
 * What an interest registers and reads: detail registrations, baselines and direct anchors use the
 * opened project; service metadata uses its service IDs. Equal descriptors share work.
 */
export function planZeropsInterest(descriptor: RuntimeInterestDescriptor): InterestPlan {
  const organization = organizationOfInterest(descriptor);
  const table = (query: TableQueryDescriptor): ReadonlyArray<PlannedRegistration> => [
    {
      descriptor: {
        kind: "table-updates",
        entity: "user-data",
        organization,
        serviceIds: query.serviceIds,
      },
      baseline: null,
    },
    { descriptor: { kind: "table-list", query }, baseline: { kind: "query", descriptor: query } },
  ];
  if (descriptor.kind === "project-variables") {
    return {
      registrations: table(serviceVariablesDescriptor(organization, descriptor.serviceIds)),
      directReads: [],
    };
  }
  // The organization's projects and services are the account store's (`data/families/`): these
  // read none of their own.
  if (readsNothing(descriptor)) return { registrations: [], directReads: [] };
  return {
    registrations: [
      { descriptor: { kind: "entity-updates", entity: "project", organization }, baseline: null },
    ],
    directReads: [{ kind: "project", ref: descriptor.project }],
  };
}

/** How long an id a table is owed waits for its own update frame before it is read. */
const TABLE_READ_GRACE_MS = 1_000;
/** The most ids one table read names. */
const TABLE_READ_BATCH = 500;

function registrationKeyOf(descriptor: RegistrationDescriptor): string {
  if (descriptor.kind === "entity-updates" || descriptor.kind === "table-updates")
    return JSON.stringify([
      descriptor.kind,
      descriptor.entity,
      organizationKeyOf(descriptor.organization),
      "project" in descriptor
        ? projectKeyOf(descriptor.project)
        : descriptor.kind === "table-updates"
          ? [...descriptor.serviceIds].sort()
          : null,
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

type EstablishmentOutcome =
  /** Its registrations and reads completed, or it was superseded or released before they did. */
  | { readonly kind: "done" }
  /** It failed alone; its siblings can keep observing until an explicit manual attempt. */
  | { readonly kind: "interest-failed" }
  /** The receiver failed under it; a manual attempt replaces it. */
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
  /** Its failed re-establishments in a row: the rung of its next retry (`scheduleInterestRetries`). */
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
  awaitingAnswer: boolean;
  /** The platform answered it with a refusal: nothing was subscribed. */
  refused: boolean;
}

interface RuntimeReceiver {
  readonly key: string;
  readonly organization: OrganizationRef;
  readonly identity: ReceiverIdentity;
  handle: ReceiverHandle | null;
  /** The last physical attempt; recovery replaces it after closing its registrations. */
  openFailure: AdapterError | null;
  failed: boolean;
  reconnectFailures: number;
  reconnectAtMs: number | null;
  readonly stopped: Latch.Latch;
  reconnectFiber: Fiber.Fiber<void> | null;
  readonly registrations: Map<string, RuntimeRegistration>;
  readonly registrationOwners: Map<string, RuntimeRegistration>;
  registrationAttempts: number;
  /** Attempts dropped that never held a subscription: refused, or never sent. */
  neverSubscribed: number;
}

interface RuntimeHydration {
  readonly target: ReadEntityRef;
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
  /** The jitter source of every backoff: a retry comes up to `RETRY_JITTER` of its wait sooner. */
  readonly random?: () => number;
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
  readServiceMateFlag: unavailableResource,
};

function registrationInterest(observation: PlatformObservation): InterestIdentity | null {
  if (observation.kind === "query-membership-observed") return observation.registration.identity;
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
 * A registration the platform refused with an HTTP error status never took effect: the receiver
 * holds no subscription for it. A definitive refusal stays scoped until manual refresh. One that got
 * no answer, or an answer that could not be read, may have left a subscription nobody owns.
 */
const canReconnect = (error: AdapterError): boolean =>
  error.retryable &&
  !error.accountRevocationEvidence &&
  ![
    "unauthorized",
    "forbidden",
    "not-found",
    "rejected",
    "cancelled",
    "overflow",
    "incomplete",
  ].includes(error.kind) &&
  (error.status === undefined ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500);

/**
 * How a failed hydration is retried: an entity the platform says is not there for this account
 * (403, 404, 410) is `gone` until a person's again; a 429 is `throttled` and
 * waits its Retry-After; anything else (a 5xx, the network, an answer without it) backs off.
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

/**
 * A failure no timer repairs: the platform refused (400/401/403/404/410, or said so outright).
 * Only a person's again sends it again.
 */
const permanentFailure = (error: AdapterError | null): boolean =>
  error !== null &&
  (!error.retryable ||
    ["unauthorized", "forbidden", "not-found", "rejected"].includes(error.kind) ||
    [400, 401, 403, 404, 410].includes(error.status ?? 0));

const registrationRefused = (error: AdapterError): boolean =>
  error.status !== undefined && !canReconnect(error);

/**
 * A shared registration its sender abandoned in flight — its establishment ran out of time, or it
 * went. Close that receiver before recovering: its subscription may still exist remotely.
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
  const random = options.random ?? Math.random;
  /** A wait made up to a fifth shorter, so tabs and entities that failed together part. */
  const jittered = (ms: number): number => soonerJittered(ms, random());
  /**
   * The recovery's ladders (`retryPolicy.ts`): an entity's hydration doubles to the cap within
   * `hydrationRetryLimit` failures, an interest's past `recoveryAttemptLimit`; each stays there.
   */
  const hydrationLadder: RetryLadder = doublingLadder(
    policy.recoveryBackoffStartMs,
    policy.recoveryBackoffMaxMs,
    policy.hydrationRetryLimit,
  );
  const recoveryLadder: RetryLadder = doublingLadder(
    policy.recoveryBackoffStartMs,
    policy.recoveryBackoffMaxMs,
    policy.recoveryAttemptLimit + 1,
  );
  /**
   * Until when each organization's reads, or its socket, wait out a 429's Retry-After: every
   * request of that kind holds, not only the one the platform answered.
   */
  const throttles = new Map<string, number>();
  const throttleKey = (organization: OrganizationRef, kind: "read" | "socket") =>
    `${organizationKeyOf(organization)}:${kind}`;
  const throttledUntil = (organization: OrganizationRef, kind: "read" | "socket"): number =>
    throttles.get(throttleKey(organization, kind)) ?? 0;
  const throttle = (
    organization: OrganizationRef | null,
    kind: "read" | "socket",
    error: AdapterError | null,
    nowMs: number,
  ): void => {
    if (organization === null || error?.status !== 429) return;
    const until = nowMs + (error.retryAfterMs ?? policy.recoveryBackoffStartMs);
    const key = throttleKey(organization, kind);
    throttles.set(key, Math.max(throttles.get(key) ?? 0, until));
  };
  /** Each interest's own Retry-After, from the failure its retry answers. */
  const interestRetryAfter = new Map<InterestKey, number>();
  const model = yield* Ref.make(
    makeInitialZeropsDataState(options.scope, options.initialAccess ?? { status: "unverified" }),
  );
  const cells = yield* makeZeropsCells({
    scope: options.scope,
    adapter: options.adapter.cells ?? unavailableCellAdapter,
    access: () => Ref.getUnsafe(model).access,
    maxEntries: policy.activeSharedReadsPerAccount,
    // A failed cell's retry waits while the tab is hidden; the visible wake below reads it.
    visible: () => Ref.getUnsafe(currentVisibility) === "visible",
  });
  const clock = yield* Clock.Clock;
  /** The access the cells were last reconciled with. */
  let reconciledAccess = Ref.getUnsafe(model).access;
  const runtimeScope = yield* Scope.make();
  // Demand arrives from independently run UI effects; workers retain the account clock and scheduler.
  const forkOwned = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.forkIn(runtimeScope),
      Effect.provideService(Clock.Clock, clock),
      Effect.provideService(Scheduler.Scheduler, scheduler),
    );
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
  const registrationPermits = yield* Semaphore.make(policy.registrationConcurrency);
  const commandSemaphore = yield* Semaphore.make(1);
  const rootAtom = Atom.make(yield* Ref.get(model));
  const unmountRootAtom = options.atomRegistry.mount(rootAtom);
  yield* Scope.addFinalizer(runtimeScope, Effect.sync(unmountRootAtom));
  const atoms = createZeropsDataAtoms(rootAtom);
  const interests = new Map<InterestKey, RuntimeInterest>();
  const leases = new Map<string, RuntimeInterest>();
  const receivers = new Map<string, RuntimeReceiver>();
  const hydrations = new Map<string, RuntimeHydration>();
  /**
   * Each entity's failed hydrations, and when the next may start: on the recovery backoff within
   * `hydrationRetryLimit`, then its cap, then a fresh budget, never given up while a lease holds
   * it. Relevant native evidence, a visible wake or a person's again lets it read at once.
   */
  const hydrationAttempts = new Map<
    string,
    {
      readonly target: ReadEntityRef;
      readonly query: QueryKey;
      count: number;
      retryAtMs: number;
      refusal: HydrationRefusal;
    }
  >();
  /** Interests a failed read (hydration or metadata) marked failed, and the reads still failing. */
  const readFailures = new Map<
    InterestKey,
    { readonly identity: InterestIdentity; readonly keys: Set<string> }
  >();
  /** Interest failures of their own whose retry the runtime owns (`scheduleInterestRetries`). */
  const interestRetries = new Map<
    InterestKey,
    { readonly identity: InterestIdentity; readonly dueAtMs: number; readonly spent: boolean }
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
  let failReceiver: (
    receiver: RuntimeReceiver,
    reason: string,
    error?: AdapterError,
  ) => Effect.Effect<void> = () => Effect.void;
  let failInterest: (
    identity: InterestIdentity,
    message: string,
    error: AdapterError | null,
  ) => Effect.Effect<void> = () => Effect.void;
  let requestInterestRetries: Effect.Effect<void> = Effect.void;
  let rotateReceiver: (
    receiver: RuntimeReceiver,
    include: ReadonlySet<InterestKey>,
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
   * Every change of access reaches the cells, whatever made it. The
   * atoms hear the change now, after the task, or when the ingress loop flushes its batch.
   */
  /** A held interest failed on its own and retryable, whose retry nobody has scheduled yet. */
  const awaitsInterestRetry = (state: ZeropsDataState): boolean => {
    for (const runtimeInterest of interests.values()) {
      if (runtimeInterest.leases.size === 0) continue;
      const failed = state.interests.get(runtimeInterest.key)?.interest;
      if (failed?.status === "failed" && failed.retryable && failed.retryAtMs === null) return true;
    }
    return false;
  };

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
          // A failure the reducer or an establishment published retries on its own backoff.
          const retry = awaitsInterestRetry(next) ? requestInterestRetries : Effect.void;
          if (next.access === reconciledAccess) return retry;
          reconciledAccess = next.access;
          return Effect.andThen(retry, cells.reconcileAccess);
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
            receivers.get(receiver.key) !== receiver ||
            receiver.registrations.get(registration.key) !== registration ||
            receiver.failed
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
          if (reduction.state !== current) {
            if (input.kind === "observation" && stamped.kind === "observation") {
              const observation = stamped.observation.input;
              if (observation.kind === "query-membership-observed") {
                hydrationAttempts.delete(entityKeyOf(observation.member));
              } else if (
                "ref" in observation &&
                "observation" in observation &&
                observation.observation.source === "native-push"
              ) {
                hydrationAttempts.delete(entityKeyOf(observation.ref));
              }
            }
            yield* publish(reduction.state, input.kind === "observation" ? "ingress-batch" : "now");
          }
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

  const failInterruptedInterest = (
    identity: InterestIdentity,
    reason: string,
  ): Effect.Effect<void> =>
    modelLock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(model);
        const desired = current.interests.get(identity.key);
        if (desired === undefined || desired.interest.identity !== identity) return;
        if (desired.interest.status === "paused") return;
        yield* publish(
          reduceZeropsDataState(
            current,
            {
              kind: "interest-upserted",
              interest: {
                ...desired,
                interest: {
                  status: "failed",
                  identity,
                  reason,
                  attempts: 1,
                  retryable: false,
                  retryAtMs: null,
                },
              },
            },
            policy,
          ).state,
        );
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

  const failOverflow = (input: RuntimeIngressInput): Effect.Effect<void> =>
    Effect.gen(function* () {
      const identities = yield* overflowIdentities(input);
      const affectedReceivers = new Map<string, RuntimeReceiver>();
      for (const identity of identities) {
        yield* failInterruptedInterest(identity, "overflow");
        const runtimeInterest = interests.get(identity.key);
        if (runtimeInterest === undefined) continue;
        const key = receiverKeyOf(runtimeInterest.descriptor);
        const receiver = receivers.get(key);
        if (receiver !== undefined) affectedReceivers.set(key, receiver);
      }
      yield* Effect.forEach(
        affectedReceivers.values(),
        (receiver) => failReceiver(receiver, "ingress overflow", readCapacityError()),
        { discard: true },
      );
    });

  const ingress = yield* makeZeropsBoundedIngress<RuntimeIngressInput>({
    maxEvents: policy.ingressMaxEventsPerAccount,
    maxBytes: policy.ingressMaxBytesPerAccount,
    maxFrameBytes: policy.ingressMaxFrameBytes,
    onOverflow: failOverflow,
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

  const makeReceiver = (organization: OrganizationRef, key: string): RuntimeReceiver => {
    receiverEpoch += 1;
    return {
      key,
      organization,
      identity: {
        accountEpoch: options.scope.epoch,
        receiverEpoch: ReceiverEpoch.make(receiverEpoch),
        receiverId: ZeropsReceiverId.make(options.makeOpaqueId()),
      },
      handle: null,
      openFailure: null,
      failed: false,
      reconnectFailures: 0,
      reconnectAtMs: null,
      stopped: Latch.makeUnsafe(false),
      reconnectFiber: null,
      registrations: new Map(),
      registrationOwners: new Map(),
      registrationAttempts: 0,
      neverSubscribed: 0,
    };
  };

  /** One socket per organization carries navigation and every opened project's subscriptions. */
  const receiverKeyOf = (descriptor: RuntimeInterestDescriptor): string =>
    organizationKeyOf(organizationOfInterest(descriptor));
  const receiverFor = (descriptor: RuntimeInterestDescriptor): RuntimeReceiver => {
    const key = receiverKeyOf(descriptor);
    const existing = receivers.get(key);
    if (existing !== undefined) return existing;
    const created = makeReceiver(organizationOfInterest(descriptor), key);
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
        interest: readsNothing(runtimeInterest.descriptor)
          ? {
              status: "observing",
              identity,
              guarantee: "source-order-unverified",
              sinceReceiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
            }
          : {
              status: "establishing",
              identity,
              startedAtMs: now,
              deadlineMs: now + policy.establishmentDeadlineMs,
              progress: {
                requiredRegistrations: plan.registrations.length,
                completedRegistrations: 0,
                requiredReads:
                  plan.directReads.length +
                  plan.registrations.filter((registration) => registration.baseline !== null)
                    .length,
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
          target.descriptor.kind === "service-variables-of-services")
          ? {
              ...base,
              kind: kind as "baseline",
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

  /** One read attempt and its adapter error. */
  const runReadOutcome = (
    ticket: ReadTicket,
    identity: InterestIdentity | null,
  ): Effect.Effect<{
    readonly succeeded: boolean;
    readonly error: AdapterError | null;
  }> =>
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
            Clock.currentTimeMillis.pipe(
              Effect.tap((now) =>
                Effect.sync(() =>
                  throttle(organizationOfReadTarget(ticket.target), "read", error, now),
                ),
              ),
              Effect.andThen(
                enqueue({
                  kind: "read-completion",
                  completion: { kind: "read-failed", ticket, failure: failureKind(error) },
                  interest: identity,
                }),
              ),
              Effect.as({ succeeded: false, error }),
            ),
          ),
        ),
      );
      if (parentSignal === undefined) return read;
      // Cancellation also removes work waiting for a read-concurrency slot.
      return Effect.raceFirst(
        read,
        Effect.callback<{
          readonly succeeded: boolean;
          readonly error: AdapterError | null;
        }>((resume) => {
          const abort = () => resume(Effect.succeed({ succeeded: false, error: null }));
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

  const unresolvedRefs = (
    state: ZeropsDataState,
    query: QueryKey,
  ): ReadonlyArray<ReadEntityRef> => {
    const inventoryQuery = state.inventory.queries.get(query);
    if (inventoryQuery === undefined) return [];
    return inventoryQuery.unresolvedMemberKeys.flatMap((key) => {
      const ref = state.inventory.memberRefs.get(key);
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
      // One loop per kind and organization: it reads what is due, batched, at most once a grace,
      // and ends when nothing is owed. Ids that arrive while a batch reads, or past its cap, are
      // read by the next round; one that arrives while the loop sleeps wakes it. A row found
      // absent waits its back-off, and a failed read its retry (`entityTable.ts`), never a loop.
      const read = Effect.gen(function* () {
        let lastReadAt = yield* Clock.currentTimeMillis;
        while (true) {
          const before = yield* Clock.currentTimeMillis;
          const eligible = [...interests.values()].filter(
            (interest) =>
              interest.leases.size > 0 &&
              interest.descriptor.kind === "project-variables" &&
              organizationKeyOf(interest.descriptor.project.organization) === organizationKey &&
              receivers.get(receiverKeyOf(interest.descriptor))?.openFailure === null,
          );
          const dependents = new Map(eligible.map((interest) => [interest.key, interest.identity]));
          if (dependents.size === 0) return;
          const serviceIds = [
            ...new Set(
              eligible.flatMap((interest) =>
                "serviceIds" in interest.descriptor ? interest.descriptor.serviceIds : [],
              ),
            ),
          ];
          const owed = [...(yield* Ref.get(model)).table.wanted.values()].filter(
            (wanted) =>
              wanted.entity === followUp.entity &&
              organizationKeyOf(wanted.organization) === organizationKey &&
              wanted.serviceIds.some((id) => serviceIds.includes(id)),
          );
          if (owed.length === 0) return;
          // A grace after the last read and after the first id came due, so ids that arrive
          // together are read together; every bound is absolute, so a wake never postpones it.
          const dueAtMs = Math.min(...owed.map((wanted) => wanted.dueAtMs));
          const readAt = Math.max(
            lastReadAt + TABLE_READ_GRACE_MS,
            dueAtMs + TABLE_READ_GRACE_MS,
            throttledUntil(followUp.organization, "read"),
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
          // Nothing is read while the tab is hidden: the visible wake starts the loop again.
          if ((yield* Ref.get(closed)) || (yield* Ref.get(currentVisibility)) === "hidden") return;
          const now = yield* Clock.currentTimeMillis;
          const ids = tableRowsDue(
            (yield* Ref.get(model)).table,
            followUp.entity,
            followUp.organization,
            now,
            serviceIds,
          ).slice(0, TABLE_READ_BATCH);
          if (ids.length === 0) continue;
          const list = serviceVariablesDescriptor(followUp.organization, serviceIds);
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
          const outcome = admitted
            ? yield* runReadOutcome(ticket, null)
            : { succeeded: false, error: readCapacityError() };
          if (admitted) yield* awaitIngress;
          yield* applyControl({ kind: "shared-read-released", requestId: ticket.requestId });
          lastReadAt = yield* Clock.currentTimeMillis;
          if (!admitted) {
            yield* Effect.forEach(
              eligible,
              (interest) => {
                const receiver = receivers.get(receiverKeyOf(interest.descriptor));
                return receiver === undefined
                  ? Effect.void
                  : failReceiver(receiver, "The account read queue is full.", readCapacityError());
              },
              { discard: true },
            );
            return;
          }
          // A failed read is said where it is drawn, with its retry; the next success lifts it.
          if (outcome.succeeded) {
            yield* reviveRead(key);
          } else {
            const failed = [...dependents.values()];
            yield* failInterests(
              failed,
              `Service metadata unavailable for ${ids.join(", ")}. ${outcome.error?.message ?? "The platform did not return these records."} Read again.`,
              false,
              { retryAtMs: lastReadAt + TABLE_READ_RETRY_MS, attempts: 1, retryable: true },
            );
            markReadFailed(failed, key);
          }
        }
      });
      yield* read.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (tableReads.get(key) === loop) tableReads.delete(key);
          }),
        ),
        forkOwned,
      );
    });

  /**
   * The queries whose hydration waits for an organization's Retry-After, read once it passes. A
   * hold that ends while the tab is hidden leaves its queries for the visible wake.
   */
  const throttledQueries = new Map<string, Set<QueryKey>>();
  const heldPastHidden = new Set<QueryKey>();
  /**
   * The entities a hold keeps from their first read: their interests read as failed until it
   * passes, so a missing list is said, not silent. Their read's answer lifts it (`reviveRead`), or
   * the hold's end when nothing is left to read.
   */
  const heldReads = new Set<string>();
  const settleHeldReads = Effect.gen(function* () {
    if (heldReads.size === 0) return;
    const current = yield* Ref.get(model);
    const unresolved = new Set<string>();
    for (const query of current.inventory.queries.values())
      for (const ref of unresolvedRefs(current, query.key)) unresolved.add(entityKeyOf(ref));
    for (const key of heldReads) {
      if (unresolved.has(key)) continue;
      heldReads.delete(key);
      yield* reviveRead(key);
    }
  });
  const readAfterThrottle = (
    organization: OrganizationRef,
    until: number,
    query: QueryKey,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const key = throttleKey(organization, "read");
      const waiting = throttledQueries.get(key);
      if (waiting !== undefined) {
        waiting.add(query);
        return;
      }
      throttledQueries.set(key, new Set([query]));
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.sleep(Duration.millis(Math.max(0, until - now))).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const queries = throttledQueries.get(key) ?? new Set<QueryKey>();
            throttledQueries.delete(key);
            yield* settleHeldReads;
            if (Ref.getUnsafe(currentVisibility) === "hidden") {
              for (const held of queries) heldPastHidden.add(held);
              return;
            }
            yield* Effect.forEach(queries, (held) => scheduleHydration(held), { discard: true });
          }),
        ),
        forkOwned,
      );
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
        // The organization's reads wait out a 429's Retry-After: this one starts after it.
        const heldUntil = throttledUntil(organizationOfEntityRef(target), "read");
        if (heldUntil > (yield* Clock.currentTimeMillis)) {
          if (!heldReads.has(key)) {
            heldReads.add(key);
            const waiting = [...dependents.values()];
            yield* failInterests(
              waiting,
              `${target.kind} ${entityIdOf(target)} waits: Zerops asked for a pause. Read again.`,
              false,
              { retryAtMs: heldUntil, attempts: 1, retryable: true },
            );
            markReadFailed(waiting, key);
          }
          yield* readAfterThrottle(organizationOfEntityRef(target), heldUntil, query);
          continue;
        }
        heldReads.delete(key);
        const attempted = hydrationAttempts.get(key);
        // A failed entity waits out its own retry; one the platform refused waits for a person.
        if (
          hydrations.size >= policy.activeSharedReadsPerAccount ||
          (attempted !== undefined &&
            (attempted.refusal.kind === "gone" ||
              (yield* Clock.currentTimeMillis) < attempted.retryAtMs))
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
            yield* failInterruptedInterest(identity, "overflow");
            const interest = interests.get(identity.key);
            if (interest === undefined) continue;
            const receiver = receivers.get(receiverKeyOf(interest.descriptor));
            if (receiver !== undefined) affectedReceivers.set(receiver.key, receiver);
          }
          yield* Effect.forEach(
            affectedReceivers.values(),
            (receiver) => failReceiver(receiver, "read queue capacity", readCapacityError()),
            { discard: true },
          );
          continue;
        }
        // While it reads, no other trigger starts it; its budget carries over from the last failure.
        hydrationAttempts.set(key, {
          target,
          query,
          count: attempted?.count ?? 0,
          retryAtMs: Number.POSITIVE_INFINITY,
          refusal: attempted?.refusal ?? { kind: "transient" },
        });
        const work = hydrationSemaphore.withPermit(runReadOutcome(ticket, null)).pipe(
          Effect.flatMap(({ succeeded, error }) =>
            awaitIngress.pipe(
              Effect.andThen(
                applyControl({ kind: "shared-read-released", requestId: ticket.requestId }),
              ),
              Effect.andThen(
                Effect.gen(function* () {
                  const current = yield* Ref.get(model);
                  const incomplete = [...current.inventory.queries.values()].some((query) =>
                    unresolvedRefs(current, query.key).some((ref) => entityKeyOf(ref) === key),
                  );
                  if (!incomplete) {
                    hydrationAttempts.delete(key);
                    yield* reviveRead(key);
                    return;
                  }
                  const id = entityIdOf(target);
                  const retry = yield* scheduleHydrationRetry(key, target, query, error);
                  const dependents = [...hydration.ownership.dependents.values()];
                  yield* failInterests(
                    dependents,
                    `${target.kind} ${id} unavailable. ${error?.message ?? "The platform did not return complete detail."} Read again.`,
                    false,
                    retry,
                  );
                  markReadFailed(dependents, key);
                }),
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
          Effect.andThen(
            Effect.suspend(() =>
              hydrationAttempts.has(key) ? Effect.void : scheduleHydration(query),
            ),
          ),
          Effect.asVoid,
          forkOwned,
        );

        hydration.fiber = fiber;
      }
    });

  /**
   * A failed hydration is read again on the recovery backoff, not at once: a refusal that lasts a
   * moment (a service the platform lists before it serves it) would spend the budget in a few
   * milliseconds. A spent budget stays at the backoff's cap, so an entity is never left
   * unresolved for good while an interest holds it, and never read faster than the cap again. A 429 waits at least its
   * Retry-After; a refusal waits for a person's again. Nothing reads while the tab is hidden: the
   * visible wake reads it at once (`resumeFromBackground`).
   */
  const scheduleHydrationRetry = (
    key: string,
    target: ReadEntityRef,
    query: QueryKey,
    error: AdapterError | null,
  ): Effect.Effect<{
    readonly retryAtMs: number | null;
    readonly attempts: number;
    readonly retryable: boolean;
  }> =>
    Effect.gen(function* () {
      const count = (hydrationAttempts.get(key)?.count ?? 0) + 1;
      const refusal = hydrationRefusal(error);
      const backoffMs = rungMs(hydrationLadder, count);
      const now = yield* Clock.currentTimeMillis;
      const delayMs = Math.max(
        jittered(backoffMs),
        refusal.kind === "throttled" ? (refusal.retryAfterMs ?? 0) : 0,
        throttledUntil(organizationOfEntityRef(target), "read") - now,
      );
      const record = {
        target,
        query,
        count,
        retryAtMs: refusal.kind === "gone" ? Number.POSITIVE_INFINITY : now + delayMs,
        refusal,
      };
      hydrationAttempts.set(key, record);
      if (refusal.kind === "gone") return { retryAtMs: null, attempts: count, retryable: false };
      yield* Effect.sleep(Duration.millis(delayMs)).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            // A reset, an attempt it let start, or a hidden tab owns the entity's next read now.
            if (hydrationAttempts.get(key) !== record || Ref.getUnsafe(closed)) return Effect.void;
            if (Ref.getUnsafe(currentVisibility) === "hidden") return Effect.void;
            record.retryAtMs = 0;
            return scheduleHydration(query);
          }),
        ),
        forkOwned,
      );
      return { retryAtMs: record.retryAtMs, attempts: count, retryable: true };
    });

  /** Each interest a read failed now waits for that read too. */
  const markReadFailed = (identities: Iterable<InterestIdentity>, readKey: string): void => {
    for (const identity of identities) {
      const held = readFailures.get(identity.key);
      const entry =
        held !== undefined && interestIdentitiesEqual(held.identity, identity)
          ? held
          : { identity, keys: new Set<string>() };
      entry.keys.add(readKey);
      readFailures.set(identity.key, entry);
    }
  };

  /**
   * A failed read answered: each interest it alone held failed observes again, its registrations
   * never having left. One failed for anything else since keeps its own failure.
   */
  const reviveRead = (readKey: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const [interestKey, entry] of readFailures) {
        if (!entry.keys.delete(readKey) || entry.keys.size > 0) continue;
        readFailures.delete(interestKey);
        const runtimeInterest = interests.get(interestKey);
        if (
          runtimeInterest === undefined ||
          runtimeInterest.leases.size === 0 ||
          !interestIdentitiesEqual(runtimeInterest.identity, entry.identity)
        )
          continue;
        const receiver = receivers.get(receiverKeyOf(runtimeInterest.descriptor));
        if (receiver === undefined || receiver.failed || receiver.openFailure !== null) continue;
        const desired = (yield* Ref.get(model)).interests.get(interestKey);
        if (
          desired?.interest.status !== "failed" ||
          !interestIdentitiesEqual(desired.interest.identity, entry.identity) ||
          interestRetries.has(interestKey)
        )
          continue;
        yield* applyControl({
          kind: "interest-upserted",
          interest: {
            ...desired,
            interest: {
              status: "observing",
              identity: desired.interest.identity,
              guarantee: "source-order-unverified",
              sinceReceiptOrdinal: ReceiptOrdinal.make(receiptOrdinal),
            },
          },
        });
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
      hydrationAttempts.delete(key);
    });

  const consumeReceiver = (receiver: RuntimeReceiver): Effect.Effect<void> => {
    const handle = receiver.handle;
    if (handle === null) return Effect.void;
    return Stream.runForEach(
      handle.events.pipe(
        Stream.takeUntil((event) => event.kind === "closed" || event.kind === "malformed"),
      ),
      (event: ReceiverEvent) => {
        if (receivers.get(receiver.key) !== receiver || receiver.failed) return Effect.void;
        if (event.kind === "pong") return Effect.void;
        if (event.kind === "observation") {
          const request = observationRegistration(event.input);
          if (request === null)
            return enqueue(
              { kind: "observation", input: event.input, interest: null },
              event.bytes,
            );
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
        if (event.kind === "malformed")
          return failReceiver(receiver, "Malformed subscription frame.");
        return failReceiver(receiver, event.reason);
      },
    ).pipe(
      Effect.andThen(failReceiver(receiver, "The data stream ended.")),
      Effect.catch((error) => failReceiver(receiver, error.message, error)),
      Effect.raceFirst(receiver.stopped.await),
    );
  };

  const ensureReceiver = (receiver: RuntimeReceiver): Effect.Effect<ReceiverHandle, AdapterError> =>
    receiverLock.withPermit(
      Effect.gen(function* () {
        if (receiver.handle !== null) return receiver.handle;
        // Every dependent sees this physical attempt's failure while recovery backs off.
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
        // A manual-attempt/pause race may have replaced this receiver while the open call was
        // in flight. Nobody else can close a socket that never landed in `receivers`.
        if (receivers.get(receiver.key) !== receiver) {
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
        if (existing !== undefined) {
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
            : yield* sharedReadTicket(planned.baseline, owner, "baseline");
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
          awaitingAnswer: false,
          refused: false,
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
            receiver.neverSubscribed += 1;
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
      receivers.get(receiver.key) !== receiver ||
      receiver.failed ||
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
            ? establish(runtimeInterest, receiverFor(runtimeInterest.descriptor))
            : Effect.succeed(establishmentDone),
        ),
      );
    });

  const establish = (
    runtimeInterest: RuntimeInterest,
    receiver: RuntimeReceiver,
  ): Effect.Effect<EstablishmentOutcome> =>
    Effect.gen(function* () {
      if (yield* Ref.get(closed)) return establishmentDone;
      if (readsNothing(runtimeInterest.descriptor)) return establishmentDone;
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
            : yield* requestTicket(identity, "baseline", planned.baseline);
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
          // must not strand the entry in `status: "registering"`. Retain the abandoned
          // physical attempt and fail its deferred so later dependents see the same outcome.
          yield* Effect.gen(function* () {
            // A bounded number of registrations are in flight across the account. The deadline
            // starts once it is sent.
            const result = yield* registrationPermits
              .withPermits(1)(
                context(policy.registrationDeadlineMs, (requestContext) =>
                  Effect.suspend(() => {
                    registration.awaitingAnswer = true;
                    return options.adapter.register(handle, registration.request, requestContext);
                  }),
                ),
              )
              .pipe(Effect.result);
            registration.awaitingAnswer = false;
            const outcome: PhysicalRegistrationOutcome = Result.isFailure(result)
              ? { kind: "failed", error: result.failure }
              : { kind: "succeeded", receipt: result.success };
            if (outcome.kind === "failed") {
              registration.status = "failed";
              // An answer with a status is the platform's refusal; one without may have subscribed.
              registration.refused = outcome.error.status !== undefined;
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
                registration.status = "failed";
                if (
                  receiver.registrationOwners.get(registration.request.subscriptionName) ===
                  registration
                ) {
                  receiver.registrationOwners.delete(registration.request.subscriptionName);
                }
              }).pipe(
                // Its siblings waiting on it receive the same abandoned-attempt failure.
                Effect.andThen(
                  Deferred.succeed(registration.outcome, {
                    kind: "failed",
                    error: REGISTRATION_ABANDONED,
                  }),
                ),
                Effect.andThen(
                  Effect.suspend(() =>
                    registration.awaitingAnswer
                      ? failReceiver(receiver, REGISTRATION_ABANDONED.message)
                      : Effect.void,
                  ),
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
          // A refusal or abandoned send stays attached to this physical attempt.
          // An uncertain answer closes the known receiver before reconnecting.
          if (registrationRefused(outcome.error)) {
            yield* failInterest(identity, outcome.error.message, outcome.error);
            return interestFailed;
          }
          yield* failReceiver(receiver, outcome.error.message, outcome.error);
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
        const read = yield* runReadOutcome(ticket, identity);
        if (runtimeInterest.identity !== identity || runtimeInterest.leases.size === 0)
          return establishmentDone;
        // A read registers nothing on the receiver: it fails its own interest alone.
        if (!read.succeeded) {
          yield* failInterest(identity, "required direct read failed", read.error);
          return interestFailed;
        }
      }
      yield* awaitIngress;
      if (!receiver.failed) receiver.reconnectFailures = 0;
      if (runtimeInterest.identity === identity) runtimeInterest.recoveryAttempts = 0;
      return establishmentDone;
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(policy.establishmentDeadlineMs),
        orElse: () => Effect.fail(ESTABLISHMENT_DEADLINE),
      }),
      Effect.catch((error: AdapterError) => {
        if (
          receivers.get(receiver.key) !== receiver ||
          runtimeInterest.identity.receiver !== receiver.identity
        )
          return Effect.succeed(establishmentDone);
        // One subscription outliving its deadline on a socket that is open says nothing against
        // the socket: this interest fails and its siblings keep observing. A socket that is dead
        // says so itself and schedules receiver recovery.
        if (
          error === ESTABLISHMENT_DEADLINE &&
          receiver.handle !== null &&
          runtimeInterest.identity.receiver.receiverId === receiver.identity.receiverId
        ) {
          return failInterest(runtimeInterest.identity, error.message, error).pipe(
            Effect.as(interestFailed),
          );
        }
        return failReceiver(receiver, error.message, error).pipe(
          Effect.as(receiverFailed(error.message)),
        );
      }),
    );

  const failInterests = (
    identities: Iterable<InterestIdentity>,
    message: string,
    abortReads = true,
    recovery?: {
      readonly retryAtMs: number | null;
      readonly attempts: number;
      readonly retryable: boolean;
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const identity of identities) {
        const interest = interests.get(identity.key);
        if (interest?.identity !== identity || interest.leases.size === 0) continue;
        if (abortReads) interest.readController.abort();
        const desired = (yield* Ref.get(model)).interests.get(identity.key);
        if (desired === undefined) continue;
        if (!abortReads && receivers.get(receiverKeyOf(interest.descriptor))?.openFailure !== null)
          continue;
        // A new failure supersedes a retry still waiting: the scheduler stamps it afresh, if any.
        if (abortReads) interestRetries.delete(identity.key);
        yield* applyControl({
          kind: "interest-upserted",
          interest: {
            ...desired,
            interest: {
              status: "failed",
              identity,
              reason: message,
              retryable: recovery?.retryable ?? true,
              attempts: recovery?.attempts ?? 1,
              retryAtMs: recovery?.retryAtMs ?? null,
            },
          },
        });
      }
    });
  failReceiver = (receiver, message, error) =>
    Ref.get(closed)
      .pipe(
        Effect.flatMap((isClosed) =>
          isClosed
            ? Effect.void
            : lifecycleLock.withPermit(
                Effect.gen(function* () {
                  if (receivers.get(receiver.key) !== receiver || (yield* Ref.get(closed))) return;
                  if (receiver.failed) {
                    const current = yield* Ref.get(model);
                    yield* failInterests(
                      [...interests.values()]
                        .filter(
                          (interest) =>
                            interest.identity.receiver === receiver.identity &&
                            current.interests.get(interest.key)?.interest.status === "establishing",
                        )
                        .map((interest) => interest.identity),
                      message,
                      true,
                      {
                        retryAtMs: receiver.reconnectAtMs,
                        attempts: receiver.reconnectFailures,
                        retryable: receiver.reconnectAtMs !== null,
                      },
                    );
                    return;
                  }
                  receiver.failed = true;
                  receiver.openFailure ??= error ?? {
                    _tag: "ZeropsDataAdapterError",
                    kind: "network",
                    message,
                    retryable: true,
                    accountRevocationEvidence: false,
                  };
                  const reconnect = canReconnect(receiver.openFailure);
                  const attempts = ++receiver.reconnectFailures;
                  const now = yield* Clock.currentTimeMillis;
                  throttle(receiver.organization, "socket", receiver.openFailure, now);
                  const delayMs = Math.max(
                    jittered(Math.min(1_000 * 2 ** Math.min(attempts - 1, 5), 30_000)),
                    receiver.openFailure.retryAfterMs ?? 0,
                    throttledUntil(receiver.organization, "socket") - now,
                  );
                  const retryAtMs = reconnect ? now + delayMs : null;
                  receiver.reconnectAtMs = retryAtMs;
                  const affected = [...interests.values()].filter(
                    (interest) =>
                      interest.identity.receiver === receiver.identity && interest.leases.size > 0,
                  );
                  yield* failInterests(
                    affected.map((interest) => interest.identity),
                    reconnect
                      ? `${message} Reconnecting… A fresh baseline will be read; updates while disconnected may be missing.`
                      : message,
                    true,
                    { retryAtMs, attempts, retryable: reconnect },
                  );
                  const handle = receiver.handle;
                  receiver.handle = null;
                  if (handle !== null) yield* options.adapter.closeReceiver(handle);
                  if (!reconnect) return;

                  // One owned recovery per physical receiver. A refresh, pause, release or shutdown fences
                  // it before it can open anything; an offline tab waits without sending socket logins.
                  receiver.reconnectFiber = yield* Effect.sleep(Duration.millis(delayMs)).pipe(
                    Effect.andThen(network.await),
                    Effect.andThen(
                      lifecycleLock.withPermit(
                        Effect.gen(function* () {
                          if ((yield* Ref.get(closed)) || receivers.get(receiver.key) !== receiver)
                            return;
                          const held = [...interests.values()].filter(
                            (interest) =>
                              interest.leases.size > 0 &&
                              interest.identity.receiver === receiver.identity,
                          );
                          if (held.length === 0) return;
                          const replacement = makeReceiver(receiver.organization, receiver.key);
                          replacement.reconnectFailures = receiver.reconnectFailures;
                          receivers.set(receiver.key, replacement);
                          // A recovered transport earns the organization's failed entities a fresh
                          // set of hydration attempts: its baselines name them again.
                          for (const [key, record] of hydrationAttempts) {
                            if (
                              organizationKeyOf(organizationOfEntityRef(record.target)) ===
                              organizationKeyOf(receiver.organization)
                            )
                              hydrationAttempts.delete(key);
                          }
                          for (const [key, hydration] of hydrations) {
                            if (
                              [...hydration.ownership.dependents.values()].some(
                                (identity) => identity.receiver === receiver.identity,
                              )
                            )
                              yield* cancelHydration(key, hydration);
                          }
                          for (const interest of held) {
                            const desired = yield* updateInterestIdentity(interest, replacement);
                            yield* applyControl({ kind: "interest-upserted", interest: desired });
                          }
                          yield* Effect.forEach(
                            held,
                            (interest) => establishInterest(interest).pipe(forkOwned),
                            { discard: true },
                          );
                        }),
                      ),
                    ),
                    forkOwned,
                  );
                }),
              ),
        ),
      )
      .pipe(Effect.ensuring(receiver.stopped.open));
  failInterest = (identity, message, error) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) => {
      if (error?.retryAfterMs !== undefined)
        interestRetryAfter.set(identity.key, now + error.retryAfterMs);
      else interestRetryAfter.delete(identity.key);
      return Effect.void;
    }).pipe(
      Effect.andThen(
        lifecycleLock.withPermit(
          failInterests([identity], message, true, {
            retryAtMs: null,
            attempts: 1,
            retryable: !permanentFailure(error),
          }),
        ),
      ),
    );

  /**
   * An interest that failed on its own — a registration refused, a read of its own, a deadline on
   * a live socket, a malformed subscription, an overflow — re-establishes alone on the receiver its
   * siblings keep observing on, on its own backoff: `recoveryBackoffStartMs` doubling to
   * `recoveryBackoffMaxMs`, and past `recoveryAttemptLimit` the cap, after which it starts over. A
   * receiver that failed is its reconnect's; a hidden tab's waits for the visible wake.
   */
  const scheduleInterestRetries = lifecycleLock.withPermit(
    Effect.gen(function* () {
      retriesRequested = false;
      if (yield* Ref.get(closed)) return;
      const state = yield* Ref.get(model);
      const now = yield* Clock.currentTimeMillis;
      const due = new Set<RuntimeReceiver>();
      for (const runtimeInterest of interests.values()) {
        if (runtimeInterest.leases.size === 0) continue;
        const desired = state.interests.get(runtimeInterest.key);
        const failed = desired?.interest;
        if (
          desired === undefined ||
          failed?.status !== "failed" ||
          !failed.retryable ||
          failed.retryAtMs !== null ||
          !interestIdentitiesEqual(failed.identity, runtimeInterest.identity)
        )
          continue;
        const receiver = receivers.get(receiverKeyOf(runtimeInterest.descriptor));
        if (receiver === undefined || receiver.failed || receiver.openFailure !== null) continue;
        runtimeInterest.recoveryAttempts += 1;
        const attempts = runtimeInterest.recoveryAttempts;
        const spent = onLastRung(recoveryLadder, attempts);
        const organization = organizationOfInterest(runtimeInterest.descriptor);
        const dueAtMs = Math.max(
          now + jittered(rungMs(recoveryLadder, attempts)),
          // A Retry-After its own failure carried, or its organization's 429, is a floor.
          interestRetryAfter.get(runtimeInterest.key) ?? 0,
          throttledUntil(organization, "read"),
          throttledUntil(organization, "socket"),
        );
        readFailures.delete(runtimeInterest.key);
        interestRetries.set(runtimeInterest.key, {
          identity: runtimeInterest.identity,
          dueAtMs,
          spent,
        });
        yield* applyControl({
          kind: "interest-upserted",
          interest: { ...desired, interest: { ...failed, attempts, retryAtMs: dueAtMs } },
        });
        due.add(receiver);
      }
      yield* Effect.forEach(due, requestRecovery, { discard: true });
    }),
  );
  let retriesRequested = false;
  requestInterestRetries = Effect.suspend(() => {
    if (retriesRequested) return Effect.void;
    retriesRequested = true;
    return scheduleInterestRetries.pipe(forkOwned, Effect.asVoid);
  });

  /**
   * The held interests of the organization's socket whose own retry waits: by its key, so a retry
   * waiting when the socket is replaced comes due on the new one.
   */
  const retriesOn = (
    key: string,
  ): ReadonlyArray<{
    readonly interest: RuntimeInterest;
    readonly dueAtMs: number;
    readonly spent: boolean;
  }> =>
    [...interests.values()].flatMap((runtimeInterest) => {
      const retry = interestRetries.get(runtimeInterest.key);
      return retry !== undefined &&
        runtimeInterest.leases.size > 0 &&
        runtimeInterest.identity === retry.identity &&
        receiverKeyOf(runtimeInterest.descriptor) === key
        ? [{ interest: runtimeInterest, dueAtMs: retry.dueAtMs, spent: retry.spent }]
        : [];
    });

  const recoveryCycles = new Map<string, { wake: Deferred.Deferred<void> }>();

  /**
   * The receiver's one recovery cycle: it waits for the earliest retry to come due (or to be
   * woken), and re-establishes the interests that are due, only those, a bounded number at a
   * time and the organization's project list first. A retry that fails alone waits out its own
   * next backoff; one that failed the receiver stops the round, the receiver's reconnect taking
   * every interest along. The round that finds nothing waiting ends the cycle.
   */
  const runRecoveryCycle = (
    key: string,
    cycle: { wake: Deferred.Deferred<void> },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      while (true) {
        cycle.wake = Deferred.makeUnsafe<void>();
        const pending = retriesOn(key);
        // A socket replaced with only waiting retries on it is opened by the retry itself.
        const receiver =
          receivers.get(key) ??
          (pending.length > 0 ? receiverFor(pending[0]!.interest.descriptor) : undefined);
        const waiting =
          receiver === undefined ||
          receiver.failed ||
          Ref.getUnsafe(closed) ||
          Ref.getUnsafe(currentVisibility) === "hidden"
            ? []
            : pending;
        if (receiver === undefined || waiting.length === 0) {
          // Ends in the same step its entry goes: a retry stamped next starts a cycle of its own.
          if (recoveryCycles.get(key) === cycle) recoveryCycles.delete(key);
          return;
        }
        const dueAtMs = Math.min(...waiting.map((retry) => retry.dueAtMs));
        const beforeSleep = yield* Clock.currentTimeMillis;
        yield* Effect.raceFirst(
          Effect.sleep(Duration.millis(Math.max(0, dueAtMs - beforeSleep))),
          Deferred.await(cycle.wake),
        );
        const due = yield* lifecycleLock.withPermit(
          Effect.gen(function* () {
            if (
              (yield* Ref.get(closed)) ||
              (yield* Ref.get(currentVisibility)) === "hidden" ||
              receivers.get(key) !== receiver ||
              // The top's own test: a login that failed or was abandoned is not one. The retry
              // meets it on establishing and fails the socket, whose recovery then owns it.
              receiver.failed
            )
              return [];
            const now = yield* Clock.currentTimeMillis;
            const ready = retriesOn(key).filter((retry) => retry.dueAtMs <= now);
            for (const { interest } of ready) {
              interestRetries.delete(interest.key);
              yield* releaseFailedRegistrations(receiver, interest.key);
            }
            // Retries churn subscriptions too: past the bound only a fresh socket stops them.
            if (
              ready.length > 0 &&
              releasedOn(receiver) >= policy.releasedRegistrationsPerReceiver
            ) {
              yield* rotateReceiver(receiver, new Set(ready.map(({ interest }) => interest.key)));
              return [];
            }
            for (const { interest } of ready) {
              const desired = yield* updateInterestIdentity(interest, receiver);
              yield* applyControl({ kind: "interest-upserted", interest: desired });
            }
            return ready.map(({ interest }) => interest);
          }),
        );
        if (due.length === 0) continue;
        let receiverFailed = false;
        yield* Effect.forEach(
          due,
          (interest) =>
            Effect.suspend(() =>
              receiverFailed
                ? Effect.void
                : Effect.exit(establishInterest(interest)).pipe(
                    Effect.map((exit) => {
                      if (Exit.isSuccess(exit) && exit.value.kind === "receiver-failed")
                        receiverFailed = true;
                    }),
                  ),
            ),
          { concurrency: policy.recoveryConcurrency, discard: true },
        );
        yield* awaitIngress;
      }
    });

  /** Starts the receiver's recovery cycle, or wakes the one running to recompute what is due. */
  const requestRecovery = (receiver: RuntimeReceiver): Effect.Effect<void> =>
    Effect.suspend(() => {
      const running = recoveryCycles.get(receiver.key);
      if (running !== undefined)
        return Deferred.succeed(running.wake, undefined).pipe(Effect.asVoid);
      const cycle = { wake: Deferred.makeUnsafe<void>() };
      recoveryCycles.set(receiver.key, cycle);
      return runRecoveryCycle(receiver.key, cycle).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (recoveryCycles.get(receiver.key) === cycle) recoveryCycles.delete(receiver.key);
          }),
        ),
        forkOwned,
        Effect.asVoid,
      );
    });

  /**
   * An interest about to register again lets go of its failed registrations only: the retry sends
   * those afresh, and keeps every healthy one it shares, which the platform cannot unsubscribe.
   */
  /** The subscriptions a socket held and let go: their frames may still arrive on it. */
  const releasedOn = (receiver: RuntimeReceiver): number =>
    receiver.registrationAttempts - receiver.registrations.size - receiver.neverSubscribed;

  const releaseFailedRegistrations = (
    receiver: RuntimeReceiver,
    interestKey: InterestKey,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      for (const [registrationKey, registration] of receiver.registrations) {
        if (registration.status !== "failed" || !registration.dependents.has(interestKey)) continue;
        receiver.registrations.delete(registrationKey);
        if (registration.refused) receiver.neverSubscribed += 1;
        if (receiver.registrationOwners.get(registration.request.subscriptionName) === registration)
          receiver.registrationOwners.delete(registration.request.subscriptionName);
      }
    });

  const stopReceiver = (receiver: RuntimeReceiver): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* receiver.stopped.open;
      if (receiver.reconnectFiber !== null) yield* Fiber.interrupt(receiver.reconnectFiber);
      const handle = receiver.handle;
      receiver.handle = null;
      if (handle !== null) yield* options.adapter.closeReceiver(handle);
    });

  const pauseForBackground = lifecycleLock.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(closed)) || (yield* Ref.get(currentVisibility)) !== "hidden") return;
      const activeReceivers = [...receivers.values()];
      receivers.clear();
      for (const runtimeInterest of interests.values()) {
        if (runtimeInterest.leases.size === 0) continue;
        runtimeInterest.readController.abort();
        const current = (yield* Ref.get(model)).interests.get(runtimeInterest.key);
        if (
          current === undefined ||
          (current.interest.status === "failed" && current.interest.retryAtMs === null)
        )
          continue;
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
      yield* Effect.forEach(activeReceivers, (receiver) => stopReceiver(receiver), {
        discard: true,
      });
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
      const toResume = paused;
      // A paused interest, a failed one waiting for its retry among them, starts over on a fresh
      // receiver: a visible wake is the first rung, now.
      for (const runtimeInterest of toResume) {
        runtimeInterest.recoveryAttempts = 0;
        interestRetries.delete(runtimeInterest.key);
        readFailures.delete(runtimeInterest.key);
        const receiver = receiverFor(runtimeInterest.descriptor);
        receiver.openFailure = null;
        const desired = yield* updateInterestIdentity(runtimeInterest, receiver);
        yield* applyControl({ kind: "interest-upserted", interest: desired });
      }
      yield* Effect.forEach(
        toResume,
        (runtimeInterest) => establishInterest(runtimeInterest).pipe(forkOwned),
        { discard: true },
      );
      // A tab back before its pause still holds its receivers: what waited on them while it was
      // hidden reads now, from a fresh budget — a failed entity, a read a Retry-After held, an owed
      // row, a failed interest.
      const queries = new Set<QueryKey>(heldPastHidden);
      heldPastHidden.clear();
      for (const [key, record] of hydrationAttempts) {
        if (record.refusal.kind === "gone" || record.retryAtMs === Number.POSITIVE_INFINITY)
          continue;
        hydrationAttempts.delete(key);
        queries.add(record.query);
      }
      yield* Effect.forEach(queries, (query) => scheduleHydration(query).pipe(forkOwned), {
        discard: true,
      });
      yield* Effect.forEach(
        tableRowsWanted(state.table),
        (batch) => scheduleTableRead({ kind: "read-table-rows", ...batch }),
        { discard: true },
      );
      yield* Effect.forEach(
        [
          ...new Set(
            [...interests.values()]
              .filter((interest) => interestRetries.has(interest.key))
              .map((interest) => receiverFor(interest.descriptor)),
          ),
        ],
        requestRecovery,
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
        yield* cells.wake;
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

  /**
   * Stops routing `interestKey`'s registrations on the socket; a registration nobody else depends
   * on leaves it. The platform has no unsubscribe: its subscription stays on the wire, its frames
   * dropped by name, until the socket closes.
   */
  const detachRegistrations = (
    receiver: RuntimeReceiver,
    interestKey: InterestKey,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const [registrationKey, registration] of receiver.registrations) {
        if (!registration.dependents.delete(interestKey)) continue;
        if (registration.status === "registering" && registration.ticket?.owner.kind === "shared") {
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
          if (registration.refused) receiver.neverSubscribed += 1;
          receiver.registrationOwners.delete(registration.request.subscriptionName);
        }
      }
    });

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
        const organizationKey = receiverKeyOf(runtimeInterest.descriptor);
        const receiver = receivers.get(organizationKey);
        if (receiver !== undefined) yield* detachRegistrations(receiver, runtimeInterest.key);
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
        const retained = yield* Ref.get(model);
        const unresolved = new Set<string>(
          [...retained.inventory.queries.values()].flatMap((query) =>
            unresolvedRefs(retained, query.key).map(entityKeyOf),
          ),
        );
        for (const key of hydrationAttempts.keys()) {
          if (!unresolved.has(key) && !hydrations.has(key)) hydrationAttempts.delete(key);
        }
        const hasOtherInterest = [...interests.values()].some(
          (interest) =>
            interest.leases.size > 0 && receiverKeyOf(interest.descriptor) === organizationKey,
        );
        // The socket closes with its organization's last demand, or is replaced once the
        // subscriptions released on it reach the bound: only a fresh socket stops their frames.
        const released = receiver === undefined ? 0 : releasedOn(receiver);
        if (
          !hasOtherInterest ||
          (released >= policy.releasedRegistrationsPerReceiver && receiver?.openFailure === null)
        ) {
          if (receiver === undefined) receivers.delete(organizationKey);
          else yield* rotateReceiver(receiver, new Set());
        }
      }),
    );

  /**
   * Replaces the organization's socket: the stale one stops, and every held interest it carried
   * that is not failed — or failed and in `include`, whose retry this is — registers afresh on a
   * new one. A hydration read for the stale socket's demand starts again on the fresh one.
   */
  rotateReceiver = (receiver, include) =>
    Effect.gen(function* () {
      if (receivers.get(receiver.key) === receiver) receivers.delete(receiver.key);
      yield* stopReceiver(receiver);
      for (const [key, hydration] of hydrations) {
        if (
          [...hydration.ownership.dependents.values()].some(
            (identity) => identity.receiver === receiver.identity,
          )
        )
          yield* cancelHydration(key, hydration);
      }
      for (const remaining of interests.values()) {
        if (
          remaining.leases.size === 0 ||
          receiverKeyOf(remaining.descriptor) !== receiver.key ||
          ((yield* Ref.get(model)).interests.get(remaining.key)?.interest.status === "failed" &&
            !include.has(remaining.key))
        )
          continue;
        const desired = yield* updateInterestIdentity(remaining, receiverFor(remaining.descriptor));
        yield* applyControl({ kind: "interest-upserted", interest: desired });
        yield* establishInterest(remaining).pipe(forkOwned);
      }
      // A retry that was waiting on the stale socket comes due on the new one.
      if (retriesOn(receiver.key).length > 0)
        yield* requestRecovery(receiverFor(retriesOn(receiver.key)[0]!.interest.descriptor));
    });

  /**
   * What the services whose variables this runtime holds run now, as the account's store holds
   * them (F13): a service that moved to another version has its trailing variables read again.
   */
  const heldDeploysAtom = Atom.make((get): ReadonlyArray<ServiceDeployObserved> => {
    const deploys: Array<ServiceDeployObserved> = [];
    for (const { descriptor, leases } of get(rootAtom).interests.values()) {
      if (leases <= 0 || descriptor.kind !== "project-variables") continue;
      for (const entry of bridgedServicesOf(get, descriptor.project).value) {
        if (entry.knowledge !== "observed") continue;
        const serviceId = entry.record.ref.serviceId;
        const facet = entry.record.deployment;
        const deploy = facet.knowledge === "observed" ? facet.fields.activeDeploy : null;
        if (!descriptor.serviceIds.includes(serviceId) || deploy == null || deploy.id === null)
          continue;
        deploys.push({
          organization: descriptor.project.organization,
          serviceId,
          deployId: deploy.id,
        });
      }
    }
    return deploys;
  });
  let heardDeploys = "";
  const stopHearingDeploys = options.atomRegistry.subscribe(
    heldDeploysAtom,
    (deploys) => {
      const key = JSON.stringify(deploys);
      if (key === heardDeploys) return;
      heardDeploys = key;
      Effect.runForkWith(runtimeContext)(
        Effect.gen(function* () {
          yield* applyControl({
            kind: "service-deploys-observed",
            deploys,
            atMs: yield* Clock.currentTimeMillis,
          });
          yield* Effect.forEach(
            tableRowsWanted((yield* Ref.get(model)).table),
            (batch) => scheduleTableRead({ kind: "read-table-rows", ...batch }),
            { discard: true },
          );
        }).pipe(forkOwned),
      );
    },
    { immediate: true },
  );
  yield* Scope.addFinalizer(runtimeScope, Effect.sync(stopHearingDeploys));

  const refresh: ZeropsDataRuntime["refresh"] = (scope) =>
    lifecycleLock.withPermit(
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return;
        const organization = scope.kind === "project" ? scope.organization : scope;
        const organizationKey = organizationKeyOf(organization);
        const held = [...interests.values()].filter(
          (interest) =>
            interest.leases.size > 0 &&
            organizationKeyOf(organizationOfInterest(interest.descriptor)) === organizationKey &&
            (scope.kind === "organization" ||
              ("project" in interest.descriptor &&
                interest.descriptor.project.projectId === scope.projectId)),
        );
        const serviceIds = [
          ...new Set(
            held.flatMap((interest) =>
              "serviceIds" in interest.descriptor ? interest.descriptor.serviceIds : [],
            ),
          ),
        ];
        yield* applyControl({
          kind: "metadata-retry-requested",
          organization,
          serviceIds,
          atMs: yield* Clock.currentTimeMillis,
        });
        // A project's again re-registers only its own subscriptions on the organization's healthy
        // socket. The organization's again, or a project's on a failed socket, replaces the socket
        // and re-establishes everything it carried.
        const current = receivers.get(organizationKey);
        const replace =
          scope.kind === "organization" ||
          current === undefined ||
          current.failed ||
          current.openFailure !== null;
        const reestablished = replace
          ? [...interests.values()].filter(
              (interest) =>
                interest.leases.size > 0 && receiverKeyOf(interest.descriptor) === organizationKey,
            )
          : held;
        const matchesEntity = (target: ReadEntityRef) =>
          organizationKeyOf(organizationOfEntityRef(target)) === organizationKey &&
          (replace ||
            (target.kind === "project" ? target : target.project).projectId === scope.projectId);
        if (current !== undefined) {
          if (replace) {
            receivers.delete(organizationKey);
            yield* stopReceiver(current);
          } else {
            for (const runtimeInterest of held) {
              yield* detachRegistrations(current, runtimeInterest.key);
            }
          }
        }
        for (const runtimeInterest of reestablished) {
          runtimeInterest.recoveryAttempts = 0;
          interestRetries.delete(runtimeInterest.key);
          readFailures.delete(runtimeInterest.key);
          const desired = yield* updateInterestIdentity(
            runtimeInterest,
            receiverFor(runtimeInterest.descriptor),
          );
          yield* applyControl({ kind: "interest-upserted", interest: desired });
        }

        // The detached registrations went with their identity: an in-flight
        // hydration is cancelled so scheduleHydration starts it fresh once the
        // interests are re-established. Manual refresh releases terminal coverage too.
        yield* Effect.forEach(
          [...hydrations.entries()].filter(([, hydration]) => matchesEntity(hydration.target)),
          ([key, hydration]) => cancelHydration(key, hydration),
          { discard: true },
        );
        for (const [entityKey, record] of hydrationAttempts) {
          if (matchesEntity(record.target)) hydrationAttempts.delete(entityKey);
        }
        yield* Effect.forEach(
          reestablished,
          (runtimeInterest) => establishInterest(runtimeInterest).pipe(forkOwned),
          { discard: true },
        );
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
        const organizationKey = receiverKeyOf(descriptor);
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
        const organizationInterestCount = [...interests.values()].filter(
          (interest) => receiverKeyOf(interest.descriptor) === organizationKey,
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
        const receiver = receiverFor(descriptor);
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
          required: true,
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
        const desired = yield* updateInterestIdentity(runtimeInterest, receiverFor(descriptor));
        yield* applyControl({ kind: "interest-upserted", interest: desired });
        establishments.push(runtimeInterest);
      } else {
        yield* applyControl({
          kind: "interest-upserted",
          interest: { ...existing, leases: runtimeInterest.leases.size },
        });
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
    importDevelopmentContainer: (input) =>
      runCommand({ kind: "import-development-container", ...input }).pipe(
        Effect.flatMap(({ attempt, result }) =>
          result.kind === "import-development-container"
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
  };

  const observeAccess = (observation: AccessObservation): Effect.Effect<void> =>
    enqueue({ kind: "access-observation", observation, interest: null }).pipe(
      Effect.andThen(awaitIngress),
    );

  const grant = yield* makeGrantDriver({
    scope: options.scope,
    policy: DEFAULT_ZEROPS_GRANT_POLICY,
    random,
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
          invalidation.topic === "inventory" ? refresh(invalidation.organization) : Effect.void,
        ),
        Effect.forkScoped,
      ),
    ).pipe(Effect.asVoid);

  const shutdown: ZeropsDataRuntime["shutdown"] = (_reason) =>
    lifecycleLock.withPermit(
      Effect.gen(function* () {
        if (yield* Ref.get(closed)) return;
        // Fence the epoch before interrupting any grant or transport work.
        yield* Ref.set(closed, true);
        // No round, read or timer of the grant outlives the epoch.
        yield* grant.close;
        yield* applyControl({ kind: "runtime-closed" });
        yield* flushPublication;
        yield* ingress.shutdown;
        // What the shutdown dropped is never reached: its waiters are let go now.
        for (const barrier of barriers) yield* Deferred.succeed(barrier, undefined);
        barriers.clear();
        yield* cells.shutdown;
        yield* Scope.close(runtimeScope, Exit.void);
        interests.clear();
        leases.clear();
        receivers.clear();
        hydrations.clear();
        hydrationAttempts.clear();
        readFailures.clear();
        heldReads.clear();
        heldPastHidden.clear();
        interestRetries.clear();
        recoveryCycles.clear();
      }),
    );

  return {
    scope: options.scope,
    reads: atoms.reads,
    commands,
    cells,
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
