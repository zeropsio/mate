import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CAPPED_RETRY_MS,
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

  it("a configuration block the descriptor does not explain stops minting after three rounds", () => {
    /** Blocked(configuration), the re-read shows the same environment, the re-exchange lands. */
    const blockRereadAndRotate = (machine: EnvironmentMachine): Run => {
      const blocked = drive(machine, [
        { type: "LINK", link: { phase: "blocked", reason: "configuration" } },
      ]);
      const read = blocked.effects.find(
        (effect): effect is Extract<EnvironmentEffect, { kind: "run" }> =>
          effect.kind === "run" && effect.op.kind === "read-descriptor",
      );
      if (read === undefined) throw new Error("no descriptor re-read");
      return drive(
        blocked.machine,
        [
          {
            type: "DESCRIPTOR_READ",
            attempt: read.attempt,
            result: { ok: true, descriptor: descriptor() },
          },
        ],
        blocked.nowMs,
      );
    };
    const rotate = (run: Run): EnvironmentMachine =>
      drive(
        run.machine,
        [
          {
            type: "EXCHANGE_SUCCEEDED",
            attempt: lastExchange(run.machine),
            environmentId: ENV_A,
            descriptor: null,
          },
        ],
        run.nowMs,
      ).machine;

    const first = blockRereadAndRotate(connected());
    expect(first.machine.credential.kind).toBe("exchanging");
    const second = blockRereadAndRotate(rotate(first));
    expect(second.machine.credential.kind).toBe("exchanging");
    const third = blockRereadAndRotate(rotate(second));
    expect(third.machine.credential).toEqual({
      kind: "refused",
      reason: { kind: "configuration" },
    });
    expect(third.effects).toContainEqual({
      kind: "log",
      diagnostic: { kind: "configuration-loop", blocks: 3 },
    });
    expect(selectReachability(third.machine, ENV_A)).toEqual({ kind: "refused-configuration" });

    // Nothing but an input change leaves it: time passes and wakes arrive, and no exchange starts.
    const waited = drive(third.machine, [
      { type: "TICK" },
      { type: "WAKE", visible: true },
      { type: "ONLINE" },
    ]);
    expect(waited.machine.credential.kind).toBe("refused");
    const retried = drive(waited.machine, [{ type: "USER_RETRY" }]);
    expect(retried.machine.credential.kind).toBe("exchanging");
  });

  it("a connect between configuration blocks starts the count over", () => {
    let machine = connected();
    for (let round = 0; round < 5; round += 1) {
      const blocked = drive(machine, [
        { type: "LINK", link: { phase: "blocked", reason: "configuration" } },
      ]);
      const read = blocked.effects.find(
        (effect): effect is Extract<EnvironmentEffect, { kind: "run" }> =>
          effect.kind === "run" && effect.op.kind === "read-descriptor",
      );
      if (read === undefined) throw new Error("no descriptor re-read");
      const reread = drive(blocked.machine, [
        {
          type: "DESCRIPTOR_READ",
          attempt: read.attempt,
          result: { ok: true, descriptor: descriptor() },
        },
      ]).machine;
      machine = drive(reread, [
        {
          type: "EXCHANGE_SUCCEEDED",
          attempt: lastExchange(reread),
          environmentId: ENV_A,
          descriptor: null,
        },
        { type: "LINK", link: { phase: "connecting" } },
        { type: "LINK", link: { phase: "connected" } },
      ]).machine;
      expect(machine.credential.kind).toBe("held");
    }
  });

  it("after a role change, the first permission block re-exchanges once before refusing the role", () => {
    const blockAndRotate = (machine: EnvironmentMachine): EnvironmentMachine => {
      const blocked = drive(machine, [
        { type: "LINK", link: { phase: "blocked", reason: "permission" } },
      ]).machine;
      expect(blocked.credential).toMatchObject({ kind: "exchanging", reconnect: true });
      return drive(blocked, [
        {
          type: "EXCHANGE_SUCCEEDED",
          attempt: lastExchange(blocked),
          environmentId: ENV_A,
          descriptor: null,
        },
      ]).machine;
    };
    const refused = drive(blockAndRotate(connected()), [
      { type: "LINK", link: { phase: "blocked", reason: "permission" } },
    ]).machine;
    expect(refused.credential).toEqual({ kind: "refused", reason: { kind: "role" } });

    const raised = drive(refused, [{ type: "ROLE_CHANGED" }]).machine;
    const rotated = drive(raised, [
      {
        type: "EXCHANGE_SUCCEEDED",
        attempt: lastExchange(raised),
        environmentId: ENV_A,
        descriptor: null,
      },
    ]).machine;
    // The server re-checks roles on a timer: its first verdict on the raised role may be stale.
    expect(blockAndRotate(rotated).credential.kind).toBe("held");
  });

  it("after five consecutive automatic failures the next retry is five minutes out", () => {
    let run = drive(initialEnvironment({ record: ENV_A }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
    const retryDelays: Array<number> = [];
    for (let failure = 1; failure <= 5; failure += 1) {
      run = drive(
        run.machine,
        [
          {
            type: "EXCHANGE_FAILED",
            attempt: lastExchange(run.machine),
            failure: { class: "retryable", cause: { kind: "network" } },
            descriptor: null,
          },
        ],
        run.nowMs,
      );
      const credential = run.machine.credential;
      if (credential.kind !== "backoff") throw new Error("no backoff");
      retryDelays.push(credential.retryAt.wall - run.nowMs);
      run = drive(run.machine, [{ type: "TICK" }], run.nowMs);
    }
    expect(retryDelays.slice(0, 4).every((delay) => delay < CAPPED_RETRY_MS)).toBe(true);
    expect(retryDelays[4]).toBe(CAPPED_RETRY_MS);
  });

  it("an exchange that answers after the user removed the Mate is logged stale and never held", () => {
    const exchanging = drive(initialEnvironment({ record: ENV_A }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]).machine;
    const attempt = lastExchange(exchanging);
    const removed = drive(exchanging, [
      { type: "USER_REMOVE" },
      { type: "EXCHANGE_SUCCEEDED", attempt, environmentId: ENV_A, descriptor: null },
    ]);
    expect(removed.machine.credential).toEqual({ kind: "retired", evidence: "removed-by-user" });
    expect(removed.effects).toEqual([
      { kind: "log", diagnostic: { kind: "stale-result", attempt } },
    ]);
  });

  it("a credential this tab could not install backs off and is exchanged again", () => {
    const exchanging = drive(initialEnvironment({ record: null }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]).machine;
    const held = drive(exchanging, [
      {
        type: "EXCHANGE_SUCCEEDED",
        attempt: lastExchange(exchanging),
        environmentId: ENV_A,
        descriptor: descriptor(),
      },
    ]).machine;

    // A failure for a credential this machine no longer holds changes nothing.
    expect(
      drive(held, [{ type: "INSTALL_FAILED", environmentId: ENV_B }]).machine.credential,
    ).toMatchObject({ kind: "held", environmentId: ENV_A });

    const failed = drive(held, [{ type: "INSTALL_FAILED", environmentId: ENV_A }]);
    expect(failed.machine.credential).toMatchObject({ kind: "backoff", last: { kind: "install" } });
    expect(failed.machine.failures).toBe(1);
    expect(selectReachability(failed.machine, null)).toMatchObject({
      kind: "retrying",
      last: { kind: "install" },
    });

    const retried = drive(failed.machine, [{ type: "TICK" }], failed.nowMs);
    expect(retried.machine.credential.kind).toBe("exchanging");
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
