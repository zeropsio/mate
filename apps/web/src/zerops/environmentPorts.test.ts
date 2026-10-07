import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  ConnectionTransientError,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import { makeAccountStore, makeMateAdapter, type MateAdapter } from "@t3tools/client-runtime/data";
import { closedOffOf, type ExchangeClock } from "@t3tools/client-runtime/zerops/environments";
import {
  RemoteEnvironmentAuthFetchError,
  RemoteEnvironmentAuthInvalidJsonError,
  RemoteEnvironmentAuthTimeoutError,
  RemoteEnvironmentAuthUndeclaredStatusError,
} from "@t3tools/client-runtime/rpc";
import {
  EnvironmentAuthInvalidError,
  EnvironmentId,
  EnvironmentInternalError,
} from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { zeropsSessionAtom } from "../state/zerops";
import { closeOffPort, hqIndexPort, keptSessionUnanswered, linkPhaseOf } from "./environmentPorts";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

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

describe("repair is the Mate adapter's", () => {
  it("re-exchanges on a rejection, and past the loop window is refused until the person asks again", async () => {
    const clock = manualClock();
    const exchanges: Array<number> = [];
    let driver!: MateAdapter;
    driver = makeMateAdapter<null>({
      store: makeAccountStore(AtomRegistry.make()),
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
        return { ok: true };
      },
      readDescriptor: () => new Promise(() => undefined),
      retryLink: () => undefined,
      retire: () => undefined,
      // The Mate's container answers every read: it is up.
      probe: async () => ({
        reading: {
          kind: "ready",
          descriptor: {
            environmentId: ENVIRONMENT_ID,
            serverVersion: "0.12.0",
            update: null,
            identity: "ok",
            identityCheckedAt: null,
          },
          projectId: "project-1",
          initAt: null,
        },
        sentAt: clock.now(),
      }),
      readInitAt: async () => null,
      readMateFlag: async () => "unknown",
      intents: { read: () => null, write: () => undefined },
    });
    driver.setAccount({
      verified: true,

      zeropsState: "live",
    });
    driver.setVisible(true);
    driver.setTargets([
      {
        key: KEY,
        orgId: "org-1",
        presence: { kind: "present", origin: ORIGIN },
        origin: ORIGIN,
        platform: { project: "ACTIVE", service: "ACTIVE" },
        record: ENVIRONMENT_ID,
      },
    ]);
    driver.setDemand("recent", [KEY]);
    await clock.advance(0);
    expect(exchanges).toEqual([0]);

    // Rejections ten seconds apart: the first two are each followed by a fresh credential at once.
    for (let rejection = 1; rejection <= 2; rejection += 1) {
      await clock.advance(10_000);
      const phase = linkPhaseOf(rejected(rejection));
      if (phase !== null) driver.link(ENVIRONMENT_ID, phase);
      await clock.advance(0);
      expect(exchanges).toHaveLength(1 + rejection);
      expect(driver.machines(KEY)?.environment.credential).toMatchObject({ kind: "held" });
    }
    // The third inside two minutes is the Mate's definitive no: nothing asks again on its own.
    await clock.advance(10_000);
    const phase = linkPhaseOf(rejected(3));
    if (phase !== null) driver.link(ENVIRONMENT_ID, phase);
    await clock.advance(0);
    await clock.advance(10 * 60_000);
    expect(exchanges).toHaveLength(3);
    expect(driver.machines(KEY)?.environment.credential).toEqual({
      kind: "refused",
      reason: { kind: "credential" },
    });

    void driver.connect(KEY, "user");
    await clock.advance(0);
    expect(exchanges).toHaveLength(4);
    expect(driver.machines(KEY)?.environment.credential).toMatchObject({ kind: "held" });
  });
});

describe("closeOffPort: HQ's word on which Mates' projects are closed off", () => {
  const structure = {
    ungrouped: [
      { projectId: "p-closed", name: "Ada", mate: { closedOff: true } },
      { projectId: "p-open", name: "Bo", mate: { closedOff: false } },
    ],
    apps: [],
  } as never;
  const word = (current: boolean | null) => {
    const registry = AtomRegistry.make();
    if (current !== null) {
      mountHqNavigation(registry, "org-1", { structure: structure, live: current });
    }
    return closeOffPort(registry).read();
  };
  it.each([
    { case: "HQ's answer now, closed off", current: true, projectId: "p-closed", want: true },
    { case: "HQ's answer now, not closed off", current: true, projectId: "p-open", want: false },
    { case: "a stale word, closed off", current: false, projectId: "p-closed", want: true },
    { case: "a stale word, not closed off", current: false, projectId: "p-open", want: "unknown" },
    { case: "no word", current: null, projectId: "p-closed", want: "unknown" },
  ] as const)("$case: $want", ({ current, projectId, want }) => {
    expect(closedOffOf(word(current), "org-1", projectId)).toBe(want);
  });
});

describe("keptSessionUnanswered: what a kept session's check failing says", () => {
  const URL = "https://zcp-1-8080.prg1.zerops.app/mate/api/auth/session";
  it.each([
    ["the check ran past its 3 s", true, new RemoteEnvironmentAuthTimeoutError(URL, 3_000)],
    [
      "the request never reached the Mate",
      true,
      new RemoteEnvironmentAuthFetchError({ message: "offline", cause: null }),
    ],
    [
      "the balancer answered for a server that is down",
      true,
      new RemoteEnvironmentAuthUndeclaredStatusError(URL, 502),
    ],
    [
      "the Mate failed inside",
      true,
      new EnvironmentInternalError({
        code: "internal_error",
        reason: "bootstrap_validation_failed",
        traceId: "trace",
      }),
    ],
    [
      "the Mate answered with a state this client cannot read",
      false,
      new RemoteEnvironmentAuthInvalidJsonError({ message: "invalid", cause: null }),
    ],
    [
      "the Mate refused the session",
      false,
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        traceId: "trace",
      }),
    ],
    [
      "the Mate does not serve the check",
      false,
      new RemoteEnvironmentAuthUndeclaredStatusError(URL, 404),
    ],
  ])("%s → no word: %s", (_name, unanswered, cause) => {
    expect(keptSessionUnanswered(cause)).toBe(unanswered);
  });
});

const presence = (online: boolean) => ({
  presence: { online, since: "2026-10-03T10:00:00.000Z", overview: online ? "live" : "stored" },
});

describe("hqIndexPort: HQ's index of the Mates the reader observes", () => {
  it("names the project whose Mate HQ says serves an environment, and tells of a change", () => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-acme" },
    } as never);
    const index = hqIndexPort(registry);
    const told: Array<string | null> = [];
    const stop = index.subscribe(() => {
      told.push(index.projectOf(ENVIRONMENT_ID));
    });
    expect(index.projectOf(ENVIRONMENT_ID)).toBeNull();

    mountHqNavigation(registry, "org-acme", {
      structure: {
        apps: [],
        ungrouped: [{ projectId: "p-vera", name: "Vera", mate: { face: "" } }],
      },
      mates: {
        "p-vera": {
          ...presence(true),
          identity: { environmentId: ENVIRONMENT_ID },
        } as unknown as MateLiveView,
      },
    });

    expect(index.projectOf(ENVIRONMENT_ID)).toBe("p-vera");
    expect(told).toEqual(["p-vera"]);
    stop();
  });
});
