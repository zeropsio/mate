import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { MINIMUM_MATE_SERVER_VERSION } from "../serverCompatibility.ts";
import {
  initialEnvironment,
  transitionEnvironment,
  type DescriptorFacts,
  type EnvironmentEffect,
  type EnvironmentEvent,
  type EnvironmentMachine,
} from "./environmentMachine.ts";
import { selectReachability } from "./reachability.ts";

const ENV_A = EnvironmentId.make("env-a");

interface Step {
  readonly machine: EnvironmentMachine;
  readonly effects: ReadonlyArray<EnvironmentEffect>;
  readonly nowMs: number;
}

/** One event at `nowMs`. */
const at = (step: Step, event: EnvironmentEvent, nowMs: number): Step => {
  const next = transitionEnvironment(step.machine, event, {
    now: { wall: nowMs, mono: nowMs },
    random: () => 0.5,
  });
  return { machine: next.state, effects: next.effects, nowMs };
};

/** A wanted Mate of a ready, listed container, its exchange in flight. */
const exchanging = (): Step => {
  let step: Step = { machine: initialEnvironment({ record: ENV_A }), effects: [], nowMs: 100_000 };
  for (const event of [
    {
      type: "GUARDS",
      guards: {
        want: true,
        routeTarget: true,
        visible: true,
        verified: true,
        zeropsState: "live",
        budget: true,
      },
    },
    { type: "CONTAINER", container: { level: "ready" } },
    {
      type: "PRESENCE",
      presence: { kind: "present", origin: "https://zcp-1-abc.prg1.zerops.app" },
    },
  ] satisfies ReadonlyArray<EnvironmentEvent>) {
    step = at(step, event, step.nowMs + 1_000);
  }
  return step;
};

/** The exchange in flight refused on the server's version, judged on `descriptor`. */
const versionRefused = (step: Step, descriptor: DescriptorFacts | null): Step => {
  const credential = step.machine.credential;
  if (credential.kind !== "exchanging") throw new Error("no exchange in flight");
  return at(
    step,
    {
      type: "EXCHANGE_FAILED",
      attempt: credential.attempt,
      failure: { class: "refusal", reason: { kind: "version" } },
      descriptor,
    },
    step.nowMs + 1_000,
  );
};

/** A server below the floor; `latest` is the newest Mate its zcp installs, null when zcp says nothing. */
const below = (latest: string | null): DescriptorFacts => ({
  environmentId: ENV_A,
  serverVersion: "0.15.2",
  update:
    latest === null
      ? null
      : { installed: "0.15.2", latest, available: true, checkedAt: "2026-11-20T10:00:00Z" },
  identity: "ok",
  identityCheckedAt: null,
});

const runs = (effects: ReadonlyArray<EnvironmentEffect>) =>
  effects.flatMap((effect) => (effect.kind === "run" ? [effect.op.kind] : []));

// witness: packages/client-runtime/src/zerops/environments/reachability.ts | return machine.descriptor === null → return machine.descriptor !== null
it("EN+9: A Mate reads update-required or update-unavailable only from a descriptor it read, and with none behind a version refusal it reads again", () => {
  const upgradable = versionRefused(exchanging(), below(MINIMUM_MATE_SERVER_VERSION));
  expect(selectReachability(upgradable.machine, ENV_A)).toEqual({
    kind: "update-required",
    actual: "0.15.2",
    minimum: MINIMUM_MATE_SERVER_VERSION,
  });
  const stuck = versionRefused(exchanging(), below(null));
  expect(selectReachability(stuck.machine, ENV_A)).toEqual({ kind: "update-unavailable" });

  const unread = versionRefused(exchanging(), null);
  const verdict = selectReachability(unread.machine, ENV_A);
  expect(verdict.kind).not.toBe("update-required");
  expect(verdict.kind).not.toBe("update-unavailable");
  const credential = unread.machine.credential;
  expect(credential.kind).toBe("backoff");
  const retryAtMs = credential.kind === "backoff" ? credential.retryAt.wall : unread.nowMs;
  const again = at(unread, { type: "TICK" }, retryAtMs);
  expect(runs(again.effects)).toEqual(["exchange"]);
});
