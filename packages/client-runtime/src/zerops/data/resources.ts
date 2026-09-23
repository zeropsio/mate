import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import { Atom } from "effect/unstable/reactivity";

import type { ZeropsLocation } from "../api.ts";
import type { ZeropsIntegrationToken, ZeropsProjectGrant } from "../groupReach.ts";
import {
  advance,
  newCell,
  read,
  type Cell,
  type FailureReason,
  type KnownEvent,
  type Shown,
  type WithheldReason,
} from "../knowledge/known.ts";
import {
  backoffOn,
  INITIAL_BACKOFF,
  scheduleRetry,
  type Backoff,
} from "../knowledge/retryPolicy.ts";
import type { ZeropsAgentType } from "../newProject.ts";
import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import type {
  AccessDenialScope,
  AccessState,
  AccountRef,
  AccountScope,
  OrganizationRef,
  ProjectRef,
  ServiceRef,
  VerifiedAccessGrant,
} from "./types.ts";
import { organizationKeyOf, projectKeyOf, projectRoleGrantsAccess } from "./types.ts";

export interface OrganizationLocationsResourceRequest {
  readonly kind: "organization-locations";
  readonly account: AccountScope;
  readonly organization: OrganizationRef;
}

/** The adapter projects service env rows to agent identifiers before returning. */
export interface ServiceAuthorizedAgentsResourceRequest {
  readonly kind: "service-authorized-agents";
  readonly account: AccountScope;
  readonly service: ServiceRef;
}

export interface OrganizationIntegrationTokenGrantsResourceRequest {
  readonly kind: "organization-integration-token-grants";
  readonly account: AccountScope;
  readonly organization: OrganizationRef;
}

/**
 * What a group environment's service is running — the sha in the deployed
 * version's name (guide 4.5, `groupDeploys.ts`). Read per service, because the
 * name lives on the service and nowhere else.
 */
export interface ServiceDeployedVersionResourceRequest {
  readonly kind: "service-deployed-version";
  readonly account: AccountScope;
  readonly service: ServiceRef;
}

/**
 * `ZCP_MATE_ENABLED` on a service — the one read fact that tells a container
 * not serving Zerops Mate apart from one that is merely away (spec-mate
 * §4.5, H9): a browser cannot, and `predates-mate` reads identically either
 * way. Read per service, same as the agent and deployed-version reads.
 */
export interface ServiceMateFlagResourceRequest {
  readonly kind: "service-mate-flag";
  readonly account: AccountScope;
  readonly service: ServiceRef;
}

export type ZeropsResourceRequest =
  | OrganizationLocationsResourceRequest
  | ServiceAuthorizedAgentsResourceRequest
  | ServiceDeployedVersionResourceRequest
  | ServiceMateFlagResourceRequest
  | OrganizationIntegrationTokenGrantsResourceRequest;

export type ZeropsResourceKind = ZeropsResourceRequest["kind"];

/** Grant metadata contains no integration-token credential. */
export interface ZeropsIntegrationTokenGrantMetadata {
  readonly tokenId: ZeropsIntegrationToken["id"];
  readonly name: ZeropsIntegrationToken["name"];
  readonly grants: ReadonlyArray<ZeropsProjectGrant>;
}

export interface ZeropsResourceValues {
  readonly "organization-locations": ReadonlyArray<ZeropsLocation>;
  readonly "service-authorized-agents": ReadonlyArray<ZeropsAgentType>;
  /** `undefined` for a service nothing has ever been deployed to. */
  readonly "service-deployed-version": string | undefined;
  /**
   * `"unknown"` for a read that failed rather than answered — never folded
   * into `false`, which is itself a fact a caller may act on (H9): a row
   * offering Enable off an `"unknown"` flag would be back to inferring.
   */
  readonly "service-mate-flag": { readonly enabled: boolean | "unknown" };
  readonly "organization-integration-token-grants": ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>;
}

export type ZeropsResourceValue<Request extends ZeropsResourceRequest> =
  ZeropsResourceValues[Request["kind"]];

export type ZeropsResourceKey = string & { readonly ZeropsResourceKey: unique symbol };

export interface ZeropsResourceSourceError {
  readonly _tag: "ZeropsResourceSourceError";
  readonly kind: "transport" | "unavailable" | "permission" | "decode";
  readonly retryable: boolean;
}

export interface ZeropsResourceRequestContext {
  /** Withholding, the final release and interruption all abort this signal. */
  readonly abortSignal: AbortSignal;
}

/**
 * These callbacks are the complete protocol seam. Implementations may wrap
 * ZeropsApiClient calls, but must perform secret stripping and env projection
 * before their Effects succeed.
 */
export interface ZeropsResourceAdapter {
  readonly readOrganizationLocations: (
    request: OrganizationLocationsResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<ZeropsResourceValues["organization-locations"], ZeropsResourceSourceError>;
  readonly readServiceAuthorizedAgents: (
    request: ServiceAuthorizedAgentsResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<ZeropsResourceValues["service-authorized-agents"], ZeropsResourceSourceError>;
  readonly readServiceDeployedVersion: (
    request: ServiceDeployedVersionResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<ZeropsResourceValues["service-deployed-version"], ZeropsResourceSourceError>;
  readonly readServiceMateFlag: (
    request: ServiceMateFlagResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<ZeropsResourceValues["service-mate-flag"], ZeropsResourceSourceError>;
  readonly readOrganizationIntegrationTokenGrants: (
    request: OrganizationIntegrationTokenGrantsResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<
    ZeropsResourceValues["organization-integration-token-grants"],
    ZeropsResourceSourceError
  >;
}

/** Why the broker takes no demand at all; access never refuses demand, it withholds (§9 C4). */
export interface ZeropsResourceAdmissionError {
  readonly _tag: "ZeropsResourceAdmissionError";
  readonly reason: "runtime-closed" | "account-mismatch" | "account-capacity" | "lease-released";
}

export interface ZeropsResourceLease<Request extends ZeropsResourceRequest> {
  readonly key: ZeropsResourceKey;
  readonly request: Request;
  /** The resource read through withholding; a released lease shows nothing. */
  readonly snapshot: Effect.Effect<Shown<ZeropsResourceValue<Request>>>;
  /** The first state with no read in flight: known, failed, gone or withheld; interrupted by release. */
  readonly awaitSettled: Effect.Effect<Shown<ZeropsResourceValue<Request>>>;
  /** Reads again now, once for every lease, when the last read failed. */
  readonly retry: Effect.Effect<boolean, ZeropsResourceAdmissionError>;
  /** Idempotent; the acquiring Scope invokes the same release path. */
  readonly release: Effect.Effect<void>;
}

export interface ZeropsResourceDiagnostics {
  readonly entries: number;
  readonly leases: number;
  readonly reading: number;
  readonly known: number;
  readonly failed: number;
  readonly withheld: number;
  readonly byKind: Readonly<Record<ZeropsResourceKind, number>>;
}

export interface ZeropsResourceBroker {
  readonly scope: AccountScope;
  /**
   * One atom per key. Mounting it is the demand for the resource; its value is
   * the resource read through withholding, so a lapse and the next grant reach
   * the mounted view without a remount.
   */
  readonly known: <Request extends ZeropsResourceRequest>(
    request: Request,
  ) => Atom.Atom<Shown<ZeropsResourceValue<Request>>>;
  /** The same demand, held by an Effect scope. */
  readonly acquire: <Request extends ZeropsResourceRequest>(
    request: Request,
  ) => Effect.Effect<ZeropsResourceLease<Request>, ZeropsResourceAdmissionError, Scope.Scope>;
  /** Counts and states only; resource values and adapter errors never enter diagnostics. */
  readonly diagnostics: Effect.Effect<ZeropsResourceDiagnostics>;
  /** Withholds and erases what the current access no longer covers; re-reads what it covers again. */
  readonly reconcileAccess: Effect.Effect<void>;
  /** Idempotent. Fences completion, aborts work and erases all retained values. */
  readonly shutdown: Effect.Effect<void>;
}

export interface ZeropsResourceBrokerOptions {
  readonly scope: AccountScope;
  readonly adapter: ZeropsResourceAdapter;
  /** Dynamic account access owned by the parent runtime. */
  readonly access: () => AccessState;
  readonly maxEntries?: number;
  /** How long a resource no one demands keeps its value (DESIGN §5 L2). */
  readonly idleRetentionMs?: number;
  /** The jitter source of the retry policy. */
  readonly random?: () => number;
}

export const RESOURCE_IDLE_RETENTION_MS = 10 * 60_000;

type AnyResourceValue = ZeropsResourceValues[ZeropsResourceKind];
type AnyShown = Shown<AnyResourceValue>;

/** One consumer's demand: told every change, and told once when the broker closes. */
interface Demand {
  readonly publish: (shown: AnyShown) => void;
  readonly close: () => void;
}

interface ResourceRead {
  readonly ordinal: number;
  readonly controller: AbortController;
  fiber: Fiber.Fiber<void> | null;
}

interface ResourceEntry {
  readonly key: ZeropsResourceKey;
  readonly request: ZeropsResourceRequest;
  cell: Cell<AnyResourceValue>;
  shown: AnyShown;
  readonly demands: Map<number, Demand>;
  inFlight: ResourceRead | null;
  backoff: Backoff;
  /** The wake at the failed read's `retryAt`, while demanded. */
  retryWake: Fiber.Fiber<void> | null;
  /** The end of the idle retention window, while nothing demands the entry. */
  evictionWake: Fiber.Fiber<void> | null;
}

/** What an open demand answers to its holder. */
interface OpenDemand {
  readonly key: ZeropsResourceKey;
  /** Neither released nor closed with the broker. */
  readonly active: () => boolean;
  readonly shown: () => AnyShown;
  readonly retry: () => boolean | ZeropsResourceAdmissionError;
  readonly release: () => void;
}

type Admission =
  | { readonly kind: "admitted"; readonly deadlineMs: number }
  | { readonly kind: "withheld"; readonly reason: WithheldReason };

/** What a demand that holds nothing shows. */
const NOT_DEMANDED: AnyShown = { state: "unread", waitingFor: null };
/** What a demand shows once its account closed. */
const ACCOUNT_CLOSED: AnyShown = { state: "unread", waitingFor: "zerops-session" };

const REFUSAL_WORDS: Readonly<Record<ZeropsResourceAdmissionError["reason"], string>> = {
  "runtime-closed": "This account is signed out.",
  "account-mismatch": "This read belongs to another account.",
  "account-capacity": "Too many resources are open at once.",
  "lease-released": "This read is no longer held.",
};

const accountRefsEqual = (left: AccountRef, right: AccountRef): boolean =>
  left.apiOrigin === right.apiOrigin && left.accountId === right.accountId;

const accountScopesEqual = (left: AccountScope, right: AccountScope): boolean =>
  left.epoch === right.epoch && accountRefsEqual(left.account, right.account);

/** The grant a resource outside any denial stands on. */
const usableGrant = (access: AccessState): VerifiedAccessGrant | null => {
  if (access.status === "verified") return access;
  if (access.status === "verifying" || access.status === "failed" || access.status === "denied") {
    return access.previous;
  }
  return null;
};

const organizationOf = (request: ZeropsResourceRequest): OrganizationRef => {
  switch (request.kind) {
    case "organization-locations":
    case "organization-integration-token-grants":
      return request.organization;
    case "service-authorized-agents":
    case "service-deployed-version":
    case "service-mate-flag":
      return request.service.project.organization;
  }
};

/** The project a resource belongs to; an organization's resource belongs to none. */
const projectOf = (request: ZeropsResourceRequest): ProjectRef | null => {
  switch (request.kind) {
    case "organization-locations":
    case "organization-integration-token-grants":
      return null;
    case "service-authorized-agents":
    case "service-deployed-version":
    case "service-mate-flag":
      return request.service.project;
  }
};

/** The access scope that withholds a resource: its project, or the account for an organization's. */
const cellScopeOf = (request: ZeropsResourceRequest): Cell<AnyResourceValue>["scope"] =>
  projectOf(request)?.projectId ?? "account";

/** A denial of the account covers every resource; a project's covers only that project's. */
const denialCovers = (scope: AccessDenialScope, request: ZeropsResourceRequest): boolean => {
  if (scope.kind === "account") return true;
  const project = projectOf(request);
  return project !== null && projectKeyOf(project) === projectKeyOf(scope.project);
};

export function zeropsResourceKeyOf(request: ZeropsResourceRequest): ZeropsResourceKey {
  const organization = organizationOf(request);
  const prefix = [
    request.kind,
    request.account.account.apiOrigin,
    request.account.account.accountId,
    request.account.epoch,
    organization.organizationId,
  ];
  switch (request.kind) {
    case "organization-locations":
    case "organization-integration-token-grants":
      return JSON.stringify(prefix) as ZeropsResourceKey;
    case "service-authorized-agents":
    case "service-deployed-version":
    case "service-mate-flag":
      return JSON.stringify([
        ...prefix,
        request.service.project.projectId,
        request.service.serviceId,
      ]) as ZeropsResourceKey;
  }
}

/** The sanitized reason a read failed: the source's own message never leaves the adapter. */
const failureOf = (
  cause: Cause.Cause<ZeropsResourceSourceError>,
): { readonly failure: FailureReason; readonly retryable: boolean } => {
  const found = Cause.findError(cause);
  if (Result.isFailure(found)) {
    return {
      failure: { kind: "transport", detail: "The read ended unexpectedly." },
      retryable: false,
    };
  }
  const { kind, retryable } = found.success;
  switch (kind) {
    case "transport":
      return { failure: { kind: "transport", detail: "Zerops did not answer." }, retryable };
    case "unavailable":
      return {
        failure: { kind: "refused", code: "unavailable", words: "Zerops has no such resource." },
        retryable,
      };
    case "permission":
      return {
        failure: { kind: "refused", code: "permission", words: "Zerops refused this read." },
        retryable,
      };
    case "decode":
      return {
        failure: { kind: "malformed", detail: "Zerops answered in an unknown shape." },
        retryable,
      };
  }
};

const admissionError = (
  reason: ZeropsResourceAdmissionError["reason"],
): ZeropsResourceAdmissionError => ({ _tag: "ZeropsResourceAdmissionError", reason });

const requestInScope = (scope: AccountScope, request: ZeropsResourceRequest): boolean =>
  accountScopesEqual(request.account, scope) &&
  accountRefsEqual(organizationOf(request).account, scope.account);

function resourceAdmission(
  scope: AccountScope,
  access: AccessState,
  request: ZeropsResourceRequest,
  nowMs: number,
): Admission {
  const withheld = (reason: WithheldReason): Admission => ({ kind: "withheld", reason });
  if (access.status === "denied" && denialCovers(access.scope, request)) {
    return withheld("access-denied");
  }
  if (access.status === "expired") return withheld("access-lapsed");
  const grant = usableGrant(access);
  if (grant === null) return withheld("access-unverified");
  if (
    grant.accountEpoch !== scope.epoch ||
    !accountRefsEqual(grant.account, scope.account) ||
    grant.deadlineMs <= nowMs
  ) {
    return withheld("access-lapsed");
  }
  const organization = organizationOf(request);
  if (
    !grant.organizations.some(
      (entry) => organizationKeyOf(entry.organization) === organizationKeyOf(organization),
    )
  ) {
    return withheld("access-denied");
  }
  const project = projectOf(request);
  if (project !== null && !projectRoleGrantsAccess(grant, project, "any-role")) {
    return withheld("access-denied");
  }
  return { kind: "admitted", deadlineMs: grant.deadlineMs };
}

function readResource(
  adapter: ZeropsResourceAdapter,
  request: ZeropsResourceRequest,
  context: ZeropsResourceRequestContext,
): Effect.Effect<AnyResourceValue, ZeropsResourceSourceError> {
  switch (request.kind) {
    case "organization-locations":
      return adapter.readOrganizationLocations(request, context);
    case "service-authorized-agents":
      return adapter.readServiceAuthorizedAgents(request, context);
    case "service-deployed-version":
      return adapter.readServiceDeployedVersion(request, context);
    case "service-mate-flag":
      return adapter.readServiceMateFlag(request, context);
    case "organization-integration-token-grants":
      return adapter.readOrganizationIntegrationTokenGrants(request, context);
  }
}

/** Nothing is in flight over it: a one-shot reader may act on it. */
const isSettled = (shown: AnyShown): boolean => {
  switch (shown.state) {
    case "unread":
    case "reading":
      return false;
    case "known":
      return shown.freshness.kind !== "revalidating";
    case "failed":
    case "gone":
    case "withheld":
      return true;
  }
};

const readFailed = (cell: Cell<AnyResourceValue>): boolean =>
  cell.held.state === "failed" ||
  (cell.held.state === "known" &&
    cell.held.freshness.kind === "stale" &&
    cell.held.freshness.reason.kind === "revalidation-failed");

/**
 * The account's broker for configuration resources (DESIGN §2.B B6/B7). Each
 * key is one `Cell`: demand reads it, a lapse or a grant that no longer covers
 * its scope withholds it with its value erased and its read aborted (law 5's
 * one erasure), and the next grant covering the scope reads it again while the
 * demand stays (§9 C4).
 */
export const makeZeropsResourceBroker = Effect.fn("ZeropsResourceBroker.make")(function* (
  options: ZeropsResourceBrokerOptions,
): Effect.fn.Return<ZeropsResourceBroker> {
  const maxEntries = options.maxEntries ?? DEFAULT_ZEROPS_DATA_POLICY.activeSharedReadsPerAccount;
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    return yield* Effect.die(new RangeError("maxEntries must be a positive safe integer."));
  }

  // Demand arrives synchronously from atoms and scopes; reads and timers run
  // as fibers on the context the broker was built in.
  const fork = Effect.runForkWith(yield* Effect.context<never>());
  const clock = yield* Clock.Clock;
  const now = () => clock.currentTimeMillisUnsafe();
  const random = options.random ?? Math.random;
  const idleRetentionMs = options.idleRetentionMs ?? RESOURCE_IDLE_RETENTION_MS;
  const entries = new Map<ZeropsResourceKey, ResourceEntry>();
  const atoms = new Map<ZeropsResourceKey, Atom.Atom<AnyShown>>();
  let nextDemandId = 0;
  let ordinal = 0;
  let closed = false;
  let deadline: { readonly atMs: number; fiber: Fiber.Fiber<void> | null } | null = null;

  const setCell = (entry: ResourceEntry, cell: Cell<AnyResourceValue>): void => {
    const previous = entry.cell;
    entry.cell = cell;
    if (
      cell.held === previous.held &&
      cell.withheld?.reason === previous.withheld?.reason &&
      cell.withheld?.cause === previous.withheld?.cause
    ) {
      return;
    }
    entry.shown = read(cell);
    for (const demand of entry.demands.values()) demand.publish(entry.shown);
  };

  const apply = (entry: ResourceEntry, event: KnownEvent<AnyResourceValue>): void =>
    setCell(entry, advance(entry.cell, event, now()));

  const cancelRetry = (entry: ResourceEntry): void => {
    entry.retryWake?.interruptUnsafe();
    entry.retryWake = null;
  };

  const abortRead = (entry: ResourceEntry): void => {
    cancelRetry(entry);
    const inFlight = entry.inFlight;
    if (inFlight === null) return;
    entry.inFlight = null;
    inFlight.controller.abort();
    inFlight.fiber?.interruptUnsafe();
  };

  const cancelEviction = (entry: ResourceEntry): void => {
    entry.evictionWake?.interruptUnsafe();
    entry.evictionWake = null;
  };

  /** Ends the entry's identity: a later demand starts a new one at `unread`. */
  const dispose = (entry: ResourceEntry): void => {
    if (entries.get(entry.key) !== entry) return;
    entries.delete(entry.key);
    atoms.delete(entry.key);
    cancelEviction(entry);
    abortRead(entry);
  };

  /**
   * The last demand went: a held value stays for the retention window (and a
   * revalidation in flight may still land in it), anything else goes now.
   */
  const idle = (entry: ResourceEntry): void => {
    cancelRetry(entry);
    if (entry.cell.held.state !== "known" || entry.cell.withheld !== null) {
      dispose(entry);
      return;
    }
    // Map order is idle order: the entry idle longest is evicted first at capacity.
    entries.delete(entry.key);
    entries.set(entry.key, entry);
    entry.evictionWake = fork(
      Effect.sleep(Duration.millis(idleRetentionMs)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            entry.evictionWake = null;
            if (entry.demands.size === 0) dispose(entry);
          }),
        ),
      ),
    );
  };

  /** Makes room for a new key by ending the identity idle longest; `false` when every entry is demanded. */
  const evictIdle = (): boolean => {
    for (const entry of entries.values()) {
      if (entry.demands.size > 0) continue;
      dispose(entry);
      return true;
    }
    return false;
  };

  const completeRead = (
    entry: ResourceEntry,
    inFlight: ResourceRead,
    atMs: number,
    exit: Exit.Exit<AnyResourceValue, ZeropsResourceSourceError>,
  ): void => {
    if (closed || entries.get(entry.key) !== entry || entry.inFlight !== inFlight) return;
    entry.inFlight = null;
    if (Exit.isSuccess(exit)) {
      entry.backoff = INITIAL_BACKOFF;
      apply(entry, {
        kind: "read-succeeded",
        ordinal: inFlight.ordinal,
        value: exit.value,
        coverage: "complete",
        atMs,
      });
      return;
    }
    const { failure, retryable } = failureOf(exit.cause);
    const scheduled = retryable ? scheduleRetry(entry.backoff, now(), random) : null;
    if (scheduled !== null) entry.backoff = scheduled.backoff;
    apply(entry, {
      kind: "read-failed",
      ordinal: inFlight.ordinal,
      failure,
      retryAtMs: scheduled?.retryAtMs ?? null,
    });
    if (scheduled !== null) scheduleRetryWake(entry, scheduled.retryAtMs);
  };

  const startRead = (entry: ResourceEntry): void => {
    cancelRetry(entry);
    const inFlight: ResourceRead = {
      ordinal: ++ordinal,
      controller: new AbortController(),
      fiber: null,
    };
    const atMs = now();
    entry.inFlight = inFlight;
    apply(entry, { kind: "read-started", ordinal: inFlight.ordinal, atMs });
    inFlight.fiber = fork(
      readResource(options.adapter, entry.request, {
        abortSignal: inFlight.controller.signal,
      }).pipe(
        Effect.exit,
        Effect.flatMap((exit) => Effect.sync(() => completeRead(entry, inFlight, atMs, exit))),
      ),
    );
  };

  /** Withholding erases: the value and its read go, the demand stays for the next grant. */
  const withhold = (entry: ResourceEntry, reason: WithheldReason): void => {
    if (entry.demands.size === 0) {
      dispose(entry);
      return;
    }
    if (
      entry.cell.withheld?.reason === reason &&
      entry.cell.held.state === "unread" &&
      entry.inFlight === null
    ) {
      return;
    }
    abortRead(entry);
    setCell(
      entry,
      advance(newCell(entry.cell.scope), { kind: "withhold", reason, cause: null }, now()),
    );
  };

  const reconcileAll = (): void => {
    if (closed) return;
    const access = options.access();
    const nowMs = now();
    for (const entry of entries.values()) reconcile(entry, access, nowMs);
  };

  const scheduleAccessDeadline = (deadlineMs: number): void => {
    if (deadline?.atMs === deadlineMs) return;
    deadline?.fiber?.interruptUnsafe();
    const scheduled: { readonly atMs: number; fiber: Fiber.Fiber<void> | null } = {
      atMs: deadlineMs,
      fiber: null,
    };
    deadline = scheduled;
    scheduled.fiber = fork(
      Effect.sleep(Duration.millis(Math.max(0, deadlineMs - now()))).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (deadline === scheduled) deadline = null;
            reconcileAll();
          }),
        ),
      ),
    );
  };

  /**
   * Brings one entry in line with the access: withheld, or admitted and read
   * when it holds nothing. A new demand also revalidates a retained value.
   */
  function reconcile(
    entry: ResourceEntry,
    access: AccessState,
    nowMs: number,
    newlyDemanded = false,
  ): void {
    const admission = resourceAdmission(options.scope, access, entry.request, nowMs);
    if (admission.kind === "withheld") {
      withhold(entry, admission.reason);
      return;
    }
    scheduleAccessDeadline(admission.deadlineMs);
    if (entry.cell.withheld !== null) apply(entry, { kind: "restore-authority" });
    const held = entry.cell.held.state;
    if (entry.inFlight === null && (held === "unread" || (newlyDemanded && held === "known"))) {
      startRead(entry);
    }
  }

  /** Reads a failed resource again, under the access that holds now. */
  const readAgain = (entry: ResourceEntry): boolean => {
    if (!readFailed(entry.cell) || entry.inFlight !== null) return false;
    const admission = resourceAdmission(options.scope, options.access(), entry.request, now());
    if (admission.kind === "withheld") {
      withhold(entry, admission.reason);
      return false;
    }
    scheduleAccessDeadline(admission.deadlineMs);
    startRead(entry);
    return true;
  };

  /** Timers are hints (§4.0): the wake re-checks the entry before it reads. */
  function scheduleRetryWake(entry: ResourceEntry, retryAtMs: number): void {
    cancelRetry(entry);
    if (entry.demands.size === 0) return;
    entry.retryWake = fork(
      Effect.sleep(Duration.millis(Math.max(0, retryAtMs - now()))).pipe(
        Effect.andThen(
          Effect.sync(() => {
            entry.retryWake = null;
            if (closed || entries.get(entry.key) !== entry || entry.demands.size === 0) return;
            readAgain(entry);
          }),
        ),
      ),
    );
  }

  /** A user's "Try again" starts from the first rung. */
  const retry = (entry: ResourceEntry): boolean => {
    entry.backoff = backoffOn(entry.backoff, "user-retry");
    return readAgain(entry);
  };

  const open = (
    request: ZeropsResourceRequest,
    demand: Demand,
  ): OpenDemand | ZeropsResourceAdmissionError => {
    if (closed) return admissionError("runtime-closed");
    if (!requestInScope(options.scope, request)) return admissionError("account-mismatch");
    const key = zeropsResourceKeyOf(request);
    let entry = entries.get(key);
    if (entry === undefined) {
      if (entries.size >= maxEntries && !evictIdle()) return admissionError("account-capacity");
      const cell = newCell<AnyResourceValue>(cellScopeOf(request));
      entry = {
        key,
        request,
        cell,
        shown: read(cell),
        demands: new Map(),
        inFlight: null,
        backoff: INITIAL_BACKOFF,
        retryWake: null,
        evictionWake: null,
      };
      entries.set(key, entry);
    }
    const held = entry;
    const id = ++nextDemandId;
    held.demands.set(id, demand);
    if (held.demands.size === 1) {
      cancelEviction(held);
      reconcile(held, options.access(), now(), true);
    }
    const active = () => !closed && held.demands.has(id);
    return {
      key,
      active,
      shown: () => (active() ? held.shown : NOT_DEMANDED),
      retry: () => {
        if (closed) return admissionError("runtime-closed");
        return active() ? retry(held) : admissionError("lease-released");
      },
      release: () => {
        if (!held.demands.delete(id) || held.demands.size > 0) return;
        idle(held);
      },
    };
  };

  const known = <Request extends ZeropsResourceRequest>(
    request: Request,
  ): Atom.Atom<Shown<ZeropsResourceValue<Request>>> => {
    const key = zeropsResourceKeyOf(request);
    let atom = atoms.get(key);
    if (atom === undefined) {
      atom = Atom.make((get): AnyShown => {
        let mounted = false;
        const opened = open(request, {
          publish: (shown) => {
            if (mounted) get.setSelf(shown);
          },
          close: () => get.setSelf(ACCOUNT_CLOSED),
        });
        if ("_tag" in opened) {
          return {
            state: "failed",
            failure: { kind: "refused", code: opened.reason, words: REFUSAL_WORDS[opened.reason] },
            atMs: now(),
            attempt: 0,
            retryAtMs: null,
          };
        }
        get.addFinalizer(opened.release);
        mounted = true;
        return opened.shown();
      });
      atoms.set(key, atom);
    }
    return atom as Atom.Atom<Shown<ZeropsResourceValue<Request>>>;
  };

  const acquire: ZeropsResourceBroker["acquire"] = (request) =>
    Effect.gen(function* () {
      const leaseScope = yield* Scope.Scope;
      const waiters = new Set<Demand>();
      const closeWaiters = () => {
        for (const waiter of waiters) waiter.close();
      };
      const opened = open(request, {
        publish: (shown) => {
          for (const waiter of waiters) waiter.publish(shown);
        },
        close: closeWaiters,
      });
      if ("_tag" in opened) return yield* Effect.fail(opened);
      // A released lease is told nothing more, so its waits end with it.
      const release = Effect.sync(() => {
        opened.release();
        closeWaiters();
      });
      yield* Scope.addFinalizer(leaseScope, release);
      type Value = Shown<ZeropsResourceValue<typeof request>>;
      const shown = () => opened.shown() as Value;
      return {
        key: opened.key,
        request,
        snapshot: Effect.sync(shown),
        awaitSettled: Effect.callback<Value>((resume) => {
          const waiter: Demand = {
            publish: (next) => {
              if (!isSettled(next)) return;
              waiters.delete(waiter);
              resume(Effect.succeed(next as Value));
            },
            close: () => {
              waiters.delete(waiter);
              resume(Effect.interrupt);
            },
          };
          if (!opened.active()) return void resume(Effect.interrupt);
          waiters.add(waiter);
          waiter.publish(shown());
          return Effect.sync(() => waiters.delete(waiter));
        }),
        retry: Effect.suspend(() => {
          const retried = opened.retry();
          return typeof retried === "boolean" ? Effect.succeed(retried) : Effect.fail(retried);
        }),
        release,
      } satisfies ZeropsResourceLease<typeof request>;
    });

  const diagnostics: Effect.Effect<ZeropsResourceDiagnostics> = Effect.sync(() => {
    const byKind: Record<ZeropsResourceKind, number> = {
      "organization-locations": 0,
      "service-authorized-agents": 0,
      "service-deployed-version": 0,
      "service-mate-flag": 0,
      "organization-integration-token-grants": 0,
    };
    const counts = { leases: 0, reading: 0, known: 0, failed: 0, withheld: 0 };
    for (const entry of entries.values()) {
      byKind[entry.request.kind] += 1;
      counts.leases += entry.demands.size;
      if (entry.shown.state === "reading") counts.reading += 1;
      if (entry.shown.state === "known") counts.known += 1;
      if (entry.shown.state === "failed") counts.failed += 1;
      if (entry.shown.state === "withheld") counts.withheld += 1;
    }
    return { entries: entries.size, ...counts, byKind };
  });

  const shutdown = Effect.sync(() => {
    if (closed) return;
    closed = true;
    deadline?.fiber?.interruptUnsafe();
    deadline = null;
    const current = [...entries.values()];
    entries.clear();
    atoms.clear();
    for (const entry of current) {
      cancelEviction(entry);
      abortRead(entry);
      entry.cell = newCell(entry.cell.scope);
      entry.shown = ACCOUNT_CLOSED;
      for (const demand of entry.demands.values()) demand.close();
      entry.demands.clear();
    }
  });

  return {
    scope: options.scope,
    known,
    acquire,
    diagnostics,
    reconcileAccess: Effect.sync(reconcileAll),
    shutdown,
  } satisfies ZeropsResourceBroker;
});
