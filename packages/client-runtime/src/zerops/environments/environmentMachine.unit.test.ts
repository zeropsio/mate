import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  initialEnvironment,
  transitionEnvironment,
  type EnvironmentEffect,
  type EnvironmentEvent,
  type EnvironmentGuards,
  type EnvironmentMachine,
} from "./environmentMachine.ts";
import { selectReachability } from "./reachability.ts";

const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");

/** A target the route wants, in a visible tab whose account and Zerops answer. */
const WANTED: EnvironmentGuards = {
  want: true,
  routeTarget: true,
  visible: true,
  verified: true,
  zeropsState: "live",
  budget: true,
};

interface Step {
  readonly machine: EnvironmentMachine;
  readonly effects: ReadonlyArray<EnvironmentEffect>;
  readonly nowMs: number;
}

/** Feeds events one second apart; returns the last step. */
const feed = (from: Step, events: ReadonlyArray<EnvironmentEvent>): Step => {
  let step = from;
  for (const event of events) {
    const nowMs = step.nowMs + 1_000;
    const next = transitionEnvironment(step.machine, event, {
      now: { wall: nowMs, mono: nowMs },
      random: () => 0.5,
    });
    step = { machine: next.state, effects: next.effects, nowMs };
  }
  return step;
};

/** The remembered Mate of a ready, listed container, its first exchange in flight. */
const exchanging = (): Step =>
  feed({ machine: initialEnvironment({ record: ENV_A }), effects: [], nowMs: 100_000 }, [
    { type: "GUARDS", guards: WANTED },
    { type: "CONTAINER", container: { level: "ready" } },
    { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
  ]);

const attemptOf = (machine: EnvironmentMachine): number => {
  if (machine.credential.kind !== "exchanging") throw new Error("no exchange in flight");
  return machine.credential.attempt;
};

const runs = (effects: ReadonlyArray<EnvironmentEffect>) =>
  effects.flatMap((effect) => (effect.kind === "run" ? [effect.op.kind] : []));

// witness: packages/client-runtime/src/zerops/environments/environmentMachine.ts | return retire(machine, "removed-by-user", out); → return machine;
it("EN13: An exchange answering after the person removed its Mate is never held", () => {
  const started = exchanging();
  const attempt = attemptOf(started.machine);

  const removed = feed(started, [{ type: "USER_REMOVE" }]);
  const answered = feed(removed, [
    { type: "EXCHANGE_SUCCEEDED", attempt, environmentId: ENV_A, descriptor: null },
  ]);
  expect(answered.machine.credential).toEqual({ kind: "retired", evidence: "removed-by-user" });
  expect(runs(answered.effects)).toEqual([]);
  expect(runs(removed.effects)).toEqual(["retire"]);
});

// witness: packages/client-runtime/src/zerops/environments/environmentMachine.ts | if (block.reason !== "permission" || machine.permissionRetried) → if (machine.permissionRetried)
it("EN14: HQ refusing a Mate's ticket for the person's role or for no Mate of theirs there refuses the Mate at once, with no second ticket, and asks again when their access changes, without Try again; breaks: a Read-only viewer's page asks HQ for another ticket right after its 403", () => {
  const rows = [
    { reason: "read-only", connected: false, refusal: { kind: "role" } },
    { reason: "not-found", connected: false, refusal: { kind: "not-found" } },
    { reason: "not-found", connected: true, refusal: { kind: "not-found" } },
    { reason: "permission", connected: false, refusal: null },
  ] as const;
  for (const row of rows) {
    const started = exchanging();
    const linked = feed(started, [
      {
        type: "EXCHANGE_SUCCEEDED",
        attempt: attemptOf(started.machine),
        environmentId: ENV_A,
        descriptor: null,
      },
      ...(row.connected ? [{ type: "LINK", link: { phase: "connected" } } as const] : []),
    ]);
    const blocked = feed(linked, [
      { type: "LINK", link: { phase: "blocked", reason: row.reason } },
    ]);

    if (row.refusal === null) {
      // A permission block keeps its one confirming exchange.
      expect(blocked.machine.credential.kind, row.reason).toBe("exchanging");
      expect(runs(blocked.effects), row.reason).toEqual(["exchange"]);
      continue;
    }
    expect(blocked.machine.credential, `${row.reason} connected=${row.connected}`).toEqual({
      kind: "refused",
      reason: row.refusal,
    });
    expect(runs(blocked.effects), `${row.reason} connected=${row.connected}`).toEqual([]);
    if (row.refusal.kind === "not-found") {
      expect(selectReachability(blocked.machine, ENV_A)).toEqual({
        kind: "gone",
        because: "direct-not-found",
      });
    }

    const asked = feed(blocked, [{ type: "ROLE_CHANGED" }]);
    expect(asked.machine.credential.kind, `${row.reason} connected=${row.connected}`).toBe(
      "exchanging",
    );
    expect(runs(asked.effects), `${row.reason} connected=${row.connected}`).toEqual(["exchange"]);
  }
});

// witness: packages/client-runtime/src/zerops/environments/environmentMachine.ts | return credential.kind === "backoff" → return credential.kind === "backoff" || credential.kind === "refused"
it("EN15: A definitive refusal is never retried by time, a wake, the network or a link", () => {
  const started = exchanging();
  const refused = feed(started, [
    {
      type: "EXCHANGE_FAILED",
      attempt: attemptOf(started.machine),
      failure: { class: "refusal", reason: { kind: "role" } },
      descriptor: null,
    },
  ]);
  expect(refused.machine.credential).toEqual({ kind: "refused", reason: { kind: "role" } });
  expect(refused.machine.timer).toBeNull();

  const later = { ...refused, nowMs: refused.nowMs + 60 * 60_000 };
  let step = later;
  for (const event of [
    { type: "TICK" },
    { type: "WAKE", visible: true },
    { type: "ONLINE" },
    { type: "LINK", link: { phase: "backoff", retryAtMs: null } },
    { type: "LINK", link: { phase: "connecting" } },
    { type: "CONTAINER", container: { level: "booting", overdue: false } },
    { type: "CONTAINER", container: { level: "ready" } },
  ] satisfies ReadonlyArray<EnvironmentEvent>) {
    step = feed(step, [event]);
    expect(step.machine.credential).toEqual({ kind: "refused", reason: { kind: "role" } });
    expect(runs(step.effects)).toEqual([]);
  }
});
