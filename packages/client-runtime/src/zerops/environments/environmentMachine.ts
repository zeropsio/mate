/**
 * One Mate target — `projectId:serviceId` — as one pure machine (DESIGN §4.4):
 * `transitionEnvironment(state, event, ctx) → { state, effects }`.
 *
 * Four parallel regions: P presence (a function of the inventory), K the Mate credential, L a
 * read-only mirror of the T3 supervisor's link, and C the container verdict. K is the only region
 * this machine decides; P, L and C arrive as events and feed its guards. Reachability is a
 * projection over all four (`reachability.ts`).
 *
 * - Effects are data: `run` an op and feed its answer back as an event carrying the op's
 *   `attempt`; arm the one timer per `schedule`, which delivers `TICK`; `cancel` it; `log`.
 * - An answer for any attempt but the one in flight is dropped (§4.0).
 * - Timers are hints: every event first settles the deadlines that have passed on either clock.
 * - Every non-terminal credential state holds a timer, waits on a named input, or waits for the
 *   user (I7).
 */
import type { EnvironmentId, ExecutionEnvironmentUpdate } from "@t3tools/contracts";

import type { ConnectionBlockedReason } from "../../connection/model.ts";
import type { GrantCapability, Instant } from "../data/access/grant.ts";
import type { AbsenceEvidence } from "../knowledge/known.ts";
import {
  backoffOn,
  INITIAL_BACKOFF,
  scheduleRetry,
  type Backoff,
  type RetryTrigger,
} from "../knowledge/retryPolicy.ts";

// ── Region P: presence ────────────────────────────────────────────────────────────────────────

/** The platform statuses a service passes through on its way up (`candidates.ts`). */
export type ServiceTransition = "NEW" | "CREATING" | "STARTING" | "RESTARTING" | "UPGRADING";

export type NoOriginReason = "subdomain-off" | "no-port" | "no-subdomain";

export type Presence =
  | { readonly kind: "unknown" }
  | { readonly kind: "present"; readonly origin: string }
  | { readonly kind: "transitioning"; readonly status: ServiceTransition }
  | { readonly kind: "inactive"; readonly status: string }
  | { readonly kind: "no-origin"; readonly reason: NoOriginReason }
  /** Only with absence evidence (§3.1): a confirmed project denial, or a confirmed service removal. */
  | { readonly kind: "gone"; readonly evidence: AbsenceEvidence };

// ── Region C: container ───────────────────────────────────────────────────────────────────────

/**
 * The container lifecycle's verdict for this target (§4.5). Levels change only on read facts; a
 * cap past its budget sets `overdue` and changes nothing else.
 */
export type ContainerVerdict =
  | { readonly level: "unknown" }
  | { readonly level: "ready" }
  | { readonly level: "creating"; readonly overdue: boolean }
  | { readonly level: "provisioning"; readonly overdue: boolean }
  | { readonly level: "booting"; readonly overdue: boolean }
  | {
      readonly level: "restarting";
      readonly by: "platform" | "you" | "announced";
      readonly overdue: boolean;
    }
  | { readonly level: "updating"; readonly overdue: boolean }
  | { readonly level: "needs-enable" }
  | { readonly level: "needs-update" }
  | { readonly level: "not-yet-available" }
  | { readonly level: "inactive"; readonly status: string };

// ── Region L: link ────────────────────────────────────────────────────────────────────────────

/** What the supervisor says, before this machine stamps a connect. */
export type LinkPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "connecting" }
  | { readonly phase: "connected" }
  | { readonly phase: "backoff"; readonly retryAtMs: number | null }
  | { readonly phase: "blocked"; readonly reason: ConnectionBlockedReason }
  | { readonly phase: "offline" };

/** The mirror. Each connect is stamped, so a connect can be ordered against a restart (§4.5). */
export type Link =
  | Exclude<LinkPhase, { readonly phase: "connected" }>
  | { readonly phase: "connected"; readonly since: Instant };

// ── Region K: credential ──────────────────────────────────────────────────────────────────────

/** What a wanted exchange waits for before it may start. */
export type WaitingOn = "presence" | "container" | "access" | "zerops" | "visible" | "budget";

/** A failure the machine retries on its own (§4.4 failure classes). */
export type ExchangeCause =
  | { readonly kind: "network" }
  | { readonly kind: "timeout" }
  /** The Mate server or its door answered 5xx. */
  | { readonly kind: "server"; readonly status: number }
  /** The throwaway mint answered 429 or 5xx. */
  | { readonly kind: "mint"; readonly status: number }
  | { readonly kind: "descriptor-unreachable" }
  /** The door's `503 zerops_identity_unavailable` (D11). */
  | { readonly kind: "identity-unavailable" }
  /** The mint still waited on project access after its 30 s wait. */
  | { readonly kind: "access-unverified" }
  /** The descriptor reports `zerops.identity = "failed"`: the Mate could not check who you are. */
  | { readonly kind: "identity-failed" }
  /** The Mate kept refusing freshly exchanged credentials. */
  | { readonly kind: "rejected" };

/** A "no" that retrying does not change; it waits for the user or an input change. */
export type RefusalReason =
  /** The door refused the role (READ_ONLY / NO_ACCESS), or the link was blocked on it twice. */
  | { readonly kind: "role" }
  /** The server is below the client floor, or the link was blocked as unsupported. */
  | { readonly kind: "version" }
  /** The Mate at this origin belongs to another project: presence needs a re-read. */
  | { readonly kind: "project-mismatch" }
  /**
   * The link kept being blocked on configuration while the descriptor showed the same
   * environment: re-exchanging does not change it, and each round mints a throwaway.
   */
  | { readonly kind: "configuration" }
  /** `identityMint` refused for a reason no later round changes. */
  | {
      readonly kind: "access";
      readonly reason: Extract<GrantCapability, { readonly allowed: false }>["reason"];
    };

export type ExchangeFailure =
  | { readonly class: "retryable"; readonly cause: ExchangeCause }
  | { readonly class: "refusal"; readonly reason: RefusalReason };

/** The blocks a descriptor re-read answers: a redeploy, or a server version with no facts yet. */
export type RereadBlock = Extract<ConnectionBlockedReason, "configuration" | "unsupported">;

export type Credential =
  | {
      readonly kind: "none";
      /** It is here because the Mate rejected the credential it held: a reconnect, not a first connect. */
      readonly reconnect: boolean;
    }
  | { readonly kind: "waiting"; readonly on: WaitingOn; readonly reconnect: boolean }
  | {
      readonly kind: "exchanging";
      readonly attempt: number;
      readonly deadline: Instant;
      readonly reconnect: boolean;
    }
  | {
      readonly kind: "backoff";
      readonly retryAt: Instant;
      readonly last: ExchangeCause;
      readonly reconnect: boolean;
    }
  | { readonly kind: "refused"; readonly reason: RefusalReason }
  | {
      readonly kind: "held";
      readonly environmentId: EnvironmentId;
      /**
       * The link's block was published for the credential this one replaced. Installing this one
       * retries the link (`rotateCredential`), so the next LINK event is the one judged.
       */
      readonly staleBlock: boolean;
      /** A descriptor re-read the link's block asked for; null while nothing is re-evaluated. */
      readonly rereading: {
        readonly attempt: number;
        readonly deadline: Instant;
        readonly block: RereadBlock;
      } | null;
    }
  /** Terminal: the target is gone or the user removed it. */
  | { readonly kind: "retired"; readonly evidence: AbsenceEvidence };

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────

/** The descriptor facts the machine reasons on (C6). */
export interface DescriptorFacts {
  readonly environmentId: EnvironmentId;
  readonly serverVersion: string;
  readonly update: ExecutionEnvironmentUpdate | null;
  readonly identity: "unknown" | "ok" | "failed";
  readonly identityCheckedAt: string | null;
}

/** The guard inputs the driver computes outside this target (§4.4 WANT and CAN). */
export interface EnvironmentGuards {
  /** Any WANT reason holds: route, record, Connect, a live intent, auto-connect, a hardened birth. */
  readonly want: boolean;
  readonly routeTarget: boolean;
  readonly visible: boolean;
  /** The epoch's first grant is admitted. */
  readonly postGrant: boolean;
  readonly identityMint: GrantCapability;
  /** The grant's rounds are failing with a transport or server cause. */
  readonly zeropsFailing: boolean;
  /** Local wall time of the newest admitted grant round; null before one. */
  readonly grantVerifiedAtMs: number | null;
  /** The tab's exchange budget has a token. */
  readonly budget: boolean;
}

export const IDLE_GUARDS: EnvironmentGuards = {
  want: false,
  routeTarget: false,
  visible: false,
  postGrant: false,
  identityMint: { allowed: false, reason: "access-unverified", waitable: true },
  zeropsFailing: false,
  grantVerifiedAtMs: null,
  budget: false,
};

// ── Machine ───────────────────────────────────────────────────────────────────────────────────

export interface EnvironmentMachine {
  readonly presence: Presence;
  readonly credential: Credential;
  readonly link: Link;
  readonly container: ContainerVerdict;
  readonly guards: EnvironmentGuards;
  /** The registration record's environment (C1); null when nothing is remembered here. */
  readonly record: EnvironmentId | null;
  /** The newest descriptor read; null before one. */
  readonly descriptor: DescriptorFacts | null;
  /** Environment ids a redeploy replaced, each mapped to the newest one that replaced it. */
  readonly superseded: ReadonlyMap<EnvironmentId, EnvironmentId>;
  /** Where the next automatic retry sits on the backoff ladder. */
  readonly ladder: Backoff;
  /** Consecutive automatic failures; from the cap on, retries slow to the capped interval. */
  readonly failures: number;
  /**
   * Monotonic times of the auth rejections counted in the loop window. Every published
   * `blocked(authentication)` belongs to the stored credential, so one counts per credential held.
   */
  readonly authRejections: ReadonlyArray<number>;
  /** The link was blocked on permission once and one exchange was spent on it. */
  readonly permissionRetried: boolean;
  /**
   * Configuration blocks in a row the descriptor did not explain (the same environment), each
   * answered by a re-exchange; a connect or an input change starts the count over.
   */
  readonly configurationBlocks: number;
  /** A descriptor read reported identity `ok` since Zerops last started failing for the grant. */
  readonly identityAnswered: boolean;
  /** Consecutive descriptor reads reporting identity `failed`, each with a newer check. */
  readonly identityFailures: {
    readonly reads: number;
    readonly lastCheckedAt: string | null;
    /** Local wall time the first of them arrived; null with no failed read. */
    readonly sinceMs: number | null;
  };
  readonly nextAttempt: number;
  /** When the interpreter's one timer fires; null when nothing waits on time. */
  readonly timer: Instant | null;
}

export type EnvironmentEvent =
  | { readonly type: "GUARDS"; readonly guards: EnvironmentGuards }
  | { readonly type: "PRESENCE"; readonly presence: Presence }
  | { readonly type: "CONTAINER"; readonly container: ContainerVerdict }
  | { readonly type: "LINK"; readonly link: LinkPhase }
  /** A descriptor read outside this machine's own ops (the probe store). */
  | { readonly type: "DESCRIPTOR"; readonly descriptor: DescriptorFacts }
  | {
      readonly type: "DESCRIPTOR_READ";
      readonly attempt: number;
      readonly result:
        | { readonly ok: true; readonly descriptor: DescriptorFacts }
        | { readonly ok: false };
    }
  | {
      readonly type: "EXCHANGE_SUCCEEDED";
      readonly attempt: number;
      readonly environmentId: EnvironmentId;
      readonly descriptor: DescriptorFacts | null;
    }
  | {
      readonly type: "EXCHANGE_FAILED";
      readonly attempt: number;
      readonly failure: ExchangeFailure;
      readonly descriptor: DescriptorFacts | null;
    }
  | { readonly type: "ROLE_CHANGED" }
  | { readonly type: "TICK" }
  /** §6.4's coalesced wake: a visible one resets the ladder and retries now. */
  | { readonly type: "WAKE"; readonly visible: boolean }
  | { readonly type: "ONLINE" }
  | { readonly type: "USER_RETRY" }
  | { readonly type: "USER_REMOVE" };

export type EnvironmentOp =
  | {
      readonly kind: "exchange";
      readonly origin: string;
      /** The remembered environment the exchange expects; null without a record. */
      readonly expected: EnvironmentId | null;
    }
  | { readonly kind: "read-descriptor"; readonly origin: string }
  /** The supervisor's `retryNow`: a link in backoff tries again at once. */
  | { readonly kind: "retry-link"; readonly environmentId: EnvironmentId }
  /** The inventory re-reads this target's presence. */
  | { readonly kind: "refresh-presence" }
  /** `catalog.remove`, the door's logout and the record's deletion; drafts keep their keys. */
  | { readonly kind: "retire"; readonly environmentId: EnvironmentId | null };

export type EnvironmentDiagnostic =
  | { readonly kind: "stale-result"; readonly attempt: number }
  | { readonly kind: "auth-loop"; readonly rejections: number }
  | { readonly kind: "configuration-loop"; readonly blocks: number };

export const ENVIRONMENT_TIMER_KEY = "environment";

export type EnvironmentEffect =
  | { readonly kind: "run"; readonly attempt: number; readonly op: EnvironmentOp }
  | {
      readonly kind: "schedule";
      readonly key: typeof ENVIRONMENT_TIMER_KEY;
      readonly at: Instant;
      readonly event: { readonly type: "TICK" };
    }
  | { readonly kind: "cancel"; readonly key: typeof ENVIRONMENT_TIMER_KEY }
  | { readonly kind: "log"; readonly diagnostic: EnvironmentDiagnostic };

export interface EnvironmentContext {
  readonly now: Instant;
  /** The jitter source for the backoff ladder. */
  readonly random: () => number;
}

/** From the moment the capability is allowed: descriptor, mint, door and token exchange (§4.4). */
export const EXCHANGE_DEADLINE_MS = 20_000;
/** One descriptor probe (§4.5's pool deadline). */
export const DESCRIPTOR_DEADLINE_MS = 8_000;
/** After this many consecutive automatic failures, retries slow to `CAPPED_RETRY_MS`. */
export const RETRY_CAP = 5;
export const CAPPED_RETRY_MS = 5 * 60_000;
/** This many auth rejections inside `AUTH_LOOP_WINDOW_MS` back off instead of re-exchanging. */
export const AUTH_LOOP_REJECTIONS = 3;
export const AUTH_LOOP_WINDOW_MS = 2 * 60_000;
/** This many unexplained configuration blocks in a row refuse instead of re-exchanging. */
export const CONFIGURATION_LOOP_BLOCKS = 3;
/** Identity `failed` backs off from the 15 s rung (§4.4). */
const IDENTITY_FAILED_RUNG = 3;

const NO_IDENTITY_FAILURES: EnvironmentMachine["identityFailures"] = {
  reads: 0,
  lastCheckedAt: null,
  sinceMs: null,
};

export const initialEnvironment = (input: {
  readonly record: EnvironmentId | null;
}): EnvironmentMachine => ({
  presence: { kind: "unknown" },
  credential: { kind: "none", reconnect: false },
  link: { phase: "idle" },
  container: { level: "unknown" },
  guards: IDLE_GUARDS,
  record: input.record,
  descriptor: null,
  superseded: new Map(),
  ladder: INITIAL_BACKOFF,
  failures: 0,
  authRejections: [],
  permissionRetried: false,
  configurationBlocks: 0,
  identityAnswered: false,
  identityFailures: NO_IDENTITY_FAILURES,
  nextAttempt: 1,
  timer: null,
});

// ── Guards ────────────────────────────────────────────────────────────────────────────────────

const after = (instant: Instant, ms: number): Instant => ({
  wall: instant.wall + ms,
  mono: instant.mono + ms,
});

/** True once either clock has passed `at`. */
const reached = (at: Instant, now: Instant): boolean => now.wall >= at.wall || now.mono >= at.mono;

/** Container levels an exchange waits out; `ready` and `unknown` let it run. */
const containerHolds = (machine: EnvironmentMachine): boolean =>
  machine.link.phase !== "connected" &&
  machine.container.level !== "ready" &&
  machine.container.level !== "unknown";

type Verdict =
  | { readonly kind: "idle" }
  | { readonly kind: "wait"; readonly on: WaitingOn }
  | { readonly kind: "refuse"; readonly reason: RefusalReason }
  | { readonly kind: "go"; readonly origin: string };

/** WANT ∧ CAN, in the order §4.4 lists CAN's conjuncts. */
const gate = (machine: EnvironmentMachine): Verdict => {
  const guards = machine.guards;
  if (!guards.want) return { kind: "idle" };
  if (!guards.postGrant) return { kind: "wait", on: "access" };
  if (machine.presence.kind !== "present") return { kind: "wait", on: "presence" };
  if (containerHolds(machine)) return { kind: "wait", on: "container" };
  if (guards.zeropsFailing && !machine.identityAnswered) return { kind: "wait", on: "zerops" };
  if (!guards.visible && !guards.routeTarget) return { kind: "wait", on: "visible" };
  if (!guards.identityMint.allowed) {
    return guards.identityMint.waitable
      ? { kind: "wait", on: "access" }
      : { kind: "refuse", reason: { kind: "access", reason: guards.identityMint.reason } };
  }
  if (!guards.budget) return { kind: "wait", on: "budget" };
  return { kind: "go", origin: machine.presence.origin };
};

type Effects = Array<EnvironmentEffect>;

const reconnecting = (credential: Credential): boolean =>
  (credential.kind === "none" ||
    credential.kind === "waiting" ||
    credential.kind === "exchanging" ||
    credential.kind === "backoff") &&
  credential.reconnect;

/** Moves an idle or waiting credential to where its guards put it now. */
const evaluate = (
  machine: EnvironmentMachine,
  ctx: EnvironmentContext,
  out: Effects,
): EnvironmentMachine => {
  const credential = machine.credential;
  if (credential.kind !== "none" && credential.kind !== "waiting") return machine;
  const reconnect = reconnecting(credential);
  const verdict = gate(machine);
  switch (verdict.kind) {
    case "idle":
      return { ...machine, credential: { kind: "none", reconnect } };
    case "wait":
      return { ...machine, credential: { kind: "waiting", on: verdict.on, reconnect } };
    case "refuse":
      return { ...machine, credential: { kind: "refused", reason: verdict.reason } };
    case "go": {
      const attempt = machine.nextAttempt;
      out.push({
        kind: "run",
        attempt,
        op: { kind: "exchange", origin: verdict.origin, expected: machine.record },
      });
      return {
        ...machine,
        nextAttempt: attempt + 1,
        credential: {
          kind: "exchanging",
          attempt,
          deadline: after(ctx.now, EXCHANGE_DEADLINE_MS),
          reconnect,
        },
      };
    }
  }
};

/** A backoff the trigger releases returns to `none`, which the guards judge next. */
const release = (machine: EnvironmentMachine, trigger: RetryTrigger): EnvironmentMachine => {
  const ladder = backoffOn(machine.ladder, trigger);
  const credential = machine.credential;
  return credential.kind === "backoff"
    ? { ...machine, ladder, credential: { kind: "none", reconnect: credential.reconnect } }
    : { ...machine, ladder };
};

/**
 * A user retry or an input change: the ladder, the cap and the permission retry start over, a
 * refusal re-evaluates.
 */
const inputChanged = (
  machine: EnvironmentMachine,
  trigger: "user-retry" | "input-change",
): EnvironmentMachine => {
  const reset = { ...machine, failures: 0, permissionRetried: false, configurationBlocks: 0 };
  return machine.credential.kind === "refused"
    ? { ...reset, ladder: INITIAL_BACKOFF, credential: { kind: "none", reconnect: false } }
    : release(reset, trigger);
};

// ── Failures ──────────────────────────────────────────────────────────────────────────────────

const backoff = (
  machine: EnvironmentMachine,
  cause: ExchangeCause,
  reconnect: boolean,
  ctx: EnvironmentContext,
): EnvironmentMachine => {
  const failures = machine.failures + 1;
  const from: Backoff =
    cause.kind === "identity-failed"
      ? { rung: Math.max(machine.ladder.rung, IDENTITY_FAILED_RUNG) }
      : machine.ladder;
  const next = scheduleRetry(from, ctx.now.wall, ctx.random);
  const delayMs = failures >= RETRY_CAP ? CAPPED_RETRY_MS : next.retryAtMs - ctx.now.wall;
  return {
    ...machine,
    failures,
    ladder: next.backoff,
    credential: { kind: "backoff", retryAt: after(ctx.now, delayMs), last: cause, reconnect },
  };
};

const refuse = (
  machine: EnvironmentMachine,
  reason: RefusalReason,
  out: Effects,
): EnvironmentMachine => {
  if (reason.kind === "project-mismatch") {
    out.push({ kind: "run", attempt: machine.nextAttempt, op: { kind: "refresh-presence" } });
    return {
      ...machine,
      nextAttempt: machine.nextAttempt + 1,
      credential: { kind: "refused", reason },
    };
  }
  return { ...machine, credential: { kind: "refused", reason } };
};

// ── Descriptor ────────────────────────────────────────────────────────────────────────────────

/** A change that re-opens a refusal or a backoff: a new environment or a new server version. */
const descriptorMoved = (before: DescriptorFacts | null, after: DescriptorFacts): boolean =>
  before !== null &&
  (before.environmentId !== after.environmentId || before.serverVersion !== after.serverVersion);

/** A failed identity counts once per check the Mate made; any other verdict ends the run. */
const countIdentityFailure = (
  failures: EnvironmentMachine["identityFailures"],
  descriptor: DescriptorFacts,
  nowMs: number,
): EnvironmentMachine["identityFailures"] => {
  if (descriptor.identity !== "failed") return NO_IDENTITY_FAILURES;
  const checkedAt = descriptor.identityCheckedAt;
  if (checkedAt === null) return failures;
  if (failures.lastCheckedAt !== null && checkedAt <= failures.lastCheckedAt) return failures;
  return {
    reads: failures.reads + 1,
    lastCheckedAt: checkedAt,
    sinceMs: failures.sinceMs ?? nowMs,
  };
};

const ingestDescriptor = (
  machine: EnvironmentMachine,
  descriptor: DescriptorFacts,
  ctx: EnvironmentContext,
): EnvironmentMachine => ({
  ...machine,
  descriptor,
  identityAnswered: machine.identityAnswered || descriptor.identity === "ok",
  identityFailures: countIdentityFailure(machine.identityFailures, descriptor, ctx.now.wall),
});

/**
 * Restart is offered for identity `failed` only when two consecutive reads report it with an
 * advancing check AND this tab's grant stayed granted and fresh over the same period — a round
 * admitted after the first failure, none failing since. Zerops then answers us but not the Mate's
 * key; during a Zerops outage the key is not the cause, so nothing is offered (§4.4).
 */
export const identityRestartOffered = (machine: EnvironmentMachine): boolean => {
  const failures = machine.identityFailures;
  const guards = machine.guards;
  return (
    failures.reads >= 2 &&
    failures.sinceMs !== null &&
    guards.grantVerifiedAtMs !== null &&
    guards.grantVerifiedAtMs >= failures.sinceMs &&
    guards.identityMint.allowed &&
    !guards.zeropsFailing
  );
};

/** `from` was replaced by `to`: every id that pointed at `from` now points at `to`. */
const supersede = (
  superseded: ReadonlyMap<EnvironmentId, EnvironmentId>,
  from: EnvironmentId,
  to: EnvironmentId,
): ReadonlyMap<EnvironmentId, EnvironmentId> => {
  const next = new Map<EnvironmentId, EnvironmentId>();
  for (const [old, by] of superseded) {
    if (old !== to) next.set(old, by === from ? to : by);
  }
  next.set(from, to);
  return next;
};

// ── Link ──────────────────────────────────────────────────────────────────────────────────────

const onBlocked = (
  machine: EnvironmentMachine,
  reason: ConnectionBlockedReason,
  ctx: EnvironmentContext,
  out: Effects,
): EnvironmentMachine => {
  const credential = machine.credential;
  // A block while nothing is held belongs to the credential already being replaced.
  if (credential.kind !== "held" || credential.rereading !== null) return machine;
  switch (reason) {
    case "authentication": {
      const authRejections = [
        ...machine.authRejections.filter((at) => ctx.now.mono - at < AUTH_LOOP_WINDOW_MS),
        ctx.now.mono,
      ];
      const next = { ...machine, authRejections };
      if (authRejections.length >= AUTH_LOOP_REJECTIONS) {
        out.push({
          kind: "log",
          diagnostic: { kind: "auth-loop", rejections: authRejections.length },
        });
        return backoff(next, { kind: "rejected" }, true, ctx);
      }
      return { ...next, credential: { kind: "none", reconnect: true } };
    }
    case "configuration":
    case "unsupported":
      // `judgeDescriptorBlock` answers these, now or once their facts can be read.
      return machine;
    case "permission":
    case "read-only":
      if (machine.permissionRetried) return refuse(machine, { kind: "role" }, out);
      return { ...machine, permissionRetried: true, credential: { kind: "none", reconnect: true } };
  }
};

/**
 * A held credential behind a block the descriptor answers: `unsupported` with a descriptor is a
 * version refusal; otherwise the descriptor is re-read as soon as the Mate has an origin, whichever
 * of the block, the presence and a probe's descriptor arrived last.
 */
const judgeDescriptorBlock = (
  machine: EnvironmentMachine,
  ctx: EnvironmentContext,
  out: Effects,
): EnvironmentMachine => {
  const credential = machine.credential;
  const link = machine.link;
  if (
    credential.kind !== "held" ||
    credential.staleBlock ||
    credential.rereading !== null ||
    link.phase !== "blocked"
  ) {
    return machine;
  }
  const block = link.reason;
  if (block !== "configuration" && block !== "unsupported") return machine;
  if (block === "unsupported" && machine.descriptor !== null) {
    return refuse(machine, { kind: "version" }, out);
  }
  if (machine.presence.kind !== "present") return machine;
  const attempt = machine.nextAttempt;
  out.push({
    kind: "run",
    attempt,
    op: { kind: "read-descriptor", origin: machine.presence.origin },
  });
  return {
    ...machine,
    nextAttempt: attempt + 1,
    credential: {
      ...credential,
      rereading: { attempt, deadline: after(ctx.now, DESCRIPTOR_DEADLINE_MS), block },
    },
  };
};

const onLink = (
  machine: EnvironmentMachine,
  phase: LinkPhase,
  ctx: EnvironmentContext,
  out: Effects,
): EnvironmentMachine => {
  if (phase.phase === "connected" && machine.link.phase === "connected") return machine;
  // Whatever the link says now, it says it about the credential held now.
  const credential =
    machine.credential.kind === "held"
      ? { ...machine.credential, staleBlock: false }
      : machine.credential;
  if (phase.phase === "connected") {
    const next: EnvironmentMachine = {
      ...machine,
      link: { phase: "connected", since: ctx.now },
      credential,
      permissionRetried: false,
      configurationBlocks: 0,
    };
    // A live socket proves the container is up: a wait on it ends.
    return next.credential.kind === "held"
      ? { ...next, failures: 0, ladder: INITIAL_BACKOFF }
      : next;
  }
  const next: EnvironmentMachine = { ...machine, link: phase, credential };
  return phase.phase === "blocked" ? onBlocked(next, phase.reason, ctx, out) : next;
};

// ── Transition ────────────────────────────────────────────────────────────────────────────────

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** An in-flight op whose deadline passed failed; a due backoff goes back through the guards. */
const settle = (machine: EnvironmentMachine, ctx: EnvironmentContext): EnvironmentMachine => {
  const credential = machine.credential;
  switch (credential.kind) {
    case "exchanging":
      return reached(credential.deadline, ctx.now)
        ? backoff(machine, { kind: "timeout" }, credential.reconnect, ctx)
        : machine;
    case "held":
      return credential.rereading !== null && reached(credential.rereading.deadline, ctx.now)
        ? backoff(machine, { kind: "descriptor-unreachable" }, true, ctx)
        : machine;
    case "backoff":
      return reached(credential.retryAt, ctx.now) ? release(machine, "retry-at-reached") : machine;
    case "none":
    case "waiting":
    case "refused":
    case "retired":
      return machine;
  }
};

const stale = (machine: EnvironmentMachine, attempt: number, out: Effects): EnvironmentMachine => {
  out.push({ kind: "log", diagnostic: { kind: "stale-result", attempt } });
  return machine;
};

const apply = (
  machine: EnvironmentMachine,
  event: EnvironmentEvent,
  ctx: EnvironmentContext,
  out: Effects,
): EnvironmentMachine => {
  const credential = machine.credential;
  switch (event.type) {
    case "GUARDS": {
      const before = machine.guards;
      const next: EnvironmentMachine = {
        ...machine,
        guards: event.guards,
        identityAnswered:
          event.guards.zeropsFailing && !before.zeropsFailing ? false : machine.identityAnswered,
      };
      const mintMoved = !sameJson(before.identityMint, event.guards.identityMint);
      if (credential.kind === "refused" && credential.reason.kind === "access" && mintMoved) {
        return inputChanged(next, "input-change");
      }
      return next;
    }
    case "PRESENCE": {
      if (sameJson(machine.presence, event.presence)) return machine;
      if (event.presence.kind === "gone") {
        return retire({ ...machine, presence: event.presence }, event.presence.evidence, out);
      }
      return inputChanged({ ...machine, presence: event.presence }, "input-change");
    }
    case "CONTAINER": {
      if (sameJson(machine.container, event.container)) return machine;
      const next: EnvironmentMachine = { ...machine, container: event.container };
      if (event.container.level !== "ready") return next;
      // Container ready kicks a link in backoff.
      if (credential.kind === "held" && machine.link.phase === "backoff") {
        out.push({
          kind: "run",
          attempt: next.nextAttempt,
          op: { kind: "retry-link", environmentId: credential.environmentId },
        });
        return { ...next, nextAttempt: next.nextAttempt + 1 };
      }
      return release(next, "prerequisite-arrived");
    }
    case "LINK":
      return onLink(machine, event.link, ctx, out);
    case "DESCRIPTOR": {
      const moved = descriptorMoved(machine.descriptor, event.descriptor);
      const next = ingestDescriptor(machine, event.descriptor, ctx);
      return moved ? inputChanged(next, "input-change") : next;
    }
    case "DESCRIPTOR_READ": {
      if (credential.kind !== "held" || credential.rereading?.attempt !== event.attempt) {
        return stale(machine, event.attempt, out);
      }
      if (!event.result.ok) {
        return backoff(machine, { kind: "descriptor-unreachable" }, true, ctx);
      }
      const read = event.result.descriptor;
      const next = ingestDescriptor(machine, read, ctx);
      if (read.environmentId !== credential.environmentId) {
        return {
          ...next,
          superseded: supersede(next.superseded, credential.environmentId, read.environmentId),
          credential: { kind: "none", reconnect: false },
        };
      }
      if (credential.rereading.block === "unsupported")
        return refuse(next, { kind: "version" }, out);
      // The same environment behind a configuration block: another exchange may clear it, but a
      // block that keeps coming back only spends throwaways.
      const configurationBlocks = next.configurationBlocks + 1;
      if (configurationBlocks >= CONFIGURATION_LOOP_BLOCKS) {
        out.push({
          kind: "log",
          diagnostic: { kind: "configuration-loop", blocks: configurationBlocks },
        });
        return refuse({ ...next, configurationBlocks }, { kind: "configuration" }, out);
      }
      return { ...next, configurationBlocks, credential: { kind: "none", reconnect: true } };
    }
    case "EXCHANGE_SUCCEEDED": {
      if (credential.kind !== "exchanging" || credential.attempt !== event.attempt) {
        return stale(machine, event.attempt, out);
      }
      const next =
        event.descriptor === null ? machine : ingestDescriptor(machine, event.descriptor, ctx);
      const record = machine.record;
      return {
        ...next,
        record: event.environmentId,
        superseded:
          record !== null && record !== event.environmentId
            ? supersede(next.superseded, record, event.environmentId)
            : next.superseded,
        failures: 0,
        ladder: INITIAL_BACKOFF,
        credential: {
          kind: "held",
          environmentId: event.environmentId,
          staleBlock: machine.link.phase === "blocked",
          rereading: null,
        },
      };
    }
    case "EXCHANGE_FAILED": {
      if (credential.kind !== "exchanging" || credential.attempt !== event.attempt) {
        return stale(machine, event.attempt, out);
      }
      const next =
        event.descriptor === null ? machine : ingestDescriptor(machine, event.descriptor, ctx);
      if (event.failure.class === "retryable") {
        return backoff(next, event.failure.cause, credential.reconnect, ctx);
      }
      // A version is refused on the descriptor it was judged on; without one it is read again.
      if (event.failure.reason.kind === "version" && next.descriptor === null) {
        return backoff(next, { kind: "descriptor-unreachable" }, credential.reconnect, ctx);
      }
      return refuse(next, event.failure.reason, out);
    }
    case "ROLE_CHANGED":
      return inputChanged(machine, "input-change");
    case "TICK":
      return machine;
    case "WAKE":
      return event.visible ? release(machine, "visible-wake") : machine;
    case "ONLINE":
      return release(machine, "online");
    case "USER_RETRY": {
      if (credential.kind === "held" && machine.link.phase !== "connected") {
        out.push({
          kind: "run",
          attempt: machine.nextAttempt,
          op: { kind: "retry-link", environmentId: credential.environmentId },
        });
        return { ...machine, nextAttempt: machine.nextAttempt + 1 };
      }
      return inputChanged(machine, "user-retry");
    }
    case "USER_REMOVE":
      return retire(machine, "removed-by-user", out);
  }
};

const retire = (
  machine: EnvironmentMachine,
  evidence: AbsenceEvidence,
  out: Effects,
): EnvironmentMachine => {
  const credential = machine.credential;
  out.push({
    kind: "run",
    attempt: machine.nextAttempt,
    op: {
      kind: "retire",
      environmentId: credential.kind === "held" ? credential.environmentId : machine.record,
    },
  });
  return {
    ...machine,
    nextAttempt: machine.nextAttempt + 1,
    credential: { kind: "retired", evidence },
  };
};

/** The one instant the machine waits on: a deadline in flight or a backoff's retry. */
const dueAt = (credential: Credential): Instant | null => {
  switch (credential.kind) {
    case "exchanging":
      return credential.deadline;
    case "backoff":
      return credential.retryAt;
    case "held":
      return credential.rereading?.deadline ?? null;
    case "none":
    case "waiting":
    case "refused":
    case "retired":
      return null;
  }
};

const reschedule = (machine: EnvironmentMachine, out: Effects): EnvironmentMachine => {
  const due = dueAt(machine.credential);
  if (sameJson(due, machine.timer)) return machine;
  if (due === null) {
    out.push({ kind: "cancel", key: ENVIRONMENT_TIMER_KEY });
  } else {
    out.push({ kind: "schedule", key: ENVIRONMENT_TIMER_KEY, at: due, event: { type: "TICK" } });
  }
  return { ...machine, timer: due };
};

export const transitionEnvironment = (
  machine: EnvironmentMachine,
  event: EnvironmentEvent,
  ctx: EnvironmentContext,
): { readonly state: EnvironmentMachine; readonly effects: ReadonlyArray<EnvironmentEffect> } => {
  const out: Effects = [];
  if (machine.credential.kind === "retired") {
    // An op's answer after retirement is never accepted: no credential is installed for it.
    if ("attempt" in event) stale(machine, event.attempt, out);
    return { state: machine, effects: out };
  }
  // The clocks first: an event is judged at the instant it is delivered.
  let next = settle(machine, ctx);
  next = apply(next, event, ctx, out);
  next = settle(next, ctx);
  next = judgeDescriptorBlock(next, ctx, out);
  // Every input can move a guard: an idle or waiting credential is re-judged after each event.
  next = evaluate(next, ctx, out);
  next = reschedule(next, out);
  return { state: next, effects: out };
};
