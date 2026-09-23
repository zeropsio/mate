/**
 * The person's session on one Gitea, for one account epoch, as one pure machine (DESIGN §4.6):
 * `transitionGiteaSession(state, event, ctx) → { state, effects }`.
 *
 * - Effects are data: `run` an op and feed its answer back as an event carrying the op's
 *   `attempt`; arm the one timer per `schedule`, which delivers `TICK`; `cancel` it.
 * - An answer for any attempt but the one in flight is dropped (§4.0); after `CLOSE` every event
 *   is dropped, silently.
 * - Timers are hints: every event first settles what has come due on either clock.
 * - Every non-terminal state holds a timer, waits for demand, or waits for a visible tab (I7).
 *
 * "Gitea still setting up" and "the broker does not answer" are separate waits, each re-mint
 * preceded by a credential-less liveness check, so nothing is minted while the broker is down. A
 * Gitea 401 reacquires without dropping what was read; the third in 10 minutes refuses. A refusal
 * is asked again every 5 minutes while the tab is visible. `expiresIn` is honoured, and the token
 * renewed only while a surface wants it.
 */
import type { Instant } from "../data/access/grant.ts";
import { RETRY_JITTER, RETRY_RUNGS_MS } from "../knowledge/retryPolicy.ts";

/** "Gitea still setting up": 5 s rising to 60 s. */
export const PENDING_RUNGS_MS: ReadonlyArray<number> = [5_000, 10_000, 20_000, 40_000, 60_000];
/** The broker, or Zerops behind the mint, does not answer: 10 s rising to 60 s. */
export const UNAVAILABLE_RUNGS_MS: ReadonlyArray<number> = [10_000, 20_000, 40_000, 60_000];
/** A refusal is asked again this long after it was said, while the tab is visible. */
export const REFUSED_RETRY_MS = 5 * 60_000;
/** This many Gitea 401s inside the window refuse instead of reacquiring again. */
export const REACQUIRE_LIMIT = 3;
export const REACQUIRE_WINDOW_MS = 10 * 60_000;
/** A demanded token is renewed this long before it expires: 60 s, or 10 % of its life if more. */
export const RENEWAL_LEAD_MIN_MS = 60_000;
export const RENEWAL_LEAD_SHARE = 0.1;
/** Failed acquisitions before the regions that wait on the session name the cause. */
export const FAILURES_BEFORE_CAUSE = 2;

export const KEEPS_REFUSING = "Gitea keeps refusing this sign-in.";

/** A token the broker minted, as this session holds it. Never persisted, never logged. */
export interface GiteaToken {
  readonly token: string;
  /** The person's login on that Gitea, `u-…`. */
  readonly login: string;
  readonly issuedAt: Instant;
  /** The broker's `expiresIn`, or null when it did not say. */
  readonly lifetimeMs: number | null;
}

/** Why an acquisition did not bring a token back. */
export type GiteaAcquireFailure =
  /** The broker answered 502/503: Gitea is still setting up. */
  | { readonly kind: "setting-up" }
  /** Nothing answered: the broker, or Zerops for the throwaway mint. */
  | { readonly kind: "unreachable"; readonly source: "broker" | "zerops" }
  /** Gitea or the broker said no, in these words. */
  | { readonly kind: "refused"; readonly reason: string }
  /** The throwaway mint waited out a closed account window (C5a). */
  | { readonly kind: "access-unverified" }
  /** Zerops answered the mint 401; the Zerops session machine owns what follows. */
  | { readonly kind: "zerops-session" };

/** Where a liveness check returns to when the broker does not answer. */
export type GiteaRetrying =
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable"; readonly source: "broker" | "zerops" };

export type GiteaRenewal =
  | { readonly kind: "none" }
  | { readonly kind: "renewing"; readonly attempt: number }
  /** The renewal failed: the token is used until it expires, then this failure is judged. */
  | { readonly kind: "failed"; readonly failure: GiteaAcquireFailure };

export type GiteaSessionPhase =
  | { readonly kind: "idle" }
  | {
      readonly kind: "acquiring";
      readonly attempt: number;
      /** A retry from pending or unavailable checks the broker answers before it mints. */
      readonly step: "liveness" | "mint";
      readonly retrying: GiteaRetrying | null;
    }
  | { readonly kind: "signed-in"; readonly session: GiteaToken; readonly renewal: GiteaRenewal }
  /** A Gitea 401 ended the token; requests wait for the next one, and the facts stay. */
  | { readonly kind: "reacquiring"; readonly attempt: number; readonly login: string }
  | { readonly kind: "pending"; readonly retryAt: Instant }
  | {
      readonly kind: "unavailable";
      readonly source: "broker" | "zerops";
      readonly retryAt: Instant;
    }
  | {
      readonly kind: "waiting";
      readonly on: "identity-mint" | "zerops-session";
      readonly retryAt: Instant;
    }
  | { readonly kind: "refused"; readonly reason: string; readonly retryAt: Instant }
  | { readonly kind: "closed" };

export interface GiteaSessionMachine {
  readonly phase: GiteaSessionPhase;
  /** A surface wants this Gitea: retries and renewals run only while it does. */
  readonly demanded: boolean;
  /** Consecutive failed acquisitions and liveness checks; a token resets it. */
  readonly failures: number;
  /** Where the next retry sits on its ladder. */
  readonly rung: number;
  /** Monotonic times of the Gitea 401s inside the reacquire window. */
  readonly unauthorized: ReadonlyArray<number>;
  readonly nextAttempt: number;
  /** When the interpreter's one timer fires; null when nothing waits on time. */
  readonly timer: Instant | null;
}

export const initialGiteaSession: GiteaSessionMachine = {
  phase: { kind: "idle" },
  demanded: false,
  failures: 0,
  rung: 0,
  unauthorized: [],
  nextAttempt: 1,
  timer: null,
};

export type GiteaSessionEvent =
  | { readonly type: "DEMAND"; readonly demanded: boolean }
  | { readonly type: "LIVENESS"; readonly attempt: number; readonly up: boolean }
  | {
      readonly type: "ACQUIRED";
      readonly attempt: number;
      readonly token: string;
      readonly login: string;
      readonly expiresInMs: number | undefined;
    }
  | {
      readonly type: "ACQUIRE_FAILED";
      readonly attempt: number;
      readonly failure: GiteaAcquireFailure;
    }
  /** Gitea answered 401 to a request that carried `token`. */
  | { readonly type: "UNAUTHORIZED"; readonly token: string }
  | { readonly type: "TICK" }
  /** §6.4's visible wake. */
  | { readonly type: "WAKE" }
  | { readonly type: "ONLINE" }
  | { readonly type: "USER_RETRY" }
  /** The account epoch closed. */
  | { readonly type: "CLOSE" };

export type GiteaSessionEffect =
  | { readonly kind: "run"; readonly attempt: number; readonly op: "liveness" | "acquire" }
  | { readonly kind: "schedule"; readonly at: Instant }
  | { readonly kind: "cancel" };

export interface GiteaSessionContext {
  readonly now: Instant;
  readonly visible: boolean;
  /** The jitter source for the retry ladders. */
  readonly random: () => number;
}

type Effects = Array<GiteaSessionEffect>;

const after = (instant: Instant, ms: number): Instant => ({
  wall: instant.wall + ms,
  mono: instant.mono + ms,
});

/** True once either clock has passed `at`. */
const reached = (at: Instant, now: Instant): boolean => now.wall >= at.wall || now.mono >= at.mono;

/** Time since `from`, by whichever clock has moved further. */
const elapsed = (from: Instant, now: Instant): number =>
  Math.max(now.wall - from.wall, now.mono - from.mono);

const expired = (session: GiteaToken, now: Instant): boolean =>
  session.lifetimeMs !== null && elapsed(session.issuedAt, now) >= session.lifetimeMs;

const renewalLead = (lifetimeMs: number): number =>
  Math.max(RENEWAL_LEAD_MIN_MS, lifetimeMs * RENEWAL_LEAD_SHARE);

const renewDue = (session: GiteaToken, now: Instant): boolean =>
  session.lifetimeMs !== null &&
  elapsed(session.issuedAt, now) >= session.lifetimeMs - renewalLead(session.lifetimeMs);

/** A delay on `rungs` at the machine's rung, within the common ±20 % jitter. */
function retryAfter(
  machine: GiteaSessionMachine,
  rungs: ReadonlyArray<number>,
  ctx: GiteaSessionContext,
): { readonly retryAt: Instant; readonly rung: number } {
  const last = rungs.length - 1;
  const rung = Math.min(machine.rung, last);
  const jitter = 1 + RETRY_JITTER * (2 * ctx.random() - 1);
  return {
    retryAt: after(ctx.now, Math.round((rungs[rung] ?? 0) * jitter)),
    rung: machine.rung + 1,
  };
}

function start(
  machine: GiteaSessionMachine,
  step: "liveness" | "mint",
  retrying: GiteaRetrying | null,
  out: Effects,
): GiteaSessionMachine {
  const attempt = machine.nextAttempt;
  out.push({ kind: "run", attempt, op: step === "liveness" ? "liveness" : "acquire" });
  return {
    ...machine,
    nextAttempt: attempt + 1,
    phase: { kind: "acquiring", attempt, step, retrying },
  };
}

/** A retry from pending or unavailable checks the broker first; any other starts with the mint. */
function retry(machine: GiteaSessionMachine, out: Effects): GiteaSessionMachine {
  const phase = machine.phase;
  switch (phase.kind) {
    case "pending":
      return start(machine, "liveness", { kind: "pending" }, out);
    case "unavailable":
      return start(machine, "liveness", { kind: "unavailable", source: phase.source }, out);
    default:
      return start(machine, "mint", null, out);
  }
}

/** Where a failed acquisition leaves the session. */
function failed(
  machine: GiteaSessionMachine,
  failure: GiteaAcquireFailure,
  ctx: GiteaSessionContext,
): GiteaSessionMachine {
  switch (failure.kind) {
    case "setting-up": {
      const { retryAt, rung } = retryAfter(machine, PENDING_RUNGS_MS, ctx);
      return {
        ...machine,
        rung,
        failures: machine.failures + 1,
        phase: { kind: "pending", retryAt },
      };
    }
    case "unreachable": {
      const { retryAt, rung } = retryAfter(machine, UNAVAILABLE_RUNGS_MS, ctx);
      return {
        ...machine,
        rung,
        failures: machine.failures + 1,
        phase: { kind: "unavailable", source: failure.source, retryAt },
      };
    }
    case "refused":
      return {
        ...machine,
        phase: {
          kind: "refused",
          reason: failure.reason,
          retryAt: after(ctx.now, REFUSED_RETRY_MS),
        },
      };
    case "access-unverified":
    case "zerops-session": {
      const { retryAt, rung } = retryAfter(machine, RETRY_RUNGS_MS, ctx);
      return {
        ...machine,
        rung,
        phase: {
          kind: "waiting",
          on: failure.kind === "access-unverified" ? "identity-mint" : "zerops-session",
          retryAt,
        },
      };
    }
  }
}

/** The attempt whose answer the machine is waiting for, if any. */
function inFlight(phase: GiteaSessionPhase): number | null {
  switch (phase.kind) {
    case "acquiring":
    case "reacquiring":
      return phase.attempt;
    case "signed-in":
      return phase.renewal.kind === "renewing" ? phase.renewal.attempt : null;
    default:
      return null;
  }
}

function apply(
  machine: GiteaSessionMachine,
  event: GiteaSessionEvent,
  ctx: GiteaSessionContext,
  out: Effects,
): GiteaSessionMachine {
  const phase = machine.phase;
  switch (event.type) {
    case "DEMAND":
      return { ...machine, demanded: event.demanded };
    case "LIVENESS": {
      if (
        phase.kind !== "acquiring" ||
        phase.step !== "liveness" ||
        phase.attempt !== event.attempt
      )
        return machine;
      if (event.up) {
        out.push({ kind: "run", attempt: phase.attempt, op: "acquire" });
        return { ...machine, phase: { ...phase, step: "mint" } };
      }
      const retrying = phase.retrying ?? { kind: "unavailable", source: "broker" };
      return failed(
        machine,
        retrying.kind === "pending"
          ? { kind: "setting-up" }
          : { kind: "unreachable", source: retrying.source },
        ctx,
      );
    }
    case "ACQUIRED": {
      if (inFlight(phase) !== event.attempt) return machine;
      if (phase.kind === "acquiring" && phase.step !== "mint") return machine;
      return {
        ...machine,
        failures: 0,
        rung: 0,
        phase: {
          kind: "signed-in",
          session: {
            token: event.token,
            login: event.login,
            issuedAt: ctx.now,
            lifetimeMs: event.expiresInMs ?? null,
          },
          renewal: { kind: "none" },
        },
      };
    }
    case "ACQUIRE_FAILED": {
      if (inFlight(phase) !== event.attempt) return machine;
      if (phase.kind === "acquiring" && phase.step !== "mint") return machine;
      if (phase.kind === "signed-in") {
        return {
          ...machine,
          phase: { ...phase, renewal: { kind: "failed", failure: event.failure } },
        };
      }
      return failed(machine, event.failure, ctx);
    }
    case "UNAUTHORIZED": {
      if (phase.kind !== "signed-in" || phase.session.token !== event.token) return machine;
      const unauthorized = [
        ...machine.unauthorized.filter((at) => ctx.now.mono - at < REACQUIRE_WINDOW_MS),
        ctx.now.mono,
      ];
      if (unauthorized.length >= REACQUIRE_LIMIT) {
        return failed(
          { ...machine, unauthorized: [] },
          { kind: "refused", reason: KEEPS_REFUSING },
          ctx,
        );
      }
      const login = phase.session.login;
      if (phase.renewal.kind === "renewing") {
        return {
          ...machine,
          unauthorized,
          phase: { kind: "reacquiring", attempt: phase.renewal.attempt, login },
        };
      }
      const attempt = machine.nextAttempt;
      out.push({ kind: "run", attempt, op: "acquire" });
      return {
        ...machine,
        unauthorized,
        nextAttempt: attempt + 1,
        phase: { kind: "reacquiring", attempt, login },
      };
    }
    case "WAKE":
    case "ONLINE":
    case "USER_RETRY": {
      if (!machine.demanded) return machine;
      if (phase.kind === "pending" || phase.kind === "unavailable" || phase.kind === "waiting") {
        return retry({ ...machine, rung: 0 }, out);
      }
      // A refusal is not a network matter: only the person asks it again early.
      if (phase.kind === "refused" && event.type === "USER_RETRY") return retry(machine, out);
      return machine;
    }
    case "TICK":
    case "CLOSE":
      return machine;
  }
}

/** Whatever has come due by now, on either clock. */
function settle(
  machine: GiteaSessionMachine,
  ctx: GiteaSessionContext,
  out: Effects,
): GiteaSessionMachine {
  const phase = machine.phase;
  switch (phase.kind) {
    case "idle":
      return machine.demanded ? start(machine, "mint", null, out) : machine;
    case "pending":
    case "unavailable":
    case "waiting":
      return machine.demanded && reached(phase.retryAt, ctx.now) ? retry(machine, out) : machine;
    case "refused":
      return machine.demanded && ctx.visible && reached(phase.retryAt, ctx.now)
        ? retry(machine, out)
        : machine;
    case "signed-in": {
      const { session, renewal } = phase;
      if (expired(session, ctx.now)) {
        if (renewal.kind === "renewing") {
          return {
            ...machine,
            phase: { kind: "reacquiring", attempt: renewal.attempt, login: session.login },
          };
        }
        if (!machine.demanded) return { ...machine, phase: { kind: "idle" } };
        if (renewal.kind === "failed") return failed(machine, renewal.failure, ctx);
        const attempt = machine.nextAttempt;
        out.push({ kind: "run", attempt, op: "acquire" });
        return {
          ...machine,
          nextAttempt: attempt + 1,
          phase: { kind: "reacquiring", attempt, login: session.login },
        };
      }
      if (machine.demanded && renewal.kind === "none" && renewDue(session, ctx.now)) {
        const attempt = machine.nextAttempt;
        out.push({ kind: "run", attempt, op: "acquire" });
        return {
          ...machine,
          nextAttempt: attempt + 1,
          phase: { ...phase, renewal: { kind: "renewing", attempt } },
        };
      }
      return machine;
    }
    case "acquiring":
    case "reacquiring":
    case "closed":
      return machine;
  }
}

/** The one instant the machine waits on. */
function dueAt(machine: GiteaSessionMachine, ctx: GiteaSessionContext): Instant | null {
  const phase = machine.phase;
  switch (phase.kind) {
    case "pending":
    case "unavailable":
    case "waiting":
      return machine.demanded ? phase.retryAt : null;
    case "refused":
      // Come due while hidden, it waits for the visible wake instead of a timer.
      return machine.demanded && !reached(phase.retryAt, ctx.now) ? phase.retryAt : null;
    case "signed-in": {
      const { session, renewal } = phase;
      if (session.lifetimeMs === null || renewal.kind === "renewing") return null;
      const expiresAt = after(session.issuedAt, session.lifetimeMs);
      return machine.demanded && renewal.kind === "none"
        ? after(expiresAt, -renewalLead(session.lifetimeMs))
        : expiresAt;
    }
    case "idle":
    case "acquiring":
    case "reacquiring":
    case "closed":
      return null;
  }
}

const sameInstant = (a: Instant | null, b: Instant | null): boolean =>
  a === b || (a !== null && b !== null && a.wall === b.wall && a.mono === b.mono);

function reschedule(
  machine: GiteaSessionMachine,
  ctx: GiteaSessionContext,
  out: Effects,
): GiteaSessionMachine {
  const due = dueAt(machine, ctx);
  if (sameInstant(due, machine.timer)) return machine;
  out.push(due === null ? { kind: "cancel" } : { kind: "schedule", at: due });
  return { ...machine, timer: due };
}

export function transitionGiteaSession(
  machine: GiteaSessionMachine,
  event: GiteaSessionEvent,
  ctx: GiteaSessionContext,
): { readonly state: GiteaSessionMachine; readonly effects: ReadonlyArray<GiteaSessionEffect> } {
  if (machine.phase.kind === "closed") return { state: machine, effects: [] };
  const out: Effects = [];
  if (event.type === "CLOSE") {
    if (machine.timer !== null) out.push({ kind: "cancel" });
    return { state: { ...initialGiteaSession, phase: { kind: "closed" } }, effects: out };
  }
  // The clocks first: an event is judged at the instant it is delivered.
  let next = settle(machine, ctx, out);
  next = apply(next, event, ctx, out);
  next = settle(next, ctx, out);
  next = reschedule(next, ctx, out);
  return { state: next, effects: out };
}

// ── Projections ───────────────────────────────────────────────────────────────────────────────

/** What a surface that reads Gitea as the person shows about the session. */
export interface GiteaSessionView {
  /**
   * A token is held, or a 401 is being answered with a new one: what was read stays, and
   * requests wait for the token.
   */
  readonly signedIn: boolean;
  /** The person's login on that Gitea, `u-…`, while signed in. */
  readonly login: string | undefined;
  /** The cause, once the regions show it: a refusal at once, a wait after two failures. */
  readonly trouble: string | null;
}

export const GITEA_SIGNED_OUT: GiteaSessionView = {
  signedIn: false,
  login: undefined,
  trouble: null,
};

const RETRYING_CAUSE = {
  pending: "Gitea is still setting up.",
  broker: "Gitea isn't answering.",
  zerops: "Zerops isn't answering.",
} as const;

function retryingCause(machine: GiteaSessionMachine, retrying: GiteaRetrying): string | null {
  if (machine.failures < FAILURES_BEFORE_CAUSE) return null;
  return retrying.kind === "pending" ? RETRYING_CAUSE.pending : RETRYING_CAUSE[retrying.source];
}

export function giteaSessionView(machine: GiteaSessionMachine): GiteaSessionView {
  const phase = machine.phase;
  switch (phase.kind) {
    case "signed-in":
      return { signedIn: true, login: phase.session.login, trouble: null };
    case "reacquiring":
      return { signedIn: true, login: phase.login, trouble: null };
    case "refused":
      return { ...GITEA_SIGNED_OUT, trouble: phase.reason };
    case "pending":
      return { ...GITEA_SIGNED_OUT, trouble: retryingCause(machine, { kind: "pending" }) };
    case "unavailable":
      return {
        ...GITEA_SIGNED_OUT,
        trouble: retryingCause(machine, { kind: "unavailable", source: phase.source }),
      };
    case "acquiring":
      return phase.retrying === null
        ? GITEA_SIGNED_OUT
        : { ...GITEA_SIGNED_OUT, trouble: retryingCause(machine, phase.retrying) };
    case "idle":
    case "waiting":
    case "closed":
      return GITEA_SIGNED_OUT;
  }
}

/** The token a request carries now, if one is held. */
export function giteaSessionToken(machine: GiteaSessionMachine): string | undefined {
  return machine.phase.kind === "signed-in" ? machine.phase.session.token : undefined;
}

/** A request waits for the token an acquisition in flight brings back. */
export function giteaSessionAwaitsToken(machine: GiteaSessionMachine): boolean {
  return machine.phase.kind === "reacquiring" || machine.phase.kind === "acquiring";
}
