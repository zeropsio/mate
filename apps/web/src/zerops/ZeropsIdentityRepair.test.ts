import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  ConnectionTransientError,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import {
  makeExchangeDriver,
  type ExchangeClock,
  type ExchangeDriver,
} from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { linkPhaseOf } from "./ZeropsIdentityRepair";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const ORIGIN = "https://zcp-1-8080.prg1.zerops.app";
const KEY = "project-1:zcp";

function connectionState(
  phase: SupervisorConnectionState["phase"],
  lastFailure: SupervisorConnectionState["lastFailure"] = null,
  attempt = 1,
): SupervisorConnectionState {
  return {
    desired: true,
    network: "online",
    phase,
    stage: null,
    attempt,
    generation: 1,
    lastFailure,
    retryAt: phase === "backoff" ? 1_000 : null,
  };
}

const rejected = (attempt: number) =>
  connectionState(
    "blocked",
    new ConnectionBlockedError({
      reason: "authentication",
      detail: "The environment credential is invalid.",
    }),
    attempt,
  );

describe("linkPhaseOf: the supervisor's state as region L", () => {
  it.each([
    [AVAILABLE_CONNECTION_STATE, { phase: "idle" }],
    [connectionState("offline"), { phase: "offline" }],
    [connectionState("connecting"), { phase: "connecting" }],
    [connectionState("connected"), { phase: "connected" }],
    [connectionState("backoff"), { phase: "backoff", retryAtMs: 1_000 }],
    [rejected(1), { phase: "blocked", reason: "authentication" }],
    [
      connectionState(
        "blocked",
        new ConnectionBlockedError({ reason: "read-only", detail: "Not yours." }),
      ),
      { phase: "blocked", reason: "read-only" },
    ],
    [
      connectionState(
        "blocked",
        new ConnectionTransientError({ reason: "network", detail: "gone" }),
      ),
      null,
    ],
  ] as const)("%#", (state, phase) => {
    expect(linkPhaseOf(state)).toEqual(phase);
  });
});

/** Wall and monotonic time moving together, timers fired in order. */
function manualClock(): ExchangeClock & { readonly advance: (ms: number) => Promise<void> } {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { readonly at: number; readonly fire: () => void }>();
  const settle = async () => {
    for (let hop = 0; hop < 50; hop += 1) await Promise.resolve();
  };
  return {
    now: () => ({ wall: now, mono: now }),
    random: () => 0.5,
    setTimer: (delayMs, fire) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + delayMs, fire });
      return () => {
        timers.delete(id);
      };
    },
    advance: async (ms) => {
      const end = now + ms;
      for (;;) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fire();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

describe("repair is the exchange driver's", () => {
  it("re-exchanges on every rejection, with backoff inside the loop window", async () => {
    const clock = manualClock();
    const exchanges: Array<number> = [];
    let driver!: ExchangeDriver;
    driver = makeExchangeDriver<null>({
      clock,
      exchange: async () => {
        exchanges.push(clock.now().mono);
        return {
          ok: true,
          environmentId: ENVIRONMENT_ID,
          descriptor: {
            environmentId: ENVIRONMENT_ID,
            serverVersion: "0.12.0",
            update: null,
            identity: "ok",
            identityCheckedAt: null,
          },
          credential: null,
        };
      },
      // The rotated credential is accepted: the supervisor connects with it.
      install: async () => {
        queueMicrotask(() => {
          const phase = linkPhaseOf(connectionState("connected"));
          if (phase !== null) driver.link(ENVIRONMENT_ID, phase);
        });
      },
      readDescriptor: () => new Promise(() => undefined),
      retryLink: () => undefined,
      refreshPresence: () => undefined,
      retire: () => undefined,
    });
    driver.setAccount({
      postGrant: true,
      identityMint: { allowed: true },
      zeropsFailing: false,
      grantVerifiedAtMs: null,
    });
    driver.setVisible(true);
    driver.setTargets([
      {
        key: KEY,
        presence: { kind: "present", origin: ORIGIN },
        container: { level: "ready" },
        record: ENVIRONMENT_ID,
      },
    ]);
    driver.setDemand("record", [KEY]);
    await clock.advance(0);
    expect(exchanges).toEqual([0]);

    // Ten rejections, ten seconds apart: every one is followed by a fresh credential; from the
    // third inside two minutes on, after a backoff first.
    for (let rejection = 1; rejection <= 10; rejection += 1) {
      await clock.advance(10_000);
      const phase = linkPhaseOf(rejected(rejection));
      if (phase !== null) driver.link(ENVIRONMENT_ID, phase);
      await clock.advance(0);
      if (rejection <= 2) expect(exchanges).toHaveLength(1 + rejection);
      await clock.advance(5_000);
      expect(exchanges).toHaveLength(1 + rejection);
      expect(driver.machine(KEY)?.credential).toMatchObject({ kind: "held" });
    }
    const gaps = exchanges.slice(1).map((at, index) => at - (10_000 * (index + 1) + 5_000 * index));
    expect(gaps.slice(0, 2)).toEqual([0, 0]);
    expect(gaps.slice(2).every((gap) => gap >= 2_000)).toBe(true);
  });
});
