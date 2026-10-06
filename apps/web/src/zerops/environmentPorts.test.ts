import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  ConnectionTransientError,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import {
  closedOffOf,
  makeExchangeDriver,
  makeRegistrationRecords,
  type ExchangeClock,
  type ExchangeDriver,
} from "@t3tools/client-runtime/zerops/environments";
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
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { accountReadsAtom, makeAccountStore } from "@t3tools/client-runtime/data";
import { seedHqVerdict } from "@t3tools/client-runtime/data/fixtures";

import { zeropsSessionAtom } from "../state/zerops";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  closeOffPort,
  hqIndexPort,
  hqOrganizationPort,
  keptSessionUnanswered,
  linkPhaseOf,
  onlinePort,
  recordsStorage,
} from "./environmentPorts";
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

describe("repair is the exchange driver's", () => {
  it("re-exchanges on a rejection, and past the loop window is refused until the person asks again", async () => {
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
        return { ok: true };
      },
      readDescriptor: () => new Promise(() => undefined),
      retryLink: () => undefined,
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
      expect(driver.machine(KEY)?.credential).toMatchObject({ kind: "held" });
    }
    // The third inside two minutes is the Mate's definitive no: nothing asks again on its own.
    await clock.advance(10_000);
    const phase = linkPhaseOf(rejected(3));
    if (phase !== null) driver.link(ENVIRONMENT_ID, phase);
    await clock.advance(0);
    await clock.advance(10 * 60_000);
    expect(exchanges).toHaveLength(3);
    expect(driver.machine(KEY)?.credential).toEqual({
      kind: "refused",
      reason: { kind: "credential" },
    });

    driver.retry(KEY);
    await clock.advance(0);
    expect(exchanges).toHaveLength(4);
    expect(driver.machine(KEY)?.credential).toMatchObject({ kind: "held" });
  });
});

describe("the records port: the account's own storage", () => {
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  it("another account's records are invisible", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    });
    const records = makeRegistrationRecords(recordsStorage);
    const record = (targetKey: string, environmentId: string) => ({
      targetKey,
      environmentId: EnvironmentId.make(environmentId),
      origin: ORIGIN,
      projectRef: { projectId: targetKey.split(":")[0] ?? targetKey, orgId: "org-1" },
      name: "shop",
    });

    openAccountLifetime("user-a");
    records.remember(record("project-a:service-a", "environment-a"));
    openAccountLifetime("user-b");
    expect(records.list()).toEqual([]);
    records.remember(record("project-b:service-b", "environment-b"));

    openAccountLifetime("user-a");
    expect(records.list().map((entry) => entry.targetKey)).toEqual(["project-a:service-a"]);
  });
});

const presence = (online: boolean) => ({
  presence: { online, since: "2026-10-03T10:00:00.000Z", overview: online ? "live" : "stored" },
});
const mates = { "p-up": presence(true), "p-down": presence(false) } as never;
/** What HQ relays of the Mates it places in `organizationId`, live or as last known. */
const registryWith = (
  view: {
    readonly organizationId: string;
    readonly mates: Readonly<Record<string, MateLiveView>>;
    readonly current: boolean;
  } | null,
  official: boolean | null = true,
) => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const orgId = view?.organizationId ?? "org-test";
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId,
    demandDetail: () => () => {},
    renewHeld: () => {},
  });
  if (view !== null)
    mountHqNavigation(
      registry,
      view.organizationId,
      {
        structure: {
          apps: [],
          ungrouped: Object.keys(view.mates).map((projectId) => ({
            projectId,
            name: projectId,
            mate: { face: "" },
          })),
        },
        mates: view.mates,
        live: view.current,
      },
      store,
    );
  seedHqVerdict(store, orgId, official === null ? "pending" : official ? "official" : "none");
  return registry;
};

// The close-off gate reads HQ's word through this port: a closed-off project stays so on a stale
// word, and an open one is known only from HQ's answer now.
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

describe("onlinePort: the projects whose Mate HQ holds online", () => {
  it.each([
    ["HQ's answer now, whatever organization is in view", { mates, current: true }, ["p-up"]],
    ["HQ naming no Mates", { mates: {}, current: true }, []],
  ] as const)("reads %s", (_name, view, expected) => {
    const read = onlinePort(registryWith({ organizationId: "org-2", ...view })).read();
    expect(read === null ? null : [...read]).toEqual(expected);
  });

  // HQ's word is not current: the container store waits for it, a bounded while — but only for an
  // HQ that is there, or not decided yet.
  const lastKnown = { organizationId: "org-1", mates, current: false } as const;
  it.each([
    ["what was last known of them, of an HQ that is there", lastKnown, true],
    ["what was last known of them, of an HQ not decided yet", lastKnown, null],
    ["nothing, of an HQ that is there", null, true],
  ] as const)("reads no word while all it holds is %s", (_name, view, official) => {
    expect(onlinePort(registryWith(view, official)).read()).toBeNull();
  });

  it.each([
    ["what was last known of them", lastKnown],
    ["nothing", null],
  ] as const)(
    "reads that none is online where the organization has no official HQ, holding %s",
    (_name, view) => {
      expect([...(onlinePort(registryWith(view, false)).read() ?? ["waits"])]).toEqual([]);
    },
  );

  it("tells its listener when the organization's HQ is decided", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: "org-test",
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
    let told = 0;
    const stop = onlinePort(registry).subscribe(() => void (told += 1));
    seedHqVerdict(store, "org-test", "none");
    await vi.waitFor(() => expect(told).toBe(1));
    stop();
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

describe("hqOrganizationPort: the organization an official HQ's current word speaks for", () => {
  it.each([
    ["an official HQ's answer now", { mates, current: true }, true, "org-2"],
    ["an HQ not decided yet", { mates, current: true }, null, null],
    ["no official HQ", { mates, current: true }, false, null],
    ["what was last known of them", { mates, current: false }, true, null],
  ] as const)("reads what it holds of %s", (_name, view, official, expected) => {
    const registry = registryWith({ organizationId: "org-2", ...view }, official);
    expect(hqOrganizationPort(registry).read()).toBe(expected);
  });
});
