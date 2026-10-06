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
  grantPlatformRead,
  grantPlatformWrite,
  grantRoundInFlight,
  initialGrant,
  transitionGrant,
  type GrantEffect,
  type GrantEvent,
  type GrantFailure,
  type GrantMachine,
  type GrantOp,
  type GrantWithholdingCause,
  type Instant,
  type ProjectOutcome,
} from "./grant.ts";
import { explore } from "../../testing/explore.ts";

/**
 * Every sequence to depth N is enumerated on the CPU alone: ~1-3 s locally, but CI runs the whole
 * workspace's suites at once and has taken more than 30 s.
 */
const EXHAUSTIVE_TIMEOUT_MS = 120_000;

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
  /** The jitter source; none by default, so every rung lands on its time. */
  random: (() => number) | undefined = undefined;
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
    return this.random === undefined
      ? { now: this.now, policy }
      : { now: this.now, policy, random: this.random };
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
    this.send({ type: "PROJECTS_DEMANDED", projects: outcomes.map(([project]) => project) });
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
  sim.send({ type: "PROJECTS_DEMANDED", projects: listed });
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

describe("a failed first read recovers by itself", () => {
  it("jitters every rung: a retry may come up to a fifth sooner, never later", () => {
    const sim = new GrantSim();
    sim.random = () => 1;
    sim.send({ type: "START" });
    sim.send({
      type: "ROUND_FAILED",
      round: sim.round(),
      failure: { kind: "server", status: 503 },
    });
    expect(sim.state.phase).toMatchObject({
      phase: "unverified-failed",
      retryAt: { wall: T0.wall + 1_600, mono: T0.mono + 1_600 },
    });
  });

  const failedFirst = (): GrantSim => {
    const sim = new GrantSim();
    sim.send({ type: "START" });
    sim.send({
      type: "ROUND_FAILED",
      round: sim.round(),
      failure: { kind: "server", status: 503 },
    });
    return sim;
  };

  it.each([
    ["its retry time", (sim: GrantSim) => (sim.elapse(2 * SECOND), sim.send({ type: "TICK" }))],
    ["online", (sim: GrantSim) => sim.send({ type: "ONLINE" })],
    ["a visible wake", (sim: GrantSim) => sim.send({ type: "WAKE", visible: true })],
    ["a manual again", (sim: GrantSim) => sim.send({ type: "USER_RETRY" })],
  ] as const)("starts a round again at %s", (_signal, signal) => {
    const sim = failedFirst();
    const before = sim.runs.length;
    sim.elapse(SECOND);
    signal(sim);
    expect(sim.runs).toHaveLength(before + 1);
    expect(sim.state.phase.phase).toBe("verifying");
  });

  it("waits out a hidden tab: its retry comes due and nothing runs until the visible wake", () => {
    const sim = failedFirst();
    sim.send({ type: "VISIBILITY", hidden: true });
    const before = sim.runs.length;
    sim.elapse(MINUTE);
    sim.send({ type: "TICK" });
    sim.send({ type: "WAKE", visible: false });
    expect(sim.runs).toHaveLength(before);
    sim.send({ type: "VISIBILITY", hidden: false });
    sim.send({ type: "WAKE", visible: true });
    expect(sim.runs).toHaveLength(before + 1);
  });
});

// A malformed answer is definitive, as a cell's decode is (2026-10-05: a definitive refusal ends
// the recovery, visibly, with a manual again): no rung, no visible wake and no `online` reads it
// again; only a person's again does.
describe("a malformed answer waits for a person's again", () => {
  const MALFORMED: GrantFailure = { kind: "malformed", detail: "an unknown shape" };
  const quiet = (sim: GrantSim) => {
    sim.elapse(10 * MINUTE);
    sim.send({ type: "TICK" });
    sim.send({ type: "ONLINE" });
    sim.send({ type: "WAKE", visible: true });
  };

  it("ends a first read's retries", () => {
    const sim = new GrantSim();
    sim.send({ type: "START" });
    sim.send({ type: "ROUND_FAILED", round: sim.round(), failure: MALFORMED });
    expect(sim.state.phase).toMatchObject({ phase: "unverified-failed", retryAt: null });
    expect(sim.state.timer).toBeNull();
    const before = sim.runs.length;
    quiet(sim);
    expect(sim.runs).toHaveLength(before);
    sim.send({ type: "USER_RETRY" });
    expect(sim.runs).toHaveLength(before + 1);
  });

  it("ends a renewal's retries before the held deadline, and says no retry is coming", () => {
    const sim = grantedSim();
    sim.elapse(12 * MINUTE - 2 * SECOND);
    sim.send({ type: "TICK" });
    sim.send({ type: "ROUND_FAILED", round: sim.round(), failure: MALFORMED });
    expect(sim.state.phase).toMatchObject({
      phase: "granted",
      renewal: { status: "failed", retryAt: null },
    });
    const before = sim.runs.length;
    sim.elapse(MINUTE);
    sim.send({ type: "TICK" });
    sim.send({ type: "WAKE", visible: true });
    expect(sim.runs).toHaveLength(before);
    sim.send({ type: "USER_RETRY" });
    expect(sim.runs).toHaveLength(before + 1);
  });

  it("ends one project's reads while the account stays granted", () => {
    const sim = grantedSim();
    sim.send({ type: "PROJECTS_DEMANDED", projects: [A, B, projectRef("project-c")] });
    const read = sim.lastRun("verify-project");
    sim.send({
      type: "PROJECT_RESULT",
      attempt: read.attempt,
      project: projectRef("project-c"),
      outcome: { kind: "failed", failure: MALFORMED },
    });
    const before = sim.runs.length;
    quiet(sim);
    expect(sim.runs.slice(before).map(({ op }) => op.kind)).not.toContain("verify-project");
    sim.send({ type: "USER_RETRY" });
    expect(sim.runs.slice(before).map(({ op }) => op.kind)).toContain("verify-project");
  });
});

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
  });

  it("stamps evidence when the round starts, so authority ends 15 min after the start on either clock (G2, T-L4)", () => {
    const sim = grantedSim(40 * SECOND);
    sim.elapse(WINDOW - 40 * SECOND - 1);
    expect(sim.write(A)).toEqual({ allowed: true });
    sim.elapse(1);
    expect(sim.write(A)).toEqual({ allowed: false, reason: "access-lapsed", waitable: true });

    const sleeper = grantedSim(40 * SECOND);
    sleeper.shiftWall(WINDOW - 40 * SECOND);
    expect(sleeper.write(A)).toEqual({ allowed: false, reason: "access-lapsed", waitable: true });
  });

  it("keeps a tab hidden across the renewal granted, with no lapse and writes open throughout (T-L1)", () => {
    const sim = grantedSim();
    sim.elapse(MINUTE);
    sim.send({ type: "VISIBILITY", hidden: true });
    play(sim, 40 * MINUTE, healthyPlatform(3 * SECOND), (tab) => {
      expect(tab.write(A)).toEqual({ allowed: true });
    });
    sim.send({ type: "VISIBILITY", hidden: false });
    sim.send({ type: "USER_RETRY" });
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
    sim.send({ type: "USER_RETRY" });
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

  it("closes a denied project at once and for good: no read confirms it later (G6)", () => {
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
    expect(effects).toContainEqual({
      kind: "observe",
      observation: { kind: "project-gone", project: A, evidence: "direct-forbidden" },
    });

    // A definitive refusal is never asked again by a clock: no read of A follows, then or later.
    const runs = sim.runs.length;
    sim.elapse(10 * MINUTE);
    sim.send({ type: "TICK" });
    expect(sim.runs.slice(runs).filter((run) => run.op.kind !== "verify-round")).toEqual([]);
    expect(sim.write(A).allowed).toBe(false);
  });

  it.each([
    ["a 200", "before the other project's", verified(A)],
    ["a 5xx", "before the other project's", failed],
    ["a 200", "last", verified(A)],
    ["a 5xx", "last", failed],
  ] as const)(
    "keeps a denial seen mid-first-round over that round's own later answer of %s, arriving %s, and admits the round at once (G6)",
    (_label, order, answer) => {
      const sim = new GrantSim();
      sim.send({ type: "START" });
      const round = sim.round();
      sim.elapse(SECOND);
      sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: [A, B] });
      sim.elapse(SECOND);
      const before = sim.effects.length;
      const answerB = { type: "ROUND_PROJECT", round, project: B, outcome: verified(B) } as const;
      if (order === "last") sim.send(answerB);
      sim.send({ type: "PROJECT_DENIED", project: A, evidence: "direct-forbidden" });
      sim.elapse(SECOND);
      sim.send({ type: "ROUND_PROJECT", round, project: A, outcome: answer });
      if (order !== "last") sim.send(answerB);
      expect(sim.state.phase.phase).toBe("granted");
      expect(sim.write(A)).toEqual({ allowed: false, reason: "project-closed", waitable: false });
      expect(sim.write(B)).toEqual({ allowed: true });
      expect(sim.effectsSince(before)).toContainEqual({
        kind: "withhold",
        scope: { kind: "project", project: A },
        reason: "access-denied",
        cause: null,
      });
    },
  );

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

  it("closes a project that 403s in the round after a lapse, and restores the others (G6, T-L20)", () => {
    const sim = grantedSim();
    sim.elapse(30 * MINUTE);
    sim.send({ type: "USER_RETRY" });
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
    expect(effects).toContainEqual({
      kind: "withhold",
      scope: { kind: "project", project: A },
      reason: "access-denied",
      cause: null,
    });
    expect(effects).toContainEqual({
      kind: "observe",
      observation: { kind: "project-gone", project: A, evidence: "direct-forbidden" },
    });
    expect(sim.write(A).allowed).toBe(false);
  });

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

  it.each([
    [
      "a first round",
      () => {
        const sim = new GrantSim();
        sim.send({ type: "START" });
        return sim;
      },
    ],
    [
      "a lapsed tab's round",
      () => {
        const sim = grantedSim();
        sim.elapse(30 * MINUTE);
        sim.send({ type: "USER_RETRY" });
        return sim;
      },
    ],
  ])(
    "a person's again that joined %s which then runs out asks once more at once (G7)",
    (_name, start) => {
      const sim = start();
      const round = grantRoundInFlight(sim.state)!;
      const joined = round.id;
      // Pressed in the joined round's last moment: its deadline, not the person, ends it.
      sim.elapse(round.deadline.mono - sim.now.mono - 300);
      sim.send({ type: "USER_RETRY" });
      expect(grantRoundInFlight(sim.state)!.id).toBe(joined);
      sim.elapse(300);
      sim.send({ type: "TICK" });
      sim.send({ type: "TICK" });
      const next = grantRoundInFlight(sim.state);
      expect(next).not.toBeNull();
      expect(next!.id).not.toBe(joined);
      expect(next!.startedAt).toEqual(sim.now);
    },
  );

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

  const unavailable: GrantFailure = { kind: "server", status: 503 };

  /** A lapse whose first round failed, one second into its backoff. */
  const failedLapse = (): GrantSim => {
    const sim = grantedSim();
    sim.elapse(20 * MINUTE);
    sim.send({ type: "TICK" });
    sim.send({ type: "ROUND_FAILED", round: sim.round(), failure: unavailable });
    sim.elapse(SECOND);
    return sim;
  };
  it.each<{
    readonly name: string;
    readonly lapse: () => GrantSim;
    readonly cause: GrantWithholdingCause;
  }>([
    {
      name: "a visible wake starts a round after the lapse's failure",
      lapse: () => {
        const sim = failedLapse();
        sim.send({ type: "WAKE", visible: true });
        return sim;
      },
      cause: { failure: unavailable, retryAtMs: null },
    },
    {
      name: "Try now starts a round after the lapse's failure",
      lapse: () => {
        const sim = failedLapse();
        sim.send({ type: "USER_RETRY" });
        return sim;
      },
      cause: { failure: unavailable, retryAtMs: null },
    },
    {
      name: "the network's return starts a round after the lapse's failure",
      lapse: () => {
        const sim = failedLapse();
        sim.send({ type: "OFFLINE" });
        sim.elapse(10 * SECOND);
        sim.send({ type: "TICK" });
        sim.send({ type: "ONLINE" });
        return sim;
      },
      cause: { failure: unavailable, retryAtMs: null },
    },
    {
      name: "the lapse starts during a round a wake began after a failed renewal",
      lapse: () => {
        const sim = grantedSim();
        sim.elapse(12 * MINUTE);
        sim.send({ type: "TICK" });
        sim.send({ type: "ROUND_FAILED", round: sim.round(), failure: unavailable });
        sim.elapse(3 * MINUTE - 10 * SECOND);
        sim.send({ type: "WAKE", visible: true });
        sim.elapse(10 * SECOND);
        sim.send({ type: "TICK" });
        return sim;
      },
      cause: { failure: unavailable, retryAtMs: null },
    },
    {
      name: "the lapse follows a verified round after a failed renewal",
      lapse: () => {
        const sim = grantedSim();
        sim.elapse(12 * MINUTE);
        sim.send({ type: "TICK" });
        sim.send({ type: "ROUND_FAILED", round: sim.round(), failure: unavailable });
        sim.elapse(10 * SECOND);
        sim.send({ type: "TICK" });
        sim.answerRound([
          [A, verified(A)],
          [B, verified(B)],
        ]);
        sim.elapse(20 * MINUTE);
        sim.send({ type: "TICK" });
        return sim;
      },
      cause: null,
    },
  ])("a lapse keeps its renewal's failure until a round verifies: $name", ({ lapse, cause }) => {
    const sim = lapse();
    expect(grantRoundInFlight(sim.state)?.startedAt.mono).toBeLessThanOrEqual(sim.now.mono);
    expect(sim.state.phase.phase).toBe("lapsed");
    expect(sim.state.published.account).toEqual({
      kind: "withheld",
      reason: "access-lapsed",
      cause,
    });
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
    sim.send({ type: "USER_RETRY" });
    expect(grantRoundInFlight(sim.state)?.startedAt).toEqual(sim.now);
  });

  it("ends dormancy when the tab becomes visible, even when the coalesced wake is suppressed (D5, §6.4)", () => {
    const sim = grantedSim();
    sim.send({ type: "VISIBILITY", hidden: true });
    play(sim, 90 * MINUTE, healthyPlatform(2 * SECOND));
    expect(sim.state.phase).toMatchObject({ phase: "lapsed", renewal: { status: "dormant" } });
    sim.send({ type: "VISIBILITY", hidden: false });
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

  it("renews a held project no lease demands any more, never withholding it as denied", () => {
    const sim = grantedSim();
    // The page that leased A closed: only B is demanded when the renewal starts.
    sim.send({ type: "PROJECTS_DEMANDED", projects: [B] });
    sim.elapse(12 * MINUTE);
    const before = sim.effects.length;
    sim.send({ type: "TICK" });
    const renewal = sim.lastRun("verify-round");
    expect(renewal.op).toEqual({ kind: "verify-round", carried: [B, A] });
    const round = sim.round();
    sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: [B, A] });
    sim.send({ type: "ROUND_PROJECT", round, project: B, outcome: verified(B) });
    sim.send({ type: "ROUND_PROJECT", round, project: A, outcome: verified(A) });
    expect(sim.write(A)).toEqual({ allowed: true });
    expect(sim.effectsSince(before).filter((effect) => effect.kind === "withhold")).toEqual([]);
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

  it.each([
    ["the round no longer lists it", [[A, verified(A)]], "project-unverified", true],
    [
      "the round read a lowered role",
      [
        [A, verified(A)],
        [B, verified(B, false)],
      ],
      "role-denies",
      false,
    ],
  ] as const)(
    "drops a project read that started before the round it would join: %s (G2, G12, §4.0)",
    (_label, renewal, reason, waitable) => {
      const sim = new GrantSim();
      sim.send({ type: "START" });
      sim.elapse(2 * SECOND);
      sim.answerRound([
        [A, verified(A)],
        [B, failed],
      ]);
      sim.elapse(11 * MINUTE + 38 * SECOND);
      sim.send({ type: "USER_RETRY" });
      const stale = sim.lastRun("verify-project");
      expect(stale.op).toEqual({ kind: "verify-project", project: B });
      sim.elapse(20 * SECOND);
      sim.send({ type: "TICK" });
      const renewalStart = grantRoundInFlight(sim.state)!.startedAt;
      sim.answerRound(renewal);
      expect(sim.state.phase.phase).toBe("granted");
      sim.elapse(2 * SECOND);
      const before = sim.effects.length;
      sim.send({
        type: "PROJECT_RESULT",
        attempt: stale.attempt,
        project: B,
        outcome: verified(B),
      });
      expect(sim.write(B)).toEqual({ allowed: false, reason, waitable });
      expect(sim.effectsSince(before)).not.toContainEqual({
        kind: "restore-authority",
        scope: { kind: "project", project: B },
      });
      const evidence = sim.state.phase.phase === "granted" ? sim.state.phase.evidence : null;
      const own = evidence?.projects.get(B.projectId);
      if (own !== undefined) expect(own.startedAt).toEqual(renewalStart);
    },
  );

  describe("a project a visible consumer demands and no evidence holds", () => {
    const C = projectRef("project-c");
    const listed = (projects: ReadonlyArray<ProjectRef>): GrantEvent => ({
      type: "PROJECTS_DEMANDED",
      projects,
    });
    const verifyRuns = (sim: GrantSim, project: ProjectRef) =>
      sim.effects.filter(
        ({ effect }) =>
          effect.kind === "run" &&
          effect.op.kind === "verify-project" &&
          effect.op.project.projectId === project.projectId,
      );

    it("is read at once, not at the next renewal, and admitted on its answer", () => {
      const sim = grantedSim();
      sim.elapse(MINUTE);
      const before = sim.effects.length;
      sim.send(listed([A, B, C]));
      expect(verifyRuns(sim, C)).toHaveLength(1);
      // Until it answers, nothing is claimed for it: no cause names a failure it never had.
      expect(sim.effectsSince(before)).toContainEqual({
        kind: "withhold",
        scope: { kind: "project", project: C },
        reason: "access-unverified",
        cause: null,
      });
      expect(sim.read(C).allowed).toBe(false);
      sim.elapse(300);
      sim.send({
        type: "PROJECT_RESULT",
        attempt: sim.lastRun("verify-project").attempt,
        project: C,
        outcome: verified(C),
      });
      expect(sim.read(C).allowed).toBe(true);
      expect(sim.effectsSince(before)).toContainEqual({
        kind: "restore-authority",
        scope: { kind: "project", project: C },
      });
      // One project read, and no round for it.
      expect(sim.effectsSince(before).filter((effect) => effect.kind === "run")).toHaveLength(1);
    });

    it.each([
      ["projects the evidence already holds", [A, B]],
      ["an empty list", []],
    ] as const)("changes nothing for %s", (_label, projects) => {
      const sim = grantedSim();
      sim.elapse(MINUTE);
      const state = sim.state;
      expect(sim.send(listed(projects))).toEqual([]);
      expect(sim.state.phase).toEqual(state.phase);
      expect(sim.state.demandedProjects).toEqual(projects);
    });

    it("is read once however often the list names it while its read is out", () => {
      const sim = grantedSim();
      sim.send(listed([A, B, C]));
      sim.send(listed([A, B, C]));
      sim.elapse(SECOND);
      sim.send(listed([C]));
      expect(verifyRuns(sim, C)).toHaveLength(1);
    });

    it("is read again on the project rungs while its read fails, never given up", () => {
      const sim = grantedSim();
      const failingC: Responder = (run) =>
        run.op.kind === "verify-project" && run.op.project.projectId === C.projectId
          ? [
              {
                afterMs: SECOND,
                event: {
                  type: "PROJECT_RESULT",
                  attempt: run.attempt,
                  project: C,
                  outcome: failed,
                },
              },
            ]
          : healthyPlatform(2 * SECOND)(run);
      sim.send(listed([A, B, C]));
      play(sim, 5 * MINUTE, failingC);
      const starts = verifyRuns(sim, C).map(({ at }) => at.mono);
      const gaps = starts.slice(1).map((at, index) => at - starts[index]!);
      // Each rung counted from the failed answer a second after its start; the last one repeats.
      expect(gaps.slice(0, 5)).toEqual([11, 21, 41, 61, 61].map((s) => s * SECOND));
      expect(sim.read(C).allowed).toBe(false);
    });

    it("demanded while the grant is lapsed, is read once a round grants again", () => {
      const sim = grantedSim();
      sim.elapse(16 * MINUTE);
      sim.send({ type: "TICK" });
      expect(sim.state.phase.phase).toBe("lapsed");
      sim.send(listed([A, B, C]));
      // Offered while lapsed, and ignored there: the grant reads no project then.
      expect(verifyRuns(sim, C)).toHaveLength(0);
      sim.elapse(SECOND);
      // The lapse's round answers for the projects its search listed, which C is not yet.
      const round = sim.round();
      sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: [A, B] });
      sim.send({ type: "ROUND_PROJECT", round, project: A, outcome: verified(A) });
      sim.send({ type: "ROUND_PROJECT", round, project: B, outcome: verified(B) });
      expect(sim.state.phase.phase).toBe("granted");
      expect(verifyRuns(sim, C)).toHaveLength(1);
    });

    it("listed while a renewal round runs that did not target it, is read when that round ends", () => {
      const sim = grantedSim();
      play(sim, 12 * MINUTE + 10 * SECOND, () => []);
      const round = sim.round();
      sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: [A, B] });
      sim.send(listed([A, B, C]));
      sim.elapse(SECOND);
      sim.send({ type: "ROUND_PROJECT", round, project: A, outcome: verified(A) });
      sim.send({ type: "ROUND_PROJECT", round, project: B, outcome: verified(B) });
      expect(grantRoundInFlight(sim.state)).toBeNull();
      expect(verifyRuns(sim, C)).toHaveLength(1);
    });

    it("is not read before the account's first grant: that round reads the list itself", () => {
      const sim = new GrantSim();
      sim.send({ type: "START" });
      expect(sim.send(listed([C])).filter((effect) => effect.kind === "run")).toEqual([]);
    });
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

// F11 (e2e, 2026-10-03): a hand over writes a project's grants, which only a round reads. The
// person who just handed a Mate over sees its new owner at once: a round now, never on the
// renewal's schedule — and right after the round in flight, which may have read before the write.
describe("access grant: grants this account wrote", () => {
  it("starts a round at once on a granted grant whose renewal waits", () => {
    const sim = grantedSim();
    sim.elapse(MINUTE);
    sim.send({ type: "TICK" });
    expect(grantRoundInFlight(sim.state)).toBeNull();
    sim.send({ type: "GRANTS_WRITTEN" });
    expect(grantRoundInFlight(sim.state)?.startedAt).toEqual(sim.now);
  });

  it("starts another round as soon as the one in flight completes", () => {
    const sim = grantedSim();
    sim.elapse(12 * MINUTE);
    sim.send({ type: "TICK" });
    const inFlight = sim.round();
    sim.send({ type: "GRANTS_WRITTEN" });
    expect(sim.round()).toBe(inFlight);
    sim.elapse(2 * SECOND);
    sim.answerRound([
      [A, verified(A)],
      [B, verified(B)],
    ]);
    expect(sim.round()).not.toBe(inFlight);
    expect(grantRoundInFlight(sim.state)?.startedAt).toEqual(sim.now);
  });

  it("asks nothing of a grant not granted yet", () => {
    const sim = new GrantSim();
    sim.send({ type: "START" });
    const first = sim.round();
    sim.send({ type: "GRANTS_WRITTEN" });
    expect(sim.round()).toBe(first);
  });
});

describe("access grant invariants over enumerated event sequences", () => {
  interface GrantNode {
    readonly state: GrantMachine;
    readonly now: Instant;
  }
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

  /**
   * Machines are invariant under a shift of both clocks and of the attempt counter: key nodes by
   * time relative to `now`, the published `retryAtMs` wall time included, and by rounds and reads
   * relative to the next attempt, which the machine compares only for equality.
   */
  const nodeKey = ({ state, now }: GrantNode): string =>
    JSON.stringify(state, function (this: object, key, value: unknown) {
      if (typeof value === "number") {
        switch (key) {
          case "nextAttempt":
            return undefined;
          // A round's id, the round that produced account evidence, and a project read's attempt.
          case "id":
          case "round":
            return state.nextAttempt - value;
          case "attempt":
            return "startedAt" in this ? state.nextAttempt - value : value;
          case "retryAtMs":
            return value - now.wall;
          default:
            return value;
        }
      }
      if (typeof value !== "object" || value === null) return value;
      if (value instanceof Map) return [...value.entries()];
      if ("wall" in value && "mono" in value) {
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
      { now, event: { type: "GRANTS_WRITTEN" } },
      // Someone else creates C: the organization's live list names it before any round does.
      { now, event: { type: "PROJECTS_DEMANDED", projects: PROJECTS } },
    ];
    if (state.phase.phase === "unverified") steps.push({ now, event: { type: "START" } });
    const round = grantRoundInFlight(state);
    if (round !== null && round.targets === null) {
      steps.push(
        {
          now,
          event: { type: "ROUND_ACCOUNT", round: round.id, organizations, projects: [A, B] },
        },
        // A project the platform no longer lists: a proper subset of what the grant carries.
        {
          now,
          event: { type: "ROUND_ACCOUNT", round: round.id, organizations, projects: [A] },
        },
        {
          now,
          event: { type: "ROUND_FAILED", round: round.id, failure: { kind: "offline" } },
        },
      );
    }
    if (round !== null && round.targets !== null) {
      // Any unanswered target may answer next, so a denied project can be the last to answer.
      for (const unanswered of round.targets) {
        if (round.outcomes.has(unanswered.projectId)) continue;
        for (const outcome of [verified(unanswered), failed, forbidden]) {
          steps.push({
            now,
            event: { type: "ROUND_PROJECT", round: round.id, project: unanswered, outcome },
          });
        }
      }
      // The round's own read of a project another GET already found denied answers late.
      for (const target of round.targets) {
        if (round.outcomes.get(target.projectId)?.outcome.kind !== "denied") continue;
        steps.push({
          now,
          event: {
            type: "ROUND_PROJECT",
            round: round.id,
            project: target,
            outcome: verified(target),
          },
        });
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
    if (evidenceOf(state) !== null || round !== null) {
      steps.push({
        now,
        event: { type: "PROJECT_DENIED", project: A, evidence: "direct-not-found" },
      });
    }
    return steps;
  };

  /**
   * Every denial still in force: closed projects, and denials the round in flight recorded for a
   * project without positive evidence (a confirming 200 lifts one while the round runs on).
   */
  const denialsOf = (state: GrantMachine): ReadonlyMap<string, Instant> => {
    const evidence = evidenceOf(state);
    const denials = new Map<string, Instant>();
    for (const [id, entry] of evidence?.closedProjects ?? []) denials.set(id, entry.deniedAt);
    for (const [id, answer] of grantRoundInFlight(state)?.outcomes ?? []) {
      if (answer.outcome.kind !== "denied" || denials.has(id)) continue;
      if (evidence?.projects.has(id) !== true) denials.set(id, answer.at);
    }
    return denials;
  };

  /** Hundreds of thousands of steps: a plain throw keeps the hot loop off `expect`'s cost. */
  const invariant = (holds: boolean, label: string): void => {
    if (!holds) throw new Error(`invariant broken: ${label}`);
  };

  const check = (
    previous: GrantMachine,
    event: GrantEvent,
    state: GrantMachine,
    effects: ReadonlyArray<GrantEffect>,
    now: Instant,
  ): void => {
    const evidence = evidenceOf(state);
    const before = evidenceOf(previous);
    const admitted = effects.some(
      (effect) => effect.kind === "observe" && effect.observation.kind === "access-verified",
    );
    const read =
      event.type === "PROJECT_RESULT"
        ? previous.projectAttempts.get(event.project.projectId)
        : undefined;
    const answeredRead =
      event.type === "PROJECT_RESULT" && read?.attempt === event.attempt ? read : undefined;

    // G2 — evidence a project read adds is never stamped later than that read started.
    if (answeredRead !== undefined && !admitted) {
      const id = answeredRead.project.projectId;
      const own = evidence?.projects.get(id);
      if (own !== undefined && own !== before?.projects.get(id)) {
        invariant(own.startedAt.mono <= answeredRead.startedAt.mono, "G2 read stamp");
      }
    }

    // G12 — only an admitted round lists a project; one missing from the held evidence stays out.
    if (before !== null && !admitted) {
      for (const project of PROJECTS) {
        const id = project.projectId;
        const held =
          before.projects.has(id) || before.unverified.has(id) || before.closedProjects.has(id);
        invariant(held || evidence?.projects.has(id) !== true, "G12 unlisted project");
      }
    }

    // G6 — a denial is lifted only by a round that started after it; one only a round held may
    // end with that round, never while it runs.
    const denials = denialsOf(state);
    const roundBefore = grantRoundInFlight(previous);
    const roundAfter = grantRoundInFlight(state);
    for (const [id, deniedAt] of denialsOf(previous)) {
      if (denials.has(id)) continue;
      const own = evidence?.projects.get(ZeropsProjectId.make(id));
      if (own !== undefined) {
        invariant(own.startedAt.mono >= deniedAt.mono, "G6 denial lifted by an older read");
      } else {
        invariant(
          roundAfter === null || roundAfter.id !== roundBefore?.id,
          "G6 denial lost inside its round",
        );
      }
    }

    // I3 — asked at this instant and at later ones no event has reached yet.
    for (const probe of [
      now,
      { wall: now.wall + MINUTE, mono: now.mono + MINUTE },
      { wall: now.wall + 14 * MINUTE, mono: now.mono + 14 * MINUTE },
      { wall: now.wall - 2 * MINUTE, mono: now.mono },
    ]) {
      for (const project of PROJECTS) {
        if (!grantPlatformWrite(state, project.projectId, { now: probe, policy }).allowed) continue;
        const own = evidence?.projects.get(project.projectId);
        invariant(
          state.phase.phase === "granted" &&
            !expiredAt(evidence!.account.startedAt, probe) &&
            own !== undefined &&
            !expiredAt(own.startedAt, probe) &&
            !evidence!.closedProjects.has(project.projectId),
          "I3 write without fresh evidence",
        );
      }
    }

    // I4 — one round in flight, and admitted account evidence is never expired at admission.
    const roundRuns = effects.filter(
      (effect) => effect.kind === "run" && effect.op.kind === "verify-round",
    );
    invariant(roundRuns.length <= 1, "I4 one round");
    if (roundRuns[0]?.kind === "run") {
      invariant(roundAfter?.id === roundRuns[0].attempt, "I4 the started round is in flight");
    }
    if (admitted) {
      invariant(
        state.phase.phase === "granted" && !expiredAt(evidence!.account.startedAt, now),
        "I4 admitted evidence is fresh",
      );
    }

    // Liveness — a round every target has answered is decided at once, never left to its deadline.
    invariant(
      roundAfter === null ||
        roundAfter.targets === null ||
        !roundAfter.targets.every((target) => roundAfter.outcomes.has(target.projectId)),
      "liveness: an answered round is still in flight",
    );

    // I11 — authority is restored only to scopes positively present in admitted, fresh evidence.
    for (const effect of effects) {
      if (effect.kind !== "restore-authority") continue;
      invariant(
        state.phase.phase === "granted" && !expiredAt(evidence!.account.startedAt, now),
        "I11 account restored under fresh evidence",
      );
      if (effect.scope.kind === "project") {
        const id = effect.scope.project.projectId;
        const own = evidence!.projects.get(id);
        invariant(
          own !== undefined && !expiredAt(own.startedAt, now) && !evidence!.closedProjects.has(id),
          "I11 project restored under fresh evidence",
        );
      }
    }
    // What the runtime was last told agrees with what a reader is allowed now.
    for (const [id, entry] of state.published.projects) {
      invariant(
        (entry.authority.kind === "authorized") ===
          grantPlatformRead(state, id, { now, policy }).allowed,
        "G12 published authority matches platformRead",
      );
    }

    // I6 (the grant's half) and I7 — every non-terminal state has an exit.
    const timerAhead =
      state.timer !== null && state.timer.mono > now.mono && state.timer.wall > now.wall;
    invariant(state.timer === null || timerAhead, "I6 timer ahead");
    const online = state.signals.online;
    switch (state.phase.phase) {
      case "unverified":
        invariant(previous.phase.phase === "unverified", "I7 unverified only before START");
        break;
      case "verifying":
      case "granted":
        invariant(timerAhead, `I7 ${state.phase.phase} has a timer`);
        break;
      case "unverified-failed":
        invariant(state.timer === null || timerAhead, "I7 failed grant waits for manual retry");
        break;
      case "lapsed": {
        const renewal = state.phase.renewal;
        const exit =
          renewal.status === "running"
            ? timerAhead
            : renewal.status === "dormant" || !online || renewal.status === "failed";
        invariant(exit, "I7 lapsed has an exit");
        break;
      }
      case "closed":
        break;
    }
  };

  it(
    "holds I3, I4, I6, I11, G2, G6, G12 and round liveness after every step of every sequence to depth 6",
    { timeout: EXHAUSTIVE_TIMEOUT_MS },
    () => {
      const roots: Array<GrantNode> = [
        { state: initialGrant({ hidden: false, online: true }, T0), now: T0 },
      ];
      const granted = grantedSim();
      roots.push({ state: granted.state, now: granted.now });
      // B's read failed in the admitted round, and its per-project retry is in flight.
      const retrying = new GrantSim();
      retrying.send({ type: "START" });
      retrying.elapse(2 * SECOND);
      retrying.answerRound([
        [A, verified(A)],
        [B, failed],
      ]);
      retrying.elapse(0);
      retrying.send({ type: "USER_RETRY" });
      expect(retrying.state.projectAttempts.has(B.projectId)).toBe(true);
      roots.push({ state: retrying.state, now: retrying.now });
      const report = explore({
        roots,
        depth: 6,
        events: (node: GrantNode) => stepsFrom(node.state, node.now),
        step: (node, step) => {
          const result = transitionGrant(node.state, step.event, { now: step.now, policy });
          return { state: { state: result.state, now: step.now }, effects: result.effects };
        },
        key: nodeKey,
        check: (node, step, result) => {
          try {
            check(node.state, step.event, result.state.state, result.effects, step.now);
            return [];
          } catch (error) {
            return [error instanceof Error ? error.message : String(error)];
          }
        },
      });
      expect(report.violations).toEqual([]);
      expect(report.transitions).toBeGreaterThan(10_000);
    },
  );
});

it.each([false, true])(
  "NO_ACCESS withholds a demanded project with round complete=%s",
  (complete) => {
    const sim = grantedSim();
    sim.elapse(12 * MINUTE);
    sim.send({ type: "TICK" });
    const round = sim.round();
    sim.send({ type: "ROUND_ACCOUNT", round, organizations, projects: [A, B] });
    sim.send({
      type: "ROUND_PROJECT",
      round,
      project: A,
      outcome: {
        kind: "verified",
        access: { project: A, role: "NO_ACCESS", mutationsAllowed: false },
      },
    });
    if (complete) sim.send({ type: "ROUND_PROJECT", round, project: B, outcome: verified(B) });
    expect(sim.read(A)).toEqual({ allowed: false, reason: "role-denies", waitable: false });
    expect(sim.state.published.projects.get(A.projectId)?.authority).toMatchObject({
      kind: "withheld",
      reason: "access-denied",
    });
    expect(sim.read(B)).toEqual({ allowed: true });
  },
);

describe("a failed check retries on its rungs", () => {
  it("retries a failed renewal on its rungs, never waiting for the next sample", () => {
    const sim = grantedSim();
    sim.elapse(12 * MINUTE - 2 * SECOND);
    sim.send({ type: "TICK" });
    const first = sim.round();
    sim.send({ type: "ROUND_FAILED", round: first, failure: { kind: "server", status: 503 } });
    expect(sim.state.phase).toMatchObject({
      phase: "granted",
      failure: { kind: "server", status: 503 },
    });
    expect(sim.write(B).allowed).toBe(true);
    sim.elapse(10 * SECOND);
    sim.send({ type: "TICK" });
    expect(sim.round()).not.toBe(first);
    sim.answerRound([
      [A, verified(A)],
      [B, verified(B)],
    ]);
    expect(sim.state.phase).toMatchObject({ phase: "granted", failure: null });
  });
});
