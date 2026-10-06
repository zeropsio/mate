import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CAPPED_RETRY_MS,
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
  it.each(["exchange", "descriptor", "backoff"] as const)(
    "losing demand ends a pending %s without losing the kept registration",
    (kind) => {
      const linked = connected();
      const pending =
        kind === "exchange"
          ? drive(linked, [{ type: "LINK", link: { phase: "blocked", reason: "authentication" } }])
              .machine
          : drive(linked, [{ type: "LINK", link: { phase: "blocked", reason: "configuration" } }])
              .machine;
      const machine = kind === "backoff" ? drive(pending, [{ type: "TICK" }]).machine : pending;
      const stopped = drive(machine, [
        { type: "GUARDS", guards: { ...GUARDS, want: false, routeTarget: false } },
      ]);
      expect(stopped.machine.record).toBe(ENV_A);
      expect(stopped.machine.timer).toBeNull();
      expect(stopped.machine.credential).toMatchObject(
        kind === "descriptor" ? { kind: "held", rereading: null } : { kind: "none" },
      );
      const blocked = drive(stopped.machine, [
        { type: "LINK", link: { phase: "blocked", reason: "configuration" } },
      ]);
      expect(blocked.effects.filter((effect) => effect.kind === "run")).toEqual([]);
      const resumed = drive(blocked.machine, [{ type: "GUARDS", guards: GUARDS }]);
      expect(resumed.effects.some((effect) => effect.kind === "run")).toBe(true);
    },
  );

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

  it.each([
    { name: "any other target's next retry is five minutes out", routeTarget: false, capped: true },
    { name: "the route's target stays on the ladder", routeTarget: true, capped: false },
  ])("after five consecutive automatic failures, $name", ({ routeTarget, capped }) => {
    let run = drive(initialEnvironment({ record: ENV_A }), [
      { type: "GUARDS", guards: { ...GUARDS, routeTarget } },
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
    if (capped) expect(retryDelays[4]).toBe(CAPPED_RETRY_MS);
    // The fifth rung, 30 s within its jitter: the route is read again in half a minute at most.
    else expect(retryDelays[4]).toBeLessThanOrEqual(36_000);
  });

  it("a Mate on the five-minute cap that becomes the route is exchanged at once", () => {
    const other = { ...GUARDS, routeTarget: false };
    let run = drive(initialEnvironment({ record: ENV_A }), [
      { type: "GUARDS", guards: other },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
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
      if (failure < 5) run = drive(run.machine, [{ type: "TICK" }], run.nowMs);
    }
    const capped = run.machine.credential;
    if (capped.kind !== "backoff") throw new Error("no backoff");
    expect(capped.retryAt.wall - run.nowMs).toBe(CAPPED_RETRY_MS);

    const opened = drive(run.machine, [{ type: "GUARDS", guards: GUARDS }], run.nowMs);
    expect(opened.machine.credential.kind).toBe("exchanging");
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

  it("a credential that keeps failing to install climbs the ladder to the cap", () => {
    let run = drive(initialEnvironment({ record: null }), [
      { type: "GUARDS", guards: { ...GUARDS, routeTarget: false } },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
    const retryDelays: Array<number> = [];
    for (let failure = 1; failure <= 5; failure += 1) {
      run = drive(
        run.machine,
        [
          {
            type: "EXCHANGE_SUCCEEDED",
            attempt: lastExchange(run.machine),
            environmentId: ENV_A,
            descriptor: null,
          },
          { type: "INSTALL_FAILED", environmentId: ENV_A },
        ],
        run.nowMs,
      );
      const credential = run.machine.credential;
      if (credential.kind !== "backoff") throw new Error("no backoff");
      retryDelays.push(credential.retryAt.wall - run.nowMs);
      run = drive(run.machine, [{ type: "TICK" }], run.nowMs);
    }
    expect(retryDelays).toEqual([2_000, 4_000, 8_000, 15_000, CAPPED_RETRY_MS]);
  });

  it("counts the failures since its link last connected, through a Try now, until it connects", () => {
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
    // Try now starts the ladder over; what failed since the link connected still stands.
    const retried = drive(once.machine, [{ type: "USER_RETRY" }], once.nowMs);
    expect(retried.machine.failuresSinceConnect).toBe(1);
    const twice = fail(retried.machine, retried.nowMs);
    expect(twice.machine.failuresSinceConnect).toBe(2);
    const again = drive(twice.machine, [{ type: "TICK" }], twice.nowMs);
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
      return drive(failed.machine, [{ type: "TICK" }], failed.nowMs);
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
      { kind: "install" },
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

  it("the ladder starts over once the registry took the credential", () => {
    const started = drive(initialEnvironment({ record: null }), [
      { type: "GUARDS", guards: GUARDS },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
    ]);
    const failed = drive(
      started.machine,
      [
        {
          type: "EXCHANGE_FAILED",
          attempt: lastExchange(started.machine),
          failure: { class: "retryable", cause: { kind: "network" } },
          descriptor: null,
        },
        { type: "TICK" },
      ],
      started.nowMs,
    );
    const held = drive(
      failed.machine,
      [
        {
          type: "EXCHANGE_SUCCEEDED",
          attempt: lastExchange(failed.machine),
          environmentId: ENV_A,
          descriptor: null,
        },
      ],
      failed.nowMs,
    ).machine;
    expect(held).toMatchObject({ credential: { kind: "held", installed: false }, failures: 1 });

    // An answer for a credential this machine no longer holds changes nothing.
    expect(drive(held, [{ type: "INSTALLED", environmentId: ENV_B }]).machine).toBe(held);

    const installed = drive(held, [{ type: "INSTALLED", environmentId: ENV_A }]).machine;
    expect(installed).toMatchObject({
      credential: { kind: "held", environmentId: ENV_A, installed: true },
      failures: 0,
      ladder: { rung: 0 },
    });
  });

  it("counts one auth rejection per rotated credential and refuses on the third within two minutes", () => {
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
    // Its freshly exchanged credentials keep being refused: a definitive answer, never retried on
    // its own — no timer, no wake; the person's Try again exchanges again.
    expect(third.machine.credential).toEqual({ kind: "refused", reason: { kind: "credential" } });
    expect(third.machine.timer).toBeNull();
    expect(selectReachability(third.machine, ENV_A)).toEqual({ kind: "refused-credential" });
    const waited = drive(third.machine, [
      { type: "TICK" },
      { type: "WAKE", visible: true },
      { type: "ONLINE" },
    ]);
    expect(waited.machine.credential.kind).toBe("refused");
    expect(drive(waited.machine, [{ type: "USER_RETRY" }]).machine.credential.kind).toBe(
      "exchanging",
    );
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

  // A9 (krok-a-hub §3): a Mate no lease holds is parked, its link closed on purpose.
  it("a link the registry parks has no drop: nothing stamped", () => {
    const parked = drive(connected(), [{ type: "LINK", link: { phase: "idle" } }]);
    expect(parked.machine.linkLostAt).toBeNull();
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
    const waited = drive(read.machine, [{ type: "TICK" }, { type: "WAKE", visible: true }]);
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
