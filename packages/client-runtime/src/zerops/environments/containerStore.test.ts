import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MateFlag, PlatformStatus } from "./containerMachine.ts";
import {
  bindContainerStore,
  makeContainerStore,
  type ContainerStore,
  type ContainerTarget,
  type IntentStorage,
} from "./containerStore.ts";
import { makeExchangeDriver, type ExchangeClock } from "./exchangeDriver.ts";
import type { ProbeReading } from "./probeStore.ts";

/** Answers settle across a few promise hops; this lets every one of them land. */
const flush = async (): Promise<void> => {
  for (let hop = 0; hop < 50; hop += 1) await Promise.resolve();
};

/**
 * Wall and monotonic time moving together; what is already settled lands first, then timers fire
 * in order, each followed by a flush. `reload` starts monotonic time over, as a new document does.
 */
function manualClock(): ExchangeClock & {
  readonly advance: (ms: number) => Promise<void>;
  readonly reload: () => void;
} {
  let mono = 0;
  let wallOffset = 1_800_000_000_000;
  let nextId = 0;
  const timers = new Map<number, { readonly at: number; readonly fire: () => void }>();
  return {
    now: () => ({ wall: mono + wallOffset, mono }),
    random: () => 0.5,
    setTimer: (delayMs, fire) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: mono + Math.max(0, delayMs), fire });
      return () => {
        timers.delete(id);
      };
    },
    advance: async (ms) => {
      await flush();
      const end = mono + ms;
      for (;;) {
        let due: [number, { readonly at: number; readonly fire: () => void }] | undefined;
        for (const entry of timers) {
          if (entry[1].at <= end && (due === undefined || entry[1].at < due[1].at)) due = entry;
        }
        if (due === undefined) break;
        timers.delete(due[0]);
        mono = Math.max(mono, due[1].at);
        due[1].fire();
        await flush();
      }
      mono = end;
      await flush();
    },
    reload: () => {
      timers.clear();
      wallOffset += mono;
      mono = 0;
    },
  };
}

const KEY = "project-1:service-1";
const ORIGIN = "https://zcp-1.prg1.zerops.app";

const ready = (serverVersion: string): ProbeReading => ({
  kind: "ready",
  descriptor: {
    environmentId: EnvironmentId.make("env-a"),
    serverVersion,
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId: "project-1",
  initAt: null,
});

const target = (service: string, origin: string | null = ORIGIN) => ({
  key: KEY,
  origin,
  platform: { project: "ACTIVE", service } satisfies PlatformStatus,
});

interface Rig {
  readonly clock: ReturnType<typeof manualClock>;
  readonly store: ContainerStore;
  /** Every probe started, in order. */
  readonly probes: Array<string>;
  /** What the next probes answer. */
  answer: ProbeReading;
}

function memoryStorage(): IntentStorage & { value: string | null } {
  const storage = {
    value: null as string | null,
    read: () => storage.value,
    write: (value: string | null) => {
      storage.value = value;
    },
  };
  return storage;
}

function rig(
  options: {
    readonly clock?: ReturnType<typeof manualClock>;
    readonly intents?: IntentStorage;
    readonly flag?: MateFlag;
  } = {},
): Rig {
  const clock = options.clock ?? manualClock();
  const probes: Array<string> = [];
  const result: Rig = {
    clock,
    probes,
    answer: ready("0.11.40"),
    store: makeContainerStore({
      clock,
      probe: (origin) => {
        probes.push(origin);
        return Promise.resolve(result.answer);
      },
      readMateFlag: () => Promise.resolve(options.flag ?? "unknown"),
      intents: options.intents ?? memoryStorage(),
    }),
  };
  return result;
}

const ENVIRONMENT_ID = EnvironmentId.make("env-a");

/**
 * A real exchange driver bound to the store, holding a credential for `KEY` on a link that the
 * test moves by hand; `retried` lists every link it kicked.
 */
async function boundDriver(rig: Rig) {
  const retried: Array<EnvironmentId> = [];
  const driver = makeExchangeDriver<string>({
    clock: rig.clock,
    exchange: async () => ({
      ok: true,
      environmentId: ENVIRONMENT_ID,
      descriptor: (ready("0.11.40") as Extract<ProbeReading, { kind: "ready" }>).descriptor,
      credential: "bearer",
    }),
    install: async () => ({ ok: true }),
    readDescriptor: () => new Promise(() => undefined),
    retryLink: (id) => {
      retried.push(id);
    },
    refreshPresence: () => undefined,
    retire: () => undefined,
  });
  const unbind = bindContainerStore(rig.store, driver);
  driver.setAccount({
    postGrant: true,
    identityMint: { allowed: true },
    zeropsFailing: false,
    grantVerifiedAtMs: 0,
  });
  driver.setVisible(true);
  driver.setTargets([
    {
      key: KEY,
      presence: { kind: "present", origin: ORIGIN },
      container: rig.store.verdict(KEY),
      record: ENVIRONMENT_ID,
    },
  ]);
  driver.setDemand("record", [KEY]);
  await rig.clock.advance(0);
  expect(driver.machine(KEY)?.credential.kind).toBe("held");
  return {
    driver,
    retried,
    dispose: () => {
      unbind();
      driver.dispose();
    },
  };
}

describe("container store (DESIGN §4.5)", () => {
  it("ready re-probes on a status move, connect failure or wake", async () => {
    const setup = rig();
    const { clock, store, probes } = setup;
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(store.verdict(KEY)).toEqual({ level: "ready" });
    expect(probes).toHaveLength(1);

    // Ready is not terminal, and nothing reads it on a clock.
    await clock.advance(60_000);
    expect(probes).toHaveLength(1);

    // A push that says the Mate is down reads nothing; the push that ends the restart reads it.
    store.setTargets([target("RESTARTING")]);
    await clock.advance(0);
    expect(probes).toHaveLength(1);
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(probes).toHaveLength(2);
    expect(store.verdict(KEY)).toEqual({ level: "ready" });

    // A live socket is the liveness signal: nothing is read while it holds.
    probes.length = 0;
    store.link(KEY, true);
    await clock.advance(60_000);
    expect(probes).toHaveLength(0);

    // The socket failing reads it again.
    store.link(KEY, false);
    await clock.advance(0);
    expect(probes).toHaveLength(1);

    // So does a visible wake, once that reading is a minute old.
    store.wake(true);
    await clock.advance(0);
    expect(probes).toHaveLength(1);
    await clock.advance(60_000);
    store.wake(true);
    await clock.advance(0);
    expect(probes).toHaveLength(2);

    // A connect that fails before it ever connects reads it again too, each time it fails.
    const bound = await boundDriver(setup);
    probes.length = 0;
    for (const attempt of [1, 2]) {
      bound.driver.link(ENVIRONMENT_ID, { phase: "connecting" });
      await clock.advance(0);
      expect(probes).toHaveLength(attempt - 1);
      bound.driver.link(ENVIRONMENT_ID, { phase: "backoff", retryAtMs: null });
      await clock.advance(0);
      expect(probes).toHaveLength(attempt);
    }
    bound.dispose();
    store.dispose();
  });

  // While the server is down the balancer answers without CORS headers: every probe would be a
  // red console error and a wasted request, and every socket an attempt held until its 502.
  it.each(["RESTARTING", "UPGRADING", "RELOADING", "STOPPED"])(
    "a Mate whose service the platform says is %s is never read until the platform says ACTIVE",
    async (status) => {
      const setup = rig();
      const { clock, store, probes } = setup;
      store.setTargets([target("ACTIVE")]);
      const bound = await boundDriver(setup);
      bound.driver.link(ENVIRONMENT_ID, { phase: "connected" });
      await clock.advance(0);
      probes.length = 0;

      // The service goes down under the socket, which falls into backoff and fails again.
      store.setTargets([target(status)]);
      bound.driver.link(ENVIRONMENT_ID, { phase: "backoff", retryAtMs: null });
      await clock.advance(0);
      bound.driver.link(ENVIRONMENT_ID, { phase: "connecting" });
      bound.driver.link(ENVIRONMENT_ID, { phase: "backoff", retryAtMs: null });
      store.request(KEY);
      store.wake(true);
      await clock.advance(120_000);
      expect(probes).toEqual([]);

      // The platform says it is back: one read, which finds it answering.
      store.setTargets([target("ACTIVE")]);
      await clock.advance(0);
      expect(probes).toEqual([ORIGIN]);
      await clock.advance(10_000);
      expect(probes).toEqual([ORIGIN]);
      expect(store.verdict(KEY)).toEqual({ level: "ready" });
      bound.dispose();
      store.dispose();
    },
  );

  it("a Mate whose status is not read yet is read as before", async () => {
    const { clock, store, probes } = rig();
    store.setTargets([
      { key: KEY, origin: ORIGIN, platform: { project: "ACTIVE", service: null } },
    ]);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN]);
    store.request(KEY);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, ORIGIN]);
    store.dispose();
  });

  it("reload mid-update keeps updating", async () => {
    const intents = memoryStorage();
    const clock = manualClock();
    const before = rig({ clock, intents });
    before.store.setTargets([target("ACTIVE")]);
    before.store.link(KEY, true);
    await clock.advance(0);
    before.store.intend(KEY, { kind: "update", from: "0.11.40" });
    expect(before.store.verdict(KEY)).toEqual({ level: "updating", overdue: false });
    await clock.advance(10_000);
    before.store.dispose();

    // The tab reloads: a new document, a new store, the same session storage.
    clock.reload();
    const after = rig({ clock, intents });
    // The server is still on the version the update started from.
    after.store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(after.store.verdict(KEY)).toEqual({ level: "updating", overdue: false });
    await clock.advance(5_000);
    expect(after.store.verdict(KEY)).toEqual({ level: "updating", overdue: false });

    // Its budget runs from the verb's acceptance, not from the reload.
    await clock.advance(120_000 - 15_000);
    expect(after.store.verdict(KEY)).toEqual({ level: "updating", overdue: true });

    // The new version answering ends it, and nothing is left in storage.
    after.answer = ready("0.11.41");
    await clock.advance(60_000);
    expect(after.store.verdict(KEY)).toEqual({ level: "ready" });
    expect(intents.value).toBeNull();
    after.store.dispose();
  });

  it("the route's Mate takes the first probe slot that frees", async () => {
    const clock = manualClock();
    const probes: Array<string> = [];
    const store = makeContainerStore({
      clock,
      // No Mate answers: each probe ends at its deadline.
      probe: (origin, signal) => {
        probes.push(origin);
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      },
      readMateFlag: () => Promise.resolve("unknown"),
      intents: memoryStorage(),
    });
    const driver = makeExchangeDriver<string>({
      clock,
      exchange: () => new Promise(() => undefined),
      install: async () => ({ ok: true }),
      readDescriptor: () => new Promise(() => undefined),
      retryLink: () => undefined,
      refreshPresence: () => undefined,
      retire: () => undefined,
    });
    const unbind = bindContainerStore(store, driver);
    const ids = ["o1", "o2", "o3", "o4", "o5", "route"];
    const originOf = (id: string) => `https://zcp-${id}.prg1.zerops.app`;
    driver.setTargets([
      {
        key: "project-route:zcp",
        presence: { kind: "present", origin: originOf("route") },
        container: { level: "unknown" },
        record: null,
      },
    ]);
    driver.setDemand("route", ["project-route:zcp"]);
    await clock.advance(0);

    // Listed last, the route's Mate misses the pool's first four slots.
    store.setTargets(
      ids.map((id) => ({
        key: `project-${id}:zcp`,
        origin: originOf(id),
        platform: { project: "ACTIVE", service: "ACTIVE" },
      })),
    );
    await clock.advance(0);
    expect(probes).toEqual(["o1", "o2", "o3", "o4"].map(originOf));

    await clock.advance(8_000);
    expect(probes.slice(4, 6)).toEqual([originOf("route"), originOf("o5")]);
    unbind();
    driver.dispose();
    store.dispose();
  });

  it("the route's Mate coming back after its exchanges failed is exchanged within seconds", async () => {
    const setup = rig();
    const { clock, store } = setup;
    setup.answer = { kind: "unreachable" };
    let down = true;
    const exchanges: Array<number> = [];
    const driver = makeExchangeDriver<string>({
      clock,
      exchange: async () => {
        exchanges.push(clock.now().mono);
        return down
          ? {
              ok: false,
              failure: { class: "retryable", cause: { kind: "descriptor-unreachable" } },
              descriptor: null,
            }
          : {
              ok: true,
              environmentId: ENVIRONMENT_ID,
              descriptor: (ready("0.11.40") as Extract<ProbeReading, { kind: "ready" }>).descriptor,
              credential: "bearer",
            };
      },
      install: async () => ({ ok: true }),
      readDescriptor: () => new Promise(() => undefined),
      retryLink: () => undefined,
      refreshPresence: () => undefined,
      retire: () => undefined,
    });
    const unbind = bindContainerStore(store, driver);
    driver.setAccount({
      postGrant: true,
      identityMint: { allowed: true },
      zeropsFailing: false,
      grantVerifiedAtMs: 0,
    });
    driver.setVisible(true);
    store.setTargets([target("ACTIVE")]);
    driver.setTargets([
      {
        key: KEY,
        presence: { kind: "present", origin: ORIGIN },
        container: { level: "ready" },
        record: null,
      },
    ]);
    driver.setDemand("route", [KEY]);

    // Down for a minute: its exchanges fail and climb the ladder.
    await clock.advance(60_000);
    expect(driver.machine(KEY)?.credential.kind).not.toBe("held");
    const failed = exchanges.length;

    // It comes back: the next read of its container finds it, and it is exchanged at once.
    down = false;
    setup.answer = ready("0.11.40");
    await clock.advance(3_000);
    expect(exchanges.length).toBeGreaterThan(failed);
    expect(driver.machine(KEY)?.credential.kind).toBe("held");
    unbind();
    driver.dispose();
    store.dispose();
  });

  it("container ready kicks a link in backoff", async () => {
    const setup = rig();
    const { clock, store, probes } = setup;
    store.setTargets([target("ACTIVE")]);
    const { driver, retried, dispose } = await boundDriver(setup);
    const environmentId = ENVIRONMENT_ID;
    driver.link(environmentId, { phase: "connected" });
    await clock.advance(0);

    // The container restarts under the socket, which falls into backoff.
    await clock.advance(5_000);
    store.setTargets([target("RESTARTING")]);
    driver.link(environmentId, { phase: "backoff", retryAtMs: null });
    await clock.advance(1_000);
    expect(driver.machine(KEY)?.container).toEqual({
      level: "restarting",
      by: "platform",
      overdue: false,
    });

    // The restart ends and a probe finds the Mate answering: the link is kicked at once.
    await clock.advance(20_000);
    probes.length = 0;
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(probes.length).toBeGreaterThan(0);
    expect(store.verdict(KEY)).toEqual({ level: "ready" });
    expect(retried).toEqual([environmentId]);
    dispose();
    store.dispose();
  });
});

describe("container store: what reads a container again", () => {
  /** The target held only by its record: the listing does not say its service's status. */
  const remembered = { key: KEY, origin: ORIGIN, platform: { project: "ACTIVE", service: null } };

  const rows: ReadonlyArray<{
    readonly name: string;
    /** The target as first listed; ACTIVE by default. */
    readonly initial?: ContainerTarget;
    /** Whether the Mate's socket is live once its first reading landed. */
    readonly connected: boolean;
    readonly act: (store: ContainerStore, clock: ReturnType<typeof manualClock>) => Promise<void>;
    readonly reads: number;
  }> = [
    {
      name: "a connected Mate the listing sends again unchanged",
      connected: true,
      act: async (store) => store.setTargets([target("ACTIVE")]),
      reads: 0,
    },
    {
      name: "a connected Mate on a visible wake",
      connected: true,
      act: async (store, clock) => {
        await clock.advance(120_000);
        store.wake(true);
      },
      reads: 0,
    },
    {
      name: "a connected Mate somebody asks about",
      connected: true,
      act: async (store) => store.request(KEY),
      reads: 0,
    },
    {
      name: "a connected Mate the listing drops to its record and lists again",
      connected: true,
      act: async (store) => {
        store.setTargets([remembered]);
        store.setTargets([target("ACTIVE")]);
      },
      reads: 0,
    },
    {
      name: "a Mate the listing drops to its record and lists again",
      connected: false,
      act: async (store) => {
        store.setTargets([remembered]);
        store.setTargets([target("ACTIVE")]);
      },
      reads: 0,
    },
    {
      name: "a Mate whose service the listing reads for the first time",
      initial: remembered,
      connected: false,
      act: async (store) => store.setTargets([target("ACTIVE")]),
      reads: 0,
    },
    {
      name: "a Mate whose service's creation time the listing adds",
      connected: false,
      act: async (store) =>
        store.setTargets([
          {
            ...target("ACTIVE"),
            platform: { project: "ACTIVE", service: "ACTIVE", serviceCreated: "2026-10-01" },
          },
        ]),
      reads: 0,
    },
    {
      name: "a Mate whose service restarted and is ACTIVE again",
      connected: false,
      act: async (store) => {
        store.setTargets([target("RESTARTING")]);
        store.setTargets([target("ACTIVE")]);
      },
      reads: 1,
    },
    {
      name: "a Mate whose service went RESTARTING while the listing lost it, then came back",
      connected: false,
      act: async (store) => {
        store.setTargets([target("RESTARTING")]);
        store.setTargets([remembered]);
        store.setTargets([target("ACTIVE")]);
      },
      reads: 1,
    },
    {
      name: "a Mate at a new address",
      connected: false,
      act: async (store) => store.setTargets([target("ACTIVE", "https://zcp-2.prg1.zerops.app")]),
      reads: 1,
    },
    {
      name: "a Mate read moments ago, on a visible wake",
      connected: false,
      act: async (store, clock) => {
        await clock.advance(5_000);
        store.wake(true);
      },
      reads: 0,
    },
    {
      name: "a Mate last read a minute ago, on a visible wake",
      connected: false,
      act: async (store, clock) => {
        await clock.advance(60_000);
        store.wake(true);
      },
      reads: 1,
    },
    {
      name: "a Mate last read a minute ago, on a hidden wake",
      connected: false,
      act: async (store, clock) => {
        await clock.advance(60_000);
        store.wake(false);
      },
      reads: 0,
    },
    {
      name: "a Mate whose socket drops",
      connected: true,
      act: async (store) => store.link(KEY, false),
      reads: 1,
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const { clock, store, probes } = rig();
    store.setTargets([row.initial ?? target("ACTIVE")]);
    await clock.advance(0);
    expect(probes).toHaveLength(1);
    if (row.connected) store.link(KEY, true);
    await clock.advance(0);
    probes.length = 0;

    await row.act(store, clock);
    await clock.advance(0);
    expect(probes).toHaveLength(row.reads);
    store.dispose();
  });
});
