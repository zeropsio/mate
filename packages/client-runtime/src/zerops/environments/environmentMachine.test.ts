import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  identityRestartOffered,
  initialEnvironment,
  transitionEnvironment,
  type ContainerVerdict,
  type DescriptorFacts,
  type EnvironmentContext,
  type EnvironmentEffect,
  type EnvironmentEvent,
  type EnvironmentGuards,
  type EnvironmentMachine,
  type ExchangeCause,
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
  it("keeps a failed attempt terminal through lease, access, wake and container changes", () => {
    const start = drive(initialEnvironment({ record: null }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
    const failed = drive(start.machine, [
      {
        type: "EXCHANGE_FAILED",
        attempt: lastExchange(start.machine),
        failure: { class: "retryable", cause: { kind: "network" } },
        descriptor: null,
      },
    ]);
    expect(failed.machine.credential).toMatchObject({ kind: "failed", last: { kind: "network" } });
    expect(failed.machine.timer).toBeNull();
    const events: ReadonlyArray<EnvironmentEvent> = [
      { type: "TICK" },

      { type: "GUARDS", guards: { ...GUARDS, want: false } },
      { type: "GUARDS", guards: GUARDS },

      { type: "CONTAINER", container: { level: "booting", overdue: false } },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "transitioning", status: "RESTARTING" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ];
    let machine = failed.machine;
    for (const event of events) {
      const next = drive(machine, [event]);
      expect(next.machine.credential.kind).toBe("failed");
      expect(next.effects.filter((effect) => effect.kind === "run")).toEqual([]);
      machine = next.machine;
    }
    const again = drive(machine, [{ type: "USER_RETRY" }]);
    expect(
      again.effects.filter((effect) => effect.kind === "run" && effect.op.kind === "exchange"),
    ).toHaveLength(1);
  });

  it("a new published endpoint originates one attempt after failure", () => {
    const start = drive(initialEnvironment({ record: null }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
    const failed = drive(start.machine, [
      {
        type: "EXCHANGE_FAILED",
        attempt: lastExchange(start.machine),
        failure: { class: "retryable", cause: { kind: "network" } },
        descriptor: null,
      },
    ]);
    const moved = drive(failed.machine, [
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN + "/new" } },
    ]);
    expect(moved.machine.credential.kind).toBe("exchanging");
    const ended = drive(moved.machine, [
      {
        type: "EXCHANGE_FAILED",
        attempt: lastExchange(moved.machine),
        failure: { class: "retryable", cause: { kind: "network" } },
        descriptor: null,
      },
    ]);
    expect(ended.machine.credential.kind).toBe("failed");
    expect(drive(ended.machine, [{ type: "TICK" }]).machine.credential.kind).toBe("failed");
  });

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

  it.each(["authentication", "permission", "read-only"] as const)(
    "a %s block ends visibly without another exchange",
    (reason) => {
      const blocked = drive(connected(), [{ type: "LINK", link: { phase: "blocked", reason } }]);
      expect(blocked.machine.credential).toMatchObject(
        reason === "authentication"
          ? { kind: "failed", stage: "exchange", last: { kind: "rejected" } }
          : { kind: "refused", reason: { kind: "role" } },
      );
      expect(
        blocked.effects.filter((effect) => effect.kind === "run" && effect.op.kind === "exchange"),
      ).toEqual([]);
      const repeated = drive(blocked.machine, [
        { type: "LINK", link: { phase: "blocked", reason } },
      ]);
      expect(repeated.machine.credential).toEqual(blocked.machine.credential);
    },
  );

  it("a configuration block with the same descriptor refuses once without minting", () => {
    const blocked = drive(connected(), [
      { type: "LINK", link: { phase: "blocked", reason: "configuration" } },
    ]);
    const read = blocked.effects.find(
      (effect) => effect.kind === "run" && effect.op.kind === "read-descriptor",
    );
    if (read?.kind !== "run") throw new Error("no descriptor read");
    const ended = drive(blocked.machine, [
      {
        type: "DESCRIPTOR_READ",
        attempt: read.attempt,
        result: { ok: true, descriptor: descriptor() },
      },
    ]);
    expect(ended.machine.credential).toEqual({
      kind: "refused",
      reason: { kind: "configuration" },
    });
    expect(ended.effects.filter((effect) => effect.kind === "run")).toEqual([]);
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

  it("a failed install ends until Connect again", () => {
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
    expect(failed.machine.credential).toMatchObject({ kind: "failed", last: { kind: "install" } });
    expect(failed.machine.failuresSinceConnect).toBe(1);
    expect(selectReachability(failed.machine, null)).toMatchObject({
      kind: "failed",
      last: { kind: "install" },
    });

    const retried = drive(failed.machine, [{ type: "USER_RETRY" }], failed.nowMs);
    expect(retried.machine.credential.kind).toBe("exchanging");
  });

  it("counts the failures since its link last connected, through Connect again, until it connects", () => {
    const fail = (machine: EnvironmentMachine, nowMs: number) =>
      drive(
        machine,
        [
          {
            type: "EXCHANGE_FAILED",
            attempt: lastExchange(machine),
            failure: { class: "retryable", cause: { kind: "network" } },
            descriptor: null,
          },
        ],
        nowMs,
      );
    const started = drive(initialEnvironment({ record: null }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
    expect(started.machine.failuresSinceConnect).toBe(0);
    const once = fail(started.machine, started.nowMs);
    expect(once.machine.failuresSinceConnect).toBe(1);
    // Connect again starts one attempt; the earlier failures still stand.
    const retried = drive(once.machine, [{ type: "USER_RETRY" }], once.nowMs);
    expect(retried.machine.failuresSinceConnect).toBe(1);
    const twice = fail(retried.machine, retried.nowMs);
    expect(twice.machine.failuresSinceConnect).toBe(2);
    const again = drive(twice.machine, [{ type: "USER_RETRY" }], twice.nowMs);
    const held = drive(
      again.machine,
      [
        {
          type: "EXCHANGE_SUCCEEDED",
          attempt: lastExchange(again.machine),
          environmentId: ENV_A,
          descriptor: null,
        },
        { type: "INSTALLED", environmentId: ENV_A },
      ],
      again.nowMs,
    );
    expect(held.machine.failuresSinceConnect).toBe(2);
    const linked = drive(
      held.machine,
      [{ type: "LINK", link: { phase: "connected" } }],
      held.nowMs,
    );
    expect(linked.machine.failuresSinceConnect).toBe(0);
  });

  // Review, pass 34: a server that answered with an error is not one still starting. Of the
  // failures since its link connected, those its server answered are counted apart, whatever the
  // link is doing between them.
  it("counts apart the failures its server answered", () => {
    const fail = (machine: EnvironmentMachine, nowMs: number, cause: ExchangeCause) => {
      const failed = drive(
        machine,
        [
          {
            type: "EXCHANGE_FAILED",
            attempt: lastExchange(machine),
            failure: { class: "retryable", cause },
            descriptor: null,
          },
        ],
        nowMs,
      );
      return drive(failed.machine, [{ type: "USER_RETRY" }], failed.nowMs);
    };
    const started = drive(initialEnvironment({ record: null }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
    const causes: ReadonlyArray<ExchangeCause> = [
      { kind: "network" },
      { kind: "server", status: 502 },
      { kind: "timeout" },
      { kind: "rejected" },
      { kind: "descriptor-unreachable" },
    ];
    let run = started;
    for (const cause of causes) run = fail(run.machine, run.nowMs, cause);
    expect(run.machine.failuresSinceConnect).toBe(5);
    expect(run.machine.errorsSinceConnect).toBe(2);
  });

  it("remembers its container was found ready, through a boot that follows", () => {
    const seen = (containers: ReadonlyArray<ContainerVerdict>) =>
      drive(
        initialEnvironment({ record: null }),
        containers.map((container) => ({ type: "CONTAINER", container }) as const),
      ).machine.readySeen;
    const booting = { level: "booting", overdue: false } as const;
    expect(seen([booting])).toBe(false);
    expect(seen([booting, { level: "ready" }])).toBe(true);
    expect(seen([booting, { level: "ready" }, booting])).toBe(true);
  });

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
          { type: "USER_RETRY" },
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
        expect(machine.credential.kind).toBe("failed");
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

// DESIGN §9 C1b bounds a conversation shown without verified access by the moment its link dropped.
describe("the link's drop (C1b)", () => {
  it("a link that stops being connected is stamped with the moment it dropped", () => {
    const live = connected();
    expect(live.linkLostAt).toBeNull();

    const dropped = drive(live, [{ type: "LINK", link: { phase: "backoff", retryAtMs: null } }]);
    const lostAt = { wall: dropped.nowMs, mono: dropped.nowMs };
    expect(dropped.machine.linkLostAt).toEqual(lostAt);

    // Still down, whatever it says next: the drop keeps its first moment.
    const reconnecting = drive(dropped.machine, [
      { type: "LINK", link: { phase: "connecting" } },
      { type: "LINK", link: { phase: "offline" } },
    ]);
    expect(reconnecting.machine.linkLostAt).toEqual(lostAt);

    const back = drive(reconnecting.machine, [{ type: "LINK", link: { phase: "connected" } }]);
    expect(back.machine.linkLostAt).toBeNull();
  });

  // A drop is a question for the platform (the owner, 2026-09-30: Quinn's banner said
  // Reconnecting through a whole restart): the inventory is read again at once, so a restart
  // the platform reports reads as one within a read's time, not whenever a push arrives.
  it.each([
    { case: "a live link that drops asks the platform", from: "connected", asks: 1 },
    { case: "a link still down asks nothing more", from: "dropped", asks: 0 },
  ])("$case", ({ from, asks }) => {
    const live = connected();
    const start =
      from === "connected"
        ? live
        : drive(live, [{ type: "LINK", link: { phase: "backoff", retryAtMs: null } }]).machine;
    const next = drive(start, [{ type: "LINK", link: { phase: "connecting" } }]);
    const refreshes = next.effects.filter(
      (effect) => effect.kind === "run" && effect.op.kind === "refresh-presence",
    );
    expect(refreshes).toHaveLength(asks);
  });

  // A9 (krok-a-hub §3): a Mate no lease holds is parked, its link closed on purpose.
  it("a link the registry parks has no drop: nothing stamped, nothing asked", () => {
    const parked = drive(connected(), [{ type: "LINK", link: { phase: "idle" } }]);
    expect(parked.machine.linkLostAt).toBeNull();
    expect(
      parked.effects.filter(
        (effect) => effect.kind === "run" && effect.op.kind === "refresh-presence",
      ),
    ).toEqual([]);
  });

  it("a link that never connected has no drop", () => {
    const never = drive(initialEnvironment({ record: ENV_A }), [
      { type: "LINK", link: { phase: "connecting" } },
      { type: "LINK", link: { phase: "backoff", retryAtMs: null } },
    ]);
    expect(never.machine.linkLostAt).toBeNull();
  });
});

// DESIGN A16: a target a record names is probed at the recorded origin before its project's
// services are read, and exchanged there only when that Mate is the one the record names.
describe("a remembered target (A16)", () => {
  const REMEMBERED = { kind: "remembered", origin: ORIGIN } as const;

  /** A remembered, wanted target, after the descriptor probe it starts has been sent. */
  const probing = (): Run =>
    drive(initialEnvironment({ record: ENV_A }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "PRESENCE", presence: REMEMBERED },
    ]);

  const probeOf = (run: Run): Extract<EnvironmentEffect, { kind: "run" }> => {
    const read = run.effects.find(
      (effect): effect is Extract<EnvironmentEffect, { kind: "run" }> =>
        effect.kind === "run" && effect.op.kind === "read-descriptor",
    );
    if (read === undefined) throw new Error("no descriptor probe");
    return read;
  };

  it("a remembered target whose descriptor names another environment waits for presence", () => {
    const started = probing();
    const read = drive(
      started.machine,
      [
        {
          type: "DESCRIPTOR_READ",
          attempt: probeOf(started).attempt,
          result: { ok: true, descriptor: descriptor({ environmentId: ENV_B }) },
        },
      ],
      started.nowMs,
    );

    expect(read.effects.some((effect) => effect.kind === "run")).toBe(false);
    expect(read.machine.credential).toEqual({ kind: "waiting", on: "presence", reconnect: false });
    // Only the services read moves it: time and wakes do not.
    const waited = drive(read.machine, [{ type: "TICK" }]);
    expect(waited.machine.credential.kind).toBe("waiting");
    const listed = drive(waited.machine, [
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
    expect(listed.effects).toContainEqual(
      expect.objectContaining({
        kind: "run",
        op: { kind: "exchange", origin: ORIGIN, expected: ENV_A },
      }),
    );
  });

  it("a probe at an origin the presence moved from is dropped at once, and the Mate is exchanged where it is listed", () => {
    const moved = "https://zcp-2-abc.prg1.zerops.app";
    const started = probing();
    const listed = drive(
      started.machine,
      [{ type: "PRESENCE", presence: { kind: "present", origin: moved } }],
      started.nowMs,
    );

    // The move is judged in its own step: nothing waits for the recorded origin's answer.
    expect(listed.effects).toContainEqual(
      expect.objectContaining({
        kind: "run",
        op: { kind: "exchange", origin: moved, expected: ENV_A },
      }),
    );

    const read = drive(
      listed.machine,
      [
        {
          type: "DESCRIPTOR_READ",
          attempt: probeOf(started).attempt,
          result: { ok: true, descriptor: descriptor({ environmentId: ENV_A }) },
        },
      ],
      listed.nowMs,
    );

    // The server at the recorded origin says nothing of the Mate listed elsewhere.
    expect(read.machine.descriptor).toBeNull();
    expect(read.machine.identityAnswered).toBe(false);
    expect(read.machine.credential).toEqual(listed.machine.credential);
    expect(read.effects).toContainEqual({
      kind: "log",
      diagnostic: { kind: "stale-result", attempt: probeOf(started).attempt },
    });
  });

  it("a probe whose Mate is no longer remembered anywhere is dropped at once, and waits for presence", () => {
    const started = probing();
    const unknown = drive(
      started.machine,
      [{ type: "PRESENCE", presence: { kind: "unknown" } }],
      started.nowMs,
    );

    expect(unknown.machine.credential).toEqual({
      kind: "waiting",
      on: "presence",
      reconnect: false,
    });
  });
});
