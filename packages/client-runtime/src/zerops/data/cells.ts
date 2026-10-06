/**
 * The store's cells: the reads no organization stream carries, one keyed cell each —
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

export type ZeropsCellRequest = MateFlagCellRequest;

export type ZeropsCellKind = ZeropsCellRequest["kind"];

export interface ZeropsCellValues {
  /**
   * `"unknown"` for a read that failed rather than answered — never folded
   * into `false`, which is itself a fact a caller may act on (H9): a row
   * offering Enable off an `"unknown"` flag would be back to inferring.
   */
  readonly "mate-flag": { readonly enabled: boolean | "unknown" };
}

/**
 * How long a value stays fresh for a new demand: one inside it is shown the value and reads
 * nothing; past it, a new demand reads again under the value. Our own writes invalidate it
 * (`invalidate`) whatever its age. `0` re-reads on every new demand.
 */
export const CELL_FRESH_MS: Readonly<Record<ZeropsCellKind, number>> = {
  "mate-flag": 0,
};

export type ZeropsCellValue<Request extends ZeropsCellRequest> = ZeropsCellValues[Request["kind"]];

export type ZeropsCellKey = string & { readonly ZeropsCellKey: unique symbol };

export interface ZeropsCellSourceError {
  readonly _tag: "ZeropsCellSourceError";
  readonly kind: "transport" | "unavailable" | "permission" | "decode";
  readonly retryable: boolean;
  /** A 429's Retry-After: the cell reads nothing sooner. */
  readonly retryAfterMs?: number;
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
  readonly readServiceMateFlag: (
    request: MateFlagCellRequest,
    context: ZeropsCellReadContext,
  ) => Effect.Effect<ZeropsCellValues["mate-flag"], ZeropsCellSourceError>;
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
  readonly waiting: number;
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
  /** One manual Read again for a demanded failed cell or expired admission, from the first rung. */
  readonly readAgain: (request: ZeropsCellRequest) => Effect.Effect<boolean>;
  /**
   * The tab is visible again: every demanded cell whose retry came due while it was hidden reads
   * now, from the first rung.
   */
  readonly wake: Effect.Effect<void>;
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
  /** Bounds waiting and failed admissions separately from the active cells. */
  readonly maxQueuedEntries?: number;
  /** The jitter source of the retry policy. */
  readonly random?: () => number;
  /** Whether the tab is visible: a retry that comes due while it is not waits for `wake`. */
  readonly visible?: () => boolean;
}

export const CELL_ADMISSION_DEADLINE_MS = 30_000;

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
  /** Input revision consumed by the last attempt, including a failed one. */
  attemptedInvalidation: number;
  /** Ends a queued admission once, without starting a read. */
  admissionWake: Fiber.Fiber<void> | null;
  backoff: Backoff;
  /** The wake at the failed read's `retryAt`, while demanded. */
  retryWake: Fiber.Fiber<void> | null;
  /** Its retry came due while the tab was hidden: the next `wake` reads it. */
  retryDue: boolean;
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

const organizationOf = (request: ZeropsCellRequest): OrganizationRef =>
  request.service.project.organization;

/** The project a cell belongs to: its service's. */
const projectOf = (request: ZeropsCellRequest): ProjectRef => request.service.project;

/** The access scope that withholds a cell: its project, or the account for an organization's. */
const cellScopeOf = (request: ZeropsCellRequest): Cell<AnyCellValue>["scope"] =>
  projectOf(request).projectId;

/** A denial of the account covers every cell; a project's covers only that project's. */
const denialCovers = (scope: AccessDenialScope, request: ZeropsCellRequest): boolean => {
  if (scope.kind === "account") return true;
  return projectKeyOf(projectOf(request)) === projectKeyOf(scope.project);
};

export function zeropsCellKeyOf(request: ZeropsCellRequest): ZeropsCellKey {
  return `${request.kind}:${request.service.serviceId}` as ZeropsCellKey;
}

/** The sanitized reason a read failed: the source's own message never leaves the adapter. */
const failureOf = (
  cause: Cause.Cause<ZeropsCellSourceError>,
): {
  readonly failure: FailureReason;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
} => {
  const found = Cause.findError(cause);
  if (Result.isFailure(found)) {
    return {
      failure: { kind: "transport", detail: "The read ended unexpectedly." },
      retryable: false,
    };
  }
  const { kind, retryable } = found.success;
  if (found.success.retryAfterMs !== undefined)
    return {
      failure: { kind: "transport", detail: "Zerops did not answer." },
      retryable,
      retryAfterMs: found.success.retryAfterMs,
    };
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
  if (!projectRoleGrantsAccess(grant, projectOf(request), "any-role")) {
    return withheld("access-denied");
  }
  return { kind: "admitted", deadlineMs: grant.deadlineMs };
}

function readCell(
  adapter: ZeropsCellAdapter,
  request: ZeropsCellRequest,
  context: ZeropsCellReadContext,
): Effect.Effect<AnyCellValue, ZeropsCellSourceError> {
  return adapter.readServiceMateFlag(request, context);
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
  const idleRetentionMs = options.idleRetentionMs ?? CELL_IDLE_RETENTION_MS;
  const random = options.random ?? Math.random;
  const visible = options.visible ?? (() => true);
  const entries = new Map<ZeropsCellKey, CellEntry>();
  const atoms = new Map<ZeropsCellKey, Atom.Atom<AnyShown>>();
  const maxQueuedEntries =
    options.maxQueuedEntries ?? DEFAULT_ZEROPS_DATA_POLICY.queuedReadRequestsPerAccount;
  if (!Number.isSafeInteger(maxQueuedEntries) || maxQueuedEntries <= 0) {
    return yield* Effect.die(new RangeError("maxQueuedEntries must be a positive safe integer."));
  }
  /** Waiting and expired admissions keep their identity until admitted or released. */
  const pending = new Map<ZeropsCellKey, CellEntry>();
  /** Queue-full views: each asks again at its retryAt, at a Read again, or when the broker closes. */
  const refusedAtoms = new Map<ZeropsCellKey, () => void>();
  let draining = false;
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

  const cancelAdmission = (entry: CellEntry): void => {
    entry.admissionWake?.interruptUnsafe();
    entry.admissionWake = null;
  };

  const cancelRetry = (entry: CellEntry): void => {
    entry.retryWake?.interruptUnsafe();
    entry.retryWake = null;
    entry.retryDue = false;
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
  const dispose = (entry: CellEntry, wakeAdmission = true): void => {
    if (entries.get(entry.key) !== entry && pending.get(entry.key) !== entry) return;
    entries.delete(entry.key);
    pending.delete(entry.key);
    cancelAdmission(entry);
    atoms.delete(entry.key);
    cancelEviction(entry);
    abortRead(entry);
    if (wakeAdmission) drainAdmission();
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
    drainAdmission();
    if (entries.get(entry.key) !== entry) return;
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
      dispose(entry, false);
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
    const { failure, retryable, retryAfterMs } = failureOf(exit.cause);
    const ladder = retryable ? scheduleRetry(entry.backoff, now(), random) : null;
    if (ladder !== null) entry.backoff = ladder.backoff;
    // A Retry-After is a floor.
    const scheduled =
      ladder === null
        ? null
        : { retryAtMs: Math.max(ladder.retryAtMs, now() + (retryAfterMs ?? 0)) };
    const failed = advance(
      entry.cell,
      {
        kind: "read-failed",
        ordinal: inFlight.ordinal,
        failure,
        retryAtMs: scheduled?.retryAtMs ?? null,
      },
      now(),
    );
    // A newer write is a new input revision, even if the earlier read failed.
    // Its reader waits for that revision, rather than settling with the superseded failure.
    if (entry.demands.size > 0 && entry.cell.lastInvalidation > entry.attemptedInvalidation)
      startRead(entry, failed);
    else {
      setCell(entry, failed);
      if (scheduled !== null) scheduleRetryWake(entry, scheduled.retryAtMs);
    }
  };

  const startRead = (entry: CellEntry, cell = entry.cell): void => {
    cancelRetry(entry);
    const inFlight: CellReadInFlight = {
      ordinal: ++ordinal,
      controller: new AbortController(),
      fiber: null,
    };
    const atMs = now();
    entry.attemptedInvalidation = cell.lastInvalidation;
    entry.inFlight = inFlight;
    setCell(entry, advance(cell, { kind: "read-started", ordinal: inFlight.ordinal, atMs }, atMs));
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
    for (const entry of [...entries.values(), ...pending.values()]) reconcile(entry, access, nowMs);
    drainAdmission();
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
    passive = false,
  ): void {
    const admission = cellAdmission(options.scope, access, entry.request, nowMs);
    if (admission.kind === "withheld") {
      if (pending.has(entry.key)) cancelAdmission(entry);
      withhold(entry, admission.reason);
      return;
    }
    scheduleAccessDeadline(admission.deadlineMs);
    if (entry.cell.withheld !== null) {
      apply(entry, { kind: "restore-authority" });
      if (pending.has(entry.key)) queueAdmission(entry);
    }
    const held = entry.cell.held;
    if (pending.has(entry.key)) return;
    // A surface that starts watching a failed cell waits for its scheduled retry; a one-shot
    // reader reads it at once.
    if (
      newlyDemanded &&
      passive &&
      held.state === "failed" &&
      held.retryAtMs !== null &&
      entry.retryWake === null &&
      entry.inFlight === null
    )
      scheduleRetryWake(entry, held.retryAtMs);
    if (
      entry.inFlight === null &&
      (held.state === "unread" ||
        (newlyDemanded && !passive && readFailed(entry.cell)) ||
        entry.cell.lastInvalidation > entry.attemptedInvalidation ||
        (held.state === "known" &&
          newlyDemanded &&
          !readFailed(entry.cell) &&
          (entry.cell.dirty || nowMs - held.asOf.atMs >= CELL_FRESH_MS[entry.request.kind])))
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
    if (pending.has(entry.key)) {
      queueAdmission(entry);
      drainAdmission();
    } else {
      startRead(entry);
    }
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
            if (closed || entry.demands.size === 0) return;
            if (entries.get(entry.key) !== entry && pending.get(entry.key) !== entry) return;
            // Nothing is read while the tab is hidden: the wake that shows it reads.
            if (!visible()) entry.retryDue = true;
            else readAgain(entry);
          }),
        ),
      ),
    );
  }

  /** A person's Read again, or the tab coming back, starts from the first rung. */
  const retry = (entry: CellEntry): boolean => {
    entry.backoff = backoffOn(entry.backoff, "user-retry");
    return readAgain(entry);
  };

  /**
   * FIFO admission is woken by capacity release: a waiting key, and one whose wait expired
   * visibly, take the slot in order. A withheld key waits for its grant instead.
   */
  function drainAdmission(): void {
    if (closed || draining) return;
    draining = true;
    try {
      for (const entry of pending.values()) {
        if (entry.admissionWake === null && entry.cell.withheld !== null) continue;
        if (entries.size >= maxEntries && !evictIdle()) break;
        pending.delete(entry.key);
        cancelAdmission(entry);
        if (entry.cell.held.state === "failed")
          setCell(entry, { ...entry.cell, held: { state: "unread", waitingFor: "data-slot" } });
        entries.set(entry.key, entry);
        reconcile(entry, options.access(), now());
      }
    } finally {
      draining = false;
    }
  }

  function queueAdmission(entry: CellEntry): void {
    cancelAdmission(entry);
    // A wait past its deadline shows as failed and keeps its place for the next free slot.
    setCell(entry, { ...entry.cell, held: { state: "unread", waitingFor: "data-slot" } });
    entry.admissionWake = fork(
      Effect.sleep(Duration.millis(CELL_ADMISSION_DEADLINE_MS)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            entry.admissionWake = null;
            if (closed || pending.get(entry.key) !== entry) return;
            setCell(entry, {
              ...entry.cell,
              held: {
                state: "failed",
                failure: {
                  kind: "refused",
                  code: "data-slot-deadline",
                  words: "No data slot became available.",
                },
                atMs: now(),
                attempt: 1,
                retryAtMs: null,
              },
            });
          }),
        ),
      ),
    );
  }

  /** A new one-shot demand gets one attempt; watching an existing failure keeps it visible. */
  const open = (
    request: ZeropsCellRequest,
    demand: Demand,
    passive: boolean,
  ): OpenDemand | ZeropsCellAdmissionError => {
    if (closed) return admissionError("runtime-closed");
    if (!requestInScope(options.scope, request)) return admissionError("account-mismatch");
    const key = zeropsCellKeyOf(request);
    let entry = entries.get(key) ?? pending.get(key);
    if (entry === undefined) {
      const waits = entries.size >= maxEntries && !evictIdle();
      if (waits && pending.size >= maxQueuedEntries) return admissionError("account-capacity");
      const cell = newCell<AnyCellValue>(cellScopeOf(request));
      entry = {
        key,
        request,
        cell,
        shown: read(cell),
        demands: new Map(),
        inFlight: null,
        attemptedInvalidation: 0,
        admissionWake: null,
        backoff: INITIAL_BACKOFF,
        retryWake: null,
        retryDue: false,
        evictionWake: null,
      };
      if (waits) {
        pending.set(key, entry);
        queueAdmission(entry);
      } else {
        entries.set(key, entry);
      }
    }
    const held = entry;
    const id = ++nextDemandId;
    held.demands.set(id, demand);
    if (held.demands.size === 1) cancelEviction(held);
    // New action demands consume one revision; passive views preserve a terminal failure.
    reconcile(held, options.access(), now(), true, passive);
    if (pending.has(key)) drainAdmission();
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
        if (pending.has(key)) dispose(held);
        else idle(held);
      },
    };
  };

  const known = <Request extends ZeropsCellRequest>(
    request: Request,
  ): Atom.Atom<Shown<ZeropsCellValue<Request>>> => {
    const key = zeropsCellKeyOf(request);
    let atom = atoms.get(key);
    if (atom === undefined) {
      // Consecutive refusals for a full queue, which the atom outlives between evaluations.
      let refusals = { backoff: INITIAL_BACKOFF, attempt: 0 };
      atom = Atom.make((get): AnyShown => {
        let mounted = false;
        const opened = open(
          request,
          {
            publish: (shown) => {
              if (mounted) get.setSelf(shown);
            },
            close: () => get.setSelf(ACCOUNT_CLOSED),
          },
          true,
        );
        if ("_tag" in opened) {
          if (opened.reason !== "account-capacity") return ACCOUNT_CLOSED;
          // The queue is the broker's own limit: the atom asks again at its retryAt.
          const atMs = now();
          const scheduled = scheduleRetry(refusals.backoff, atMs, random);
          refusals = { backoff: scheduled.backoff, attempt: refusals.attempt + 1 };
          const askAgain = () => get.refreshSelf();
          refusedAtoms.set(key, askAgain);
          const wake = fork(
            Effect.sleep(Duration.millis(scheduled.retryAtMs - atMs)).pipe(
              Effect.andThen(Effect.sync(() => (visible() ? askAgain() : undefined))),
            ),
          );
          get.addFinalizer(() => {
            refusedAtoms.delete(key);
            wake.interruptUnsafe();
          });
          return {
            state: "failed",
            failure: {
              kind: "refused",
              code: "data-slot-queue-full",
              words: "The data slot queue is full.",
            },
            atMs,
            attempt: refusals.attempt,
            retryAtMs: scheduled.retryAtMs,
          };
        }
        refusals = { backoff: INITIAL_BACKOFF, attempt: 0 };
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
      const opened = open(
        request,
        {
          publish: (shown) => {
            for (const waiter of waiters) waiter.publish(shown);
          },
          close: closeWaiters,
        },
        false,
      );
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
    const byKind: Record<ZeropsCellKind, number> = { "mate-flag": 0 };
    const counts = { leases: 0, reading: 0, waiting: 0, known: 0, failed: 0, withheld: 0 };
    for (const entry of [...entries.values(), ...pending.values()]) {
      byKind[entry.request.kind] += 1;
      counts.leases += entry.demands.size;
      if (entry.admissionWake !== null) counts.waiting += 1;
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
    const current = [...entries.values(), ...pending.values()];
    entries.clear();
    pending.clear();
    atoms.clear();
    for (const askAgain of refusedAtoms.values()) askAgain();
    refusedAtoms.clear();
    for (const entry of current) {
      cancelEviction(entry);
      cancelAdmission(entry);
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
    readAgain: (request) =>
      Effect.sync(() => {
        if (closed || !requestInScope(options.scope, request)) return false;
        const key = zeropsCellKeyOf(request);
        const entry = entries.get(key) ?? pending.get(key);
        const askAgain = refusedAtoms.get(key);
        if (askAgain !== undefined) {
          askAgain();
          return true;
        }
        return entry !== undefined && entry.demands.size > 0 && retry(entry);
      }),
    wake: Effect.sync(() => {
      if (closed) return;
      for (const entry of [...entries.values(), ...pending.values()]) {
        if (!entry.retryDue || entry.demands.size === 0) continue;
        entry.retryDue = false;
        entry.backoff = backoffOn(entry.backoff, "visible-wake");
        readAgain(entry);
      }
      // A refused atom asking again re-registers itself: iterate over a copy.
      for (const askAgain of Array.from(refusedAtoms.values())) askAgain();
    }),
    shutdown,
  } satisfies ZeropsCells;
});
