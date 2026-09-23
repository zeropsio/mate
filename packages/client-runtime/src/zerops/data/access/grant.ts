/**
 * The access grant (DESIGN §4.2): the client's verified authority over the platform, as one
 * pure machine — `transitionGrant(state, event, ctx) → { state, effects }`.
 *
 * - A round is REST only (G1). Its account part (`fetchUser` and every organization list)
 *   admits the account; each project carries its own evidence and its own deadline (C2b).
 * - Evidence is stamped when its round starts, on the wall and the monotonic clock, and
 *   authorizes for the policy window after that stamp on whichever clock runs out first. A
 *   backwards wall jump beyond the tolerance ends it at once (G2, G5).
 * - Timers are hints. Every event first re-evaluates both clocks, and every capability is
 *   computed from the stamps at the instant it is asked for, so a deadline a frozen or
 *   throttled tab slept through is honoured when the tab next runs.
 * - A 403/404 closes that project's writes at once; its content is removed only after a direct
 *   confirming read at least the confirmation delay later (G6).
 * - Effects are data. The interpreter runs `run` ops and feeds their answers back as events,
 *   arms one timer per `schedule` that delivers `TICK`, and forwards the rest to the runtime.
 */
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
}

/** Why a round or a project read did not answer. A 401 belongs to the session machine. */
export type GrantFailure =
  | { readonly kind: "offline" }
  | { readonly kind: "timeout"; readonly afterMs: number }
  | { readonly kind: "transport"; readonly detail: string }
  | { readonly kind: "throttled"; readonly retryAfterMs: number | null }
  | { readonly kind: "server"; readonly status: number }
  | { readonly kind: "malformed"; readonly detail: string };

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

/** Listed, but its latest read failed: it keeps any older evidence until that expires. */
export interface UnverifiedProject {
  readonly project: ProjectRef;
  readonly failure: GrantFailure;
  readonly retryAt: Instant;
  /** Failed reads so far; picks the rung of the next wait. */
  readonly attempt: number;
}

/** A 403/404 was seen: writes are closed, content is withheld until a confirming read. */
export interface ClosedProject {
  readonly project: ProjectRef;
  readonly deniedAt: Instant;
  readonly confirmation:
    | { readonly status: "due"; readonly at: Instant; readonly attempt: number }
    | { readonly status: "confirmed"; readonly evidence: DenialEvidence };
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
}

export type Renewal =
  | { readonly status: "idle"; readonly dueAt: Instant }
  | { readonly status: "running"; readonly round: GrantRound }
  | {
      readonly status: "backoff";
      readonly failure: GrantFailure;
      readonly retryAt: Instant;
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
      readonly retryAt: Instant;
      readonly attempt: number;
    }
  | { readonly phase: "granted"; readonly evidence: Evidence; readonly renewal: Renewal }
  | { readonly phase: "lapsed"; readonly last: Evidence; readonly renewal: Renewal }
  | { readonly phase: "closed" };

/** A read of one project outside a round: a per-project retry, or a denial's confirmation. */
export interface ProjectAttempt {
  readonly attempt: number;
  readonly kind: "verify" | "confirm";
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
  /** §6.4's coalesced wake: visible resets every backoff; hidden only re-evaluates deadlines. */
  | { readonly type: "WAKE"; readonly visible: boolean }
  | { readonly type: "ONLINE" }
  | { readonly type: "OFFLINE" }
  | { readonly type: "USER_RETRY" }
  /** `fetchUser` and every organization list answered; `projects` are the round's reads. */
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
  | { readonly kind: "verify-project"; readonly project: ProjectRef }
  | { readonly kind: "confirm-denial"; readonly project: ProjectRef };

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

const rung = (ladder: ReadonlyArray<number>, attempt: number): number =>
  ladder[Math.min(Math.max(attempt, 1), ladder.length) - 1]!;

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

/** Door and Gitea throwaway mints (§4.3, Phase 0–1): the account window only, no role. */
export const grantIdentityMint = (machine: GrantMachine, ctx: GrantContext): GrantCapability =>
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
    return { ...machine, phase: { ...phase, renewal: { status: "running", round } } };
  }
  return machine;
};

const withRenewal = (machine: GrantMachine, renewal: Renewal): GrantMachine => {
  const phase = machine.phase;
  return phase.phase === "granted" || phase.phase === "lapsed"
    ? { ...machine, phase: { ...phase, renewal } }
    : machine;
};

const carriedProjects = (evidence: Evidence | null): ReadonlyArray<ProjectRef> => {
  if (evidence === null) return [];
  const carried = new Map<ZeropsProjectId, ProjectRef>();
  for (const [id, own] of evidence.projects) carried.set(id, own.access.project);
  for (const [id, entry] of evidence.unverified) carried.set(id, entry.project);
  for (const [id, entry] of evidence.closedProjects) carried.set(id, entry.project);
  return [...carried.values()];
};

/** Starts a round now; the caller puts it in the phase's round slot. */
const newRound = (
  machine: GrantMachine,
  failures: number,
  ctx: GrantContext,
  out: Effects,
): { readonly machine: GrantMachine; readonly round: GrantRound } => {
  const carried = carriedProjects(heldEvidence(machine));
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
  if (phase.phase === "verifying") {
    return {
      ...machine,
      phase: {
        phase: "unverified-failed",
        failure,
        retryAt: after(ctx.now, rung(ctx.policy.initialRetryMs, attempt)),
        attempt,
      },
    };
  }
  if (phase.phase === "granted") {
    // Bounded by the held deadline, where the lapse starts its own round (§4.2 timers).
    const retryAt = sooner(
      after(ctx.now, rung(ctx.policy.renewalRetryMs, attempt)),
      after(phase.evidence.account.startedAt, ctx.policy.windowMs),
    );
    return withRenewal(machine, { status: "backoff", failure, retryAt, attempt });
  }
  return withRenewal(machine, {
    status: "backoff",
    failure,
    retryAt: after(ctx.now, rung(ctx.policy.lapsedRetryMs, attempt)),
    attempt,
  });
};

const closeProject = (
  machine: GrantMachine,
  project: ProjectRef,
  evidence: DenialEvidence,
  readStartedAt: Instant | null,
  ctx: GrantContext,
  out: Effects,
): GrantMachine => {
  const held = heldEvidence(machine);
  if (held === null) return machine;
  const id = project.projectId;
  const closedProjects = new Map(held.closedProjects);
  const closed = closedProjects.get(id);
  if (closed === undefined) {
    closedProjects.set(id, {
      project,
      deniedAt: ctx.now,
      confirmation: {
        status: "due",
        at: after(ctx.now, ctx.policy.denialConfirmationDelayMs),
        attempt: 0,
      },
    });
  } else if (
    closed.confirmation.status === "due" &&
    readStartedAt !== null &&
    reached(after(closed.deniedAt, ctx.policy.denialConfirmationDelayMs), readStartedAt)
  ) {
    closedProjects.set(id, { ...closed, confirmation: { status: "confirmed", evidence } });
    out.push({ kind: "observe", observation: { kind: "project-gone", project, evidence } });
  } else {
    return machine;
  }
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
          const deniedAt = answer?.at ?? ctx.now;
          closedProjects.set(id, {
            project: target,
            deniedAt,
            confirmation: {
              status: "due",
              at: after(deniedAt, ctx.policy.denialConfirmationDelayMs),
              attempt: 0,
            },
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
          retryAt: after(ctx.now, rung(ctx.policy.projectRetryMs, 1)),
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
  return {
    ...machine,
    roundDurationsMs,
    phase: {
      phase: "granted",
      evidence,
      renewal: { status: "idle", dueAt: after(round.startedAt, ctx.policy.windowMs - lead) },
    },
  };
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
    return closeProject(machine, attempt.project, outcome.evidence, attempt.startedAt, ctx, out);
  }
  // Positive evidence joins the admitted account evidence, and so carries its stamp.
  if (phase.phase !== "granted" || expired(phase.evidence.account.startedAt, ctx.now, ctx.policy)) {
    return machine;
  }
  const held = phase.evidence;
  const closed = held.closedProjects.get(id);
  if (attempt.kind === "confirm") {
    if (closed === undefined || closed.confirmation.status !== "due") return machine;
    if (outcome.kind === "failed") {
      const tries = closed.confirmation.attempt + 1;
      const closedProjects = new Map(held.closedProjects);
      closedProjects.set(id, {
        ...closed,
        confirmation: {
          status: "due",
          at: after(ctx.now, rung(ctx.policy.projectRetryMs, tries)),
          attempt: tries,
        },
      });
      return withEvidence(machine, { ...held, closedProjects });
    }
  } else if (closed !== undefined) {
    return machine;
  }
  if (outcome.kind === "failed") {
    const entry = held.unverified.get(id);
    if (entry === undefined) return machine;
    const unverified = new Map(held.unverified);
    unverified.set(id, {
      ...entry,
      failure: outcome.failure,
      retryAt: after(ctx.now, rung(ctx.policy.projectRetryMs, entry.attempt + 1)),
      attempt: entry.attempt + 1,
    });
    return withEvidence(machine, { ...held, unverified });
  }
  const projects = new Map(held.projects);
  projects.set(id, { access: outcome.access, startedAt: held.account.startedAt });
  const unverified = new Map(held.unverified);
  unverified.delete(id);
  const closedProjects = new Map(held.closedProjects);
  closedProjects.delete(id);
  return withEvidence(machine, { ...held, projects, unverified, closedProjects });
};

/** A visible wake, `online` or a user retry: every wait restarts from its first rung, now. */
const wake = (machine: GrantMachine, ctx: GrantContext, out: Effects): GrantMachine => {
  const phase = machine.phase;
  if (phase.phase === "unverified-failed") {
    return machine.signals.online ? startVerifying(machine, 0, ctx, out) : machine;
  }
  if (phase.phase !== "granted" && phase.phase !== "lapsed") return machine;
  // A waiting renewal is due now; a granted idle one keeps its schedule (renew if due).
  const renewal = phase.renewal.status;
  const next =
    renewal === "backoff" ||
    renewal === "dormant" ||
    (phase.phase === "lapsed" && renewal === "idle")
      ? withRenewal(machine, { status: "idle", dueAt: ctx.now })
      : machine;
  const held = heldEvidence(next)!;
  const unverified = new Map(
    [...held.unverified].map(([id, entry]) => [id, { ...entry, retryAt: ctx.now, attempt: 0 }]),
  );
  // A confirmation retrying after a failure restarts now; a first one keeps its G6 delay.
  const closedProjects = new Map(
    [...held.closedProjects].map(([id, entry]): [ZeropsProjectId, ClosedProject] => [
      id,
      entry.confirmation.status === "due" && entry.confirmation.attempt > 0
        ? { ...entry, confirmation: { status: "due", at: ctx.now, attempt: 0 } }
        : entry,
    ]),
  );
  return withEvidence(next, { ...held, unverified, closedProjects });
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
          retryAt: after(ctx.now, rung(ctx.policy.initialRetryMs, 1)),
          attempt: 1,
        },
      };
    case "TICK":
      return machine;
    case "VISIBILITY":
      return {
        ...machine,
        signals: {
          ...machine.signals,
          hiddenSince: event.hidden ? (machine.signals.hiddenSince ?? ctx.now) : null,
        },
      };
    case "WAKE":
      return event.visible ? wake(machine, ctx, out) : machine;
    case "ONLINE": {
      const online = { ...machine, signals: { ...machine.signals, online: true } };
      return online.signals.hiddenSince === null ? wake(online, ctx, out) : online;
    }
    case "OFFLINE":
      return { ...machine, signals: { ...machine.signals, online: false } };
    case "USER_RETRY":
      // A retry during a round joins it (G7).
      return grantRoundInFlight(machine) === null ? wake(machine, ctx, out) : machine;
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
      const answered: GrantRound = {
        ...round,
        outcomes: new Map(round.outcomes).set(id, { outcome: event.outcome, at: ctx.now }),
      };
      let next = withRound(machine, answered);
      if (event.outcome.kind === "denied") {
        next = closeProject(next, event.project, event.outcome.evidence, round.startedAt, ctx, out);
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
    case "PROJECT_DENIED": {
      if (heldEvidence(machine) !== null) {
        return closeProject(machine, event.project, event.evidence, null, ctx, out);
      }
      const round = grantRoundInFlight(machine);
      if (round === null) return machine;
      return withRound(machine, {
        ...round,
        outcomes: new Map(round.outcomes).set(event.project.projectId, {
          outcome: { kind: "denied", evidence: event.evidence },
          at: ctx.now,
        }),
      });
    }
    case "EPOCH_CLOSED":
      return machine;
  }
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
        retryAt: ctx.now,
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
            { kind: "timeout", afterMs: round.deadline.mono - round.startedAt.mono },
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
  if (
    phase.phase === "unverified-failed" &&
    next.signals.online &&
    reached(phase.retryAt, ctx.now)
  ) {
    next = startVerifying(next, phase.attempt, ctx, out);
  } else if (phase.phase === "granted" || phase.phase === "lapsed") {
    const renewal = phase.renewal;
    if (renewal.status === "idle" && reached(renewal.dueAt, ctx.now)) {
      next = startRenewal(next, 0, ctx, out);
    } else if (renewal.status === "backoff" && reached(renewal.retryAt, ctx.now)) {
      next = startRenewal(next, renewal.attempt, ctx, out);
    }
  }

  return startProjectReads(next, ctx, out);
};

/** Per-project retries and denial confirmations run only under a fresh account grant. */
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
  const roundRunning = phase.renewal.status === "running";
  const reads: Array<{ readonly kind: ProjectAttempt["kind"]; readonly project: ProjectRef }> = [];
  if (!roundRunning) {
    for (const [id, entry] of phase.evidence.unverified) {
      if (!machine.projectAttempts.has(id) && reached(entry.retryAt, ctx.now)) {
        reads.push({ kind: "verify", project: entry.project });
      }
    }
  }
  for (const [id, entry] of phase.evidence.closedProjects) {
    if (
      entry.confirmation.status === "due" &&
      !machine.projectAttempts.has(id) &&
      reached(entry.confirmation.at, ctx.now)
    ) {
      reads.push({ kind: "confirm", project: entry.project });
    }
  }
  if (reads.length === 0) return machine;
  const projectAttempts = new Map(machine.projectAttempts);
  let nextAttempt = machine.nextAttempt;
  for (const read of reads) {
    const attempt = nextAttempt++;
    projectAttempts.set(read.project.projectId, { ...read, attempt, startedAt: ctx.now });
    out.push({
      kind: "run",
      attempt,
      op:
        read.kind === "verify"
          ? { kind: "verify-project", project: read.project }
          : { kind: "confirm-denial", project: read.project },
    });
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
    phase.renewal.status === "backoff"
      ? { failure: phase.renewal.failure, retryAtMs: phase.renewal.retryAt.wall }
      : null;
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
    const authority: ScopeAuthority = evidence.closedProjects.has(id)
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
                entry === undefined
                  ? null
                  : { failure: entry.failure, retryAtMs: entry.retryAt.wall },
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
  if (phase.phase === "unverified-failed" && online) candidates.push(phase.retryAt);
  if (phase.phase === "granted" || phase.phase === "lapsed") {
    const renewal = phase.renewal;
    if (online && renewal.status === "idle") candidates.push(renewal.dueAt);
    if (online && renewal.status === "backoff") candidates.push(renewal.retryAt);
  }
  if (phase.phase === "granted") {
    const evidence = phase.evidence;
    candidates.push(after(evidence.account.startedAt, ctx.policy.windowMs));
    for (const own of evidence.projects.values()) {
      candidates.push(after(own.startedAt, ctx.policy.windowMs));
    }
    if (online && !dormant(machine, ctx)) {
      for (const [id, entry] of evidence.unverified) {
        if (round === null && !machine.projectAttempts.has(id)) candidates.push(entry.retryAt);
      }
      for (const [id, entry] of evidence.closedProjects) {
        if (entry.confirmation.status === "due" && !machine.projectAttempts.has(id)) {
          candidates.push(entry.confirmation.at);
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
