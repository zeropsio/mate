import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { readZeropsContainer } from "../containerHealth.ts";
import { makeDescriptorShare } from "../descriptorShare.ts";
import type { MateFlag, PlatformStatus } from "./containerMachine.ts";
import {
  bindContainerStore,
  HQ_WAIT_MS,
  INIT_AT_READ_DEADLINE_MS,
  makeContainerStore,
  type ContainerStore,
  type ContainerTarget,
  type IntentStorage,
} from "./containerStore.ts";
import { makeExchangeDriver, type ExchangeClock } from "./exchangeDriver.ts";
import type { ProbeReading } from "./probeStore.ts";
import { reachabilityPhrase, selectReachability } from "./reachability.ts";

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
  /** Whether each probe asked for a read started now. */
  readonly asks: Array<boolean>;
  /** What the next probes answer. */
  answer: ProbeReading;
  /** Every `/healthz` read for a verb's baseline, by origin. */
  readonly initAtReads: Array<string>;
  /** What those reads answer: an initAt, null, or never. */
  initAt: string | null | "never";
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
  const asks: Array<boolean> = [];
  const initAtReads: Array<string> = [];
  const result: Rig = {
    clock,
    probes,
    asks,
    initAtReads,
    initAt: null,
    answer: ready("0.11.40"),
    store: makeContainerStore({
      clock,
      probe: (origin, _signal, ask) => {
        probes.push(origin);
        asks.push(ask.fresh);
        return Promise.resolve({ reading: result.answer, sentAt: clock.now() });
      },
      readInitAt: (origin, signal) => {
        initAtReads.push(origin);
        const initAt = result.initAt;
        return initAt === "never"
          ? new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(new Error("aborted"))),
            )
          : Promise.resolve(initAt);
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
  driver.setDemand("route", [KEY]);
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

  it("the route's Mate takes the first probe slot, and the first that frees", async () => {
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
      readInitAt: () => Promise.resolve(null),
      readMateFlag: () => Promise.resolve("unknown"),
      intents: memoryStorage(),
    });
    const driver = makeExchangeDriver<string>({
      clock,
      exchange: () => new Promise(() => undefined),
      install: async () => ({ ok: true }),
      readDescriptor: () => new Promise(() => undefined),
      retryLink: () => undefined,
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

    // Listed last, the route's Mate still takes the pool's first slot.
    store.setTargets(
      ids.map((id) => ({
        key: `project-${id}:zcp`,
        origin: originOf(id),
        platform: { project: "ACTIVE", service: "ACTIVE" },
      })),
    );
    await clock.advance(0);
    expect(probes).toEqual(["route", "o1", "o2", "o3"].map(originOf));

    // The route's read again takes the first slot that frees.
    store.request("project-route:zcp");
    await clock.advance(8_000);
    expect(probes.slice(4, 6)).toEqual([originOf("route"), originOf("o4")]);
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

  // Live, 2026-10-05: Ada's container stayed ACTIVE while `zerops@mate` was stopped; with the
  // conversation open 127 s its banner said "Ada is taking longer than usual to start." with only
  // Go to projects. Nothing but failed probes said it was starting: the link is failing, and says
  // so with Try now — "starting" is the platform's word alone.
  // Live, 2026-10-05, again: nginx kept serving zcp's init marker at `/mate/healthz` (200,
  // initComplete true) while the Mate was stopped, and the descriptor's CORS-less 502 read as no
  // answer — "Almost there." at 60 s, then "taking longer than usual to start".
  it.each([
    { name: "every probe unanswered", answer: { kind: "unreachable" } },
    {
      name: "zcp's init marker answering, the Mate not",
      answer: { kind: "not-answering", initAt: "2026-10-05T01:00:00Z" },
    },
  ] as const)(
    "an ACTIVE container whose server stops answering reads as its link failing, with Try now: $name",
    async ({ answer }) => {
      const setup = rig();
      const { clock, store } = setup;
      store.setTargets([target("ACTIVE")]);
      const { driver, dispose } = await boundDriver(setup);
      driver.link(ENVIRONMENT_ID, { phase: "connected" });
      await clock.advance(1_000);

      // The server stops: the socket drops into backoff, the link counting down to its next try,
      // while the platform keeps saying ACTIVE.
      setup.answer = answer;
      driver.link(ENVIRONMENT_ID, { phase: "backoff", retryAtMs: null });
      const words: Array<string> = [];
      for (let second = 0; second < 127; second += 1) {
        await clock.advance(1_000);
        driver.link(ENVIRONMENT_ID, { phase: "backoff", retryAtMs: clock.now().wall + 4_000 });
        await clock.advance(0);
        const verdict = selectReachability(driver.machine(KEY)!, ENVIRONMENT_ID);
        expect(verdict.kind).not.toBe("container");
        const phrase = reachabilityPhrase(verdict, { nowMs: clock.now().wall, mateName: "Ada" });
        expect(phrase.actions).toContain("try-now");
        words.push(phrase.text ?? "");
      }
      // Never a start, never "Almost there.": its server is not answering, counted down.
      expect(words.filter((text) => /start|Almost there/u.test(text))).toEqual([]);
      expect(words.at(-1)).toBe("This Mate isn't answering. Trying again in 4 s.");
      dispose();
      store.dispose();
    },
  );

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

// A Mate that never answers — deleted from its zcp, or a zcp serving none — while the platform
// still says ACTIVE: polled for good, it cost a pair of failed requests a minute (t10, 2026-10-03).
describe("container store: a container that never answers", () => {
  it("is read once at load, and then only when someone asks, while nobody waits on it", async () => {
    const setup = rig();
    const { clock, store, probes } = setup;
    setup.answer = { kind: "unreachable" };
    store.setTargets([target("ACTIVE")]);
    await clock.advance(10 * 60_000);
    expect(probes).toEqual([ORIGIN]);

    store.request(KEY);
    await clock.advance(10 * 60_000);
    expect(probes).toEqual([ORIGIN, ORIGIN]);
    store.dispose();
  });

  it("is polled on the backing-off ladder while a lease waits on it, read at once as it starts", async () => {
    const setup = rig();
    const { clock, store, probes } = setup;
    setup.answer = { kind: "unreachable" };
    store.setTargets([target("ACTIVE")]);
    await clock.advance(60_000);
    expect(probes).toEqual([ORIGIN]);

    store.setWanted(new Set([KEY]));
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, ORIGIN]);
    await clock.advance(30_000);
    expect(probes.length).toBeGreaterThan(2);

    // Let go, it is read again only when asked.
    store.setWanted(new Set());
    const read = probes.length;
    await clock.advance(10 * 60_000);
    expect(probes.length).toBe(read);
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
    /** Whether HQ holds the Mate online once its first reading landed. */
    readonly online?: boolean;
    readonly act: (store: ContainerStore, clock: ReturnType<typeof manualClock>) => Promise<void>;
    readonly reads: number;
    /** Whether those reads are started now, past a descriptor another reader just made. */
    readonly fresh?: boolean;
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
      fresh: true,
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
      fresh: true,
    },
    {
      name: "a Mate at a new address",
      connected: false,
      act: async (store) => store.setTargets([target("ACTIVE", "https://zcp-2.prg1.zerops.app")]),
      reads: 1,
      fresh: true,
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
      fresh: false,
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
      fresh: true,
    },
    {
      name: "a Mate somebody asks about",
      connected: false,
      act: async (store) => store.request(KEY),
      reads: 1,
      fresh: true,
    },
    {
      name: "a Mate an exchange is about to read anyway",
      connected: false,
      act: async (store) => store.request(KEY, { fresh: false }),
      reads: 1,
      fresh: false,
    },
    {
      name: "a Mate HQ holds online, on a visible wake",
      connected: false,
      online: true,
      act: async (store, clock) => {
        await clock.advance(120_000);
        store.wake(true);
      },
      reads: 0,
    },
    {
      name: "a Mate HQ holds online somebody asks about",
      connected: false,
      online: true,
      act: async (store) => store.request(KEY),
      reads: 0,
    },
    {
      name: "a Mate HQ lets go",
      connected: false,
      online: true,
      act: async (store) => store.setOnline(new Set()),
      reads: 1,
      fresh: true,
    },
    {
      name: "a Mate HQ holds online whose socket drops",
      connected: true,
      online: true,
      act: async (store) => store.link(KEY, false),
      reads: 0,
    },
    {
      name: "a Mate HQ holds online that our verb restarts",
      connected: false,
      online: true,
      act: async (store) => store.intend(KEY, { kind: "restart" }),
      reads: 1,
      fresh: true,
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const { clock, store, probes, asks } = rig();
    store.setTargets([row.initial ?? target("ACTIVE")]);
    await clock.advance(0);
    expect(probes).toHaveLength(1);
    if (row.connected) store.link(KEY, true);
    if (row.online) store.setOnline(new Set(["project-1"]));
    await clock.advance(0);
    probes.length = 0;

    await row.act(store, clock);
    await clock.advance(0);
    expect(probes).toHaveLength(row.reads);
    expect(asks.slice(1)).toEqual(probes.map(() => row.fresh));
    store.dispose();
  });
});

describe("container store: a Mate HQ holds online (krok-a §4)", () => {
  it("never probes a container whose Mate HQ holds online", async () => {
    const { clock, store, probes } = rig();
    store.setOnline(new Set(["project-1"]));
    store.setTargets([target("ACTIVE")]);
    await clock.advance(120_000);
    store.wake(true);
    store.request(KEY);
    await clock.advance(0);
    expect(probes).toEqual([]);
    expect(store.verdict(KEY)).toEqual({ level: "ready" });
    store.dispose();
  });

  it("probes the route's container whatever HQ says", async () => {
    const { clock, store, probes } = rig();
    store.setOnline(new Set(["project-1"]));
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(probes).toEqual([]);

    // The route moves onto it: it is read at once, and whenever someone asks.
    store.setFirst(new Set([KEY]));
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN]);
    store.request(KEY);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, ORIGIN]);

    // The route moving off it leaves HQ's word to prove it up again.
    store.setFirst(new Set());
    store.request(KEY);
    await clock.advance(60_000);
    store.wake(true);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, ORIGIN]);
    store.dispose();
  });

  it("a reload mid-update is not ended by HQ holding the Mate online", async () => {
    const intents = memoryStorage();
    const clock = manualClock();
    const before = rig({ clock, intents });
    before.store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    before.store.intend(KEY, { kind: "update", from: "0.11.40" });
    await clock.advance(10_000);
    before.store.dispose();

    // HQ has not heard the Mate go yet: it still holds it online when the tab reloads.
    clock.reload();
    const after = rig({ clock, intents });
    after.store.setOnline(new Set(["project-1"]));
    after.store.setTargets([target("ACTIVE")]);
    await clock.advance(5_000);
    expect(after.store.verdict(KEY)).toEqual({ level: "updating", overdue: false });

    // The new version answering ends it; HQ's word proves it up from then on.
    after.answer = ready("0.11.41");
    await clock.advance(10_000);
    expect(after.store.verdict(KEY)).toEqual({ level: "ready" });
    expect(intents.value).toBeNull();
    after.probes.length = 0;
    await clock.advance(120_000);
    after.store.wake(true);
    await clock.advance(0);
    expect(after.probes).toEqual([]);
    after.store.dispose();
  });

  it.each([
    ["holds it online: it is never read", new Set(["project-1"]), []],
    ["does not hold it online: it is read", new Set<string>(), [ORIGIN]],
  ] as const)(
    "a Mate first seen before HQ answers waits for its word; HQ %s",
    async (_name, online, reads) => {
      const { clock, store, probes } = rig();
      store.setOnline(null);
      store.setTargets([target("ACTIVE")]);
      await clock.advance(0);
      expect(probes).toEqual([]);

      store.setOnline(online);
      await clock.advance(0);
      expect(probes).toEqual(reads);
      store.dispose();
    },
  );

  it("a Mate first seen before HQ answers is read once HQ_WAIT_MS passes without its word", async () => {
    const { clock, store, probes } = rig();
    store.setOnline(null);
    store.setTargets([target("ACTIVE")]);
    await clock.advance(HQ_WAIT_MS - 1);
    expect(probes).toEqual([]);
    await clock.advance(1);
    expect(probes).toEqual([ORIGIN]);

    // HQ answering late proves it up from then on; a Mate listed after the wait is read at once.
    store.setOnline(new Set(["project-1"]));
    const other = "https://zcp-2.prg1.zerops.app";
    store.setTargets([
      target("ACTIVE"),
      { ...target("ACTIVE", other), key: "project-2:service-2" },
    ]);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, other]);
    store.dispose();
  });

  it("a Mate first seen where no HQ will answer is read at once, and never waits after", async () => {
    const { clock, store, probes } = rig();
    store.setOnline("absent");
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN]);

    const other = "https://zcp-2.prg1.zerops.app";
    store.setOnline("absent");
    store.setTargets([
      target("ACTIVE"),
      { ...target("ACTIVE", other), key: "project-2:service-2" },
    ]);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, other]);
    store.dispose();
  });

  it("the route's Mate never waits for HQ's word", async () => {
    const { clock, store, probes } = rig();
    const other = "https://zcp-2.prg1.zerops.app";
    const otherKey = "project-2:service-2";
    store.setOnline(null);
    store.setFirst(new Set([KEY]));
    store.setTargets([target("ACTIVE"), { ...target("ACTIVE", other), key: otherKey }]);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN]);

    // The route moving onto a Mate that waits reads it at once.
    store.setFirst(new Set([otherKey]));
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, other]);
    store.dispose();
  });

  it("a visible wake reads no Mate that waits for HQ's word", async () => {
    const { clock, store, probes } = rig();
    store.setOnline(null);
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    store.wake(true);
    await clock.advance(0);
    expect(probes).toEqual([]);
    store.setOnline(new Set(["project-1"]));
    await clock.advance(0);
    expect(probes).toEqual([]);
    store.dispose();
  });

  it("HQ going quiet keeps its word HQ_WAIT_MS, then reads what it held online", async () => {
    const { clock, store, probes } = rig();
    store.setOnline(new Set(["project-1"]));
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);

    // Its stream ends and comes back within the wait: nothing is read.
    store.setOnline(null);
    await clock.advance(HQ_WAIT_MS - 1);
    store.setOnline(new Set(["project-1"]));
    await clock.advance(HQ_WAIT_MS);
    expect(probes).toEqual([]);

    // It stays quiet past the wait: its Mate is read as if no HQ held it.
    store.setOnline(null);
    await clock.advance(HQ_WAIT_MS - 1);
    expect(probes).toEqual([]);
    await clock.advance(1);
    expect(probes).toEqual([ORIGIN]);
    store.dispose();
  });
});

// t10, 2026-10-03: the zcp projects of KRLS that serve no Mate (eval, zcp-telemetry…) answered every
// read with a redirect the browser refused. Under an official HQ whose word is current, a listed
// project it does not hold online is read only once a lease waits on it.
describe("container store: a project an official HQ's word speaks for", () => {
  it("is not read at load, nor on a wake or a status push, while HQ does not hold it online", async () => {
    const { clock, store, probes } = rig();
    store.setHqScope(new Set(["project-1"]));
    store.setOnline(new Set());
    store.setTargets([target("ACTIVE")]);
    await clock.advance(120_000);
    store.wake(true);
    store.setTargets([target("RESTARTING")]);
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(probes).toEqual([]);
    store.dispose();
  });

  it("is read once a lease waits on it, and when someone asks", async () => {
    const { clock, store, probes } = rig();
    store.setHqScope(new Set(["project-1"]));
    store.setOnline(new Set());
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    store.request(KEY);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN]);

    store.setWanted(new Set([KEY]));
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, ORIGIN]);
    store.dispose();
  });

  it("is read as before where no official HQ's word is current, or outside what it speaks for", async () => {
    const { clock, store, probes } = rig();
    const other = "https://zcp-2.prg1.zerops.app";
    store.setHqScope(new Set(["project-2"]));
    store.setOnline(new Set());
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN]);

    store.setHqScope(null);
    store.setTargets([
      target("ACTIVE"),
      { ...target("ACTIVE", other), key: "project-2:service-2" },
    ]);
    await clock.advance(0);
    expect(probes).toEqual([ORIGIN, other]);
    store.dispose();
  });
});

describe("container store: a reading counts only from when its read was sent", () => {
  it("a platform restart is not ended by a descriptor read before it, which the share still holds", async () => {
    const clock = manualClock();
    let up = true;
    const requests: Array<string> = [];
    const fetch = async (url: string): Promise<Response> => {
      requests.push(url);
      if (!up) throw new TypeError("Failed to fetch");
      const body = url.endsWith("/healthz")
        ? { initComplete: true, initAt: "2026-10-01T00:00:00Z" }
        : {
            environmentId: "env-a",
            label: "zcp",
            platform: { os: "linux", arch: "x64" },
            serverVersion: "0.11.83",
            capabilities: { repositoryIdentity: true },
            basePath: "/mate",
            zerops: { projectId: "project-1" },
          };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    };
    const share = makeDescriptorShare({ clock, fetch });
    const store = makeContainerStore({
      clock,
      probe: (origin, signal, ask) =>
        readZeropsContainer(origin, { descriptor: share.read, fetch }, signal, ask),
      readInitAt: () => Promise.resolve(null),
      readMateFlag: () => Promise.resolve("unknown"),
      intents: memoryStorage(),
    });
    store.setTargets([target("ACTIVE")]);
    store.link(KEY, true);
    await clock.advance(0);

    // The socket drops: the container is read, and answers.
    store.link(KEY, false);
    await clock.advance(1_000);
    expect(store.verdict(KEY)).toEqual({ level: "ready" });

    // The platform restarts it, and says ACTIVE again while the server is still away.
    up = false;
    store.setTargets([target("RESTARTING")]);
    await clock.advance(5_000);
    requests.length = 0;
    store.setTargets([target("ACTIVE")]);
    await clock.advance(0);

    // The read from before the restart ends nothing: a read is sent, and finds it away.
    expect(requests.length).toBeGreaterThan(0);
    expect(store.verdict(KEY)).not.toEqual({ level: "ready" });
    store.dispose();
  });
});

describe("container store: a restart's baseline is read before its verb", () => {
  it("reads /healthz once before the verb, and judges the restart by it across a reload", async () => {
    const intents = memoryStorage();
    const clock = manualClock();
    const before = rig({ clock, intents });
    before.store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    before.initAt = "2026-09-23T08:00:00Z";
    const initAt = await before.store.initAt(KEY);
    expect(initAt).toBe("2026-09-23T08:00:00Z");
    expect(before.initAtReads).toEqual([ORIGIN]);
    before.store.intend(KEY, { kind: "restart", initAt });
    await clock.advance(1_000);
    before.store.dispose();

    // The tab reloads; the first read is already the restarted server.
    clock.reload();
    const after = rig({ clock, intents });
    after.answer = { kind: "initializing", initAt: "2026-09-23T09:00:00Z" };
    after.store.setTargets([target("ACTIVE")]);
    await clock.advance(0);
    expect(after.store.verdict(KEY)).toEqual({ level: "booting", overdue: false });
    after.store.dispose();
  });

  it.each([
    { name: "a Mate that answers no initAt", initAt: null, deadline: false },
    { name: "a Mate that never answers, by its deadline", initAt: "never", deadline: true },
  ] as const)("names no baseline for $name", async ({ initAt, deadline }) => {
    const setup = rig();
    setup.store.setTargets([target("ACTIVE")]);
    await setup.clock.advance(0);
    setup.initAt = initAt;
    const read = setup.store.initAt(KEY);
    if (deadline) await setup.clock.advance(INIT_AT_READ_DEADLINE_MS);
    expect(await read).toBeNull();
    expect(setup.initAtReads).toHaveLength(1);
    setup.store.dispose();
  });

  it("reads nothing for a target it does not hold", async () => {
    const setup = rig();
    expect(await setup.store.initAt(KEY)).toBeNull();
    expect(setup.initAtReads).toEqual([]);
    setup.store.dispose();
  });
});
