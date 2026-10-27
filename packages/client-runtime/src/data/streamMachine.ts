/**
 * The one lifecycle every connection and every logical scope runs: a pure
 * transition function from a phase, an event and the time to the next phase, its named next
 * action, and what the runtime must do. Adapters only classify a failure into an
 * {@link OutcomeClass}; this module alone owns retry, backoff and refusal.
 *
 * A root stream (a connection, `parent: null`) owns recovery. A child scope (a registration, an HQ
 * scope, a detail read) waits for its parent's next attempt when the parent goes down. Its own read
 * failing transiently on a live parent is its own to retry, on the same policy, opening nothing:
 * the link and its other scopes stay. A definitive refusal is terminal for unchanged input at
 * either level.
 *
 * @module data/streamMachine
 */

export type Phase =
  | "idle"
  | "connecting"
  | "baselining"
  | "live"
  | "stale"
  | "recovering"
  | "reauthenticating"
  | "paused"
  | "refused"
  | "unsupported"
  | "closed";

/** Every answer a source gives falls into one of these classes. */
export type OutcomeClass =
  | "definitive-refusal"
  | "recoverable-session"
  | "transient"
  | "access-unverified"
  | "authoritative-denial"
  | "proven-deletion"
  | "corrupt-data"
  | "uncertain-acceptance"
  | "observation-exhausted";

/**
 * The classes a stream's lifecycle answers. The rest belong to a fact (deletion, corrupt row) or
 * to an operation (uncertain acceptance, exhausted observation) and never move a stream.
 */
export type StreamOutcome = Extract<
  OutcomeClass,
  | "definitive-refusal"
  | "recoverable-session"
  | "transient"
  | "access-unverified"
  | "authoritative-denial"
>;

export interface StreamFault {
  readonly outcome: StreamOutcome;
  readonly message: string;
  /** The source's own code for it (HQ's `scope-error` code), where it named one. */
  readonly code?: string;
  /** What the source asked for (`Retry-After`), ms. */
  readonly retryAfterMs?: number;
}

export type NextAction =
  | { readonly kind: "await-demand" }
  | { readonly kind: "await-handshake"; readonly deadlineAt: number }
  | { readonly kind: "await-baseline"; readonly deadlineAt: number }
  | { readonly kind: "await-changes" }
  | { readonly kind: "revalidate"; readonly at: number }
  | { readonly kind: "await-parent" }
  | { readonly kind: "retry"; readonly at: number }
  | { readonly kind: "repair-session" }
  | { readonly kind: "await-access-verification" }
  | { readonly kind: "await-input-change" }
  | { readonly kind: "upgrade" }
  | { readonly kind: "none" };

/** The next actions each phase may name; the transition never pairs a phase with another. */
export const NEXT_ACTIONS: Readonly<Record<Phase, ReadonlyArray<NextAction["kind"]>>> = {
  idle: ["await-demand"],
  connecting: ["await-handshake"],
  baselining: ["await-baseline"],
  live: ["await-changes", "revalidate", "await-input-change"],
  stale: ["await-parent"],
  recovering: ["retry"],
  reauthenticating: ["repair-session"],
  paused: ["await-demand", "await-access-verification"],
  refused: ["await-input-change"],
  unsupported: ["upgrade"],
  closed: ["none"],
};

export interface StreamState {
  readonly phase: Phase;
  /**
   * `sampled`: no realtime, read again on a cadence while demanded. `once`: no realtime and nothing
   * that ages it by time — read again only when our write or the person's again asks.
   */
  readonly mode: "realtime" | "sampled" | "once";
  /** A root owns recovery; a child waits for its parent's attempts. */
  readonly parent: string | null;
  readonly demanded: boolean;
  /** Bumped by every attempt; inbound input of an older generation is late and ignored. */
  readonly generation: number;
  /** Consecutive failed attempts since the last live phase. */
  readonly failures: number;
  /** The session was already repaired once in this failure streak. */
  readonly repaired: boolean;
  readonly fault: StreamFault | null;
  readonly next: NextAction;
  /** When it last stopped being live, while it is not live again: when an outage began. */
  readonly lostAt?: number;
  /**
   * It stopped being live less than {@link STREAM_POLICY.reconnectGraceMs} ago and is reconnecting:
   * what it held stands as current ({@link liveOrHeld}). HQ ends every segment on purpose and a
   * socket blinks; neither is an outage until the grace runs out.
   */
  readonly held?: true;
  /**
   * When a stream not live before made its first attempt (a child: on its parent), while that was less than
   * {@link STREAM_POLICY.reconnectGraceMs} ago and it is not live yet: a failed first attempt is
   * retried within a second, a blink like a reconnect's, and not trouble until the grace runs out
   * ({@link streamTrouble}). Nothing was read, so nothing reads as live.
   */
  readonly patientSince?: number;
}

export type StreamEvent =
  | { readonly kind: "demand"; readonly demanded: boolean }
  /**
   * `baselineWithinMs`: how long its first answer may take, where the source names its own bound
   * ({@link STREAM_POLICY.baselineTimeoutMs} otherwise). `Infinity` names none: the connection's
   * own liveness bounds the wait — a source still working on an open connection is slow, not gone.
   */
  | { readonly kind: "handshake"; readonly baselineWithinMs?: number }
  /**
   * The root's socket exists and its upgrade is under way, queued or slow. The upgrade is waited
   * for until the ticket it carries would have expired, not for the attempt's fixed window.
   */
  | { readonly kind: "socket-created" }
  /**
   * `ages`: a source read once answered with a value that still changes without any write of
   * ours (an invitation waiting on its invitee), so it is read again on the cadence until it
   * answers settled.
   */
  | { readonly kind: "baseline-committed"; readonly ages?: boolean }
  /** `jitter` is a uniform draw in [0, 1] the caller supplies, so the function stays pure. */
  | { readonly kind: "fault"; readonly fault: StreamFault; readonly jitter: number }
  /** The retry the stream named came due. */
  | { readonly kind: "retry-due" }
  /** The named deadline of `connecting` or `baselining` passed. */
  | { readonly kind: "deadline" }
  /** The person asked to try again. */
  | { readonly kind: "manual-retry" }
  /** Network, visibility or focus returned: expedite recovery, never undo a refusal. */
  | { readonly kind: "resume" }
  /**
   * A sampled or read-once scope's value is old: its revalidation came due, or our own write
   * changed it. It is read again, under its value; a refusal stays refused.
   */
  | { readonly kind: "revalidate" }
  /** An input the refusal was decided over changed (credential, grant, filter). */
  | { readonly kind: "input-changed" }
  /** The single-flight session repair succeeded. */
  | { readonly kind: "session-repaired" }
  /**
   * The grace that began at `since` — a loss at `lostAt`, or a first try at `patientSince` — ran
   * out: a stream still not live is now down.
   */
  | { readonly kind: "grace-over"; readonly since: number }
  /** A child scope's registration starts on its parent's open connection. */
  | { readonly kind: "attempt" }
  /** A child scope's parent connection went down. */
  | { readonly kind: "parent-lost" }
  /** The source speaks no protocol this build reads. */
  | { readonly kind: "unsupported" }
  | { readonly kind: "close" };

export type StreamDirective =
  | { readonly kind: "connect"; readonly generation: number }
  | { readonly kind: "repair-session" }
  /** Close the transport; facts stay. */
  | { readonly kind: "disconnect" };

export interface StreamTransition {
  readonly state: StreamState;
  readonly directives: ReadonlyArray<StreamDirective>;
}

export const STREAM_POLICY = {
  /** The attempt's window to get a ticket and create the socket. */
  handshakeTimeoutMs: 10_000,
  /**
   * A created socket's window to open: the life of the one-use ticket it carries (HQ's 60 s). A
   * browser queues handshakes per address, so a slow upgrade is in progress, not dead; past the
   * ticket's life it cannot succeed and the attempt starts over from a new one.
   */
  socketHandshakeTimeoutMs: 60_000,
  baselineTimeoutMs: 20_000,
  backoffBaseMs: 1_000,
  backoffCapMs: 60_000,
  /** Where realtime is unverified, a demanded sampled source revalidates this often. */
  sampledIntervalMs: 30_000,
  /**
   * How long a stream that was live and is reconnecting still reads live: HQ's planned segment
   * end re-confirms in 90–270 ms, a dropped socket's first retry within about a second.
   */
  reconnectGraceMs: 5_000,
} as const;

/** What a connection or scope that passed its deadline says to the person. */
export const NO_ANSWER_IN_TIME = "No answer came in time.";

export function initialStream(input: {
  readonly parent: string | null;
  readonly mode: StreamState["mode"];
}): StreamState {
  return {
    phase: "idle",
    mode: input.mode,
    parent: input.parent,
    demanded: false,
    generation: 0,
    failures: 0,
    repaired: false,
    fault: null,
    next: { kind: "await-demand" },
  };
}

const settle = (state: StreamState): StreamTransition => ({ state, directives: [] });

function attempt(state: StreamState, now: number): StreamTransition {
  const generation = state.generation + 1;
  return {
    state: {
      ...state,
      phase: "connecting",
      generation,
      next: { kind: "await-handshake", deadlineAt: now + STREAM_POLICY.handshakeTimeoutMs },
    },
    // A child's attempt is its parent's registration; only a root opens a connection.
    directives: state.parent === null ? [{ kind: "connect", generation }] : [],
  };
}

const awaitParent = (state: StreamState): StreamTransition =>
  settle({ ...state, phase: "stale", next: { kind: "await-parent" } });

/** The one retry policy: capped exponential backoff, half-to-full jitter, `Retry-After` as a floor. */
export function retryDelayMs(failures: number, jitter: number, retryAfterMs?: number): number {
  const exponential = Math.min(
    STREAM_POLICY.backoffCapMs,
    STREAM_POLICY.backoffBaseMs * 2 ** Math.max(0, failures - 1),
  );
  return Math.max(retryAfterMs ?? 0, Math.round(exponential * (0.5 + jitter / 2)));
}

function fail(
  state: StreamState,
  fault: StreamFault,
  jitter: number,
  now: number,
): StreamTransition {
  const refuse = () =>
    settle({ ...state, phase: "refused", fault, next: { kind: "await-input-change" } });
  if (fault.outcome === "definitive-refusal" || fault.outcome === "authoritative-denial")
    return refuse();
  if (fault.outcome === "access-unverified")
    return settle({
      ...state,
      phase: "paused",
      fault,
      next: { kind: "await-access-verification" },
    });
  if (!state.demanded)
    return settle({ ...state, phase: "paused", fault, next: { kind: "await-demand" } });
  // Losing an established root transport starts recovery; it is not a failed attempt.
  const failures = state.failures + (state.parent === null && state.phase === "live" ? 0 : 1);
  // A child's session is its parent's: it waits for the parent's next attempt. Its own read
  // failing transiently is its own: it retries alone, on the one policy.
  if (state.parent !== null && fault.outcome !== "transient")
    return awaitParent({ ...state, failures, fault });
  if (fault.outcome === "recoverable-session") {
    if (state.repaired || state.phase === "reauthenticating") return refuse();
    return {
      state: { ...state, phase: "reauthenticating", fault, next: { kind: "repair-session" } },
      directives: [{ kind: "repair-session" }],
    };
  }
  return settle({
    ...state,
    phase: "recovering",
    failures,
    fault,
    next: { kind: "retry", at: now + retryDelayMs(failures, jitter, fault.retryAfterMs) },
  });
}

/** A phase that holds or seeks a subscription: not idle, paused, refused, unsupported or closed. */
const isActive = (phase: Phase): boolean =>
  phase === "connecting" ||
  phase === "baselining" ||
  phase === "live" ||
  phase === "stale" ||
  phase === "recovering" ||
  phase === "reauthenticating";

/** The phases a stream that was live passes through on its way back. */
const RECONNECTING: ReadonlySet<Phase> = new Set([
  "connecting",
  "baselining",
  "stale",
  "recovering",
  "reauthenticating",
]);

/** Live, or lost within its grace and on its way back: what it holds is current. */
export const liveOrHeld = (stream: StreamState): boolean =>
  stream.phase === "live" || stream.held === true;

/** When the grace a stream is in began — its loss from live, or its first try — while it is in one. */
export const graceSince = (stream: StreamState): number | undefined =>
  stream.held === true ? stream.lostAt : stream.patientSince;

/**
 * Whether a stream's trouble is worth saying, the one rule every surface reads: `stopped` at once
 * when it was refused or paused on a fault — nothing tries again until something changes;
 * `retrying` only for an attempt failing past its grace, measured from its loss when it had been
 * live and from its first try when it had not. A failed attempt inside the grace is a blink.
 */
export function streamTrouble(stream: StreamState): "stopped" | "retrying" | null {
  if (stream.phase === "refused" || (stream.phase === "paused" && stream.fault !== null))
    return "stopped";
  // A session repair counts no failure, and has no deadline of its own: it is bounded the same.
  const failing = stream.failures > 0 || stream.phase === "reauthenticating";
  return failing && !liveOrHeld(stream) && stream.patientSince === undefined ? "retrying" : null;
}

/**
 * One rule for every stream: leaving live for a reconnect holds what it read as current for the
 * grace, and dates the loss; a first attempt is given the same grace before a failure is
 * trouble; live again forgets all of it; a refusal, a pause or a close ends either grace.
 */
function hold(before: StreamState, after: StreamState, now: number): StreamState {
  if (after.phase === "live") {
    if (after.lostAt === undefined && after.held === undefined && after.patientSince === undefined)
      return after;
    const { lostAt: _lostAt, held: _held, patientSince: _patientSince, ...rest } = after;
    return rest;
  }
  if (!RECONNECTING.has(after.phase)) {
    if (after.held === undefined && after.patientSince === undefined) return after;
    const { held: _held, patientSince: _patientSince, ...rest } = after;
    return rest;
  }
  if (before.phase === "live") return { ...after, lostAt: now, held: true };
  // A stream never lost from live starts its grace with its first attempt — from rest, or a child's
  // first registration on its parent — never while it only waits for its parent.
  const firstTry =
    after.phase === "connecting" &&
    after.lostAt === undefined &&
    after.patientSince === undefined &&
    (!RECONNECTING.has(before.phase) || after.failures === 0);
  return firstTry ? { ...after, patientSince: now } : after;
}

export function transition(state: StreamState, event: StreamEvent, now: number): StreamTransition {
  if (event.kind === "grace-over") {
    if (state.held === true && state.lostAt === event.since) {
      const { held: _held, ...rest } = state;
      return settle(rest);
    }
    if (state.held !== true && state.patientSince === event.since) {
      const { patientSince: _patientSince, ...rest } = state;
      return settle(rest);
    }
    return settle(state);
  }
  const next = step(state, event, now);
  const held = hold(state, next.state, now);
  return held === next.state ? next : { ...next, state: held };
}

function step(state: StreamState, event: StreamEvent, now: number): StreamTransition {
  if (state.phase === "closed") return settle(state);
  if (event.kind === "close")
    return {
      state: { ...state, phase: "closed", demanded: false, next: { kind: "none" } },
      directives: [{ kind: "disconnect" }],
    };
  if (event.kind === "unsupported")
    return {
      state: { ...state, phase: "unsupported", next: { kind: "upgrade" } },
      directives: [{ kind: "disconnect" }],
    };
  if (state.phase === "refused" || state.phase === "unsupported")
    return state.phase === "refused" &&
      (event.kind === "manual-retry" || event.kind === "input-changed")
      ? attempt({ ...state, failures: 0, repaired: false, fault: null }, now)
      : settle(state);
  switch (event.kind) {
    case "demand":
      if (!event.demanded)
        return {
          state: { ...state, demanded: false, phase: "paused", next: { kind: "await-demand" } },
          directives: [{ kind: "disconnect" }],
        };
      if (state.phase !== "idle" && state.phase !== "paused")
        return settle({ ...state, demanded: true });
      return state.parent === null
        ? attempt({ ...state, demanded: true }, now)
        : awaitParent({ ...state, demanded: true });
    case "handshake":
      return state.phase === "connecting"
        ? settle({
            ...state,
            phase: "baselining",
            next: {
              kind: "await-baseline",
              deadlineAt: now + (event.baselineWithinMs ?? STREAM_POLICY.baselineTimeoutMs),
            },
          })
        : settle(state);
    case "socket-created":
      return state.phase === "connecting"
        ? settle({
            ...state,
            next: {
              kind: "await-handshake",
              deadlineAt: now + STREAM_POLICY.socketHandshakeTimeoutMs,
            },
          })
        : settle(state);
    case "baseline-committed":
      return state.phase === "baselining"
        ? settle({
            ...state,
            phase: "live",
            failures: 0,
            repaired: false,
            fault: null,
            next:
              state.mode === "sampled" || (state.mode === "once" && event.ages === true)
                ? { kind: "revalidate", at: now + STREAM_POLICY.sampledIntervalMs }
                : state.mode === "once"
                  ? { kind: "await-input-change" }
                  : { kind: "await-changes" },
          })
        : settle(state);
    case "fault":
      return fail(state, event.fault, event.jitter, now);
    case "retry-due":
      return state.phase === "recovering" ? attempt(state, now) : settle(state);
    case "attempt":
      return state.parent !== null && state.demanded && isActive(state.phase)
        ? attempt(state, now)
        : settle(state);
    case "parent-lost":
      return state.parent !== null && isActive(state.phase) ? awaitParent(state) : settle(state);
    case "deadline":
      return state.phase === "connecting" || state.phase === "baselining"
        ? fail(state, { outcome: "transient", message: NO_ANSWER_IN_TIME }, 1, now)
        : settle(state);
    case "session-repaired":
      return state.phase === "reauthenticating"
        ? attempt({ ...state, repaired: true }, now)
        : settle(state);
    case "revalidate":
      return state.mode !== "realtime" && (state.phase === "live" || state.phase === "recovering")
        ? attempt(state, now)
        : settle(state);
    case "manual-retry":
    case "input-changed":
      return state.phase === "recovering" || state.phase === "paused"
        ? attempt(state, now)
        : settle(state);
    case "resume":
      return state.demanded && state.phase === "recovering" ? attempt(state, now) : settle(state);
    case "grace-over":
      return settle(state);
  }
}

/** Phases in which a link observes nothing more until something outside it changes. */
export const UNOBSERVED_PHASES: ReadonlySet<string> = new Set([
  "paused",
  "refused",
  "unsupported",
  "closed",
]);
