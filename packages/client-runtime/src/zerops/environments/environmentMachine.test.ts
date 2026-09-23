import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  identityRestartOffered,
  initialEnvironment,
  transitionEnvironment,
  type DescriptorFacts,
  type EnvironmentContext,
  type EnvironmentEffect,
  type EnvironmentEvent,
  type EnvironmentGuards,
  type EnvironmentMachine,
} from "./environmentMachine.ts";
import { selectReachability } from "./reachability.ts";

const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");

const GUARDS: EnvironmentGuards = {
  want: true,
  routeTarget: true,
  visible: true,
  postGrant: true,
  identityMint: { allowed: true },
  zeropsFailing: false,
  grantVerifiedAtMs: 0,
  budget: true,
};

const at = (ms: number): EnvironmentContext => ({
  now: { wall: ms, mono: ms },
  random: () => 0.5,
});

const descriptor = (overrides: Partial<DescriptorFacts> = {}): DescriptorFacts => ({
  environmentId: ENV_A,
  serverVersion: "0.12.0",
  update: null,
  identity: "ok",
  identityCheckedAt: "2026-09-23T10:00:00.000Z",
  ...overrides,
});

interface Run {
  readonly machine: EnvironmentMachine;
  readonly effects: ReadonlyArray<EnvironmentEffect>;
  readonly nowMs: number;
}

/** Feeds events one second apart; `TICK` is delivered at the machine's own timer. */
const drive = (
  machine: EnvironmentMachine,
  events: ReadonlyArray<EnvironmentEvent>,
  startMs = 100_000,
): Run => {
  let nowMs = startMs;
  let current = machine;
  let effects: ReadonlyArray<EnvironmentEffect> = [];
  for (const event of events) {
    nowMs = event.type === "TICK" && current.timer !== null ? current.timer.wall : nowMs + 1_000;
    const next = transitionEnvironment(current, event, at(nowMs));
    current = next.state;
    effects = next.effects;
  }
  return { machine: current, effects, nowMs };
};

const lastExchange = (machine: EnvironmentMachine): number => {
  if (machine.credential.kind !== "exchanging") throw new Error("no exchange in flight");
  return machine.credential.attempt;
};

/** Connected on `ENV_A` through one exchange. */
const connected = (): EnvironmentMachine => {
  const started = drive(initialEnvironment({ record: ENV_A }), [
    { type: "GUARDS", guards: GUARDS },
    { type: "CONTAINER", container: { level: "ready" } },
    { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
  ]).machine;
  return drive(started, [
    {
      type: "EXCHANGE_SUCCEEDED",
      attempt: lastExchange(started),
      environmentId: ENV_A,
      descriptor: descriptor(),
    },
    { type: "LINK", link: { phase: "connected" } },
  ]).machine;
};

describe("environment machine (DESIGN §4.4)", () => {
  it("blocked(configuration) on a redeployed Mate re-reads the descriptor and records the replacement", () => {
    const blocked = drive(connected(), [
      { type: "LINK", link: { phase: "blocked", reason: "configuration" } },
    ]);
    expect(blocked.machine.credential).toMatchObject({ kind: "held", environmentId: ENV_A });
    const read = blocked.effects.find(
      (effect): effect is Extract<EnvironmentEffect, { kind: "run" }> =>
        effect.kind === "run" && effect.op.kind === "read-descriptor",
    );
    expect(read).toBeDefined();

    const reread = drive(blocked.machine, [
      {
        type: "DESCRIPTOR_READ",
        attempt: read!.attempt,
        result: { ok: true, descriptor: descriptor({ environmentId: ENV_B }) },
      },
    ]);
    expect(reread.machine.superseded.get(ENV_A)).toBe(ENV_B);
    expect(reread.machine.credential.kind).toBe("exchanging");
  });

  it("a configuration block during a redeploy re-reads the descriptor once the Mate is present again", () => {
    const blocked = drive(connected(), [
      { type: "PRESENCE", presence: { kind: "transitioning", status: "RESTARTING" } },
      { type: "LINK", link: { phase: "connecting" } },
      { type: "LINK", link: { phase: "blocked", reason: "configuration" } },
    ]);
    // No origin to read from while the service restarts.
    expect(blocked.effects).toEqual([]);
    const present = drive(
      blocked.machine,
      [{ type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } }],
      blocked.nowMs,
    );
    expect(present.effects).toContainEqual(
      expect.objectContaining({ kind: "run", op: { kind: "read-descriptor", origin: ORIGIN } }),
    );
    expect(selectReachability(present.machine, ENV_A)).toEqual({
      kind: "connecting",
      waitingOn: "descriptor",
    });
  });

  it("counts one auth rejection per rotated credential and backs off on the third within two minutes", () => {
    /** The link rejects the held credential; the re-exchange succeeds and installs a new one. */
    const rejectAndRotate = (machine: EnvironmentMachine, nowMs: number): Run => {
      const rejected = drive(
        machine,
        [
          { type: "LINK", link: { phase: "blocked", reason: "authentication" } },
          // The supervisor re-attempts with the stored credential on any signal: the same
          // credential is rejected again while the new one is being exchanged. Not counted.
          { type: "LINK", link: { phase: "blocked", reason: "authentication" } },
        ],
        nowMs,
      );
      expect(rejected.machine.credential).toMatchObject({ kind: "exchanging", reconnect: true });
      return drive(
        rejected.machine,
        [
          {
            type: "EXCHANGE_SUCCEEDED",
            attempt: lastExchange(rejected.machine),
            environmentId: ENV_A,
            descriptor: null,
          },
        ],
        rejected.nowMs,
      );
    };
    const first = rejectAndRotate(connected(), 200_000);
    const second = rejectAndRotate(first.machine, first.nowMs);
    const third = drive(
      second.machine,
      [{ type: "LINK", link: { phase: "blocked", reason: "authentication" } }],
      second.nowMs,
    );
    expect(third.machine.credential).toMatchObject({
      kind: "backoff",
      last: { kind: "rejected" },
      reconnect: true,
    });
    expect(third.effects).toContainEqual({
      kind: "log",
      diagnostic: { kind: "auth-loop", rejections: 3 },
    });

    // Rejections older than two minutes no longer count.
    const later = rejectAndRotate(second.machine, second.nowMs + 120_000);
    expect(later.machine.credential.kind).toBe("held");
  });

  /**
   * Restart is offered for identity `failed` only when two consecutive descriptor reads report
   * `failed` with an advancing `identityCheckedAt` AND this tab's grant is granted and fresh over
   * the same period: Zerops answered us after the Mate's key first failed.
   */
  describe("the Restart-for-identity rule", () => {
    const FIRST = "2026-09-23T10:00:00.000Z";
    const SECOND = "2026-09-23T10:00:20.000Z";
    const failedAt = (checkedAt: string) =>
      descriptor({ identity: "failed", identityCheckedAt: checkedAt });

    /** Two failed exchanges; the grant input between them decides "fresh over the period". */
    const twoFailures = (input: {
      readonly second: string;
      readonly grantBetween: Partial<EnvironmentGuards>;
    }): EnvironmentMachine => {
      const start = drive(initialEnvironment({ record: ENV_A }), [
        { type: "GUARDS", guards: GUARDS },
        { type: "CONTAINER", container: { level: "ready" } },
        { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
      ]);
      const first = drive(
        start.machine,
        [
          {
            type: "EXCHANGE_FAILED",
            attempt: lastExchange(start.machine),
            failure: { class: "retryable", cause: { kind: "identity-failed" } },
            descriptor: failedAt(FIRST),
          },
          { type: "GUARDS", guards: { ...GUARDS, ...input.grantBetween } },
          { type: "TICK" },
        ],
        start.nowMs,
      );
      return drive(
        first.machine,
        [
          {
            type: "EXCHANGE_FAILED",
            attempt: lastExchange(first.machine),
            failure: { class: "retryable", cause: { kind: "identity-failed" } },
            descriptor: failedAt(input.second),
          },
        ],
        first.nowMs,
      ).machine;
    };

    const rows: ReadonlyArray<{
      readonly name: string;
      readonly second: string;
      readonly grantBetween: (firstFailedAtMs: number) => Partial<EnvironmentGuards>;
      readonly offered: boolean;
    }> = [
      {
        name: "advancing check, grant verified after the first failure → offered",
        second: SECOND,
        grantBetween: (ms) => ({ grantVerifiedAtMs: ms + 500 }),
        offered: true,
      },
      {
        name: "the same check reported twice → not offered",
        second: FIRST,
        grantBetween: (ms) => ({ grantVerifiedAtMs: ms + 500 }),
        offered: false,
      },
      {
        name: "no grant round since the first failure (a Zerops outage) → not offered",
        second: SECOND,
        grantBetween: () => ({ grantVerifiedAtMs: 0 }),
        offered: false,
      },
    ];
    for (const row of rows) {
      it(row.name, () => {
        const machine = twoFailures({
          second: row.second,
          grantBetween: row.grantBetween(104_000),
        });
        expect(machine.credential.kind).toBe("backoff");
        expect(identityRestartOffered(machine)).toBe(row.offered);
      });
    }

    it("a grant round failing after the second failure withdraws the offer", () => {
      const machine = twoFailures({
        second: SECOND,
        grantBetween: { grantVerifiedAtMs: 104_500 },
      });
      const outage = drive(machine, [
        { type: "GUARDS", guards: { ...GUARDS, grantVerifiedAtMs: 104_500, zeropsFailing: true } },
      ]).machine;
      expect(identityRestartOffered(outage)).toBe(false);
    });
  });
});
