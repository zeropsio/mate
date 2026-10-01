/**
 * The store's cells: the reads no organization stream carries, one keyed cell each —
 * `tokens:{org}`, `members:{org}`, `locations:{org}`, `env:{service}`, `agents:{service}` and
 * `mate-flag:{service}`. Every caller of a key shares its one read; a value stays fresh for its
 * kind's while (`CELL_FRESH_MS`), our own writes invalidate it, an idle cell is kept
 * `CELL_IDLE_RETENTION_MS`, and access withholds what it no longer covers. The data adapter's
 * `cells` read them (`restAdapter.ts`).
 */
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import { Atom } from "effect/unstable/reactivity";

import type { ZeropsLocation, ZeropsOrganizationMember } from "../api.ts";
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

export interface LocationsCellRequest {
  readonly kind: "locations";
  readonly account: AccountScope;
  readonly organization: OrganizationRef;
}

/** The adapter projects service env rows to agent identifiers before returning. */
export interface AgentsCellRequest {
  readonly kind: "agents";
  readonly account: AccountScope;
  readonly service: ServiceRef;
}

/** The organization's members (`GET /client/{id}/user/list`): names, roles and pictures. */
export interface MembersCellRequest {
  readonly kind: "members";
  readonly account: AccountScope;
  readonly organization: OrganizationRef;
}

/** A service's variable names (`GET /service-stack/{id}/env`), never a value. */
export interface EnvCellRequest {
  readonly kind: "env";
  readonly account: AccountScope;
  readonly service: ServiceRef;
}

export interface TokensCellRequest {
  readonly kind: "tokens";
  readonly account: AccountScope;
  readonly organization: OrganizationRef;
}

/**
 * `ZCP_MATE_ENABLED` on a service — the one read fact that tells a container
 * not serving Zerops Mate apart from one that is merely away (spec-mate
 * §4.5, H9): a browser cannot, and `predates-mate` reads identically either
 * way. Read per service, only to confirm an off the organization's streamed
 * variables state (`environments/mateFlag.ts`).
 */
export interface MateFlagCellRequest {
  readonly kind: "mate-flag";
  readonly account: AccountScope;
  readonly service: ServiceRef;
}

export type ZeropsCellRequest =
  | LocationsCellRequest
  | AgentsCellRequest
  | MateFlagCellRequest
  | TokensCellRequest
  | MembersCellRequest
  | EnvCellRequest;

export type ZeropsCellKind = ZeropsCellRequest["kind"];

/** Grant metadata contains no integration-token credential. */
export interface ZeropsIntegrationTokenGrantMetadata {
  readonly tokenId: ZeropsIntegrationToken["id"];
  readonly name: ZeropsIntegrationToken["name"];
  readonly grants: ReadonlyArray<ZeropsProjectGrant>;
  /** When the platform minted it: the start-up throwaway sweep dates rows by it. */
  readonly created?: string | undefined;
  /** The token's own org role: the broker grant decides by it and writes it back unchanged. */
  readonly roleCode?: string | undefined;
}

export interface ZeropsCellValues {
  readonly locations: ReadonlyArray<ZeropsLocation>;
  readonly agents: ReadonlyArray<ZeropsAgentType>;
  /**
   * `"unknown"` for a read that failed rather than answered — never folded
   * into `false`, which is itself a fact a caller may act on (H9): a row
   * offering Enable off an `"unknown"` flag would be back to inferring.
   */
  readonly "mate-flag": { readonly enabled: boolean | "unknown" };
  readonly tokens: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>;
  readonly members: ReadonlyArray<ZeropsOrganizationMember>;
  readonly env: ReadonlyArray<string>;
}

/**
 * How long a value stays fresh for a new demand: one inside it is shown the value and reads
 * nothing; past it, a new demand reads again under the value. Our own writes invalidate it
 * (`invalidate`) whatever its age. `0` re-reads on every new demand.
 */
export const CELL_FRESH_MS: Readonly<Record<ZeropsCellKind, number>> = {
  locations: 0,
  agents: 0,
  "mate-flag": 0,
  tokens: 60_000,
  members: 5 * 60_000,
  env: 60_000,
};

export type ZeropsCellValue<Request extends ZeropsCellRequest> = ZeropsCellValues[Request["kind"]];

export type ZeropsCellKey = string & { readonly ZeropsCellKey: unique symbol };

export interface ZeropsCellSourceError {
  readonly _tag: "ZeropsCellSourceError";
  readonly kind: "transport" | "unavailable" | "permission" | "decode";
  readonly retryable: boolean;
}

export interface ZeropsCellReadContext {
  /**
   * Withholding, shutdown and the end of the entry abort this signal. The final
   * release ends an entry that holds no value; an entry that holds one is
   * retained, and its revalidation in flight runs on into the retention window.
   */
  readonly abortSignal: AbortSignal;
}

/**
 * These callbacks are the complete protocol seam. Implementations may wrap
 * ZeropsApiClient calls, but must perform secret stripping and env projection
 * before their Effects succeed.
 */
export interface ZeropsCellAdapter {
  readonly readOrganizationLocations: (
    request: LocationsCellRequest,
    context: ZeropsCellReadContext,
  ) => Effect.Effect<ZeropsCellValues["locations"], ZeropsCellSourceError>;
  readonly readServiceAuthorizedAgents: (
    request: AgentsCellRequest,
    context: ZeropsCellReadContext,
  ) => Effect.Effect<ZeropsCellValues["agents"], ZeropsCellSourceError>;
  readonly readServiceMateFlag: (
    request: MateFlagCellRequest,
    context: ZeropsCellReadContext,
  ) => Effect.Effect<ZeropsCellValues["mate-flag"], ZeropsCellSourceError>;
  readonly readOrganizationIntegrationTokenGrants: (
    request: TokensCellRequest,
    context: ZeropsCellReadContext,
  ) => Effect.Effect<ZeropsCellValues["tokens"], ZeropsCellSourceError>;
  readonly readOrganizationMembers: (
    request: MembersCellRequest,
    context: ZeropsCellReadContext,
  ) => Effect.Effect<ZeropsCellValues["members"], ZeropsCellSourceError>;
  readonly readServiceVariableNames: (
    request: EnvCellRequest,
    context: ZeropsCellReadContext,
  ) => Effect.Effect<ZeropsCellValues["env"], ZeropsCellSourceError>;
}

/** Why the broker takes no demand at all; access never refuses demand, it withholds (§9 C4). */
export interface ZeropsCellAdmissionError {
  readonly _tag: "ZeropsCellAdmissionError";
  readonly reason: "runtime-closed" | "account-mismatch" | "account-capacity" | "lease-released";
}

export interface ZeropsCellLease<Request extends ZeropsCellRequest> {
  readonly key: ZeropsCellKey;
  readonly request: Request;
  /** The cell read through withholding; a released lease shows nothing. */
  readonly snapshot: Effect.Effect<Shown<ZeropsCellValue<Request>>>;
  /** The first state with no read in flight: known, failed, gone or withheld; interrupted by release. */
  readonly awaitSettled: Effect.Effect<Shown<ZeropsCellValue<Request>>>;
  /** Reads again now, once for every lease, when the last read failed. */
  readonly retry: Effect.Effect<boolean, ZeropsCellAdmissionError>;
  /** Idempotent; the acquiring Scope invokes the same release path. */
  readonly release: Effect.Effect<void>;
}

export interface ZeropsCellDiagnostics {
  readonly entries: number;
  readonly leases: number;
  readonly reading: number;
  readonly known: number;
  readonly failed: number;
  readonly withheld: number;
  readonly byKind: Readonly<Record<ZeropsCellKind, number>>;
}

export interface ZeropsCells {
  readonly scope: AccountScope;
  /**
   * One atom per key. Mounting it is the demand for the cell; its value is
   * the cell read through withholding, so a lapse and the next grant reach
   * the mounted view without a remount.
   */
  readonly known: <Request extends ZeropsCellRequest>(
    request: Request,
  ) => Atom.Atom<Shown<ZeropsCellValue<Request>>>;
  /** The same demand, held by an Effect scope. */
  readonly acquire: <Request extends ZeropsCellRequest>(
    request: Request,
  ) => Effect.Effect<ZeropsCellLease<Request>, ZeropsCellAdmissionError, Scope.Scope>;
  /** Counts and states only; cell values and adapter errors never enter diagnostics. */
  readonly diagnostics: Effect.Effect<ZeropsCellDiagnostics>;
  /** Withholds and erases what the current access no longer covers; re-reads what it covers again. */
  readonly reconcileAccess: Effect.Effect<void>;
  /**
   * Our own write changed it: a demanded cell reads again now, once however often it is told;
   * an idle one on its next demand, whatever its freshness.
   */
  readonly invalidate: (request: ZeropsCellRequest) => Effect.Effect<void>;
  /** Idempotent. Fences completion, aborts work and erases all retained values. */
  readonly shutdown: Effect.Effect<void>;
}

export interface ZeropsCellsOptions {
  readonly scope: AccountScope;
  readonly adapter: ZeropsCellAdapter;
  /** Dynamic account access owned by the parent runtime. */
  readonly access: () => AccessState;
  readonly maxEntries?: number;
  /** How long a cell no one demands keeps its value (DESIGN §5 L2). */
  readonly idleRetentionMs?: number;
  /** The jitter source of the retry policy. */
  readonly random?: () => number;
}

export const CELL_IDLE_RETENTION_MS = 10 * 60_000;

type AnyCellValue = ZeropsCellValues[ZeropsCellKind];
type AnyShown = Shown<AnyCellValue>;

/** One consumer's demand: told every change, and told once when the broker closes. */
interface Demand {
  readonly publish: (shown: AnyShown) => void;
  readonly close: () => void;
}

interface CellReadInFlight {
  readonly ordinal: number;
  readonly controller: AbortController;
  fiber: Fiber.Fiber<void> | null;
}

interface CellEntry {
  readonly key: ZeropsCellKey;
  readonly request: ZeropsCellRequest;
  cell: Cell<AnyCellValue>;
  shown: AnyShown;
  readonly demands: Map<number, Demand>;
  inFlight: CellReadInFlight | null;
  backoff: Backoff;
  /** The wake at the failed read's `retryAt`, while demanded. */
  retryWake: Fiber.Fiber<void> | null;
  /** The end of the idle retention window, while nothing demands the entry. */
  evictionWake: Fiber.Fiber<void> | null;
}

/** What an open demand answers to its holder. */
interface OpenDemand {
  readonly key: ZeropsCellKey;
  /** Neither released nor closed with the broker. */
  readonly active: () => boolean;
  readonly shown: () => AnyShown;
  readonly retry: () => boolean | ZeropsCellAdmissionError;
  readonly release: () => void;
}

type Admission =
  | { readonly kind: "admitted"; readonly deadlineMs: number }
  | { readonly kind: "withheld"; readonly reason: WithheldReason };

/** What a demand that holds nothing shows. */
const NOT_DEMANDED: AnyShown = { state: "unread", waitingFor: null };
/** What a demand shows once its account closed, or when it names another account session. */
const ACCOUNT_CLOSED: AnyShown = { state: "unread", waitingFor: "zerops-session" };

const accountRefsEqual = (left: AccountRef, right: AccountRef): boolean =>
  left.apiOrigin === right.apiOrigin && left.accountId === right.accountId;

const accountScopesEqual = (left: AccountScope, right: AccountScope): boolean =>
  left.epoch === right.epoch && accountRefsEqual(left.account, right.account);

/** The grant a cell outside any denial stands on. */
const usableGrant = (access: AccessState): VerifiedAccessGrant | null => {
  if (access.status === "verified") return access;
  if (access.status === "verifying" || access.status === "failed" || access.status === "denied") {
    return access.previous;
  }
  return null;
};

const organizationOf = (request: ZeropsCellRequest): OrganizationRef => {
  switch (request.kind) {
    case "locations":
    case "tokens":
    case "members":
      return request.organization;
    case "agents":
    case "mate-flag":
    case "env":
      return request.service.project.organization;
  }
};

/** The project a cell belongs to; an organization's cell belongs to none. */
const projectOf = (request: ZeropsCellRequest): ProjectRef | null => {
  switch (request.kind) {
    case "locations":
    case "tokens":
    case "members":
      return null;
    case "agents":
    case "mate-flag":
    case "env":
      return request.service.project;
  }
};

/** The access scope that withholds a cell: its project, or the account for an organization's. */
const cellScopeOf = (request: ZeropsCellRequest): Cell<AnyCellValue>["scope"] =>
  projectOf(request)?.projectId ?? "account";

/** A denial of the account covers every cell; a project's covers only that project's. */
const denialCovers = (scope: AccessDenialScope, request: ZeropsCellRequest): boolean => {
  if (scope.kind === "account") return true;
  const project = projectOf(request);
  return project !== null && projectKeyOf(project) === projectKeyOf(scope.project);
};

export function zeropsCellKeyOf(request: ZeropsCellRequest): ZeropsCellKey {
  switch (request.kind) {
    case "locations":
    case "tokens":
    case "members":
      return `${request.kind}:${request.organization.organizationId}` as ZeropsCellKey;
    case "agents":
    case "mate-flag":
    case "env":
      return `${request.kind}:${request.service.serviceId}` as ZeropsCellKey;
  }
}

/** The sanitized reason a read failed: the source's own message never leaves the adapter. */
const failureOf = (
  cause: Cause.Cause<ZeropsCellSourceError>,
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

const admissionError = (reason: ZeropsCellAdmissionError["reason"]): ZeropsCellAdmissionError => ({
  _tag: "ZeropsCellAdmissionError",
  reason,
});

const requestInScope = (scope: AccountScope, request: ZeropsCellRequest): boolean =>
  accountScopesEqual(request.account, scope) &&
  accountRefsEqual(organizationOf(request).account, scope.account);

function cellAdmission(
  scope: AccountScope,
  access: AccessState,
  request: ZeropsCellRequest,
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

function readCell(
  adapter: ZeropsCellAdapter,
  request: ZeropsCellRequest,
  context: ZeropsCellReadContext,
): Effect.Effect<AnyCellValue, ZeropsCellSourceError> {
  switch (request.kind) {
    case "locations":
      return adapter.readOrganizationLocations(request, context);
    case "agents":
      return adapter.readServiceAuthorizedAgents(request, context);
    case "mate-flag":
      return adapter.readServiceMateFlag(request, context);
    case "tokens":
      return adapter.readOrganizationIntegrationTokenGrants(request, context);
    case "members":
      return adapter.readOrganizationMembers(request, context);
    case "env":
      return adapter.readServiceVariableNames(request, context);
  }
}

/** Nothing is in flight over it: a one-shot reader may act on it. */
const isSettled = (shown: AnyShown): boolean => {
  switch (shown.state) {
    case "unread":
    case "reading":
      return false;
    // A value being read again, or owed a read since our own write, is not an answer yet: a
    // reader waits for the new one. One whose re-read failed is that failure.
    case "known":
      return (
        shown.freshness.kind === "settled" ||
        shown.freshness.kind === "live" ||
        (shown.freshness.kind === "stale" && shown.freshness.reason.kind === "revalidation-failed")
      );
    case "failed":
    case "gone":
    case "withheld":
      return true;
  }
};

const readFailed = (cell: Cell<AnyCellValue>): boolean =>
  cell.held.state === "failed" ||
  (cell.held.state === "known" &&
    cell.held.freshness.kind === "stale" &&
    cell.held.freshness.reason.kind === "revalidation-failed");

/**
 * The account's cells (DESIGN §2.B B6/B7). Each key is one `Cell`: demand reads it, a lapse or a grant that no longer covers
 * its scope withholds it with its value erased and its read aborted (law 5's
 * one erasure), and the next grant covering the scope reads it again while the
 * demand stays (§9 C4).
 */
export const makeZeropsCells = Effect.fn("ZeropsCells.make")(function* (
  options: ZeropsCellsOptions,
): Effect.fn.Return<ZeropsCells> {
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
  const idleRetentionMs = options.idleRetentionMs ?? CELL_IDLE_RETENTION_MS;
  const entries = new Map<ZeropsCellKey, CellEntry>();
  const atoms = new Map<ZeropsCellKey, Atom.Atom<AnyShown>>();
  /** Atoms refused for capacity: each asks again at its retryAt, or at once when the broker closes. */
  const capacityWaits = new Set<() => void>();
  let nextDemandId = 0;
  let ordinal = 0;
  let closed = false;
  let deadline: { readonly atMs: number; fiber: Fiber.Fiber<void> | null } | null = null;

  const setCell = (entry: CellEntry, cell: Cell<AnyCellValue>): void => {
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

  const apply = (entry: CellEntry, event: KnownEvent<AnyCellValue>): void =>
    setCell(entry, advance(entry.cell, event, now()));

  const cancelRetry = (entry: CellEntry): void => {
    entry.retryWake?.interruptUnsafe();
    entry.retryWake = null;
  };

  const abortRead = (entry: CellEntry): void => {
    cancelRetry(entry);
    const inFlight = entry.inFlight;
    if (inFlight === null) return;
    entry.inFlight = null;
    inFlight.controller.abort();
    inFlight.fiber?.interruptUnsafe();
  };

  const cancelEviction = (entry: CellEntry): void => {
    entry.evictionWake?.interruptUnsafe();
    entry.evictionWake = null;
  };

  /** Ends the entry's identity: a later demand starts a new one at `unread`. */
  const dispose = (entry: CellEntry): void => {
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
  const idle = (entry: CellEntry): void => {
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
    entry: CellEntry,
    inFlight: CellReadInFlight,
    atMs: number,
    exit: Exit.Exit<AnyCellValue, ZeropsCellSourceError>,
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
      // Invalidated while it read: what it answered may predate the write, so it reads once more.
      if (entry.cell.dirty && entry.demands.size > 0) startRead(entry);
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

  const startRead = (entry: CellEntry): void => {
    cancelRetry(entry);
    const inFlight: CellReadInFlight = {
      ordinal: ++ordinal,
      controller: new AbortController(),
      fiber: null,
    };
    const atMs = now();
    entry.inFlight = inFlight;
    apply(entry, { kind: "read-started", ordinal: inFlight.ordinal, atMs });
    inFlight.fiber = fork(
      readCell(options.adapter, entry.request, {
        abortSignal: inFlight.controller.signal,
      }).pipe(
        Effect.exit,
        Effect.flatMap((exit) => Effect.sync(() => completeRead(entry, inFlight, atMs, exit))),
      ),
    );
  };

  /** Withholding erases: the value and its read go, the demand stays for the next grant. */
  const withhold = (entry: CellEntry, reason: WithheldReason): void => {
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
    entry: CellEntry,
    access: AccessState,
    nowMs: number,
    newlyDemanded = false,
  ): void {
    const admission = cellAdmission(options.scope, access, entry.request, nowMs);
    if (admission.kind === "withheld") {
      withhold(entry, admission.reason);
      return;
    }
    scheduleAccessDeadline(admission.deadlineMs);
    if (entry.cell.withheld !== null) apply(entry, { kind: "restore-authority" });
    const held = entry.cell.held;
    if (
      entry.inFlight === null &&
      (held.state === "unread" ||
        (newlyDemanded && held.state === "failed") ||
        (held.state === "known" &&
          (entry.cell.dirty ||
            entry.cell.lastInvalidation > held.asOf.ordinal ||
            (newlyDemanded && nowMs - held.asOf.atMs >= CELL_FRESH_MS[entry.request.kind]))))
    ) {
      startRead(entry);
    }
  }

  /** Reads a failed cell again, under the access that holds now. */
  const readAgain = (entry: CellEntry): boolean => {
    if (!readFailed(entry.cell) || entry.inFlight !== null) return false;
    const admission = cellAdmission(options.scope, options.access(), entry.request, now());
    if (admission.kind === "withheld") {
      withhold(entry, admission.reason);
      return false;
    }
    scheduleAccessDeadline(admission.deadlineMs);
    startRead(entry);
    return true;
  };

  /** Timers are hints (§4.0): the wake re-checks the entry before it reads. */
  function scheduleRetryWake(entry: CellEntry, retryAtMs: number): void {
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
  const retry = (entry: CellEntry): boolean => {
    entry.backoff = backoffOn(entry.backoff, "user-retry");
    return readAgain(entry);
  };

  const open = (
    request: ZeropsCellRequest,
    demand: Demand,
  ): OpenDemand | ZeropsCellAdmissionError => {
    if (closed) return admissionError("runtime-closed");
    if (!requestInScope(options.scope, request)) return admissionError("account-mismatch");
    const key = zeropsCellKeyOf(request);
    let entry = entries.get(key);
    if (entry === undefined) {
      if (entries.size >= maxEntries && !evictIdle()) return admissionError("account-capacity");
      const cell = newCell<AnyCellValue>(cellScopeOf(request));
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
    if (held.demands.size === 1) cancelEviction(held);
    // Every new demand, a first or one joining a held cell, gets a value inside its kind's
    // freshness, and a failed cell is read afresh rather than answering its old failure.
    reconcile(held, options.access(), now(), true);
    const active = () => !closed && held.demands.has(id);
    return {
      key,
      active,
      shown: () => {
        if (closed) return ACCOUNT_CLOSED;
        return held.demands.has(id) ? held.shown : NOT_DEMANDED;
      },
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

  const known = <Request extends ZeropsCellRequest>(
    request: Request,
  ): Atom.Atom<Shown<ZeropsCellValue<Request>>> => {
    const key = zeropsCellKeyOf(request);
    let atom = atoms.get(key);
    if (atom === undefined) {
      // Consecutive refusals for capacity, which the atom outlives between evaluations.
      let capacity = { backoff: INITIAL_BACKOFF, attempt: 0 };
      atom = Atom.make((get): AnyShown => {
        let mounted = false;
        const opened = open(request, {
          publish: (shown) => {
            if (mounted) get.setSelf(shown);
          },
          close: () => get.setSelf(ACCOUNT_CLOSED),
        });
        if ("_tag" in opened) {
          if (opened.reason !== "account-capacity") return ACCOUNT_CLOSED;
          // Capacity is the broker's own limit: the atom asks again at its retryAt.
          const atMs = now();
          const scheduled = scheduleRetry(capacity.backoff, atMs, random);
          capacity = { backoff: scheduled.backoff, attempt: capacity.attempt + 1 };
          const askAgain = () => get.refreshSelf();
          capacityWaits.add(askAgain);
          const wake = fork(
            Effect.sleep(Duration.millis(scheduled.retryAtMs - atMs)).pipe(
              Effect.andThen(Effect.sync(askAgain)),
            ),
          );
          get.addFinalizer(() => {
            capacityWaits.delete(askAgain);
            wake.interruptUnsafe();
          });
          return {
            state: "failed",
            failure: { kind: "throttled", retryAfterMs: null },
            atMs,
            attempt: capacity.attempt,
            retryAtMs: scheduled.retryAtMs,
          };
        }
        capacity = { backoff: INITIAL_BACKOFF, attempt: 0 };
        get.addFinalizer(opened.release);
        mounted = true;
        return opened.shown();
      });
      atoms.set(key, atom);
    }
    return atom as Atom.Atom<Shown<ZeropsCellValue<Request>>>;
  };

  const acquire: ZeropsCells["acquire"] = (request) =>
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
      type Value = Shown<ZeropsCellValue<typeof request>>;
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
      } satisfies ZeropsCellLease<typeof request>;
    });

  const diagnostics: Effect.Effect<ZeropsCellDiagnostics> = Effect.sync(() => {
    const byKind: Record<ZeropsCellKind, number> = {
      locations: 0,
      agents: 0,
      "mate-flag": 0,
      tokens: 0,
      members: 0,
      env: 0,
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
    for (const askAgain of capacityWaits) askAgain();
  });

  return {
    scope: options.scope,
    known,
    acquire,
    diagnostics,
    reconcileAccess: Effect.sync(reconcileAll),
    invalidate: (request) =>
      Effect.sync(() => {
        if (closed) return;
        const entry = entries.get(zeropsCellKeyOf(request));
        if (entry === undefined) return;
        // A read out now — a first one included — began before the write: it reads once more.
        apply(entry, { kind: "invalidated", ordinal: ++ordinal });
        // A read in flight began before the write: it is read once more when it answers (M3).
        if (entry.demands.size > 0 && entry.inFlight === null)
          reconcile(entry, options.access(), now());
      }),
    shutdown,
  } satisfies ZeropsCells;
});
