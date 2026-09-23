import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_ZEROPS_GRANT_POLICY } from "../policy.ts";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type AccountRef,
  type OrganizationEffectiveAccess,
  type OrganizationRef,
  type ProjectEffectiveAccess,
  type ProjectRef,
} from "../types.ts";
import {
  grantIdentityMint,
  grantPlatformRead,
  grantPlatformWrite,
  grantRoundInFlight,
  initialGrant,
  transitionGrant,
  type GrantEffect,
  type GrantEvent,
  type GrantMachine,
  type GrantOp,
  type Instant,
  type ProjectOutcome,
} from "./grant.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const WINDOW = 15 * MINUTE;
const policy = DEFAULT_ZEROPS_GRANT_POLICY;
const T0: Instant = { wall: Date.UTC(2026, 8, 23, 10, 0, 0), mono: 10 * MINUTE };

const account: AccountRef = {
  apiOrigin: makeZeropsApiOrigin("https://api.app-prg1.zerops.io"),
  accountId: ZeropsAccountId.make("account-a"),
};
const organization: OrganizationRef = {
  kind: "organization",
  account,
  organizationId: ZeropsOrganizationId.make("org-a"),
};
const organizations: ReadonlyArray<OrganizationEffectiveAccess> = [
  { organization, mutationsAllowed: true },
];
const projectRef = (id: string): ProjectRef => ({
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make(id),
});
const A = projectRef("project-a");
const B = projectRef("project-b");
const access = (project: ProjectRef, mutationsAllowed = true): ProjectEffectiveAccess => ({
  project,
  role: mutationsAllowed ? "ADMIN" : "READ_ONLY",
  mutationsAllowed,
});
const verified = (project: ProjectRef, mutationsAllowed = true): ProjectOutcome => ({
  kind: "verified",
  access: access(project, mutationsAllowed),
});
const failed: ProjectOutcome = { kind: "failed", failure: { kind: "server", status: 503 } };
const forbidden: ProjectOutcome = { kind: "denied", evidence: "direct-forbidden" };

interface RunRequest {
  readonly attempt: number;
  readonly op: GrantOp;
}

/** One tab's grant, driven by hand: both clocks, the effects each step produced, the runs asked for. */
class GrantSim {
  state: GrantMachine;
  now: Instant = T0;
  readonly effects: Array<{ readonly at: Instant; readonly effect: GrantEffect }> = [];
  readonly runs: Array<RunRequest> = [];

  constructor(
    signals: { readonly hidden: boolean; readonly online: boolean } = {
      hidden: false,
      online: true,
    },
  ) {
    this.state = initialGrant(signals, T0);
  }

  get ctx() {
    return { now: this.now, policy };
  }

  send(event: GrantEvent): ReadonlyArray<GrantEffect> {
    const result = transitionGrant(this.state, event, this.ctx);
    this.state = result.state;
    for (const effect of result.effects) {
      this.effects.push({ at: this.now, effect });
      if (effect.kind === "run") this.runs.push({ attempt: effect.attempt, op: effect.op });
    }
    return result.effects;
  }

  /** Both clocks move: ordinary time. */
  elapse(ms: number): void {
    this.now = { wall: this.now.wall + ms, mono: this.now.mono + ms };
  }

  /** Only the wall clock moves: a set clock, or a sleep the monotonic clock did not count. */
  shiftWall(ms: number): void {
    this.now = { wall: this.now.wall + ms, mono: this.now.mono };
  }

  round(): number {
    const round = grantRoundInFlight(this.state);
    if (round === null) throw new Error("no round in flight");
    return round.id;
  }

  /** Answers the round in flight: the account part, then each project. */
  answerRound(outcomes: ReadonlyArray<readonly [ProjectRef, ProjectOutcome | null]>): void {
    const round = this.round();
    this.send({
      type: "ROUND_ACCOUNT",
      round,
      organizations,
      projects: outcomes.map(([project]) => project),
    });
    for (const [project, outcome] of outcomes) {
      if (outcome !== null) this.send({ type: "ROUND_PROJECT", round, project, outcome });
    }
  }

  lastRun(kind: GrantOp["kind"]): RunRequest {
    const run = this.runs.findLast((candidate) => candidate.op.kind === kind);
    if (run === undefined) throw new Error(`no ${kind} run`);
    return run;
  }

  effectsSince(index: number): ReadonlyArray<GrantEffect> {
    return this.effects.slice(index).map((entry) => entry.effect);
  }

  write(project: ProjectRef) {
    return grantPlatformWrite(this.state, project.projectId, this.ctx);
  }

  read(project: ProjectRef) {
    return grantPlatformRead(this.state, project.projectId, this.ctx);
  }
}

/** The account part answers within a second; the project reads take the rest of the round. */
const accountPartMs = (roundMs: number): number => Math.min(roundMs, SECOND);

/** A tab granted `listed` by a round that started at T0 and took `roundMs`. */
const grantedSim = (roundMs = 2 * SECOND, listed: ReadonlyArray<ProjectRef> = [A, B]): GrantSim => {
  const sim = new GrantSim();
  sim.send({ type: "START" });
  const round = sim.round();
  sim.elapse(accountPartMs(roundMs));
  sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: listed });
  sim.elapse(roundMs - accountPartMs(roundMs));
  for (const project of listed) {
    sim.send({ type: "ROUND_PROJECT", round, project, outcome: verified(project) });
  }
  return sim;
};

type Responder = (run: RunRequest) => ReadonlyArray<{
  readonly afterMs: number;
  readonly event: GrantEvent;
}>;

/** Every round verifies each of `listed` within `roundMs`; every project read verifies it. */
const healthyPlatform =
  (roundMs: number, listed: ReadonlyArray<ProjectRef> = [A, B]): Responder =>
  (run) => {
    if (run.op.kind === "verify-round") {
      return [
        {
          afterMs: accountPartMs(roundMs),
          event: { type: "ROUND_ACCOUNT", round: run.attempt, organizations, projects: listed },
        },
        ...listed.map((project) => ({
          afterMs: roundMs,
          event: {
            type: "ROUND_PROJECT" as const,
            round: run.attempt,
            project,
            outcome: verified(project),
          },
        })),
      ];
    }
    return [
      {
        afterMs: roundMs,
        event: {
          type: "PROJECT_RESULT",
          attempt: run.attempt,
          project: run.op.project,
          outcome: verified(run.op.project),
        },
      },
    ];
  };

/**
 * Plays the tab forward to `untilMs` after T0: timers fire as TICKs, hidden-tab timers late to the
 * next one-minute bucket (Chrome's intensive throttling), and runs are answered by `respond`.
 * `onStep` observes the tab after every delivered event.
 */
const play = (
  sim: GrantSim,
  untilMs: number,
  respond: Responder,
  onStep: (sim: GrantSim) => void = () => undefined,
): void => {
  const until = T0.mono + untilMs;
  const pending: Array<{ at: number; event: GrantEvent }> = [];
  let answered = 0;
  const collect = () => {
    for (; answered < sim.runs.length; answered++) {
      const run = sim.runs[answered]!;
      for (const reply of respond(run)) {
        pending.push({ at: sim.now.mono + reply.afterMs, event: reply.event });
      }
    }
  };
  collect();
  for (let steps = 0; steps < 10_000; steps++) {
    const timer = sim.state.timer;
    const hidden = sim.state.signals.hiddenSince !== null;
    const fireAt =
      timer === null
        ? Number.POSITIVE_INFINITY
        : Math.max(sim.now.mono, hidden ? Math.ceil(timer.mono / MINUTE) * MINUTE : timer.mono);
    pending.sort((left, right) => left.at - right.at);
    const reply = pending[0];
    const next = Math.min(fireAt, reply?.at ?? Number.POSITIVE_INFINITY);
    if (next > until) {
      sim.elapse(until - sim.now.mono);
      return;
    }
    sim.elapse(next - sim.now.mono);
    if (reply !== undefined && reply.at === next) {
      pending.shift();
      sim.send(reply.event);
    } else {
      sim.send({ type: "TICK" });
    }
    collect();
    onStep(sim);
  }
  throw new Error("play did not converge");
};

const kinds = (effects: ReadonlyArray<GrantEffect>) => effects.map((effect) => effect.kind);
const expiredObservations = (effects: ReadonlyArray<GrantEffect>) =>
  effects.filter(
    (effect) => effect.kind === "observe" && effect.observation.kind === "access-expired",
  );

describe("access grant reducer", () => {
  it("admits the first round and restores the account and each verified project (G12)", () => {
    const sim = new GrantSim();
    expect(sim.write(A)).toEqual({ allowed: false, reason: "access-unverified", waitable: true });
    sim.send({ type: "START" });
    expect(sim.lastRun("verify-round").op).toEqual({ kind: "verify-round", carried: [] });
    sim.elapse(2 * SECOND);
    const before = sim.effects.length;
    sim.answerRound([
      [A, verified(A)],
      [B, verified(B, false)],
    ]);
    const effects = sim.effectsSince(before);
    expect(effects).toContainEqual({
      kind: "observe",
      observation: expect.objectContaining({ kind: "access-verified", verifiedAtMs: T0.wall }),
    });
    expect(effects).toContainEqual({ kind: "restore-authority", scope: { kind: "account" } });
    expect(effects).toContainEqual({
      kind: "restore-authority",
      scope: { kind: "project", project: A },
    });
    expect(effects).toContainEqual({
      kind: "restore-authority",
      scope: { kind: "project", project: B },
    });
    expect(sim.state.phase.phase).toBe("granted");
    expect(sim.write(A)).toEqual({ allowed: true });
    expect(sim.write(B)).toEqual({ allowed: false, reason: "role-denies", waitable: false });
    expect(sim.read(B)).toEqual({ allowed: true });
    expect(grantIdentityMint(sim.state, sim.ctx)).toEqual({ allowed: true });
  });

  it("stamps evidence when the round starts, so authority ends 15 min after the start on either clock (G2, T-L4)", () => {
    const sim = grantedSim(40 * SECOND);
    sim.elapse(WINDOW - 40 * SECOND - 1);
    expect(sim.write(A)).toEqual({ allowed: true });
    sim.elapse(1);
    expect(sim.write(A)).toEqual({ allowed: false, reason: "access-lapsed", waitable: true });

    const sleeper = grantedSim(40 * SECOND);
    sleeper.shiftWall(WINDOW - 40 * SECOND);
    expect(sleeper.write(A).allowed).toBe(false);
    expect(grantIdentityMint(sleeper.state, sleeper.ctx)).toEqual({
      allowed: false,
      reason: "access-lapsed",
      waitable: true,
    });
  });

  it("keeps a tab hidden across the renewal granted, with no lapse and writes open throughout (T-L1)", () => {
    const sim = grantedSim();
    sim.elapse(MINUTE);
    sim.send({ type: "VISIBILITY", hidden: true });
    play(sim, 40 * MINUTE, healthyPlatform(3 * SECOND), (tab) => {
      expect(tab.write(A)).toEqual({ allowed: true });
    });
    sim.send({ type: "VISIBILITY", hidden: false });
    sim.send({ type: "WAKE", visible: true });
    expect(sim.state.phase.phase).toBe("granted");
    expect(sim.write(A)).toEqual({ allowed: true });
    expect(expiredObservations(sim.effectsSince(0))).toEqual([]);
    expect(kinds(sim.effectsSince(0))).not.toContain("withhold");
  });

  it.each([
    ["a quick round", 1 * SECOND, 2],
    ["a 30 s round", 30 * SECOND, 2],
    // 20 projects give the round 105 s (G7) and the renewal a lead of 190 s.
    ["a round slow enough to widen the lead", 100 * SECOND, 20],
  ])(
    "renews before the deadline with %s while hidden timers fire late to one-minute buckets (G13)",
    (_label, roundMs, projects) => {
      const listed = [
        A,
        B,
        ...Array.from({ length: projects - 2 }, (_, index) => projectRef(`project-${index}`)),
      ];
      const sim = grantedSim(roundMs, listed);
      sim.send({ type: "VISIBILITY", hidden: true });
      const admitted: Array<number> = [];
      play(sim, 50 * MINUTE, healthyPlatform(roundMs, listed), (tab) => {
        expect(tab.write(A)).toEqual({ allowed: true });
        if (tab.state.phase.phase === "granted")
          admitted.push(tab.state.phase.evidence.account.round);
      });
      expect(new Set(admitted).size).toBeGreaterThanOrEqual(4);
      expect(expiredObservations(sim.effectsSince(0))).toEqual([]);
    },
  );

  it("lapses a tab frozen for 30 min on its wake and starts a round at once (T-L2, G9)", () => {
    const sim = grantedSim();
    sim.elapse(30 * MINUTE);
    const before = sim.effects.length;
    sim.send({ type: "WAKE", visible: true });
    const effects = sim.effectsSince(before);
    expect(sim.state.phase.phase).toBe("lapsed");
    expect(expiredObservations(effects)).toHaveLength(1);
    expect(effects).toContainEqual({
      kind: "invalidate",
      invalidation: { topic: "access", change: "lapsed" },
    });
    expect(effects).toContainEqual({
      kind: "withhold",
      scope: { kind: "account" },
      reason: "access-lapsed",
      cause: null,
    });
    expect(effects).toContainEqual({
      kind: "withhold",
      scope: { kind: "project", project: A },
      reason: "access-lapsed",
      cause: null,
    });
    const round = sim.lastRun("verify-round");
    expect(round.op).toEqual({ kind: "verify-round", carried: [A, B] });
    expect(grantRoundInFlight(sim.state)?.startedAt).toEqual(sim.now);
    expect(sim.write(A)).toEqual({ allowed: false, reason: "access-lapsed", waitable: true });

    sim.elapse(2 * SECOND);
    sim.answerRound([
      [A, verified(A)],
      [B, verified(B)],
    ]);
    expect(sim.state.phase.phase).toBe("granted");
    expect(sim.write(A)).toEqual({ allowed: true });
  });

  it.each([
    ["the first round", 0],
    ["a renewal round", 12 * MINUTE],
  ])(
    "discards %s that a frozen tab completes after its evidence expired, and starts another (G3)",
    (_label, startAfterMs) => {
      const sim = startAfterMs === 0 ? new GrantSim() : grantedSim();
      if (startAfterMs === 0) sim.send({ type: "START" });
      else {
        sim.elapse(startAfterMs - 2 * SECOND);
        sim.send({ type: "TICK" });
      }
      const late = sim.round();
      sim.elapse(SECOND);
      sim.send({ type: "ROUND_ACCOUNT", round: late, organizations, projects: [A, B] });
      sim.send({ type: "ROUND_PROJECT", round: late, project: A, outcome: verified(A) });
      // Frozen before B answered; the timers and B's answer are delivered 16 min later.
      sim.elapse(16 * MINUTE);
      sim.send({ type: "ROUND_PROJECT", round: late, project: B, outcome: verified(B) });
      expect(sim.write(A).allowed).toBe(false);
      expect(sim.state.phase.phase).not.toBe("granted");
      expect(sim.round()).not.toBe(late);
      expect(grantRoundInFlight(sim.state)?.startedAt).toEqual(sim.now);
      expect(sim.effectsSince(0)).toContainEqual({
        kind: "log",
        diagnostic: expect.objectContaining({ kind: "round-discarded-late", round: late }),
      });
    },
  );

  it("lapses and re-verifies at once when the wall clock is set back 1 h (G5)", () => {
    const sim = grantedSim();
    sim.elapse(5 * MINUTE);
    sim.shiftWall(-60 * MINUTE);
    expect(sim.write(A)).toEqual({ allowed: false, reason: "access-lapsed", waitable: true });
    sim.send({ type: "TICK" });
    expect(sim.state.phase.phase).toBe("lapsed");
    expect(grantRoundInFlight(sim.state)).not.toBeNull();
    sim.elapse(2 * SECOND);
    sim.answerRound([
      [A, verified(A)],
      [B, verified(B)],
    ]);
    expect(sim.write(A)).toEqual({ allowed: true });
  });

  it.each([
    ["back 59 s", -59 * SECOND, "granted"],
    ["back 61 s", -61 * SECOND, "lapsed"],
    ["forward 61 s", 61 * SECOND, "granted"],
    ["forward past the deadline", 11 * MINUTE, "lapsed"],
  ] as const)("treats a wall-clock jump %s as %s (G5)", (_label, jumpMs, phase) => {
    const sim = grantedSim();
    sim.elapse(4 * MINUTE);
    sim.shiftWall(jumpMs);
    expect(sim.write(A).allowed).toBe(phase === "granted");
    sim.send({ type: "WAKE", visible: false });
    expect(sim.state.phase.phase).toBe(phase);
  });

  it("closes a denied project's writes at once and withholds its content without removing it (G6)", () => {
    const sim = grantedSim();
    sim.elapse(MINUTE);
    const before = sim.effects.length;
    sim.send({ type: "PROJECT_DENIED", project: A, evidence: "direct-forbidden" });
    const effects = sim.effectsSince(before);
    expect(sim.write(A)).toEqual({ allowed: false, reason: "project-closed", waitable: false });
    expect(sim.read(A)).toEqual({ allowed: false, reason: "project-closed", waitable: false });
    expect(sim.write(B)).toEqual({ allowed: true });
    expect(sim.state.phase.phase).toBe("granted");
    expect(effects).toContainEqual({
      kind: "withhold",
      scope: { kind: "project", project: A },
      reason: "access-denied",
      cause: null,
    });
    expect(effects).not.toContainEqual(
      expect.objectContaining({
        kind: "observe",
        observation: expect.objectContaining({ kind: "project-gone" }),
      }),
    );

    sim.elapse(4 * SECOND);
    sim.send({ type: "TICK" });
    expect(sim.runs.some((run) => run.op.kind === "confirm-denial")).toBe(false);
    sim.elapse(SECOND);
    sim.send({ type: "TICK" });
    const confirm = sim.lastRun("confirm-denial");
    expect(confirm.op).toEqual({ kind: "confirm-denial", project: A });
    sim.send({ type: "PROJECT_RESULT", attempt: confirm.attempt, project: A, outcome: forbidden });
    expect(sim.effectsSince(before)).toContainEqual({
      kind: "observe",
      observation: { kind: "project-gone", project: A, evidence: "direct-forbidden" },
    });
    expect(sim.write(A).allowed).toBe(false);
  });

  it("keeps the account granted when one project's read 5xx's, and that project's writes lapse at its own deadline (C2b, T-L19)", () => {
    const sim = grantedSim();
    const failingB: Responder = (run) => {
      if (run.op.kind === "verify-round") {
        return [
          {
            afterMs: 2 * SECOND,
            event: { type: "ROUND_ACCOUNT", round: run.attempt, organizations, projects: [A, B] },
          },
          {
            afterMs: 2 * SECOND,
            event: { type: "ROUND_PROJECT", round: run.attempt, project: A, outcome: verified(A) },
          },
          {
            afterMs: 2 * SECOND,
            event: { type: "ROUND_PROJECT", round: run.attempt, project: B, outcome: failed },
          },
        ];
      }
      return [
        {
          afterMs: SECOND,
          event: {
            type: "PROJECT_RESULT",
            attempt: run.attempt,
            project: run.op.project,
            outcome: failed,
          },
        },
      ];
    };
    const checkpoints: Array<{ at: number; b: boolean; a: boolean }> = [];
    play(sim, 20 * MINUTE, failingB, (tab) => {
      checkpoints.push({
        at: tab.now.mono - T0.mono,
        a: tab.write(A).allowed,
        b: tab.write(B).allowed,
      });
    });
    expect(sim.state.phase.phase).toBe("granted");
    expect(checkpoints.every((point) => point.a)).toBe(true);
    expect(checkpoints.filter((point) => point.at < WINDOW).every((point) => point.b)).toBe(true);
    expect(checkpoints.filter((point) => point.at >= WINDOW).every((point) => !point.b)).toBe(true);
    expect(sim.write(B)).toEqual({ allowed: false, reason: "project-unverified", waitable: true });
    expect(sim.effectsSince(0)).toContainEqual({
      kind: "withhold",
      scope: { kind: "project", project: B },
      reason: "access-unverified",
      cause: expect.objectContaining({ failure: { kind: "server", status: 503 } }),
    });
    expect(expiredObservations(sim.effectsSince(0))).toEqual([]);
    const projectRetries = sim.effects
      .filter((entry) => entry.effect.kind === "run" && entry.effect.op.kind === "verify-project")
      .map((entry) => entry.at.mono);
    const gaps = projectRetries.slice(1, 4).map((at, index) => at - projectRetries[index]!);
    // The 20, 40, 60 s rungs, each counted from the failed answer one second after its start.
    expect(gaps).toEqual([21 * SECOND, 41 * SECOND, 61 * SECOND]);
  });

  it.each([
    ["a second 403 confirms it gone", forbidden, false],
    ["a 200 reopens it", verified(A), true],
  ] as const)(
    "keeps a project that 403s once after a lapse withheld until confirmed: %s (G6, T-L20)",
    (_label, confirmation, reopened) => {
      const sim = grantedSim();
      sim.elapse(30 * MINUTE);
      sim.send({ type: "WAKE", visible: true });
      sim.elapse(2 * SECOND);
      const before = sim.effects.length;
      sim.answerRound([
        [A, forbidden],
        [B, verified(B)],
      ]);
      const effects = sim.effectsSince(before);
      expect(sim.state.phase.phase).toBe("granted");
      expect(effects).toContainEqual({
        kind: "restore-authority",
        scope: { kind: "project", project: B },
      });
      expect(effects).not.toContainEqual({
        kind: "restore-authority",
        scope: { kind: "project", project: A },
      });
      expect(effects).toContainEqual({
        kind: "withhold",
        scope: { kind: "project", project: A },
        reason: "access-denied",
        cause: null,
      });
      expect(sim.write(A).allowed).toBe(false);

      sim.elapse(5 * SECOND);
      sim.send({ type: "TICK" });
      const confirm = sim.lastRun("confirm-denial");
      const settled = sim.effects.length;
      sim.send({
        type: "PROJECT_RESULT",
        attempt: confirm.attempt,
        project: A,
        outcome: confirmation,
      });
      expect(sim.read(A).allowed).toBe(reopened);
      expect(sim.effectsSince(settled).some((effect) => effect.kind === "restore-authority")).toBe(
        reopened,
      );
    },
  );

  it.each([
    [0, 30 * SECOND],
    [4, 45 * SECOND],
    [40, 180 * SECOND],
  ])("gives a round with %i listed projects a deadline of %i ms (G7)", (projects, deadlineMs) => {
    const sim = new GrantSim();
    sim.send({ type: "START" });
    const round = sim.round();
    const listed = Array.from({ length: projects }, (_, index) => projectRef(`project-${index}`));
    expect(grantRoundInFlight(sim.state)?.deadline).toEqual({
      wall: T0.wall + 30 * SECOND,
      mono: T0.mono + 30 * SECOND,
    });
    sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: listed });
    if (projects === 0) {
      // Nothing to read: the account part alone completes the round.
      expect(sim.state.phase.phase).toBe("granted");
      return;
    }
    expect(grantRoundInFlight(sim.state)?.deadline).toEqual({
      wall: T0.wall + deadlineMs,
      mono: T0.mono + deadlineMs,
    });
    for (const project of listed.slice(1)) {
      sim.send({ type: "ROUND_PROJECT", round, project, outcome: verified(project) });
    }
    sim.elapse(deadlineMs - 1);
    sim.send({ type: "TICK" });
    expect(sim.state.phase.phase).toBe("verifying");
    sim.elapse(1);
    sim.send({ type: "TICK" });
    // The account part answered in time; the one project without an answer is unverified.
    expect(sim.state.phase.phase).toBe("granted");
    expect(sim.write(listed[0]!)).toEqual({
      allowed: false,
      reason: "project-unverified",
      waitable: true,
    });
    expect(sim.write(listed[1]!)).toEqual({ allowed: true });
  });

  it("fails a round whose account part misses the deadline and retries by the session backoff", () => {
    const sim = new GrantSim();
    sim.send({ type: "START" });
    sim.elapse(30 * SECOND);
    sim.send({ type: "TICK" });
    expect(sim.state.phase).toEqual({
      phase: "unverified-failed",
      failure: { kind: "timeout", afterMs: 30 * SECOND },
      retryAt: { wall: sim.now.wall + 2 * SECOND, mono: sim.now.mono + 2 * SECOND },
      attempt: 1,
    });
    sim.elapse(2 * SECOND);
    sim.send({ type: "TICK" });
    sim.send({
      type: "ROUND_FAILED",
      round: sim.round(),
      failure: { kind: "server", status: 502 },
    });
    expect(sim.state.phase).toMatchObject({ phase: "unverified-failed", attempt: 2 });
    sim.send({ type: "USER_RETRY" });
    expect(sim.state.phase.phase).toBe("verifying");
  });

  it("never closes writes during a failing renewal before the held deadline, and retries at 10, 20, 40, 60 s bounded by it (G4, T-L3)", () => {
    const sim = grantedSim();
    sim.elapse(12 * MINUTE - 2 * SECOND);
    sim.send({ type: "TICK" });
    const retryStarts: Array<number> = [];
    for (let failures = 0; failures < 5; failures++) {
      retryStarts.push(grantRoundInFlight(sim.state)!.startedAt.mono - T0.mono);
      sim.send({
        type: "ROUND_FAILED",
        round: sim.round(),
        failure: { kind: "server", status: 503 },
      });
      expect(sim.write(A)).toEqual({ allowed: true });
      const timer = sim.state.timer!;
      sim.elapse(timer.mono - sim.now.mono);
      sim.send({ type: "TICK" });
    }
    retryStarts.push(grantRoundInFlight(sim.state)!.startedAt.mono - T0.mono);
    // The fifth retry was due at 15:10; it was bounded to the deadline, where the grant lapsed
    // and the lapse started a round at once.
    expect(retryStarts).toEqual(
      [0, 10, 30, 70, 130, 180].map((seconds) => 12 * MINUTE + seconds * SECOND),
    );
    expect(sim.state.phase.phase).toBe("lapsed");
    expect(sim.write(A)).toEqual({ allowed: false, reason: "access-lapsed", waitable: true });
    const lapsedAt = sim.effects.length;
    sim.send({
      type: "ROUND_FAILED",
      round: sim.round(),
      failure: { kind: "server", status: 503 },
    });
    expect(sim.effectsSince(lapsedAt)).toContainEqual({
      kind: "withhold",
      scope: { kind: "account" },
      reason: "access-lapsed",
      cause: {
        failure: { kind: "server", status: 503 },
        retryAtMs: sim.now.wall + 2 * SECOND,
      },
    });
    sim.elapse(MINUTE);
    sim.send({ type: "WAKE", visible: true });
    sim.elapse(SECOND);
    sim.answerRound([
      [A, verified(A)],
      [B, verified(B)],
    ]);
    expect(sim.write(A)).toEqual({ allowed: true });
  });

  it("retries a lapsed grant at 2, 5, 15, 30, 60 s and at once on a visible wake (G9)", () => {
    const sim = grantedSim();
    sim.elapse(20 * MINUTE);
    sim.send({ type: "TICK" });
    const starts: Array<number> = [];
    for (let failures = 0; failures < 6; failures++) {
      starts.push(sim.now.mono);
      sim.send({
        type: "ROUND_FAILED",
        round: sim.round(),
        failure: { kind: "transport", detail: "reset" },
      });
      sim.elapse(sim.state.timer!.mono - sim.now.mono);
      sim.send({ type: "TICK" });
    }
    expect(starts.slice(1).map((at, index) => at - starts[index]!)).toEqual(
      [2, 5, 15, 30, 60].map((seconds) => seconds * SECOND),
    );
    sim.send({
      type: "ROUND_FAILED",
      round: sim.round(),
      failure: { kind: "transport", detail: "reset" },
    });
    sim.elapse(10 * SECOND);
    sim.send({ type: "WAKE", visible: true });
    expect(grantRoundInFlight(sim.state)?.startedAt).toEqual(sim.now);
  });

  it("goes dormant after 60 min hidden, lapses at the deadline and starts a round on the visible wake (D5)", () => {
    const sim = grantedSim();
    sim.send({ type: "VISIBILITY", hidden: true });
    play(sim, 90 * MINUTE, healthyPlatform(2 * SECOND));
    expect(sim.state.phase).toMatchObject({ phase: "lapsed", renewal: { status: "dormant" } });
    expect(grantRoundInFlight(sim.state)).toBeNull();
    const lastRound = sim.lastRun("verify-round");
    const dormantSince = sim.effects.find(
      (entry) => entry.effect.kind === "run" && entry.effect.attempt === lastRound.attempt,
    )!.at.mono;
    expect(dormantSince - T0.mono).toBeLessThan(60 * MINUTE + 1 * MINUTE);
    sim.send({ type: "VISIBILITY", hidden: false });
    sim.send({ type: "WAKE", visible: true });
    expect(grantRoundInFlight(sim.state)?.startedAt).toEqual(sim.now);
  });

  it("pauses rounds offline and starts one when the tab is back online", () => {
    const sim = grantedSim();
    sim.elapse(MINUTE);
    sim.send({ type: "OFFLINE" });
    sim.elapse(11 * MINUTE);
    sim.send({ type: "TICK" });
    expect(grantRoundInFlight(sim.state)).toBeNull();
    expect(sim.write(A)).toEqual({ allowed: true });
    sim.send({ type: "ONLINE" });
    expect(grantRoundInFlight(sim.state)?.startedAt).toEqual(sim.now);
  });

  it("applies a lowered role before the round that reported it completes", () => {
    const sim = grantedSim();
    sim.elapse(12 * MINUTE);
    sim.send({ type: "TICK" });
    const round = sim.round();
    sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: [A, B] });
    sim.send({ type: "ROUND_PROJECT", round, project: A, outcome: verified(A, false) });
    expect(sim.write(A)).toEqual({ allowed: false, reason: "role-denies", waitable: false });
    expect(sim.write(B)).toEqual({ allowed: true });
  });

  it("drops every result after the epoch closes", () => {
    const sim = new GrantSim();
    sim.send({ type: "START" });
    const round = sim.round();
    expect(kinds(sim.send({ type: "EPOCH_CLOSED" }))).toEqual(["cancel"]);
    expect(sim.state.phase.phase).toBe("closed");
    expect(sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: [] })).toEqual([]);
    expect(sim.state.phase.phase).toBe("closed");
    expect(sim.write(A)).toEqual({ allowed: false, reason: "epoch-closed", waitable: false });
  });
});

describe("access grant invariants over enumerated event sequences", () => {
  const C = projectRef("project-c");
  const PROJECTS = [A, B, C] as const;
  const TOLERANCE = policy.wallJumpBackToleranceMs;

  /** §4.2's `expired`, restated here so the reducer is not checked against itself. */
  const expiredAt = (stamp: Instant, now: Instant): boolean =>
    now.wall >= stamp.wall + WINDOW ||
    now.mono >= stamp.mono + WINDOW ||
    now.wall - stamp.wall < now.mono - stamp.mono - TOLERANCE;

  const evidenceOf = (state: GrantMachine) =>
    state.phase.phase === "granted"
      ? state.phase.evidence
      : state.phase.phase === "lapsed"
        ? state.phase.last
        : null;

  /** Machines are invariant under a shift of both clocks: key nodes by time relative to `now`. */
  const nodeKey = (state: GrantMachine, now: Instant): string =>
    JSON.stringify(state, (_key, value: unknown) => {
      if (value instanceof Map) return [...value.entries()];
      if (
        typeof value === "object" &&
        value !== null &&
        Object.keys(value).length === 2 &&
        "wall" in value &&
        "mono" in value
      ) {
        const instant = value as Instant;
        return [instant.wall - now.wall, instant.mono - now.mono];
      }
      return value;
    });

  const stepsFrom = (
    state: GrantMachine,
    now: Instant,
  ): ReadonlyArray<{ readonly now: Instant; readonly event: GrantEvent }> => {
    const at = (wallMs: number, monoMs: number): Instant => ({
      wall: now.wall + wallMs,
      mono: now.mono + monoMs,
    });
    const steps: Array<{ now: Instant; event: GrantEvent }> = [
      { now: at(30 * SECOND, 30 * SECOND), event: { type: "TICK" } },
      { now: at(13 * MINUTE, 13 * MINUTE), event: { type: "TICK" } },
      { now: at(20 * MINUTE, 0), event: { type: "WAKE", visible: true } },
      { now: at(-2 * MINUTE, 0), event: { type: "TICK" } },
      { now, event: { type: "VISIBILITY", hidden: state.signals.hiddenSince === null } },
      { now, event: state.signals.online ? { type: "OFFLINE" } : { type: "ONLINE" } },
      { now, event: { type: "USER_RETRY" } },
    ];
    if (state.phase.phase === "unverified") steps.push({ now, event: { type: "START" } });
    const round = grantRoundInFlight(state);
    if (round !== null && round.targets === null) {
      steps.push(
        {
          now,
          event: { type: "ROUND_ACCOUNT", round: round.id, organizations, projects: [A, B] },
        },
        {
          now,
          event: { type: "ROUND_FAILED", round: round.id, failure: { kind: "offline" } },
        },
      );
    }
    if (round !== null && round.targets !== null) {
      const unanswered = round.targets.find((target) => !round.outcomes.has(target.projectId));
      if (unanswered !== undefined) {
        for (const outcome of [verified(unanswered), failed, forbidden]) {
          steps.push({
            now,
            event: { type: "ROUND_PROJECT", round: round.id, project: unanswered, outcome },
          });
        }
      }
    }
    const attempt = [...state.projectAttempts.values()][0];
    if (attempt !== undefined) {
      for (const outcome of [verified(attempt.project), failed, forbidden]) {
        steps.push({
          now,
          event: {
            type: "PROJECT_RESULT",
            attempt: attempt.attempt,
            project: attempt.project,
            outcome,
          },
        });
      }
    }
    if (evidenceOf(state) !== null) {
      steps.push({
        now,
        event: { type: "PROJECT_DENIED", project: A, evidence: "direct-not-found" },
      });
    }
    return steps;
  };

  const check = (
    previous: GrantMachine,
    state: GrantMachine,
    effects: ReadonlyArray<GrantEffect>,
    now: Instant,
  ): void => {
    const evidence = evidenceOf(state);

    // I3 — asked at this instant and at later ones no event has reached yet.
    for (const probe of [
      now,
      { wall: now.wall + MINUTE, mono: now.mono + MINUTE },
      { wall: now.wall + 14 * MINUTE, mono: now.mono + 14 * MINUTE },
      { wall: now.wall - 2 * MINUTE, mono: now.mono },
    ]) {
      for (const project of PROJECTS) {
        if (!grantPlatformWrite(state, project.projectId, { now: probe, policy }).allowed) continue;
        expect(state.phase.phase).toBe("granted");
        expect(expiredAt(evidence!.account.startedAt, probe)).toBe(false);
        const own = evidence!.projects.get(project.projectId);
        expect(own).toBeDefined();
        expect(expiredAt(own!.startedAt, probe)).toBe(false);
        expect(evidence!.closedProjects.has(project.projectId)).toBe(false);
      }
    }

    // I4 — one round in flight, and admitted account evidence is never expired at admission.
    const roundRuns = effects.filter(
      (effect) => effect.kind === "run" && effect.op.kind === "verify-round",
    );
    expect(roundRuns.length).toBeLessThanOrEqual(1);
    if (roundRuns[0]?.kind === "run") {
      expect(grantRoundInFlight(state)?.id).toBe(roundRuns[0].attempt);
    }
    const admitted = effects.some(
      (effect) => effect.kind === "observe" && effect.observation.kind === "access-verified",
    );
    if (admitted) {
      expect(state.phase.phase).toBe("granted");
      expect(expiredAt(evidence!.account.startedAt, now)).toBe(false);
    }

    // I11 — authority is restored only to scopes positively present in admitted, fresh evidence.
    for (const effect of effects) {
      if (effect.kind !== "restore-authority") continue;
      expect(state.phase.phase).toBe("granted");
      expect(expiredAt(evidence!.account.startedAt, now)).toBe(false);
      if (effect.scope.kind === "project") {
        const id = effect.scope.project.projectId;
        const own = evidence!.projects.get(id);
        expect(own).toBeDefined();
        expect(expiredAt(own!.startedAt, now)).toBe(false);
        expect(evidence!.closedProjects.has(id)).toBe(false);
      }
    }
    // G6 — a confirming read starts at least the confirmation delay after its denial.
    for (const effect of effects) {
      if (effect.kind !== "run" || effect.op.kind !== "confirm-denial") continue;
      const closed = evidence!.closedProjects.get(effect.op.project.projectId)!;
      expect(
        now.mono - closed.deniedAt.mono >= policy.denialConfirmationDelayMs ||
          now.wall - closed.deniedAt.wall >= policy.denialConfirmationDelayMs,
      ).toBe(true);
    }

    // What the runtime was last told agrees with what a reader is allowed now.
    for (const [id, entry] of state.published.projects) {
      expect(entry.authority.kind === "authorized").toBe(
        grantPlatformRead(state, id, { now, policy }).allowed,
      );
    }

    // I6 (the grant's half) and I7 — every non-terminal state has an exit.
    const timerAhead =
      state.timer !== null && state.timer.mono > now.mono && state.timer.wall > now.wall;
    expect(state.timer === null || timerAhead).toBe(true);
    const online = state.signals.online;
    switch (state.phase.phase) {
      case "unverified":
        expect(previous.phase.phase).toBe("unverified");
        break;
      case "verifying":
      case "granted":
        expect(timerAhead).toBe(true);
        break;
      case "unverified-failed":
        expect(timerAhead || !online).toBe(true);
        break;
      case "lapsed": {
        const renewal = state.phase.renewal;
        const exit =
          renewal.status === "running"
            ? timerAhead
            : renewal.status === "dormant" ||
              !online ||
              (renewal.status === "backoff" && timerAhead);
        expect(exit).toBe(true);
        break;
      }
      case "closed":
        break;
    }
  };

  it("holds I3, I4, I6 and I11 after every step of every sequence to depth 6", () => {
    const roots: Array<{ state: GrantMachine; now: Instant }> = [
      { state: initialGrant({ hidden: false, online: true }, T0), now: T0 },
    ];
    const granted = grantedSim();
    roots.push({ state: granted.state, now: granted.now });
    const visited = new Set<string>();
    let frontier = roots;
    let explored = 0;
    for (let depth = 0; depth < 6; depth++) {
      const next: Array<{ state: GrantMachine; now: Instant }> = [];
      for (const node of frontier) {
        for (const step of stepsFrom(node.state, node.now)) {
          const result = transitionGrant(node.state, step.event, { now: step.now, policy });
          explored++;
          check(node.state, result.state, result.effects, step.now);
          const key = nodeKey(result.state, step.now);
          if (visited.has(key)) continue;
          visited.add(key);
          next.push({ state: result.state, now: step.now });
        }
      }
      frontier = next;
    }
    expect(explored).toBeGreaterThan(10_000);
  });
});
