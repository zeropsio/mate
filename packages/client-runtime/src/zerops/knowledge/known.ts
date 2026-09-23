/**
 * The knowledge type: how every remote fact reaches a projection (DESIGN §3).
 *
 * UI-free and platform-free (design-system R1), and a pure reducer: no Effect runtime, no fetch,
 * no storage, no clock. The caller passes the wall time of the transition.
 */
import type { ZeropsProjectId } from "../data/types.ts";

/** Local bookkeeping. Ordering uses `ordinal` and nothing else; `atMs` is for "as of" copy only. */
export interface Stamp {
  /** Store-local and strictly increasing from 1: a read-start ticket or a push receipt ordinal. */
  readonly ordinal: number;
  /** Local wall time the evidence was produced (read start or push receipt). */
  readonly atMs: number;
}

/** What a read waits for before it can start. Waiting is not a failure. */
export type Prerequisite =
  | "zerops-session"
  | "access-grant"
  | "gitea-session"
  | "mate-session"
  | "presence"
  | "visible"
  | "online";

export type FailureReason =
  | { readonly kind: "offline" }
  | { readonly kind: "timeout"; readonly afterMs: number }
  | { readonly kind: "transport"; readonly detail: string }
  | { readonly kind: "throttled"; readonly retryAfterMs: number | null }
  | { readonly kind: "server"; readonly status: number }
  /** This owner's credential died; its session machine takes over. */
  | { readonly kind: "unauthorized" }
  /** The source's own "no", in its own words. */
  | { readonly kind: "refused"; readonly code: string; readonly words: string }
  | { readonly kind: "malformed"; readonly detail: string }
  /** An older Mate lacks the capability: never retried automatically. */
  | { readonly kind: "unsupported"; readonly capability: string };

export type StaleReason =
  | { readonly kind: "source-recovering"; readonly retryAtMs: number | null }
  | {
      readonly kind: "revalidation-failed";
      readonly failure: FailureReason;
      /** Consecutive failed revalidations over this value. */
      readonly attempt: number;
      readonly retryAtMs: number | null;
    }
  /** An admitted invalidation is newer than this value's read start. */
  | { readonly kind: "invalidated" }
  /** A push announced a newer identity not yet read. */
  | { readonly kind: "superseded"; readonly by: string };

export type Freshness =
  | { readonly kind: "live" }
  | { readonly kind: "settled" }
  /** A read or a resubscribe is in flight over the value. */
  | { readonly kind: "revalidating"; readonly sinceMs: number }
  /** The push source is paused: the value is not current. */
  | { readonly kind: "paused"; readonly by: "background" | "offline" }
  | { readonly kind: "stale"; readonly reason: StaleReason; readonly sinceMs: number };

export type AbsenceEvidence =
  /** A direct read of exactly this scope, confirmed. */
  | "direct-not-found"
  | "direct-forbidden"
  /** A complete observing query lacks it and a direct read confirmed. */
  | "complete-scope-omits-verified"
  /** An entity removal (never a membership delta) or our own delete. */
  | "authoritative-removal"
  | "removed-by-user";

export type Coverage = "complete" | "partial";

export type Known<T> =
  | { readonly state: "unread"; readonly waitingFor: Prerequisite | null }
  | { readonly state: "reading"; readonly sinceMs: number; readonly attempt: number }
  | {
      /** No value was ever known for this identity. */
      readonly state: "failed";
      readonly failure: FailureReason;
      readonly atMs: number;
      readonly attempt: number;
      /** `null`: only a named user action or an input change leaves this state. */
      readonly retryAtMs: number | null;
    }
  | {
      /** `T` carries its own domain negatives, e.g. `Deployment { kind: "none" }`. */
      readonly state: "known";
      readonly value: T;
      readonly asOf: Stamp;
      readonly coverage: Coverage;
      readonly freshness: Freshness;
    }
  | { readonly state: "gone"; readonly evidence: AbsenceEvidence; readonly asOf: Stamp };

export type WithheldReason = "access-lapsed" | "access-unverified" | "access-denied";

/** The renewal state behind a withholding, so copy can name a cause (R-K3). */
export type WithholdingCause = {
  readonly failure: FailureReason;
  readonly retryAtMs: number | null;
} | null;

export interface Withholding {
  readonly reason: WithheldReason;
  readonly cause: WithholdingCause;
}

/** The only shape a consumer ever receives. */
export type Shown<T> = Known<T> | ({ readonly state: "withheld" } & Withholding);

/** What a store keeps. Private to the store; nothing past `read` sees it. */
export interface Cell<T> {
  readonly held: Known<T>;
  /** The access scope that withholds it; `null` for a cell outside platform access. */
  readonly scope: ZeropsProjectId | "account" | null;
  readonly withheld: Withholding | null;
  /** Ordinal of the newest read in flight. */
  readonly lastReadStart: number | null;
  /** Ordinal of the newest admitted invalidation; 0 before the first. */
  readonly lastInvalidation: number;
  /**
   * A read is owed: the value was invalidated during a read (M3), or no source stated its
   * coverage. Only a value admitted with stated coverage, newer than every admitted
   * invalidation, settles it; a failed read leaves it owed under the retry schedule.
   */
  readonly dirty: boolean;
}

export type KnownEvent<T> =
  | { readonly kind: "waiting"; readonly on: Prerequisite }
  | { readonly kind: "read-started"; readonly ordinal: number; readonly atMs: number }
  | {
      readonly kind: "read-succeeded";
      readonly ordinal: number;
      readonly value: T;
      readonly coverage: Coverage;
      readonly atMs: number;
    }
  | {
      readonly kind: "read-failed";
      readonly ordinal: number;
      readonly failure: FailureReason;
      readonly retryAtMs: number | null;
    }
  | {
      readonly kind: "pushed";
      readonly ordinal: number;
      readonly value: T;
      /** Stated by a source that knows it, e.g. a query observed with coverage (§3.5). */
      readonly coverage?: Coverage;
      readonly atMs: number;
    }
  | {
      readonly kind: "source";
      readonly freshness:
        | "live"
        | "revalidating"
        | "paused-background"
        | "paused-offline"
        | "recovering";
      readonly retryAtMs?: number | null;
    }
  | { readonly kind: "invalidated"; readonly ordinal: number }
  | {
      readonly kind: "proven-absent";
      readonly evidence: AbsenceEvidence;
      readonly ordinal: number;
      readonly atMs: number;
    }
  | { readonly kind: "withhold"; readonly reason: WithheldReason; readonly cause: WithholdingCause }
  | { readonly kind: "restore-authority" };

/** A new identity: a new key, an evicted entry read again, or a new epoch. */
export const newCell = <T>(scope: Cell<T>["scope"]): Cell<T> => ({
  held: { state: "unread", waitingFor: null },
  scope,
  withheld: null,
  lastReadStart: null,
  lastInvalidation: 0,
  dirty: false,
});

/** The public read. Withholding is applied here, so a surface cannot forget it (fail-closed, AL-09). */
export const read = <T>(cell: Cell<T>): Shown<T> =>
  cell.withheld !== null ? { state: "withheld", ...cell.withheld } : cell.held;

/**
 * The only way a cell changes: the transition table of DESIGN §3.2 under the monotonicity rules
 * of §3.3. Total — an event a state does not answer leaves the cell as it is.
 */
export function advance<T>(cell: Cell<T>, event: KnownEvent<T>, nowMs: number): Cell<T> {
  switch (event.kind) {
    case "waiting":
      return cell.held.state === "unread"
        ? { ...cell, held: { state: "unread", waitingFor: event.on } }
        : cell;
    case "read-started":
      return {
        ...cell,
        held: startRead(cell.held, event.atMs),
        lastReadStart: Math.max(cell.lastReadStart ?? 0, event.ordinal),
      };
    case "read-succeeded":
      return admitValue(completeRead(cell, event.ordinal), event, "read", nowMs);
    case "read-failed": {
      // A failure of a read superseded by one still in flight is dropped (§4.0).
      const superseded = cell.lastReadStart !== null && cell.lastReadStart > event.ordinal;
      const completed = completeRead(cell, event.ordinal);
      return superseded ? completed : { ...completed, held: failRead(cell.held, event, nowMs) };
    }
    case "pushed":
      return admitValue(cell, event, "push", nowMs);
    case "source":
      return cell.held.state === "known"
        ? {
            ...cell,
            held: {
              ...cell.held,
              freshness: sourceFreshness(
                cell.held.freshness,
                cell.held.asOf.ordinal < cell.lastInvalidation,
                event,
                nowMs,
              ),
            },
          }
        : cell;
    case "invalidated":
      return {
        ...cell,
        held:
          cell.held.state === "known" && event.ordinal > cell.held.asOf.ordinal
            ? { ...cell.held, freshness: invalidatedFreshness(cell.held.freshness, nowMs) }
            : cell.held,
        lastInvalidation: Math.max(cell.lastInvalidation, event.ordinal),
        dirty: cell.dirty || (cell.lastReadStart !== null && cell.lastReadStart < event.ordinal),
      };
    case "proven-absent": {
      const completed = completeRead(cell, event.ordinal);
      const held = cell.held;
      const newer = !("asOf" in held) || event.ordinal > held.asOf.ordinal;
      return newer
        ? {
            ...completed,
            held: {
              state: "gone",
              evidence: event.evidence,
              asOf: { ordinal: event.ordinal, atMs: event.atMs },
            },
            // Absence is sticky (M6): nothing is owed a read.
            dirty: false,
          }
        : completed;
    }
    case "withhold":
      return cell.scope === null
        ? cell
        : { ...cell, withheld: { reason: event.reason, cause: event.cause } };
    case "restore-authority":
      return { ...cell, withheld: null };
  }
}

function startRead<T>(held: Known<T>, atMs: number): Known<T> {
  switch (held.state) {
    case "unread":
      return { state: "reading", sinceMs: atMs, attempt: 1 };
    case "failed":
      return { state: "reading", sinceMs: atMs, attempt: held.attempt + 1 };
    case "known":
      return held.freshness.kind === "revalidating"
        ? held
        : { ...held, freshness: { kind: "revalidating", sinceMs: atMs } };
    case "reading":
    case "gone":
      return held;
  }
}

/** A completion releases its own ticket; a newer read still in flight keeps its own. */
const completeRead = <T>(cell: Cell<T>, ordinal: number): Cell<T> => ({
  ...cell,
  lastReadStart:
    cell.lastReadStart !== null && cell.lastReadStart > ordinal ? cell.lastReadStart : null,
});

/**
 * A read result or a push carrying a value. A value older than the applied one is suppressed
 * (M2); `gone` reopens only on a read newer than the absence (M6) — the store sends a read
 * result for a `gone` cell only after `UNAVAILABLE_REOPEN_ADMISSION`; a value older than an
 * admitted invalidation is stored but never fresh (M3).
 */
function admitValue<T>(
  cell: Cell<T>,
  event: {
    readonly ordinal: number;
    readonly value: T;
    readonly atMs: number;
    readonly coverage?: Coverage;
  },
  origin: "read" | "push",
  nowMs: number,
): Cell<T> {
  const held = cell.held;
  if (held.state === "gone" && origin === "push") return cell;
  if ("asOf" in held && event.ordinal <= held.asOf.ordinal) return cell;
  const invalidated = event.ordinal < cell.lastInvalidation;
  const freshness: Freshness = invalidated
    ? invalidatedFreshness(held.state === "known" ? held.freshness : null, nowMs)
    : { kind: origin === "read" ? "settled" : "live" };
  // A push that states no coverage keeps the value's; into a cell with none it is partial, and
  // a read is owed until one can prove the collection complete.
  const stated = event.coverage !== undefined;
  return {
    ...cell,
    held: {
      state: "known",
      value: event.value,
      asOf: { ordinal: event.ordinal, atMs: event.atMs },
      coverage: event.coverage ?? (held.state === "known" ? held.coverage : "partial"),
      freshness,
    },
    dirty: invalidated || (!stated && (cell.dirty || held.state !== "known")),
  };
}

function failRead<T>(
  held: Known<T>,
  event: Extract<KnownEvent<T>, { kind: "read-failed" }>,
  nowMs: number,
): Known<T> {
  const retryAtMs = event.failure.kind === "unsupported" ? null : event.retryAtMs;
  switch (held.state) {
    case "unread":
    case "reading":
    case "failed":
      return {
        state: "failed",
        failure: event.failure,
        atMs: nowMs,
        attempt: held.state === "unread" ? 1 : held.attempt,
        retryAtMs,
      };
    case "known": {
      if (event.ordinal <= held.asOf.ordinal) return held;
      const previous =
        held.freshness.kind === "stale" && held.freshness.reason.kind === "revalidation-failed"
          ? held.freshness.reason.attempt
          : 0;
      return {
        ...held,
        freshness: {
          kind: "stale",
          reason: {
            kind: "revalidation-failed",
            failure: event.failure,
            attempt: previous + 1,
            retryAtMs,
          },
          sinceMs: nowMs,
        },
      };
    }
    case "gone":
      return held;
  }
}

/** A live source never makes a value older than an admitted invalidation fresh (M3). */
function sourceFreshness(
  current: Freshness,
  invalidated: boolean,
  event: Extract<KnownEvent<unknown>, { kind: "source" }>,
  nowMs: number,
): Freshness {
  switch (event.freshness) {
    case "live":
      return invalidated ? invalidatedFreshness(current, nowMs) : { kind: "live" };
    case "revalidating":
      return current.kind === "revalidating" ? current : { kind: "revalidating", sinceMs: nowMs };
    case "paused-background":
      return { kind: "paused", by: "background" };
    case "paused-offline":
      return { kind: "paused", by: "offline" };
    case "recovering":
      return {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: event.retryAtMs ?? null },
        sinceMs: nowMs,
      };
  }
}

const invalidatedFreshness = (current: Freshness | null, nowMs: number): Freshness =>
  current?.kind === "stale" && current.reason.kind === "invalidated"
    ? current
    : { kind: "stale", reason: { kind: "invalidated" }, sinceMs: nowMs };
