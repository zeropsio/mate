import { describe, expect, it } from "vite-plus/test";

import {
  initialGiteaSession,
  giteaSessionAwaitsToken,
  giteaSessionReadable,
  giteaSessionToken,
  giteaSessionView,
  KEEPS_REFUSING,
  transitionGiteaSession,
  type GiteaSessionEffect,
  type GiteaSessionEvent,
  type GiteaSessionMachine,
} from "./giteaSessionMachine.ts";

const S = 1_000;
const MIN = 60 * S;

/** One delivered event: what, when, and whether the tab was visible then. */
type Step = readonly [event: GiteaSessionEvent, atMs: number, visible?: boolean];

interface Run {
  readonly machine: GiteaSessionMachine;
  /** Every effect, in order. */
  readonly effects: ReadonlyArray<GiteaSessionEffect>;
  /** The effects of the last step. */
  readonly last: ReadonlyArray<GiteaSessionEffect>;
}

function play(steps: ReadonlyArray<Step>, from: GiteaSessionMachine = initialGiteaSession): Run {
  let machine = from;
  const effects: Array<GiteaSessionEffect> = [];
  let last: ReadonlyArray<GiteaSessionEffect> = [];
  for (const [event, atMs, visible = true] of steps) {
    const next = transitionGiteaSession(machine, event, {
      now: { wall: atMs, mono: atMs },
      visible,
      random: () => 0.5,
    });
    machine = next.state;
    last = next.effects;
    effects.push(...next.effects);
  }
  return { machine, effects, last };
}

const DEMAND: GiteaSessionEvent = { type: "DEMAND", demanded: true };
const UNDEMAND: GiteaSessionEvent = { type: "DEMAND", demanded: false };
const TICK: GiteaSessionEvent = { type: "TICK" };
const acquired = (
  attempt: number,
  token: string,
  expiresInMs: number | undefined = undefined,
): GiteaSessionEvent => ({ type: "ACQUIRED", attempt, token, login: "u-person", expiresInMs });
const failed = (
  attempt: number,
  failure: Extract<GiteaSessionEvent, { type: "ACQUIRE_FAILED" }>["failure"],
): GiteaSessionEvent => ({ type: "ACQUIRE_FAILED", attempt, failure });
const SETTING_UP = { kind: "setting-up" } as const;
const BROKER_DOWN = { kind: "unreachable", source: "broker" } as const;
const NOT_A_MEMBER = {
  kind: "refused",
  reason: "You are not a member of this organization's Gitea.",
} as const;
const liveness = (attempt: number, up: boolean): GiteaSessionEvent => ({
  type: "LIVENESS",
  attempt,
  up,
});

const runs = (effects: ReadonlyArray<GiteaSessionEffect>) =>
  effects.flatMap((effect) => (effect.kind === "run" ? [effect.op] : []));
const scheduled = (effects: ReadonlyArray<GiteaSessionEffect>) =>
  effects.flatMap((effect) => (effect.kind === "schedule" ? [effect.at.mono] : []));

/** Signed in at 0 with `gitea-token-1`, demanded. */
const signedIn = (expiresInMs?: number) =>
  play([
    [DEMAND, 0],
    [acquired(1, "t1", expiresInMs), 0],
  ]);

describe("the Gitea session machine (DESIGN §4.6)", () => {
  it.each([
    {
      row: "idle ─demand─► acquiring: one throwaway mint, no liveness check first",
      steps: [[DEMAND, 0]] as ReadonlyArray<Step>,
      phase: "acquiring",
      runs: ["acquire"],
    },
    {
      row: "idle without demand stays idle",
      steps: [[TICK, 0]] as ReadonlyArray<Step>,
      phase: "idle",
      runs: [],
    },
    {
      row: "acquiring ─OK─► signed-in",
      steps: [
        [DEMAND, 0],
        [acquired(1, "t1"), 1 * S],
      ] as ReadonlyArray<Step>,
      phase: "signed-in",
      runs: ["acquire"],
    },
    {
      row: "acquiring ─502/503 setting up─► pending",
      steps: [
        [DEMAND, 0],
        [failed(1, SETTING_UP), 0],
      ] as ReadonlyArray<Step>,
      phase: "pending",
      runs: ["acquire"],
    },
    {
      row: "acquiring ─broker unreachable─► unavailable",
      steps: [
        [DEMAND, 0],
        [failed(1, BROKER_DOWN), 0],
      ] as ReadonlyArray<Step>,
      phase: "unavailable",
      runs: ["acquire"],
    },
    {
      row: "acquiring ─403 not a member─► refused",
      steps: [
        [DEMAND, 0],
        [failed(1, NOT_A_MEMBER), 0],
      ] as ReadonlyArray<Step>,
      phase: "refused",
      runs: ["acquire"],
    },
    {
      row: "acquiring ─the mint waited out a closed account window─► waiting on identityMint",
      steps: [
        [DEMAND, 0],
        [failed(1, { kind: "access-unverified" }), 0],
      ] as ReadonlyArray<Step>,
      phase: "waiting",
      runs: ["acquire"],
    },
    {
      row: "acquiring ─Zerops 401 on the throwaway─► waiting on the Zerops session",
      steps: [
        [DEMAND, 0],
        [failed(1, { kind: "zerops-session" }), 0],
      ] as ReadonlyArray<Step>,
      phase: "waiting",
      runs: ["acquire"],
    },
    {
      row: "pending ─retryAt─► a liveness check before the next mint",
      steps: [
        [DEMAND, 0],
        [failed(1, SETTING_UP), 0],
        [TICK, 5 * S],
      ] as ReadonlyArray<Step>,
      phase: "acquiring",
      runs: ["acquire", "liveness"],
    },
    {
      row: "pending ─liveness answered─► the mint",
      steps: [
        [DEMAND, 0],
        [failed(1, SETTING_UP), 0],
        [TICK, 5 * S],
        [liveness(2, true), 5 * S],
      ] as ReadonlyArray<Step>,
      phase: "acquiring",
      runs: ["acquire", "liveness", "acquire"],
    },
    {
      row: "unavailable ─no answer from the broker─► stays, next rung, no mint",
      steps: [
        [DEMAND, 0],
        [failed(1, BROKER_DOWN), 0],
        [TICK, 10 * S],
        [liveness(2, false), 10 * S],
      ] as ReadonlyArray<Step>,
      phase: "unavailable",
      runs: ["acquire", "liveness"],
    },
    {
      row: "any ─epoch closed─► closed",
      steps: [
        [DEMAND, 0],
        [acquired(1, "t1"), 0],
        [{ type: "CLOSE" }, 0],
      ] as ReadonlyArray<Step>,
      phase: "closed",
      runs: ["acquire"],
    },
  ])("$row", ({ steps, phase, runs: expected }) => {
    const run = play(steps);
    expect(run.machine.phase.kind).toBe(phase);
    expect(runs(run.effects)).toEqual(expected);
  });

  describe("retry ladders", () => {
    it("pending retries 5 s rising to 60 s, unavailable 10 s rising to 60 s", () => {
      const pending = play([
        [DEMAND, 0],
        [failed(1, SETTING_UP), 0],
        [TICK, 5 * S],
        [liveness(2, true), 5 * S],
        [failed(2, SETTING_UP), 5 * S],
      ]);
      expect(scheduled(pending.effects)).toEqual([5 * S, 15 * S]);

      let unavailable = play([
        [DEMAND, 0],
        [failed(1, BROKER_DOWN), 0],
      ]);
      let at = 0;
      const delays: Array<number> = [];
      for (let attempt = 2; attempt <= 7; attempt += 1) {
        const phase = unavailable.machine.phase;
        if (phase.kind !== "unavailable")
          throw new Error(`expected unavailable, got ${phase.kind}`);
        delays.push(phase.retryAt.mono - at);
        at = phase.retryAt.mono;
        unavailable = play(
          [
            [TICK, at],
            [liveness(attempt, false), at],
          ],
          unavailable.machine,
        );
      }
      expect(delays).toEqual([10 * S, 20 * S, 40 * S, 60 * S, 60 * S, 60 * S]);
    });

    it("waits on identityMint on the common ladder and counts no failure", () => {
      const run = play([
        [DEMAND, 0],
        [failed(1, { kind: "access-unverified" }), 0],
      ]);
      expect(scheduled(run.effects)).toEqual([2 * S]);
      expect(run.machine.failures).toBe(0);
      // No liveness check: the broker was never the trouble.
      expect(runs(play([[TICK, 2 * S]], run.machine).last)).toEqual(["acquire"]);
    });

    it("a visible wake or online resets the ladder and tries now", () => {
      const down = play([
        [DEMAND, 0],
        [failed(1, BROKER_DOWN), 0],
        [TICK, 10 * S],
        [liveness(2, false), 10 * S],
      ]);
      for (const event of [
        { type: "WAKE" },
        { type: "ONLINE" },
      ] as ReadonlyArray<GiteaSessionEvent>) {
        const woken = play([[event, 11 * S]], down.machine);
        expect(runs(woken.last)).toEqual(["liveness"]);
        const again = play([[liveness(3, false), 11 * S]], woken.machine);
        // Back on the first rung.
        expect(scheduled(again.last)).toEqual([21 * S]);
      }
    });

    it("an undemanded retry waits, and runs once demand returns", () => {
      const run = play([
        [DEMAND, 0],
        [failed(1, BROKER_DOWN), 0],
        [UNDEMAND, 1 * S],
      ]);
      expect(run.last).toEqual([{ kind: "cancel" }]);
      expect(runs(play([[TICK, 30 * S]], run.machine).effects)).toEqual([]);
      expect(runs(play([[DEMAND, 30 * S]], run.machine).last)).toEqual(["liveness"]);
    });
  });

  describe("refusal", () => {
    const refused = play([
      [DEMAND, 0],
      [failed(1, NOT_A_MEMBER), 0],
    ]);

    it("is asked again after 5 minutes while visible, without a liveness check", () => {
      expect(scheduled(refused.effects)).toEqual([5 * MIN]);
      expect(runs(play([[TICK, 5 * MIN]], refused.machine).last)).toEqual(["acquire"]);
    });

    it("waits for the tab to be visible, then asks on the wake", () => {
      const hidden = play([[TICK, 5 * MIN, false]], refused.machine);
      expect(runs(hidden.last)).toEqual([]);
      expect(hidden.machine.timer).toBeNull();
      expect(runs(play([[{ type: "WAKE" }, 7 * MIN]], hidden.machine).last)).toEqual(["acquire"]);
    });

    it("a wake or online before the 5 minutes asks nothing", () => {
      expect(runs(play([[{ type: "WAKE" }, 1 * MIN]], refused.machine).last)).toEqual([]);
      expect(runs(play([[{ type: "ONLINE" }, 1 * MIN]], refused.machine).last)).toEqual([]);
    });

    it("keeps saying the refusal while it is asked again, until the answer lands", () => {
      const asking = play([[TICK, 5 * MIN]], refused.machine);
      expect(asking.machine.phase.kind).toBe("acquiring");
      expect(giteaSessionView(asking.machine).trouble).toBe(NOT_A_MEMBER.reason);
    });

    it("stays at or under 12 asks an hour", () => {
      let run = refused;
      let asks = 0;
      for (let minute = 1; minute <= 60; minute += 1) {
        run = play([[TICK, minute * MIN]], run.machine);
        const attempts = run.last.flatMap((effect) => (effect.kind === "run" ? [effect] : []));
        asks += attempts.length;
        for (const attempt of attempts) {
          run = play([[failed(attempt.attempt, NOT_A_MEMBER), minute * MIN]], run.machine);
        }
      }
      expect(asks).toBeLessThanOrEqual(12);
      expect(asks).toBeGreaterThan(0);
    });
  });

  describe("expiry and renewal", () => {
    it("renews at expiresAt − max(60 s, 10 %) while demanded, on the old token", () => {
      const hour = signedIn(60 * MIN);
      expect(scheduled(hour.effects)).toEqual([54 * MIN]);
      const renewing = play([[TICK, 54 * MIN]], hour.machine);
      expect(runs(renewing.last)).toEqual(["acquire"]);
      expect(giteaSessionToken(renewing.machine)).toBe("t1");

      const renewed = play([[acquired(2, "t2", 60 * MIN), 54 * MIN]], renewing.machine);
      expect(giteaSessionToken(renewed.machine)).toBe("t2");
      expect(scheduled(renewed.last)).toEqual([108 * MIN]);

      expect(scheduled(signedIn(5 * MIN).effects)).toEqual([4 * MIN]);
    });

    it("a failed renewal keeps the token until expiry, then goes unavailable", () => {
      const renewing = play([[TICK, 54 * MIN]], signedIn(60 * MIN).machine);
      const failedRenewal = play([[failed(2, BROKER_DOWN), 54 * MIN]], renewing.machine);
      expect(giteaSessionToken(failedRenewal.machine)).toBe("t1");
      expect(scheduled(failedRenewal.last)).toEqual([60 * MIN]);

      const expired = play([[TICK, 60 * MIN]], failedRenewal.machine);
      expect(expired.machine.phase.kind).toBe("unavailable");
      expect(giteaSessionToken(expired.machine)).toBeUndefined();
      // One failure: what was read with the token still stands.
      expect(giteaSessionView(expired.machine)).toEqual({
        signedIn: true,
        readable: false,
        login: "u-person",
        trouble: null,
      });
    });

    it("not demanded at expiry: idle, the token forgotten, acquired again on the next demand", () => {
      const quiet = play([[UNDEMAND, 1 * MIN]], signedIn(60 * MIN).machine);
      expect(runs(play([[TICK, 54 * MIN]], quiet.machine).last)).toEqual([]);
      const expired = play([[TICK, 60 * MIN]], quiet.machine);
      expect(expired.machine.phase.kind).toBe("idle");
      expect(giteaSessionToken(expired.machine)).toBeUndefined();
      expect(runs(play([[DEMAND, 61 * MIN]], expired.machine).last)).toEqual(["acquire"]);
    });

    it("a token without expiresIn waits on no timer", () => {
      const run = signedIn(undefined);
      expect(run.machine.timer).toBeNull();
      expect(giteaSessionToken(play([[TICK, 24 * 60 * MIN]], run.machine).machine)).toBe("t1");
    });

    it("a frozen tab that wakes past expiry never uses the expired token", () => {
      const quiet = play([[UNDEMAND, 1 * MIN]], signedIn(60 * MIN).machine);
      const woke = play([[{ type: "WAKE" }, 90 * MIN]], quiet.machine);
      expect(giteaSessionToken(woke.machine)).toBeUndefined();
    });
  });

  describe("a Gitea 401", () => {
    it("reacquires, keeps the session's facts, and queues requests for the new token", () => {
      const run = play([[{ type: "UNAUTHORIZED", token: "t1" }, 1 * MIN]], signedIn().machine);
      expect(run.machine.phase.kind).toBe("reacquiring");
      expect(runs(run.last)).toEqual(["acquire"]);
      expect(giteaSessionView(run.machine)).toEqual({
        signedIn: true,
        readable: true,
        login: "u-person",
        trouble: null,
      });
      expect(giteaSessionToken(run.machine)).toBeUndefined();
      expect(giteaSessionAwaitsToken(run.machine)).toBe(true);

      const back = play([[acquired(2, "t2"), 1 * MIN]], run.machine);
      expect(giteaSessionToken(back.machine)).toBe("t2");
    });

    it("whose reacquire fails keeps the facts, and after two failed acquisitions names the cause beside them", () => {
      const first = play(
        [
          [{ type: "UNAUTHORIZED", token: "t1" }, 1 * MIN],
          [failed(2, BROKER_DOWN), 1 * MIN],
        ],
        signedIn().machine,
      );
      expect(first.machine.phase.kind).toBe("unavailable");
      // The facts stand, and the view says nothing can be read meanwhile: no token to send, none
      // on its way.
      expect(giteaSessionView(first.machine)).toEqual({
        signedIn: true,
        readable: false,
        login: "u-person",
        trouble: null,
      });
      expect(giteaSessionReadable(first.machine)).toBe(false);

      // The retry's liveness check runs with the facts still up.
      const checking = play([[TICK, 1 * MIN + 10 * S]], first.machine);
      expect(giteaSessionView(checking.machine).signedIn).toBe(true);

      // Stale with the cause: a 401 never blanks what was read (§4.6).
      const second = play([[liveness(3, false), 1 * MIN + 10 * S]], checking.machine);
      expect(giteaSessionView(second.machine)).toEqual({
        signedIn: true,
        readable: false,
        login: "u-person",
        trouble: "Gitea isn't answering.",
      });
    });

    it("for a token the session no longer holds is ignored", () => {
      const reacquired = play(
        [
          [{ type: "UNAUTHORIZED", token: "t1" }, 1 * MIN],
          [acquired(2, "t2"), 1 * MIN],
        ],
        signedIn().machine,
      );
      // A request that carried t1 answers 401 after t2 arrived: t2 stays.
      const late = play([[{ type: "UNAUTHORIZED", token: "t1" }, 1 * MIN]], reacquired.machine);
      expect(late.machine.phase.kind).toBe("signed-in");
      expect(giteaSessionToken(late.machine)).toBe("t2");
      expect(late.last).toEqual([]);
    });

    it("while a renewal is in flight joins it instead of minting again", () => {
      const renewing = play([[TICK, 54 * MIN]], signedIn(60 * MIN).machine);
      const run = play([[{ type: "UNAUTHORIZED", token: "t1" }, 55 * MIN]], renewing.machine);
      expect(run.machine.phase.kind).toBe("reacquiring");
      expect(runs(run.last)).toEqual([]);
      expect(giteaSessionToken(play([[acquired(2, "t2"), 55 * MIN]], run.machine).machine)).toBe(
        "t2",
      );
    });

    it("the third in 10 minutes refuses: Gitea keeps refusing this sign-in", () => {
      const third = play(
        [
          [{ type: "UNAUTHORIZED", token: "t1" }, 1 * MIN],
          [acquired(2, "t2"), 1 * MIN],
          [{ type: "UNAUTHORIZED", token: "t2" }, 4 * MIN],
          [acquired(3, "t3"), 4 * MIN],
          [{ type: "UNAUTHORIZED", token: "t3" }, 9 * MIN],
        ],
        signedIn().machine,
      );
      expect(third.machine.phase).toMatchObject({ kind: "refused", reason: KEEPS_REFUSING });
      // A refusal is not a wait: what was read with the refused sign-in no longer stands.
      expect(giteaSessionView(third.machine)).toEqual({
        signedIn: false,
        readable: false,
        login: undefined,
        trouble: KEEPS_REFUSING,
      });
      expect(runs(third.last)).toEqual([]);

      const spread = play(
        [
          [{ type: "UNAUTHORIZED", token: "t1" }, 1 * MIN],
          [acquired(2, "t2"), 1 * MIN],
          [{ type: "UNAUTHORIZED", token: "t2" }, 6 * MIN],
          [acquired(3, "t3"), 6 * MIN],
          [{ type: "UNAUTHORIZED", token: "t3" }, 12 * MIN],
        ],
        signedIn().machine,
      );
      expect(spread.machine.phase.kind).toBe("reacquiring");
    });
  });

  describe("what the regions show", () => {
    it("names the cause only after two failed acquisitions", () => {
      const once = play([
        [DEMAND, 0],
        [failed(1, BROKER_DOWN), 0],
      ]);
      expect(giteaSessionView(once.machine)).toEqual({
        signedIn: false,
        readable: false,
        login: undefined,
        trouble: null,
      });
      const twice = play(
        [
          [TICK, 10 * S],
          [liveness(2, false), 10 * S],
        ],
        once.machine,
      );
      expect(giteaSessionView(twice.machine).trouble).toBe("Gitea isn't answering.");
      // The cause stays up while the next liveness check runs.
      expect(giteaSessionView(play([[TICK, 30 * S]], twice.machine).machine).trouble).toBe(
        "Gitea isn't answering.",
      );

      const settingUp = play([
        [DEMAND, 0],
        [failed(1, SETTING_UP), 0],
        [TICK, 5 * S],
        [liveness(2, true), 5 * S],
        [failed(2, SETTING_UP), 5 * S],
      ]);
      expect(giteaSessionView(settingUp.machine).trouble).toBe("Gitea is still setting up.");

      const zeropsDown = play([
        [DEMAND, 0],
        [failed(1, { kind: "unreachable", source: "zerops" }), 0],
        [TICK, 10 * S],
        [liveness(2, false), 10 * S],
      ]);
      expect(giteaSessionView(zeropsDown.machine).trouble).toBe("Zerops isn't answering.");
    });

    it("a refusal says its reason at once", () => {
      const run = play([
        [DEMAND, 0],
        [failed(1, NOT_A_MEMBER), 0],
      ]);
      expect(giteaSessionView(run.machine).trouble).toBe(NOT_A_MEMBER.reason);
    });

    it("a success clears the count", () => {
      const run = play([
        [DEMAND, 0],
        [failed(1, BROKER_DOWN), 0],
        [TICK, 10 * S],
        [liveness(2, true), 10 * S],
        [acquired(2, "t1"), 10 * S],
      ]);
      expect(run.machine.failures).toBe(0);
      expect(giteaSessionView(run.machine)).toEqual({
        signedIn: true,
        readable: true,
        login: "u-person",
        trouble: null,
      });
    });
  });

  describe("results and the epoch", () => {
    it("drops a result for an attempt that is not in flight", () => {
      const run = play([
        [DEMAND, 0],
        [failed(1, BROKER_DOWN), 0],
        [acquired(1, "late"), 1 * S],
      ]);
      expect(run.machine.phase.kind).toBe("unavailable");
      expect(giteaSessionToken(run.machine)).toBeUndefined();
    });

    it("closed forgets the token, and a result landing afterwards is silent", () => {
      const closing = play([
        [DEMAND, 0],
        [{ type: "CLOSE" }, 1 * S],
      ]);
      expect(closing.machine.phase.kind).toBe("closed");
      const late = play([[acquired(1, "t1"), 2 * S]], closing.machine);
      expect(late.machine).toBe(closing.machine);
      expect(late.last).toEqual([]);
      expect(giteaSessionToken(late.machine)).toBeUndefined();
      expect(giteaSessionView(late.machine)).toEqual({
        signedIn: false,
        readable: false,
        login: undefined,
        trouble: null,
      });

      const held = play([[{ type: "CLOSE" }, 1 * MIN]], signedIn(60 * MIN).machine);
      expect(giteaSessionToken(held.machine)).toBeUndefined();
      expect(held.last).toEqual([{ kind: "cancel" }]);
    });
  });
});
