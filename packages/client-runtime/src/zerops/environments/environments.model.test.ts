import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  initialEnvironment,
  transitionEnvironment,
  type DescriptorFacts,
  type EnvironmentEffect,
  type EnvironmentEvent,
  type EnvironmentGuards,
  type EnvironmentMachine,
} from "./environmentMachine.ts";
import { isTerminalReachability, selectReachability } from "./reachability.ts";
import type { Instant } from "../data/access/grant.ts";
import { explore } from "../testing/explore.ts";

/**
 * DESIGN §11.3 I5, I7 and I9's reachability half over every event sequence the driver can send one target, breadth first
 * to depth 6, deduplicated by state. Time stands still between events and jumps to the machine's
 * own timer on `TICK`, so a state's instants stay few and the layers stay bounded. An answer is
 * sent for the attempt in flight and for the one before it (a late, superseded answer).
 */
const DEPTH = 6;
const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");

const GRANTED: EnvironmentGuards = {
  want: true,
  routeTarget: false,
  visible: true,
  postGrant: true,
  identityMint: { allowed: true },
  zeropsFailing: false,
  grantVerifiedAtMs: 0,
  budget: true,
};

const GUARD_VARIANTS: ReadonlyArray<EnvironmentGuards> = [
  GRANTED,
  { ...GRANTED, want: false },
  { ...GRANTED, visible: false },
  { ...GRANTED, postGrant: false },
  { ...GRANTED, identityMint: { allowed: false, reason: "access-lapsed", waitable: true } },
  { ...GRANTED, identityMint: { allowed: false, reason: "epoch-closed", waitable: false } },
  { ...GRANTED, zeropsFailing: true },
  { ...GRANTED, budget: false },
];

const descriptor = (overrides: Partial<DescriptorFacts> = {}): DescriptorFacts => ({
  environmentId: ENV_A,
  serverVersion: "0.12.0",
  update: null,
  identity: "ok",
  identityCheckedAt: "2026-09-23T10:00:00.000Z",
  ...overrides,
});

const INPUTS: ReadonlyArray<EnvironmentEvent> = [
  ...GUARD_VARIANTS.map((guards): EnvironmentEvent => ({ type: "GUARDS", guards })),
  { type: "PRESENCE", presence: { kind: "unknown" } },
  { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
  { type: "PRESENCE", presence: { kind: "transitioning", status: "RESTARTING" } },
  { type: "PRESENCE", presence: { kind: "no-origin", reason: "subdomain-off" } },
  { type: "PRESENCE", presence: { kind: "gone", evidence: "direct-not-found" } },
  { type: "CONTAINER", container: { level: "unknown" } },
  { type: "CONTAINER", container: { level: "ready" } },
  { type: "CONTAINER", container: { level: "booting", overdue: false } },
  { type: "CONTAINER", container: { level: "restarting", by: "platform", overdue: false } },
  { type: "CONTAINER", container: { level: "inactive", status: "STOPPED" } },
  { type: "LINK", link: { phase: "idle" } },
  { type: "LINK", link: { phase: "connecting" } },
  { type: "LINK", link: { phase: "connected" } },
  { type: "LINK", link: { phase: "backoff", retryAtMs: null } },
  { type: "LINK", link: { phase: "blocked", reason: "authentication" } },
  { type: "LINK", link: { phase: "blocked", reason: "configuration" } },
  { type: "LINK", link: { phase: "blocked", reason: "permission" } },
  { type: "LINK", link: { phase: "blocked", reason: "unsupported" } },
  { type: "DESCRIPTOR", descriptor: descriptor() },
  { type: "DESCRIPTOR", descriptor: descriptor({ environmentId: ENV_B, serverVersion: "0.13.0" }) },
  {
    type: "DESCRIPTOR",
    descriptor: descriptor({ identity: "failed", identityCheckedAt: "2026-09-23T10:01:00.000Z" }),
  },
  { type: "INSTALLED", environmentId: ENV_A },
  { type: "INSTALL_FAILED", environmentId: ENV_A },
  { type: "ROLE_CHANGED" },
  { type: "TICK" },
  { type: "WAKE", visible: true },
  { type: "ONLINE" },
  { type: "USER_RETRY" },
  { type: "USER_REMOVE" },
];

const answers = (attempt: number): ReadonlyArray<EnvironmentEvent> => [
  { type: "EXCHANGE_SUCCEEDED", attempt, environmentId: ENV_A, descriptor: descriptor() },
  { type: "EXCHANGE_SUCCEEDED", attempt, environmentId: ENV_B, descriptor: null },
  {
    type: "EXCHANGE_FAILED",
    attempt,
    failure: { class: "retryable", cause: { kind: "network" } },
    descriptor: null,
  },
  {
    type: "EXCHANGE_FAILED",
    attempt,
    failure: { class: "retryable", cause: { kind: "identity-failed" } },
    descriptor: descriptor({ identity: "failed", identityCheckedAt: "2026-09-23T10:02:00.000Z" }),
  },
  {
    type: "EXCHANGE_FAILED",
    attempt,
    failure: { class: "refusal", reason: { kind: "role" } },
    descriptor: null,
  },
  {
    type: "EXCHANGE_FAILED",
    attempt,
    failure: { class: "refusal", reason: { kind: "project-mismatch" } },
    descriptor: null,
  },
  {
    type: "EXCHANGE_FAILED",
    attempt,
    failure: { class: "refusal", reason: { kind: "version" } },
    descriptor: null,
  },
  { type: "DESCRIPTOR_READ", attempt, result: { ok: true, descriptor: descriptor() } },
  {
    type: "DESCRIPTOR_READ",
    attempt,
    result: { ok: true, descriptor: descriptor({ environmentId: ENV_B }) },
  },
  { type: "DESCRIPTOR_READ", attempt, result: { ok: false } },
];

interface ModelState {
  readonly machine: EnvironmentMachine;
  readonly nowMs: number;
}

const eventsFrom = (state: ModelState): ReadonlyArray<EnvironmentEvent> => {
  const last = state.machine.nextAttempt - 1;
  return last < 1 ? INPUTS : [...INPUTS, ...answers(last), ...answers(last - 1)];
};

const step = (
  state: ModelState,
  event: EnvironmentEvent,
): { readonly state: ModelState; readonly effects: ReadonlyArray<EnvironmentEffect> } => {
  const timer = state.machine.timer;
  const nowMs =
    event.type === "TICK" && timer !== null ? Math.max(state.nowMs, timer.wall) : state.nowMs;
  const next = transitionEnvironment(state.machine, event, {
    now: { wall: nowMs, mono: nowMs },
    random: () => 0.5,
  });
  return {
    state:
      next.state === state.machine && nowMs === state.nowMs
        ? state
        : { machine: next.state, nowMs },
    effects: next.effects,
  };
};

/**
 * Two states share a key when they differ only by a shift of the clock and of the attempt
 * counter: the machine compares instants only with each other and with `now`, and an op's
 * `attempt` only for equality, so every sequence from one checks as it does from the other. The
 * counter itself is keyed only as whether an attempt has run, since `eventsFrom` answers the last
 * two attempts only then. The guards' grant stamp stays absolute: 0 precedes every instant the
 * model reaches, so no shift reorders it.
 */
const keyOf = ({ machine, nowMs }: ModelState): string =>
  JSON.stringify(machine, (key, value: unknown) => {
    if (typeof value === "number") {
      switch (key) {
        case "nextAttempt":
          return value > 1;
        case "attempt":
          return machine.nextAttempt - value;
        case "sinceMs":
          return value - nowMs;
        default:
          return value;
      }
    }
    if (typeof value !== "object" || value === null) return value;
    if (value instanceof Map) return [...value.entries()];
    if ("wall" in value && "mono" in value) {
      const instant = value as Instant;
      return [instant.wall - nowMs, instant.mono - nowMs];
    }
    if (key === "authRejections") return (value as ReadonlyArray<number>).map((at) => at - nowMs);
    return value;
  });

/** Every violation of I5, I7 and I9 in one transition, as readable strings. */
const violations = (
  before: ModelState,
  effects: ReadonlyArray<EnvironmentEffect>,
  after: ModelState,
): ReadonlyArray<string> => {
  const found: Array<string> = [];
  const machine = after.machine;
  const credential = machine.credential;
  const exchanges = effects.filter(
    (effect): effect is Extract<EnvironmentEffect, { kind: "run" }> =>
      effect.kind === "run" && effect.op.kind === "exchange",
  );
  // I5: at most one exchange at a time, and none while P ≠ present, before the first grant, or
  // while `identityMint` is not allowed.
  if (exchanges.length > 1) found.push(`I5: ${exchanges.length} exchanges in one step`);
  for (const exchange of exchanges) {
    if (credential.kind !== "exchanging" || credential.attempt !== exchange.attempt) {
      found.push("I5: an exchange runs that the machine does not track");
    }
    if (
      before.machine.credential.kind === "exchanging" &&
      before.machine.credential.attempt !== exchange.attempt &&
      !(before.machine.timer !== null && after.nowMs >= before.machine.timer.wall)
    ) {
      found.push("I5: a second exchange started before the first ended");
    }
    if (machine.presence.kind !== "present") found.push("I5: exchange while P ≠ present");
    if (!machine.guards.postGrant) found.push("I5: exchange before the first grant");
    if (!machine.guards.identityMint.allowed) found.push("I5: exchange while identityMint refuses");
  }
  // I7: every non-terminal state has a timer or waits on a named input or the user.
  const due =
    credential.kind === "exchanging"
      ? credential.deadline
      : credential.kind === "backoff"
        ? credential.retryAt
        : credential.kind === "held"
          ? (credential.rereading?.deadline ?? null)
          : null;
  if (JSON.stringify(due) !== JSON.stringify(machine.timer)) {
    found.push(
      `I7: ${credential.kind} due ${JSON.stringify(due)}, timer ${JSON.stringify(machine.timer)}`,
    );
  }
  if (credential.kind === "none" && machine.guards.want) {
    found.push("I7: a wanted target idles in none");
  }
  if (credential.kind === "waiting") {
    if (!machine.guards.want) found.push("I7: waiting on an exchange nobody wants");
    // A waiting credential is a fixed point of its inputs: re-sending them starts nothing.
    const again = transitionEnvironment(
      machine,
      { type: "GUARDS", guards: machine.guards },
      { now: { wall: after.nowMs, mono: after.nowMs }, random: () => 0.5 },
    );
    if (JSON.stringify(again.state.credential) !== JSON.stringify(credential)) {
      found.push(`I7: waiting(${credential.on}) was stranded; its inputs already allow more`);
    }
  }
  // A held credential behind a blocked link: the block is being re-read, its re-read waits on
  // presence, or the block predates the credential and installing it retries the link.
  if (
    credential.kind === "held" &&
    machine.link.phase === "blocked" &&
    credential.rereading === null &&
    !credential.staleBlock
  ) {
    const reason = machine.link.reason;
    const needsRead =
      reason === "configuration" || (reason === "unsupported" && machine.descriptor === null);
    if (!needsRead || machine.presence.kind === "present") {
      found.push(`I7: held behind blocked(${reason}) with nothing in flight`);
    }
  }
  // I9: a terminal verdict only with its evidence; K held ∧ L connected ∧ C ≠ inactive ⇒ ready.
  for (const asked of [ENV_A, ENV_B]) {
    const verdict = selectReachability(machine, asked);
    const superseded = machine.superseded.has(asked);
    if (isTerminalReachability(verdict)) {
      const evidenced =
        verdict.kind === "gone"
          ? machine.presence.kind === "gone" || credential.kind === "retired"
          : verdict.kind === "replaced"
            ? superseded
            : verdict.kind === "refused-role"
              ? credential.kind === "refused" && credential.reason.kind === "role"
              : credential.kind === "refused" &&
                credential.reason.kind === "version" &&
                machine.descriptor !== null;
      if (!evidenced) found.push(`I9: terminal ${verdict.kind} for ${asked} without evidence`);
    }
    if (
      credential.kind === "held" &&
      machine.link.phase === "connected" &&
      machine.container.level !== "inactive" &&
      machine.presence.kind !== "gone" &&
      !superseded &&
      verdict.kind !== "ready"
    ) {
      found.push(`I9: held, connected and not inactive, yet ${verdict.kind} for ${asked}`);
    }
  }
  return found;
};

describe("environment invariants (DESIGN §11.3 I5, I7, I9) over enumerated event sequences", () => {
  it(`holds for every sequence to depth ${DEPTH}`, { timeout: 30_000 }, () => {
    const report = explore({
      roots: [{ machine: initialEnvironment({ record: ENV_A }), nowMs: 100_000 }],
      depth: DEPTH,
      events: eventsFrom,
      step,
      key: keyOf,
      check: (before, _event, { state: after, effects }) => violations(before, effects, after),
    });
    expect(report.violations.slice(0, 3)).toEqual([]);
    expect(report.transitions).toBeGreaterThan(10_000);
  });
});
