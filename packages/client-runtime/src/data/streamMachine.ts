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
  live: ["await-changes", "revalidate"],
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
  readonly mode: "realtime" | "sampled";
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
}

export type StreamEvent =
  | { readonly kind: "demand"; readonly demanded: boolean }
  | { readonly kind: "handshake" }
  | { readonly kind: "baseline-committed" }
  /** `jitter` is a uniform draw in [0, 1] the caller supplies, so the function stays pure. */
  | { readonly kind: "fault"; readonly fault: StreamFault; readonly jitter: number }
  /** The retry the stream named came due. */
  | { readonly kind: "retry-due" }
  /** The named deadline of `connecting` or `baselining` passed. */
  | { readonly kind: "deadline" }
  /** The person asked to try again. */
  | { readonly kind: "manual-retry" }
  /**
   * A sampled scope's value is old: its revalidation came due, or our own write changed it. It is
   * read again, under its value; a refusal stays refused.
   */
  | { readonly kind: "revalidate" }
  /** An input the refusal was decided over changed (credential, grant, filter). */
  | { readonly kind: "input-changed" }
  /** The single-flight session repair succeeded. */
  | { readonly kind: "session-repaired" }
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
  handshakeTimeoutMs: 10_000,
  baselineTimeoutMs: 20_000,
  backoffBaseMs: 1_000,
  backoffCapMs: 60_000,
  /** Where realtime is unverified, a demanded sampled source revalidates this often (§10.5). */
  sampledIntervalMs: 30_000,
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
  const failures = state.failures + 1;
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

export function transition(state: StreamState, event: StreamEvent, now: number): StreamTransition {
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
            next: { kind: "await-baseline", deadlineAt: now + STREAM_POLICY.baselineTimeoutMs },
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
              state.mode === "sampled"
                ? { kind: "revalidate", at: now + STREAM_POLICY.sampledIntervalMs }
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
      return state.mode === "sampled" && (state.phase === "live" || state.phase === "recovering")
        ? attempt(state, now)
        : settle(state);
    case "manual-retry":
    case "input-changed":
      return state.phase === "recovering" || state.phase === "paused"
        ? attempt(state, now)
        : settle(state);
  }
}
