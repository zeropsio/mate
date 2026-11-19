/**
 * The knowledge type: how every remote fact reaches a projection (DESIGN §3).
 *
 * UI-free and platform-free (design-system R1): types only.
 */
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
  | "mate-session"
  | "presence"
  | "visible"
  | "data-slot"
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
  | {
      readonly kind: "source-recovering";
      readonly retryAtMs: number | null;
      readonly coverageGap?: boolean;
    }
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
