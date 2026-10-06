/**
 * The access grant (DESIGN §4.2): the client's verified authority over the platform, as one
 * pure machine — `transitionGrant(state, event, ctx) → { state, effects }`.
 *
 * - A round is REST only (G1). Its account part (`fetchUser` and membership roles)
 *   admits the account; each project carries its own evidence and its own deadline (C2b).
 * - Evidence is stamped when its round starts, on the wall and the monotonic clock, and
 *   authorizes for the policy window after that stamp on whichever clock runs out first. A
 *   backwards wall jump beyond the tolerance ends it at once (G2, G5).
 * - Timers are hints. Every event first re-evaluates both clocks, and every capability is
 *   computed from the stamps at the instant it is asked for, so a deadline a frozen or
 *   throttled tab slept through is honoured when the tab next runs.
 * - A 403/404 closes that project for good, at once: its writes, and its content (G6). A definitive
 *   refusal is never asked again by a clock.
 * - A failed round or read retries on its ladder (policy) while the tab is visible: at once on a
 *   visible wake, `online` or a person's retry; nothing retries while the tab is hidden. A
 *   malformed answer is definitive, as a cell's decode is: only a person's retry asks again
 *   (2026-10-05).
 * - Effects are data. The interpreter runs `run` ops and feeds their answers back as events,
 *   arms one timer per `schedule` that delivers `TICK`, and forwards the rest to the runtime.
 */
import { rungMs, soonerJittered, type RetryLadder } from "../../knowledge/retryPolicy.ts";
import { renewalLeadMs, roundDeadlineMs, type ZeropsGrantPolicy } from "../policy.ts";
import type {
  OrganizationEffectiveAccess,
  ProjectEffectiveAccess,
  ProjectRef,
  ZeropsProjectId,
} from "../types.ts";

/** One moment on both clocks: `Date.now()` and `performance.now()`. */
export interface Instant {
  readonly wall: number;
  readonly mono: number;
}

export interface GrantContext {
  readonly now: Instant;
  readonly policy: ZeropsGrantPolicy;
  /** The jitter source of every rung: a retry comes up to `RETRY_JITTER` of it sooner. */
  readonly random?: () => number;
}

/** Why a round or a project read did not answer. A 401 belongs to the session machine. */
export type GrantFailure =
  | { readonly kind: "offline" }
  | { readonly kind: "timeout"; readonly afterMs: number }
  | { readonly kind: "transport"; readonly detail: string }
  | { readonly kind: "throttled"; readonly retryAfterMs: number | null }
  | { readonly kind: "server"; readonly status: number }
  /** Definitive: asking the same again gets the same answer, so only a person asks again. */
  | { readonly kind: "malformed"; readonly detail: string };

/** A failure no wait repairs (`malformed`): it waits for a person's retry, never a rung. */
const definitive = (failure: GrantFailure | null): boolean => failure?.kind === "malformed";

export type DenialEvidence = "direct-forbidden" | "direct-not-found";

export interface AccountEvidence {
  readonly round: number;
  /** When the round's first request was sent. */
  readonly startedAt: Instant;
  readonly organizations: ReadonlyArray<OrganizationEffectiveAccess>;
}

export interface ProjectEvidence {
  /** The organization membership role of its round joined with the project's `userRoles`. */
  readonly access: ProjectEffectiveAccess;
  /** The stamp of the round whose membership it joins; never later than its own read. */
  readonly startedAt: Instant;
}

/**
 * Listed, but not verified: its latest read failed, and it keeps any older evidence until that
 * expires — or the organization's list named it after the round that would have read it, and no
 * read has answered yet (`failure` null).
 */
export interface UnverifiedProject {
  readonly project: ProjectRef;
  readonly failure: GrantFailure | null;
  /**
   * When its next read is due: at once when first demanded, on the project rungs after a failure;
   * null after a definitive one, until a person's retry.
   */
  readonly dueAt: Instant | null;
  /** Failed reads so far; picks the rung of the next wait. */
  readonly attempt: number;
}

/** A 403/404 was seen: the project is closed for good, its writes and its content. */
export interface ClosedProject {
  readonly project: ProjectRef;
  readonly deniedAt: Instant;
  readonly evidence: DenialEvidence;
}

export interface Evidence {
  readonly account: AccountEvidence;
  /** Positively verified, possibly carried from an earlier round with its older stamp. */
  readonly projects: ReadonlyMap<ZeropsProjectId, ProjectEvidence>;
  readonly unverified: ReadonlyMap<ZeropsProjectId, UnverifiedProject>;
  readonly closedProjects: ReadonlyMap<ZeropsProjectId, ClosedProject>;
}

export type ProjectOutcome =
  | { readonly kind: "verified"; readonly access: ProjectEffectiveAccess }
  | { readonly kind: "denied"; readonly evidence: DenialEvidence }
  | { readonly kind: "failed"; readonly failure: GrantFailure };

/** The one round in flight (G7). */
export interface GrantRound {
  readonly id: number;
  readonly startedAt: Instant;
  /** Base deadline until the account part answers, then scaled to the listed projects. */
  readonly deadline: Instant;
  /** Consecutive failed rounds before this one; picks the rung if it fails too. */
  readonly failures: number;
  /** Null until the account part answers. */
  readonly organizations: ReadonlyArray<OrganizationEffectiveAccess> | null;
  readonly targets: ReadonlyArray<ProjectRef> | null;
  readonly outcomes: ReadonlyMap<
    ZeropsProjectId,
    { readonly outcome: ProjectOutcome; readonly at: Instant }
  >;
  /** A person's again joined it: if it runs out unanswered, the next round starts at once. */
  readonly askedAgain?: true;
}

export type Renewal =
  | { readonly status: "idle"; readonly dueAt: Instant }
  | {
      readonly status: "running";
      readonly round: GrantRound;
      /**
       * This account wrote a project's grants while the round ran, which may have read them
       * before the write: another round follows it at once (`GRANTS_WRITTEN`).
       */
      readonly again?: true;
    }
  | {
      readonly status: "failed";
      readonly failure: GrantFailure;
      /**
       * Granted: bounded by the held deadline, where the lapse starts its own round. Null after a
       * definitive failure, until a person's retry.
       */
      readonly retryAt: Instant | null;
      readonly attempt: number;
    }
  /** Hidden longer than the policy: no round until a visible wake (D5). */
  | { readonly status: "dormant" };

export type GrantState =
  | { readonly phase: "unverified" }
  | { readonly phase: "verifying"; readonly round: GrantRound }
  | {
      readonly phase: "unverified-failed";
      readonly failure: GrantFailure;
      /** Null after a definitive failure, until a person's retry. */
      readonly retryAt: Instant | null;
      readonly attempt: number;
    }
  /**
   * `failure` is the renewal's last failure since its evidence was admitted: a retry, a wake,
   * `online`, a user retry or the lapse itself starts a round without clearing it, so only a grant
   * does.
   */
  | {
      readonly phase: "granted";
      readonly evidence: Evidence;
      readonly renewal: Renewal;
      readonly failure: GrantFailure | null;
    }
  | {
      readonly phase: "lapsed";
      readonly last: Evidence;
      readonly renewal: Renewal;
      readonly failure: GrantFailure | null;
    }
  | { readonly phase: "closed" };

/** A read of one project outside a round: a per-project retry. */
export interface ProjectAttempt {
  readonly attempt: number;
  readonly project: ProjectRef;
  readonly startedAt: Instant;
}

export type GrantWithheldReason = "access-lapsed" | "access-unverified" | "access-denied";
/** The renewal state behind a withholding, so copy can name a cause. */
export type GrantWithholdingCause = {
  readonly failure: GrantFailure;
  readonly retryAtMs: number | null;
} | null;

export type ScopeAuthority =
  | { readonly kind: "authorized" }
  | {
      readonly kind: "withheld";
      readonly reason: GrantWithheldReason;
      readonly cause: GrantWithholdingCause;
    };

export interface GrantMachine {
  readonly phase: GrantState;
  readonly demandedProjects: ReadonlyArray<ProjectRef>;
  readonly signals: { readonly hiddenSince: Instant | null; readonly online: boolean };
  readonly projectAttempts: ReadonlyMap<ZeropsProjectId, ProjectAttempt>;
  /** Admitted round durations this epoch, newest last (G13's p95). */
  readonly roundDurationsMs: ReadonlyArray<number>;
  /** Rounds and project reads share one attempt counter. */
  readonly nextAttempt: number;
  /** When the interpreter's one timer fires; null when nothing waits on time. */
  readonly timer: Instant | null;
  /** Per scope, the authority the runtime was last told (G12). */
  readonly published: {
    readonly account: ScopeAuthority | null;
    readonly projects: ReadonlyMap<
      ZeropsProjectId,
      { readonly project: ProjectRef; readonly authority: ScopeAuthority }
    >;
  };
}

export type GrantEvent =
  /** The epoch's pre-grant stage is built. */
  | { readonly type: "START" }
  /** The timer fired. */
  | { readonly type: "TICK" }
  | { readonly type: "VISIBILITY"; readonly hidden: boolean }
  /** §6.4's coalesced wake: visible restarts every failed wait now; hidden only re-evaluates. */
  | { readonly type: "WAKE"; readonly visible: boolean }
  | { readonly type: "ONLINE" }
  | { readonly type: "OFFLINE" }
  | { readonly type: "USER_RETRY" }
  /**
   * This account wrote a project's grants (a hand over): what the grant holds of every project's
   * grants is read again at once, not on the renewal's schedule.
   */
  | { readonly type: "GRANTS_WRITTEN" }
  /** `fetchUser` and membership roles answered; `projects` are the round's reads. */
  | {
      readonly type: "ROUND_ACCOUNT";
      readonly round: number;
      readonly organizations: ReadonlyArray<OrganizationEffectiveAccess>;
      readonly projects: ReadonlyArray<ProjectRef>;
    }
  | {
      readonly type: "ROUND_PROJECT";
      readonly round: number;
      readonly project: ProjectRef;
      readonly outcome: ProjectOutcome;
    }
  /** `fetchUser` or an organization list failed. */
  | { readonly type: "ROUND_FAILED"; readonly round: number; readonly failure: GrantFailure }
  | {
      readonly type: "PROJECT_RESULT";
      readonly attempt: number;
      readonly project: ProjectRef;
      readonly outcome: ProjectOutcome;
    }
  /**
   * The projects an organization's live list names now. One the held evidence does not name —
   * a project someone else created since the round — is read on its own at once, rather than
   * waiting out the window for the next renewal.
   */
  | { readonly type: "PROJECTS_DEMANDED"; readonly projects: ReadonlyArray<ProjectRef> }
  /** Any GET on the project answered 403/404 (G6). */
  | {
      readonly type: "PROJECT_DENIED";
      readonly project: ProjectRef;
      readonly evidence: DenialEvidence;
    }
  | { readonly type: "EPOCH_CLOSED" };

export type GrantOp =
  /** `carried` are the projects this grant holds, so a round reads them even when unlisted. */
  | { readonly kind: "verify-round"; readonly carried: ReadonlyArray<ProjectRef> }
  | { readonly kind: "verify-project"; readonly project: ProjectRef };

export type GrantScope =
  | { readonly kind: "account" }
  | { readonly kind: "project"; readonly project: ProjectRef };

export type GrantObservation =
  | { readonly kind: "access-verified"; readonly verifiedAtMs: number; readonly evidence: Evidence }
  | { readonly kind: "access-expired"; readonly expiredAtMs: number }
  | {
      readonly kind: "project-gone";
      readonly project: ProjectRef;
      readonly evidence: DenialEvidence;
    };

export type GrantDiagnostic =
  | {
      readonly kind: "round-admitted";
      readonly round: number;
      readonly durationMs: number;
      readonly projects: number;
    }
  | {
      readonly kind: "round-discarded-late";
      readonly round: number;
      readonly startedAtMs: number;
      readonly completedAtMs: number;
    };

export const GRANT_TIMER_KEY = "access-grant";

export type GrantEffect =
  | { readonly kind: "run"; readonly attempt: number; readonly op: GrantOp }
  | {
      readonly kind: "schedule";
      readonly key: typeof GRANT_TIMER_KEY;
      readonly at: Instant;
      readonly event: { readonly type: "TICK" };
    }
  | { readonly kind: "cancel"; readonly key: typeof GRANT_TIMER_KEY }
  | {
      readonly kind: "invalidate";
      readonly invalidation: { readonly topic: "access"; readonly change: "lapsed" };
    }
  | { readonly kind: "observe"; readonly observation: GrantObservation }
  | {
      readonly kind: "withhold";
      readonly scope: GrantScope;
      readonly reason: GrantWithheldReason;
      readonly cause: GrantWithholdingCause;
    }
  | { readonly kind: "restore-authority"; readonly scope: GrantScope }
  | { readonly kind: "log"; readonly diagnostic: GrantDiagnostic };

export type GrantCapability =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | "access-unverified"
        | "access-lapsed"
        | "project-unverified"
        | "role-denies"
        | "project-closed"
        | "epoch-closed";
      /** True when a later round or project read may allow it. */
      readonly waitable: boolean;
    };

// ── Clocks ────────────────────────────────────────────────────────────────────────────────────

const after = (instant: Instant, ms: number): Instant => ({
  wall: instant.wall + ms,
  mono: instant.mono + ms,
});

/** True once either clock has passed `at`. */
const reached = (at: Instant, now: Instant): boolean => now.wall >= at.wall || now.mono >= at.mono;

/** Whichever comes first on each clock. */
const sooner = (left: Instant, right: Instant): Instant => ({
  wall: Math.min(left.wall, right.wall),
  mono: Math.min(left.mono, right.mono),
});

/** §4.2 `expired(i, now)`: the window ran out on either clock, or the wall clock jumped back. */
const expired = (stamp: Instant, now: Instant, policy: ZeropsGrantPolicy): boolean =>
  reached(after(stamp, policy.windowMs), now) ||
  now.wall - stamp.wall < now.mono - stamp.mono - policy.wallJumpBackToleranceMs;

/** A rung's wait (`rungMs`), jittered up to a fifth sooner so tabs that failed together part. */
const waitOf = (ctx: GrantContext, ladder: RetryLadder, attempt: number): number => {
  const ms = rungMs(ladder, attempt);
  return ctx.random === undefined ? ms : soonerJittered(ms, ctx.random());
};

/** When a read that failed with `failure` is due again on `ladder`: never, for a definitive one. */
const retryAtOf = (
  ctx: GrantContext,
  failure: GrantFailure,
  ladder: RetryLadder,
  attempt: number,
): Instant | null => (definitive(failure) ? null : after(ctx.now, waitOf(ctx, ladder, attempt)));

/** Whether a wait that may have none has come due. */
const due = (at: Instant | null, now: Instant): boolean => at !== null && reached(at, now);

/** Failed reads retry only in a visible tab; the visible wake restarts them. */
const retrying = (machine: GrantMachine): boolean =>
  machine.signals.online && machine.signals.hiddenSince === null;

const p95 = (samples: ReadonlyArray<number>): number => {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
};

const dormant = (machine: GrantMachine, ctx: GrantContext): boolean =>
  machine.signals.hiddenSince !== null &&
  reached(after(machine.signals.hiddenSince, ctx.policy.dormantAfterHiddenMs), ctx.now);

// ── Reading the state ─────────────────────────────────────────────────────────────────────────

const heldEvidence = (machine: GrantMachine): Evidence | null =>
  machine.phase.phase === "granted"
    ? machine.phase.evidence
    : machine.phase.phase === "lapsed"
      ? machine.phase.last
      : null;

export const grantRoundInFlight = (machine: GrantMachine): GrantRound | null => {
  const phase = machine.phase;
  if (phase.phase === "verifying") return phase.round;
  if (
    (phase.phase === "granted" || phase.phase === "lapsed") &&
    phase.renewal.status === "running"
  ) {
    return phase.renewal.round;
  }
  return null;
};

const ALLOWED: GrantCapability = { allowed: true };

const accountRefusal = (machine: GrantMachine, ctx: GrantContext): GrantCapability | null => {
  switch (machine.phase.phase) {
    case "closed":
      return { allowed: false, reason: "epoch-closed", waitable: false };
    case "unverified":
    case "verifying":
    case "unverified-failed":
      return { allowed: false, reason: "access-unverified", waitable: true };
    case "lapsed":
      // Only an admitted round ends a lapse; a wall clock set back does not.
      return { allowed: false, reason: "access-lapsed", waitable: true };
    case "granted":
      return expired(machine.phase.evidence.account.startedAt, ctx.now, ctx.policy)
        ? { allowed: false, reason: "access-lapsed", waitable: true }
        : null;
  }
};

/** The account's own evidence authorizes now: what every platform capability starts from. */
export const grantAccount = (machine: GrantMachine, ctx: GrantContext): GrantCapability =>
  accountRefusal(machine, ctx) ?? ALLOWED;

const projectRefusal = (
  machine: GrantMachine,
  projectId: ZeropsProjectId,
  ctx: GrantContext,
): GrantCapability | ProjectEvidence => {
  const refusal = accountRefusal(machine, ctx);
  if (refusal !== null) return refusal;
  const evidence = heldEvidence(machine)!;
  if (evidence.closedProjects.has(projectId)) {
    return { allowed: false, reason: "project-closed", waitable: false };
  }
  const own = evidence.projects.get(projectId);
  if (own === undefined || expired(own.startedAt, ctx.now, ctx.policy)) {
    return { allowed: false, reason: "project-unverified", waitable: true };
  }
  if (own.access.role === "NO_ACCESS") {
    return { allowed: false, reason: "role-denies", waitable: false };
  }
  return own;
};

export const grantPlatformRead = (
  machine: GrantMachine,
  projectId: ZeropsProjectId,
  ctx: GrantContext,
): GrantCapability => {
  const verdict = projectRefusal(machine, projectId, ctx);
  return "allowed" in verdict ? verdict : ALLOWED;
};

export const grantPlatformWrite = (
  machine: GrantMachine,
  projectId: ZeropsProjectId,
  ctx: GrantContext,
): GrantCapability => {
  const verdict = projectRefusal(machine, projectId, ctx);
  if ("allowed" in verdict) return verdict;
  return verdict.access.mutationsAllowed
    ? ALLOWED
    : { allowed: false, reason: "role-denies", waitable: false };
};

// ── Transitions ───────────────────────────────────────────────────────────────────────────────

export const initialGrant = (
  signals: { readonly hidden: boolean; readonly online: boolean },
  now: Instant,
): GrantMachine => ({
  phase: { phase: "unverified" },
  demandedProjects: [],
  signals: { hiddenSince: signals.hidden ? now : null, online: signals.online },
  projectAttempts: new Map(),
  roundDurationsMs: [],
  nextAttempt: 1,
  timer: null,
  published: { account: null, projects: new Map() },
});

type Effects = Array<GrantEffect>;

const withEvidence = (machine: GrantMachine, evidence: Evidence): GrantMachine => {
  const phase = machine.phase;
  if (phase.phase === "granted") return { ...machine, phase: { ...phase, evidence } };
  if (phase.phase === "lapsed") return { ...machine, phase: { ...phase, last: evidence } };
  return machine;
};

const withRound = (machine: GrantMachine, round: GrantRound): GrantMachine => {
  const phase = machine.phase;
  if (phase.phase === "verifying") return { ...machine, phase: { ...phase, round } };
  if (phase.phase === "granted" || phase.phase === "lapsed") {
    const again = phase.renewal.status === "running" && phase.renewal.again === true;
    return {
      ...machine,
      phase: {
        ...phase,
        renewal: { status: "running", round, ...(again ? { again: true as const } : {}) },
      },
    };
  }
  return machine;
};

const withRenewal = (machine: GrantMachine, renewal: Renewal): GrantMachine => {
  const phase = machine.phase;
  return phase.phase === "granted" || phase.phase === "lapsed"
    ? { ...machine, phase: { ...phase, renewal } }
    : machine;
};

/**
 * What a round reads: the demanded projects, and every project the held evidence still names —
 * verified or unverified. A project no lease demands at the instant a round starts is not one this
 * account lost: only the platform's answer, or the organization's membership gone, takes it out of
 * the evidence. A denial is final.
 */
const carriedProjects = (machine: GrantMachine): ReadonlyArray<ProjectRef> => {
  const carried = new Map<ZeropsProjectId, ProjectRef>(
    machine.demandedProjects.map((project) => [project.projectId, project]),
  );
  const held = heldEvidence(machine);
  if (held === null) return [...carried.values()];
  const keep = (project: ProjectRef) => {
    if (!carried.has(project.projectId)) carried.set(project.projectId, project);
  };
  for (const { access } of held.projects.values()) keep(access.project);
  for (const { project } of held.unverified.values()) keep(project);
  return [...carried.values()];
};

/** Starts a round now; the caller puts it in the phase's round slot. */
const newRound = (
  machine: GrantMachine,
  failures: number,
  ctx: GrantContext,
  out: Effects,
): { readonly machine: GrantMachine; readonly round: GrantRound } => {
  const carried = carriedProjects(machine);
  const round: GrantRound = {
    id: machine.nextAttempt,
    startedAt: ctx.now,
    deadline: after(ctx.now, roundDeadlineMs(ctx.policy, carried.length)),
    failures,
    organizations: null,
    targets: null,
    outcomes: new Map(),
  };
  out.push({ kind: "run", attempt: round.id, op: { kind: "verify-round", carried } });
  return { machine: { ...machine, nextAttempt: machine.nextAttempt + 1 }, round };
};

const startVerifying = (
  machine: GrantMachine,
  failures: number,
  ctx: GrantContext,
  out: Effects,
): GrantMachine => {
  const started = newRound(machine, failures, ctx, out);
  return { ...started.machine, phase: { phase: "verifying", round: started.round } };
};

/** A renewal that is due: dormant when hidden too long, paused offline, otherwise a round. */
const startRenewal = (
  machine: GrantMachine,
  failures: number,
  ctx: GrantContext,
  out: Effects,
): GrantMachine => {
  if (dormant(machine, ctx)) return withRenewal(machine, { status: "dormant" });
  if (!machine.signals.online) return machine;
  const started = newRound(machine, failures, ctx, out);
  return withRenewal(started.machine, { status: "running", round: started.round });
};

const failRound = (
  machine: GrantMachine,
  round: GrantRound,
  failure: GrantFailure,
  ctx: GrantContext,
): GrantMachine => {
  const attempt = round.failures + 1;
  const phase = machine.phase;
  /**
   * When the next round goes out on `ladder`: at once when a person asked during this one, never
   * by itself after a definitive failure.
   */
  const retryAfter = (ladder: RetryLadder): Instant | null =>
    round.askedAgain === true ? ctx.now : retryAtOf(ctx, failure, ladder, attempt);
  if (phase.phase === "verifying") {
    return {
      ...machine,
      phase: {
        phase: "unverified-failed",
        failure,
        retryAt: retryAfter(ctx.policy.initialRetryMs),
        attempt,
      },
    };
  }
  if (phase.phase === "granted") {
    // Bounded by the held deadline, where the lapse starts its own round (§4.2 timers).
    const retry = retryAfter(ctx.policy.renewalRetryMs);
    const retryAt =
      retry === null
        ? null
        : sooner(retry, after(phase.evidence.account.startedAt, ctx.policy.windowMs));
    return {
      ...machine,
      phase: { ...phase, renewal: { status: "failed", failure, retryAt, attempt }, failure },
    };
  }
  if (phase.phase !== "lapsed") return machine;
  const retryAt = retryAfter(ctx.policy.lapsedRetryMs);
  return {
    ...machine,
    phase: { ...phase, renewal: { status: "failed", failure, retryAt, attempt }, failure },
  };
};

const closeProject = (
  machine: GrantMachine,
  project: ProjectRef,
  evidence: DenialEvidence,
  ctx: GrantContext,
  out: Effects,
): GrantMachine => {
  const held = heldEvidence(machine);
  if (held === null) return machine;
  const id = project.projectId;
  if (held.closedProjects.has(id)) return machine;
  const closedProjects = new Map(held.closedProjects);
  closedProjects.set(id, { project, deniedAt: ctx.now, evidence });
  out.push({ kind: "observe", observation: { kind: "project-gone", project, evidence } });
  const projects = new Map(held.projects);
  projects.delete(id);
  const unverified = new Map(held.unverified);
  unverified.delete(id);
  return withEvidence(machine, { ...held, projects, unverified, closedProjects });
};

/** A lowered role applies the moment it is read, under the evidence's own stamp. */
const lowerRole = (machine: GrantMachine, access: ProjectEffectiveAccess): GrantMachine => {
  const held = heldEvidence(machine);
  const own = held?.projects.get(access.project.projectId);
  if (held === null || own === undefined) return machine;
  if (!own.access.mutationsAllowed || access.mutationsAllowed) return machine;
  const projects = new Map(held.projects);
  projects.set(access.project.projectId, { access, startedAt: own.startedAt });
  return withEvidence(machine, { ...held, projects });
};

const completeRound = (
  machine: GrantMachine,
  round: GrantRound,
  ctx: GrantContext,
  out: Effects,
): GrantMachine => {
  if (expired(round.startedAt, ctx.now, ctx.policy)) {
    // G3: verified in a frozen tab and delivered after its own deadline.
    out.push({
      kind: "log",
      diagnostic: {
        kind: "round-discarded-late",
        round: round.id,
        startedAtMs: round.startedAt.wall,
        completedAtMs: ctx.now.wall,
      },
    });
    // Another round starts at once: its own stamp is the fresh one.
    if (machine.phase.phase === "verifying") {
      return {
        ...machine,
        phase: {
          phase: "unverified-failed",
          failure: { kind: "timeout", afterMs: ctx.now.mono - round.startedAt.mono },
          retryAt: ctx.now,
          attempt: round.failures + 1,
        },
      };
    }
    return withRenewal(machine, { status: "idle", dueAt: ctx.now });
  }

  const previous = heldEvidence(machine);
  const closedProjects = new Map(previous?.closedProjects ?? []);
  const projects = new Map<ZeropsProjectId, ProjectEvidence>();
  const unverified = new Map<ZeropsProjectId, UnverifiedProject>();
  for (const target of round.targets ?? []) {
    const id = target.projectId;
    const answer = round.outcomes.get(id);
    const outcome: ProjectOutcome = answer?.outcome ?? {
      kind: "failed",
      failure: { kind: "timeout", afterMs: ctx.now.mono - round.startedAt.mono },
    };
    const closed = closedProjects.get(id);
    switch (outcome.kind) {
      case "verified":
        // A denial received after this round started is newer than its read.
        if (closed !== undefined && round.startedAt.mono < closed.deniedAt.mono) break;
        closedProjects.delete(id);
        projects.set(id, { access: outcome.access, startedAt: round.startedAt });
        break;
      case "denied":
        if (closed === undefined) {
          closedProjects.set(id, {
            project: target,
            deniedAt: answer?.at ?? ctx.now,
            evidence: outcome.evidence,
          });
          out.push({
            kind: "observe",
            observation: { kind: "project-gone", project: target, evidence: outcome.evidence },
          });
        }
        break;
      case "failed": {
        if (closed !== undefined) break;
        const own = previous?.projects.get(id);
        if (own !== undefined) projects.set(id, own);
        unverified.set(id, {
          project: target,
          failure: outcome.failure,
          dueAt: retryAtOf(ctx, outcome.failure, ctx.policy.projectRetryMs, 1),
          attempt: 1,
        });
        break;
      }
    }
  }

  const evidence: Evidence = {
    account: {
      round: round.id,
      startedAt: round.startedAt,
      organizations: round.organizations ?? [],
    },
    projects,
    unverified,
    closedProjects,
  };
  const durationMs = ctx.now.mono - round.startedAt.mono;
  const roundDurationsMs = [...machine.roundDurationsMs, durationMs].slice(
    -ctx.policy.roundDurationSamples,
  );
  const lead = renewalLeadMs(ctx.policy, p95(roundDurationsMs));
  out.push({
    kind: "observe",
    observation: { kind: "access-verified", verifiedAtMs: round.startedAt.wall, evidence },
  });
  out.push({
    kind: "log",
    diagnostic: {
      kind: "round-admitted",
      round: round.id,
      durationMs,
      projects: round.targets?.length ?? 0,
    },
  });
  return demandProjects(
    {
      ...machine,
      roundDurationsMs,
      phase: {
        phase: "granted",
        evidence,
        renewal: {
          status: "idle",
          // Grants this account wrote while it ran may have been read before the write.
          dueAt: wroteDuring(machine)
            ? ctx.now
            : after(round.startedAt, ctx.policy.windowMs - lead),
        },
        failure: null,
      },
    },
    machine.demandedProjects,
    ctx,
  );
};

/** Whether this account wrote a project's grants while the renewal in flight ran. */
const wroteDuring = (machine: GrantMachine): boolean => {
  const phase = machine.phase;
  return (
    (phase.phase === "granted" || phase.phase === "lapsed") &&
    phase.renewal.status === "running" &&
    phase.renewal.again === true
  );
};

/**
 * Grants this account wrote: a granted grant reads every project again — at once where its renewal
 * waits, right after the round in flight otherwise. A grant not granted yet reads them with its
 * first round; one retrying after a failure, with its next.
 */
const grantsWritten = (machine: GrantMachine, ctx: GrantContext): GrantMachine => {
  const phase = machine.phase;
  if (phase.phase !== "granted" && phase.phase !== "lapsed") return machine;
  const renewal = phase.renewal;
  if (renewal.status === "running") return withRenewal(machine, { ...renewal, again: true });
  return renewal.status === "idle"
    ? withRenewal(machine, { status: "idle", dueAt: ctx.now })
    : machine;
};

const roundComplete = (round: GrantRound): boolean =>
  round.targets !== null && round.targets.every((target) => round.outcomes.has(target.projectId));

const projectResult = (
  machine: GrantMachine,
  attempt: ProjectAttempt,
  outcome: ProjectOutcome,
  ctx: GrantContext,
  out: Effects,
): GrantMachine => {
  const phase = machine.phase;
  const id = attempt.project.projectId;
  if (outcome.kind === "denied") {
    return closeProject(machine, attempt.project, outcome.evidence, ctx, out);
  }
  // Failure belongs to the accepted read even if authority lapsed while it ran.
  const held = heldEvidence(machine);
  if (held === null) return machine;
  // §4.0: a read that started before the admitted round is superseded by it; joined to that
  // round, its evidence would be stamped later than itself (G2). Ordered on the monotonic clock,
  // so a wall clock set back within the tolerance cannot make every fresh read look stale.
  if (attempt.startedAt.mono < held.account.startedAt.mono) return machine;
  // Only a project the admitted evidence still holds as unverified takes a read's answer.
  if (!held.unverified.has(id)) return machine;
  if (outcome.kind === "failed") {
    const entry = held.unverified.get(id)!;
    const unverified = new Map(held.unverified);
    unverified.set(id, {
      ...entry,
      failure: outcome.failure,
      dueAt: retryAtOf(ctx, outcome.failure, ctx.policy.projectRetryMs, entry.attempt + 1),
      attempt: entry.attempt + 1,
    });
    return withEvidence(machine, { ...held, unverified });
  }
  // Only fresh account evidence may admit a positive project answer.
  if (phase.phase !== "granted" || expired(held.account.startedAt, ctx.now, ctx.policy))
    return machine;
  const projects = new Map(held.projects);
  projects.set(id, {
    access: outcome.access,
    startedAt: held.account.startedAt,
  });
  const unverified = new Map(held.unverified);
  unverified.delete(id);
  const closedProjects = new Map(held.closedProjects);
  closedProjects.delete(id);
  return withEvidence(machine, { ...held, projects, unverified, closedProjects });
};

/**
 * A visible wake, `online` or a person's retry: every wait restarts from its first rung, now — one
 * a definitive failure ended only on a person's retry (`person`).
 */
const wake = (
  machine: GrantMachine,
  ctx: GrantContext,
  out: Effects,
  person: boolean,
): GrantMachine => {
  const phase = machine.phase;
  if (phase.phase === "unverified-failed") {
    if (!person && definitive(phase.failure)) return machine;
    return machine.signals.online ? startVerifying(machine, 0, ctx, out) : machine;
  }
  if (phase.phase !== "granted" && phase.phase !== "lapsed") return machine;
  // A waiting renewal is due now; a granted idle one keeps its schedule (renew if due).
  const renewal = phase.renewal;
  const next =
    (renewal.status === "failed" && (person || !definitive(renewal.failure))) ||
    renewal.status === "dormant" ||
    (phase.phase === "lapsed" && renewal.status === "idle")
      ? withRenewal(machine, { status: "idle", dueAt: ctx.now })
      : machine;
  const held = heldEvidence(next)!;
  const unverified = new Map(
    [...held.unverified].map(([id, entry]) => [
      id,
      !person && definitive(entry.failure) ? entry : { ...entry, dueAt: ctx.now, attempt: 0 },
    ]),
  );
  return withEvidence(next, { ...held, unverified });
};

const apply = (
  machine: GrantMachine,
  event: GrantEvent,
  ctx: GrantContext,
  out: Effects,
): GrantMachine => {
  switch (event.type) {
    case "START":
      if (machine.phase.phase !== "unverified") return machine;
      if (machine.signals.online) return startVerifying(machine, 0, ctx, out);
      return {
        ...machine,
        phase: {
          phase: "unverified-failed",
          failure: { kind: "offline" },
          retryAt: after(ctx.now, waitOf(ctx, ctx.policy.initialRetryMs, 1)),
          attempt: 1,
        },
      };
    case "TICK":
      return machine;
    case "VISIBILITY": {
      const next = {
        ...machine,
        signals: {
          ...machine.signals,
          hiddenSince: event.hidden ? (machine.signals.hiddenSince ?? ctx.now) : null,
        },
      };
      // Dormancy is a hidden tab's state: it ends with visibility itself, so a wake the §6.4
      // coalescer suppressed cannot leave a visible tab without a round (D5).
      const phase = next.phase;
      const dormantRenewal =
        (phase.phase === "granted" || phase.phase === "lapsed") &&
        phase.renewal.status === "dormant";
      return !event.hidden && dormantRenewal
        ? withRenewal(next, { status: "idle", dueAt: ctx.now })
        : next;
    }
    case "WAKE":
      return event.visible ? wake(machine, ctx, out, false) : machine;
    case "ONLINE": {
      const online = { ...machine, signals: { ...machine.signals, online: true } };
      return online.signals.hiddenSince === null ? wake(online, ctx, out, false) : online;
    }
    case "OFFLINE":
      return { ...machine, signals: { ...machine.signals, online: false } };
    case "USER_RETRY": {
      // A retry during a round joins it (G7); should that round fail, the person's ask is not
      // spent on it: the next round goes out at once instead of on the ladder.
      const round = grantRoundInFlight(machine);
      if (round === null) return wake(machine, ctx, out, true);
      return round.askedAgain === true
        ? machine
        : withRound(machine, { ...round, askedAgain: true });
    }
    case "GRANTS_WRITTEN":
      return grantsWritten(machine, ctx);
    case "ROUND_ACCOUNT": {
      const round = grantRoundInFlight(machine);
      if (round === null || round.id !== event.round || round.targets !== null) return machine;
      const listed: GrantRound = {
        ...round,
        organizations: event.organizations,
        targets: event.projects,
        deadline: after(round.startedAt, roundDeadlineMs(ctx.policy, event.projects.length)),
      };
      const next = withRound(machine, listed);
      return roundComplete(listed) ? completeRound(next, listed, ctx, out) : next;
    }
    case "ROUND_PROJECT": {
      const round = grantRoundInFlight(machine);
      if (round === null || round.id !== event.round) return machine;
      const id = event.project.projectId;
      // A denial recorded while this round ran is newer than the round's own read (G6).
      if (round.outcomes.get(id)?.outcome.kind === "denied") return machine;
      const answered: GrantRound = {
        ...round,
        outcomes: new Map(round.outcomes).set(id, { outcome: event.outcome, at: ctx.now }),
      };
      let next = withRound(machine, answered);
      if (event.outcome.kind === "denied") {
        next = closeProject(next, event.project, event.outcome.evidence, ctx, out);
      } else if (event.outcome.kind === "verified") {
        next = lowerRole(next, event.outcome.access);
      }
      return roundComplete(answered) ? completeRound(next, answered, ctx, out) : next;
    }
    case "ROUND_FAILED": {
      const round = grantRoundInFlight(machine);
      if (round === null || round.id !== event.round) return machine;
      return failRound(machine, round, event.failure, ctx);
    }
    case "PROJECT_RESULT": {
      const id = event.project.projectId;
      const attempt = machine.projectAttempts.get(id);
      if (attempt === undefined || attempt.attempt !== event.attempt) return machine;
      const projectAttempts = new Map(machine.projectAttempts);
      projectAttempts.delete(id);
      return projectResult({ ...machine, projectAttempts }, attempt, event.outcome, ctx, out);
    }
    case "PROJECTS_DEMANDED":
      return demandProjects({ ...machine, demandedProjects: event.projects }, event.projects, ctx);
    case "PROJECT_DENIED": {
      if (heldEvidence(machine) !== null) {
        return closeProject(machine, event.project, event.evidence, ctx, out);
      }
      const round = grantRoundInFlight(machine);
      if (round === null) return machine;
      const denied: GrantRound = {
        ...round,
        outcomes: new Map(round.outcomes).set(event.project.projectId, {
          outcome: { kind: "denied", evidence: event.evidence },
          at: ctx.now,
        }),
      };
      // The denial may be the last outcome the round waited for: the round is complete now.
      const next = withRound(machine, denied);
      return roundComplete(denied) ? completeRound(next, denied, ctx, out) : next;
    }
    case "EPOCH_CLOSED":
      return machine;
  }
};

/**
 * The demanded projects a fresh grant does not name yet, in an organization its evidence holds, are
 * held unverified and due now: `startProjectReads` reads each on its own. A project the evidence
 * names already — verified, unverified or closed — is left as it is.
 */
const demandProjects = (
  machine: GrantMachine,
  demanded: ReadonlyArray<ProjectRef>,
  ctx: GrantContext,
): GrantMachine => {
  const phase = machine.phase;
  if (phase.phase !== "granted" || expired(phase.evidence.account.startedAt, ctx.now, ctx.policy)) {
    return machine;
  }
  const evidence = phase.evidence;
  const organizations = new Set(
    evidence.account.organizations.map(({ organization }) => organization.organizationId),
  );
  const fresh = demanded.filter(
    (project) =>
      organizations.has(project.organization.organizationId) &&
      !evidence.projects.has(project.projectId) &&
      !evidence.unverified.has(project.projectId) &&
      !evidence.closedProjects.has(project.projectId),
  );
  if (fresh.length === 0) return machine;
  const unverified = new Map(evidence.unverified);
  for (const project of fresh) {
    unverified.set(project.projectId, {
      project,
      failure: null,
      dueAt: ctx.now,
      attempt: 0,
    });
  }
  return withEvidence(machine, { ...evidence, unverified });
};

/**
 * A project's authority ends at its own deadline for good: its evidence is dropped, so a wall
 * clock set back later cannot revive it, and the project is read again at once.
 */
const dropExpiredProjects = (
  machine: GrantMachine,
  evidence: Evidence,
  ctx: GrantContext,
): GrantMachine => {
  const lapsed = [...evidence.projects].filter(([, own]) =>
    expired(own.startedAt, ctx.now, ctx.policy),
  );
  if (lapsed.length === 0) return machine;
  const projects = new Map(evidence.projects);
  const unverified = new Map(evidence.unverified);
  for (const [id, own] of lapsed) {
    projects.delete(id);
    if (!unverified.has(id)) {
      unverified.set(id, {
        project: own.access.project,
        failure: { kind: "timeout", afterMs: ctx.policy.windowMs },
        dueAt: ctx.now,
        attempt: 0,
      });
    }
  }
  return withEvidence(machine, { ...evidence, projects, unverified });
};

const projectAttemptDeadline = (attempt: ProjectAttempt, policy: ZeropsGrantPolicy): Instant =>
  after(attempt.startedAt, roundDeadlineMs(policy, 1));

/** Re-evaluates both clocks: lapse, round and read deadlines, and everything now due. */
const settle = (machine: GrantMachine, ctx: GrantContext, out: Effects): GrantMachine => {
  let next = machine;

  if (
    next.phase.phase === "granted" &&
    expired(next.phase.evidence.account.startedAt, ctx.now, ctx.policy)
  ) {
    const renewal = next.phase.renewal;
    out.push({
      kind: "observe",
      observation: { kind: "access-expired", expiredAtMs: ctx.now.wall },
    });
    out.push({ kind: "invalidate", invalidation: { topic: "access", change: "lapsed" } });
    next = {
      ...next,
      phase: {
        phase: "lapsed",
        last: next.phase.evidence,
        // A lapse starts a round at once (G9); a round already running is that round.
        renewal:
          renewal.status === "running"
            ? { status: "running", round: { ...renewal.round, failures: 0 } }
            : { status: "idle", dueAt: ctx.now },
        failure: next.phase.failure,
      },
    };
  }

  if (next.phase.phase === "granted") next = dropExpiredProjects(next, next.phase.evidence, ctx);

  const round = grantRoundInFlight(next);
  if (round !== null && reached(round.deadline, ctx.now)) {
    next =
      round.targets === null
        ? failRound(
            next,
            round,
            {
              kind: "timeout",
              afterMs: round.deadline.mono - round.startedAt.mono,
            },
            ctx,
          )
        : completeRound(next, round, ctx, out);
  }

  for (const attempt of next.projectAttempts.values()) {
    if (!reached(projectAttemptDeadline(attempt, ctx.policy), ctx.now)) continue;
    const projectAttempts = new Map(next.projectAttempts);
    projectAttempts.delete(attempt.project.projectId);
    next = projectResult(
      { ...next, projectAttempts },
      attempt,
      {
        kind: "failed",
        failure: { kind: "timeout", afterMs: ctx.now.mono - attempt.startedAt.mono },
      },
      ctx,
      out,
    );
  }

  const phase = next.phase;
  if (phase.phase === "unverified-failed" && retrying(next) && due(phase.retryAt, ctx.now)) {
    next = startVerifying(next, phase.attempt, ctx, out);
  } else if (phase.phase === "granted" || phase.phase === "lapsed") {
    const renewal = phase.renewal;
    if (renewal.status === "idle" && reached(renewal.dueAt, ctx.now))
      next = startRenewal(next, 0, ctx, out);
    else if (renewal.status === "failed" && retrying(next) && due(renewal.retryAt, ctx.now))
      next = startRenewal(next, renewal.attempt, ctx, out);
  }

  return startProjectReads(next, ctx, out);
};

/** Requested project checks run only under a fresh account grant. */
const startProjectReads = (
  machine: GrantMachine,
  ctx: GrantContext,
  out: Effects,
): GrantMachine => {
  const phase = machine.phase;
  if (
    phase.phase !== "granted" ||
    !machine.signals.online ||
    dormant(machine, ctx) ||
    expired(phase.evidence.account.startedAt, ctx.now, ctx.policy)
  ) {
    return machine;
  }
  if (phase.renewal.status === "running") return machine;
  const reads: Array<ProjectRef> = [];
  for (const [id, entry] of phase.evidence.unverified) {
    if (
      machine.demandedProjects.some((project) => project.projectId === id) &&
      !machine.projectAttempts.has(id) &&
      (entry.attempt === 0 || retrying(machine)) &&
      due(entry.dueAt, ctx.now)
    ) {
      reads.push(entry.project);
    }
  }
  if (reads.length === 0) return machine;
  const projectAttempts = new Map(machine.projectAttempts);
  let nextAttempt = machine.nextAttempt;
  for (const project of reads) {
    const attempt = nextAttempt++;
    projectAttempts.set(project.projectId, { attempt, project, startedAt: ctx.now });
    out.push({ kind: "run", attempt, op: { kind: "verify-project", project } });
  }
  return { ...machine, projectAttempts, nextAttempt };
};

const AUTHORIZED: ScopeAuthority = { kind: "authorized" };
const withheld = (reason: GrantWithheldReason, cause: GrantWithholdingCause): ScopeAuthority => ({
  kind: "withheld",
  reason,
  cause,
});

const sameAuthority = (left: ScopeAuthority | null, right: ScopeAuthority): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const authorityEffect = (scope: GrantScope, authority: ScopeAuthority): GrantEffect =>
  authority.kind === "authorized"
    ? { kind: "restore-authority", scope }
    : { kind: "withhold", scope, reason: authority.reason, cause: authority.cause };

/** G12: per scope, tells the runtime only what changed. */
const publish = (machine: GrantMachine, ctx: GrantContext, out: Effects): GrantMachine => {
  const phase = machine.phase;
  if (phase.phase !== "granted" && phase.phase !== "lapsed") return machine;
  const evidence = heldEvidence(machine)!;
  const lapsed = phase.phase === "lapsed";
  const lapseCause: GrantWithholdingCause =
    phase.failure === null
      ? null
      : {
          failure: phase.failure,
          retryAtMs:
            phase.renewal.status === "failed" ? (phase.renewal.retryAt?.wall ?? null) : null,
        };
  const account = lapsed ? withheld("access-lapsed", lapseCause) : AUTHORIZED;

  const scopes = new Map<ZeropsProjectId, ProjectRef>();
  for (const [id, own] of evidence.projects) scopes.set(id, own.access.project);
  for (const [id, entry] of evidence.unverified) scopes.set(id, entry.project);
  for (const [id, entry] of evidence.closedProjects) scopes.set(id, entry.project);
  for (const [id, entry] of machine.published.projects) {
    if (!scopes.has(id)) scopes.set(id, entry.project);
  }

  const projects = new Map<
    ZeropsProjectId,
    { readonly project: ProjectRef; readonly authority: ScopeAuthority }
  >();
  for (const [id, project] of scopes) {
    const own = evidence.projects.get(id);
    const entry = evidence.unverified.get(id);
    const before = machine.published.projects.get(id)?.authority ?? null;
    const authority: ScopeAuthority =
      evidence.closedProjects.has(id) || own?.access.role === "NO_ACCESS"
        ? withheld("access-denied", null)
        : own === undefined && entry === undefined
          ? // Missing from the admitted evidence: whatever it had stays withheld.
            before === null || before.kind === "authorized"
            ? withheld("access-denied", null)
            : before
          : lapsed
            ? withheld("access-lapsed", lapseCause)
            : own !== undefined && !expired(own.startedAt, ctx.now, ctx.policy)
              ? AUTHORIZED
              : withheld(
                  "access-unverified",
                  entry === undefined || entry.failure === null
                    ? null
                    : { failure: entry.failure, retryAtMs: entry.dueAt?.wall ?? null },
                );
    projects.set(id, { project, authority });
    if (!sameAuthority(before, authority)) {
      out.push(authorityEffect({ kind: "project", project }, authority));
    }
  }
  if (!sameAuthority(machine.published.account, account)) {
    out.push(authorityEffect({ kind: "account" }, account));
  }
  return { ...machine, published: { account, projects } };
};

/** One timer: the earliest instant anything waits on, on either clock. */
const reschedule = (machine: GrantMachine, ctx: GrantContext, out: Effects): GrantMachine => {
  const phase = machine.phase;
  const online = machine.signals.online;
  const candidates: Array<Instant> = [];
  const round = grantRoundInFlight(machine);
  if (round !== null) candidates.push(round.deadline);
  for (const attempt of machine.projectAttempts.values()) {
    candidates.push(projectAttemptDeadline(attempt, ctx.policy));
  }

  if (phase.phase === "unverified-failed" && retrying(machine) && phase.retryAt !== null)
    candidates.push(phase.retryAt);
  if (phase.phase === "granted" || phase.phase === "lapsed") {
    const renewal = phase.renewal;
    if (online && renewal.status === "idle") candidates.push(renewal.dueAt);
    if (retrying(machine) && renewal.status === "failed" && renewal.retryAt !== null)
      candidates.push(renewal.retryAt);
  }
  if (phase.phase === "granted") {
    const evidence = phase.evidence;
    candidates.push(after(evidence.account.startedAt, ctx.policy.windowMs));
    for (const own of evidence.projects.values()) {
      candidates.push(after(own.startedAt, ctx.policy.windowMs));
    }
    if (online && !dormant(machine, ctx)) {
      for (const [id, entry] of evidence.unverified) {
        if (
          machine.demandedProjects.some((project) => project.projectId === id) &&
          (entry.attempt === 0 || retrying(machine)) &&
          round === null &&
          !machine.projectAttempts.has(id) &&
          entry.dueAt !== null
        ) {
          candidates.push(entry.dueAt);
        }
      }
    }
  }
  const pending = candidates.filter((at) => !reached(at, ctx.now));
  const timer = pending.length === 0 ? null : pending.reduce(sooner);
  const previous = machine.timer;
  if (timer === null) {
    if (previous !== null) out.push({ kind: "cancel", key: GRANT_TIMER_KEY });
  } else if (previous === null || previous.wall !== timer.wall || previous.mono !== timer.mono) {
    out.push({ kind: "schedule", key: GRANT_TIMER_KEY, at: timer, event: { type: "TICK" } });
  }
  return { ...machine, timer };
};

export const transitionGrant = (
  machine: GrantMachine,
  event: GrantEvent,
  ctx: GrantContext,
): { readonly state: GrantMachine; readonly effects: ReadonlyArray<GrantEffect> } => {
  if (machine.phase.phase === "closed") return { state: machine, effects: [] };
  if (event.type === "EPOCH_CLOSED") {
    return {
      state: { ...machine, phase: { phase: "closed" }, projectAttempts: new Map(), timer: null },
      effects: machine.timer === null ? [] : [{ kind: "cancel", key: GRANT_TIMER_KEY }],
    };
  }
  const out: Effects = [];
  // The clocks first: an event is judged at the instant it is delivered.
  let next = settle(machine, ctx, out);
  next = apply(next, event, ctx, out);
  next = settle(next, ctx, out);
  next = publish(next, ctx, out);
  next = reschedule(next, ctx, out);
  return { state: next, effects: out };
};
