import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { MateFlag, PlatformStatus } from "./containerMachine.ts";
import {
  bindContainerStore,
  makeContainerStore,
  type ContainerStore,
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
  it("ready re-probes on status push, connect failure or wake", async () => {
    const setup = rig();
    const { clock, store, probes } = setup;
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(store.verdict(KEY)).toEqual({ level: "ready" });
    expect(probes).toHaveLength(1);

    // Ready is not terminal, and nothing reads it on a clock.
    await clock.advance(60_000);
    expect(probes).toHaveLength(1);

    // A status push reads it again at once; the push that ends the restart does too.
    store.setTargets([target("RESTARTING")]);
    await clock.advance(0);
    expect(probes).toHaveLength(2);
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(probes).toHaveLength(3);
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

    // So does a visible wake.
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
