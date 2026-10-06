import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsThrowawayPlatform } from "../../authorization/zeropsThrowaway.ts";
import { ZeropsApiError } from "../api.ts";
import { DOOR_MINT_BURST, DOOR_MINT_PACE, DOOR_MINT_THROTTLE_MS } from "../doorThrowaway.ts";
import { descriptorFacts, exchangeAtDoor } from "../identityExchange.ts";
import { makeFakeMate, type FakeMate, type FakeMateCredential } from "../testing/fakeMate.ts";
import {
  AUTH_LOOP_REJECTIONS,
  CAPPED_RETRY_MS,
  RETRY_CAP,
  type ContainerVerdict,
  type EnvironmentDiagnostic,
  type Presence,
} from "./environmentMachine.ts";
import { makeExchangeDriver, type ExchangeDriver } from "./exchangeDriver.ts";
import {
  EXCHANGE_CONCURRENCY,
  type AccountGuards,
  type DemandReason,
  type ExchangeClock,
  type ExchangeRequest,
  type TargetKey,
} from "./exchange.ts";
import { selectReachability } from "./reachability.ts";

const GRANTED: AccountGuards = {
  postGrant: true,
  identityMint: { allowed: true },
  zeropsFailing: false,
  grantVerifiedAtMs: 0,
};

/** A renewal round in progress: the mint waits for it (§4.3 `identityMint`). */
const RENEWING: AccountGuards = {
  ...GRANTED,
  identityMint: { allowed: false, reason: "access-unverified", waitable: true },
};

const LAPSED: AccountGuards = {
  ...GRANTED,
  identityMint: { allowed: false, reason: "access-lapsed", waitable: true },
};

/** Answers settle across a few promise hops; this lets every one of them land. */
const flush = async (): Promise<void> => {
  for (let hop = 0; hop < 50; hop += 1) await Promise.resolve();
};

/** Wall and monotonic time moving together; timers fire in order, each followed by a flush. */
function manualClock(): ExchangeClock & { readonly advance: (ms: number) => Promise<void> } {
  let mono = 0;
  const wallOffset = 1_800_000_000_000;
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
  };
}

/** The background's gap between door mints once its bucket is spent. */
const GAP = 60_000 / DOOR_MINT_PACE.perMinute;

/** A platform whose first `throttled` mints answer 429. */
const platformThrottling = (throttled: number): ZeropsThrowawayPlatform => {
  let left = throttled;
  return {
    mint: async () => {
      if (left > 0) {
        left -= 1;
        throw new ZeropsApiError("Too many requests.", "unexpected", 429);
      }
      return { id: "token", token: "throwaway" };
    },
    remove: async () => undefined,
  };
};

const keyOf = (mate: FakeMate): TargetKey => `${mate.projectId}:zcp`;

interface Rig {
  readonly driver: ExchangeDriver;
  readonly clock: ReturnType<typeof manualClock>;
  readonly exchanges: Array<ExchangeRequest>;
  readonly installs: Array<{ readonly key: TargetKey; readonly credential: FakeMateCredential }>;
  readonly retriedLinks: Array<EnvironmentId>;
  readonly logs: Array<{ readonly key: TargetKey; readonly diagnostic: EnvironmentDiagnostic }>;
  /** Holds every exchange's answer until `release` lets the oldest one through. */
  readonly release: () => Promise<void>;
  readonly start: (input: {
    readonly records?: ReadonlyArray<FakeMate>;
    readonly route?: FakeMate;
    readonly demand?: { readonly reason: DemandReason; readonly mates: ReadonlyArray<FakeMate> };
    readonly account?: AccountGuards;
  }) => Promise<void>;
  readonly reach: (mate: FakeMate) => ReturnType<typeof selectReachability>;
}

function rig(
  mates: ReadonlyArray<FakeMate>,
  options: {
    readonly hold?: boolean;
    /** How the first installs fail, in order; every later one succeeds. */
    readonly failedInstalls?: ReadonlyArray<"answers" | "throws">;
    /** How many of the first mints the platform answers 429. */
    readonly throttledMints?: number;
    /** The targets whose session an earlier load kept, and their Mates still hold. */
    readonly kept?: ReadonlySet<TargetKey>;
  } = {},
): Rig {
  const platform = platformThrottling(options.throttledMints ?? 0);
  const clock = manualClock();
  const exchanges: Array<ExchangeRequest> = [];
  const installs: Array<{ readonly key: TargetKey; readonly credential: FakeMateCredential }> = [];
  const retriedLinks: Array<EnvironmentId> = [];
  const logs: Array<{ readonly key: TargetKey; readonly diagnostic: EnvironmentDiagnostic }> = [];
  const held: Array<() => void> = [];
  const failedInstalls = [...(options.failedInstalls ?? [])];
  const mateAt = (origin: string): FakeMate => {
    const mate = mates.find((entry) => entry.origin === origin);
    if (mate === undefined) throw new Error(`no Mate at ${origin}`);
    return mate;
  };
  const driver: ExchangeDriver = makeExchangeDriver<FakeMateCredential>({
    clock,
    exchange: async (request) => {
      exchanges.push(request);
      const mate = mateAt(request.origin);
      if (options.hold) await new Promise<void>((resolve) => held.push(resolve));
      return exchangeAtDoor(
        {
          throwaway: { platform, clientId: "org", projectId: mate.projectId, nonce: "n" },
          readDescriptor: mate.readDescriptor,
          prepare: mate.prepare,
          environmentOf: (credential) => credential.environmentId,
          kept: options.kept?.has(request.key)
            ? {
                credential: { environmentId: mate.descriptor().environmentId, generation: 100 },
                check: async () => true,
                forget: () => undefined,
                unanswered: false,
                answered: () => undefined,
              }
            : null,
        },
        request.origin,
        { reason: request.reason, expectedProjectId: mate.projectId },
      );
    },
    kept: (key) => options.kept?.has(key) ?? false,
    install: async ({ key, environmentId, credential }) => {
      installs.push({ key, credential });
      const failure = failedInstalls.shift();
      if (failure === "throws") throw new Error("the registry is unavailable");
      if (failure === "answers") return { ok: false };
      const mate = mates.find((entry) => keyOf(entry) === key)!;
      // The registry's supervisor connects with what was installed, and publishes its verdict.
      const link = mate.socket(credential);
      queueMicrotask(() =>
        driver.link(
          environmentId,
          link.phase === "connected"
            ? { phase: "connected" }
            : { phase: "blocked", reason: link.reason! },
        ),
      );
      return { ok: true };
    },
    readDescriptor: async (origin) =>
      descriptorFacts(await mateAt(origin).readDescriptor(`${origin}/mate`)),
    retryLink: (environmentId) => {
      retriedLinks.push(environmentId);
    },
    retire: () => undefined,
    log: (key, diagnostic) => {
      logs.push({ key, diagnostic });
    },
  });
  const present = (mate: FakeMate): Presence => ({ kind: "present", origin: mate.origin });
  return {
    driver,
    clock,
    exchanges,
    installs,
    retriedLinks,
    logs,
    release: async () => {
      held.shift()?.();
      await flush();
    },
    start: async (input) => {
      driver.setAccount(input.account ?? GRANTED);
      driver.setVisible(true);
      driver.setTargets(
        mates.map((mate) => ({
          key: keyOf(mate),
          presence: present(mate),
          container: { level: "ready" } satisfies ContainerVerdict,
          record: input.records?.includes(mate) ? mate.descriptor().environmentId : null,
        })),
      );
      // The remembered targets are the background's: each a Mate left last.
      driver.setDemand("recent", (input.records ?? []).map(keyOf));
      driver.setDemand("route", input.route === undefined ? [] : [keyOf(input.route)]);
      if (input.demand !== undefined) {
        driver.setDemand(input.demand.reason, input.demand.mates.map(keyOf));
      }
      await flush();
    },
    reach: (mate) => {
      const machine = driver.machine(keyOf(mate));
      if (machine === undefined) throw new Error(`no machine for ${keyOf(mate)}`);
      return selectReachability(machine, null);
    },
  };
}

const mate = (id: string, options: { readonly serverVersion?: string } = {}): FakeMate =>
  makeFakeMate({
    origin: `https://zcp-${id}-8080.prg1.zerops.app`,
    projectId: `project-${id}`,
    environmentId: EnvironmentId.make(`env-${id}`),
    ...options,
  });

/** The person's Connect, as the account makes it: a user lease on the target, then the retry. */
const connectHeld = (driver: ExchangeDriver, key: TargetKey, reason: "user") => {
  driver.hold(key, "user");
  return driver.connect(key, reason);
};

describe("exchange driver (DESIGN §4.4)", () => {
  it("a door 500 on reload retries and connects", async () => {
    const shop = mate("shop");
    shop.scriptDoor("500", "500");
    const { driver, clock, exchanges, installs, start, reach } = rig([shop]);

    await start({ records: [shop], route: shop });
    expect(exchanges).toHaveLength(1);
    expect(reach(shop)).toMatchObject({ kind: "retrying", last: { kind: "server", status: 500 } });

    await clock.advance(2_000);
    expect(exchanges).toHaveLength(2);
    await clock.advance(4_000);
    expect(exchanges).toHaveLength(3);

    expect(installs).toHaveLength(1);
    expect(driver.machine(keyOf(shop))?.credential).toMatchObject({
      kind: "held",
      environmentId: EnvironmentId.make("env-shop"),
    });
    expect(reach(shop)).toEqual({ kind: "ready", notice: null });
    expect(exchanges.map((request) => request.reason)).toEqual(["restore", "restore", "restore"]);
  });

  describe("a refusal waits for an input change and names it", () => {
    const rows: ReadonlyArray<{
      readonly name: string;
      readonly target: () => FakeMate;
      readonly refused: unknown;
      readonly verdict: unknown;
      readonly change: (rig: Rig, target: FakeMate) => void;
    }> = [
      {
        name: "the door refuses the role; the presence changes",
        target: () => {
          const target = mate("ro");
          target.scriptDoor("read-only");
          return target;
        },
        refused: { kind: "refused", reason: { kind: "role" } },
        verdict: { kind: "refused-role" },
        change: ({ driver }, target) => {
          driver.setTargets([
            {
              key: keyOf(target),
              presence: { kind: "transitioning", status: "RESTARTING" },
              container: { level: "ready" },
              record: null,
            },
          ]);
          driver.setTargets([
            {
              key: keyOf(target),
              presence: { kind: "present", origin: target.origin },
              container: { level: "ready" },
              record: null,
            },
          ]);
        },
      },
      {
        name: "the server is below the floor; the user retries",
        target: () => mate("old", { serverVersion: "0.10.4" }),
        refused: { kind: "refused", reason: { kind: "version" } },
        verdict: { kind: "update-unavailable" },
        change: ({ driver }, target) => driver.retry(keyOf(target)),
      },
    ];

    it.each(rows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
      const target = row.target();
      const setup = rig([target]);
      await setup.start({ records: [target] });
      expect(setup.driver.machine(keyOf(target))?.credential).toEqual(row.refused);
      expect(setup.reach(target)).toEqual(row.verdict);

      // Time, wakes and the network coming back change nothing a refusal waits on.
      await setup.clock.advance(10 * 60_000);
      setup.driver.wake(true);
      setup.driver.online();
      await flush();
      const before = setup.exchanges.length;
      expect(setup.driver.machine(keyOf(target))?.credential).toEqual(row.refused);

      row.change(setup, target);
      await flush();
      expect(setup.exchanges).toHaveLength(before + 1);
    });
  });

  it("a renewal round never burns an attempt", async () => {
    const shop = mate("shop");
    const cafe = mate("cafe");
    const { driver, exchanges, release, start } = rig([shop, cafe], { hold: true });
    await start({ records: [shop] });
    expect(exchanges).toHaveLength(1);

    // A round closes the mint while shop's exchange is in flight, and cafe is wanted meanwhile.
    driver.setAccount(RENEWING);
    driver.setDemand("recent", [keyOf(shop), keyOf(cafe)]);
    await flush();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.signal.aborted).toBe(false);
    expect(driver.machine(keyOf(cafe))).toMatchObject({
      credential: { kind: "waiting", on: "access" },
      failures: 0,
    });

    // Shop's mint waited the round out inside its attempt; its answer is installed.
    await release();
    expect(driver.machine(keyOf(shop))).toMatchObject({
      credential: { kind: "held" },
      failures: 0,
    });

    // The round is admitted: cafe's exchange starts, on its first attempt.
    driver.setAccount(GRANTED);
    await flush();
    expect(exchanges.map((request) => request.key)).toEqual([keyOf(shop), keyOf(cafe)]);
    await release();
    expect(driver.machine(keyOf(cafe))).toMatchObject({
      credential: { kind: "held" },
      failures: 0,
    });
  });

  it("route target exchanged first", async () => {
    const mates = ["a", "b", "c", "d", "e"].map((id) => mate(id));
    const route = mates[4]!;
    const { exchanges, release, start, reach } = rig(mates, { hold: true });
    await start({ records: mates, route });

    expect(exchanges.map((request) => request.key)).toEqual([
      keyOf(route),
      keyOf(mates[0]!),
      keyOf(mates[1]!),
    ]);
    expect(exchanges).toHaveLength(EXCHANGE_CONCURRENCY);
    expect(reach(mates[2]!)).toEqual({ kind: "connecting", waitingOn: "budget" });

    await release();
    expect(exchanges.map((request) => request.key).slice(3)).toEqual([keyOf(mates[2]!)]);
  });

  it("the route's exchange starts at once while three restores hold every slot", async () => {
    const records = ["a", "b", "c"].map((id) => mate(id));
    const route = mate("route");
    const { driver, exchanges, start } = rig([...records, route], { hold: true });
    const routeTarget = (container: ContainerVerdict) => ({
      key: keyOf(route),
      presence: { kind: "present", origin: route.origin } as const,
      container,
      record: route.descriptor().environmentId,
    });
    // The route's Mate is still coming up while every remembered one could start.
    const started = start({ records: [...records, route], route });
    driver.setTargets([routeTarget({ level: "booting", overdue: false })]);
    await started;
    expect(exchanges.map((request) => request.key)).toEqual(records.map(keyOf));

    // Its container comes up with every restore still out: it does not wait for one to end.
    driver.setTargets([routeTarget({ level: "ready" })]);
    await flush();
    expect(exchanges.map((request) => request.key)).toEqual([...records.map(keyOf), keyOf(route)]);
    expect(exchanges.map((request) => request.asked)).toEqual([false, false, false, true]);
  });

  it("a remembered target's descriptor probe counts against the minute's mints (A16)", async () => {
    const spent = Array.from({ length: DOOR_MINT_BURST - 1 }, (_, index) => mate(`s${index}`));
    const remembered = [mate("r1"), mate("r2")];
    const { driver, exchanges } = rig([...spent, ...remembered]);
    driver.setAccount(GRANTED);
    driver.setVisible(true);
    driver.setTargets([
      ...spent.map((listed) => ({
        key: keyOf(listed),
        presence: { kind: "present", origin: listed.origin } as const,
        container: { level: "ready" } as const,
        record: null,
      })),
      ...remembered.map((listed) => ({
        key: keyOf(listed),
        presence: { kind: "remembered", origin: listed.origin } as const,
        container: { level: "unknown" } as const,
        record: listed.descriptor().environmentId,
      })),
    ]);
    driver.setDemand("recent", spent.map(keyOf));
    await flush();
    expect(exchanges).toHaveLength(DOOR_MINT_BURST - 1);

    // Both are looked for where their records kept them: one mint is left for the two.
    driver.setDemand("recent", [...spent, ...remembered].map(keyOf));
    await flush();

    expect(exchanges).toHaveLength(DOOR_MINT_BURST);
    expect(exchanges.at(-1)?.key).toBe(keyOf(remembered[0]!));
  });

  it("a revoked session re-exchanges, and past the loop window is refused until the person asks again", async () => {
    const shop = mate("shop");
    const { driver, clock, exchanges, installs, logs, start, reach } = rig([shop]);
    await start({ records: [shop] });
    const environmentId = EnvironmentId.make("env-shop");
    expect(reach(shop)).toEqual({ kind: "ready", notice: null });

    // Revoked every 30 s: the third rejection finds three in the loop window.
    for (let revocation = 1; revocation <= AUTH_LOOP_REJECTIONS; revocation += 1) {
      shop.revokeSessions();
      driver.link(environmentId, { phase: "blocked", reason: "authentication" });
      // The supervisor re-attempts with the revoked credential while the new one is exchanged.
      driver.link(environmentId, { phase: "blocked", reason: "authentication" });
      await flush();
      if (revocation === AUTH_LOOP_REJECTIONS) {
        // A definitive refusal: nothing asks again on its own, however long it waits.
        expect(exchanges).toHaveLength(revocation);
        expect(reach(shop)).toEqual({ kind: "refused-credential" });
        await clock.advance(10 * 60_000);
        expect(exchanges).toHaveLength(revocation);
        driver.retry(keyOf(shop));
        await flush();
      }
      expect(exchanges).toHaveLength(1 + revocation);
      expect(installs).toHaveLength(1 + revocation);
      expect(reach(shop)).toEqual({ kind: "ready", notice: null });
      await clock.advance(30_000);
    }
    // The repairs the rejections asked for; the person's own after the refusal is a fresh one.
    expect(exchanges.slice(1, AUTH_LOOP_REJECTIONS).every((r) => r.reason === "repair")).toBe(true);
    expect(logs).toContainEqual({
      key: keyOf(shop),
      diagnostic: { kind: "auth-loop", rejections: AUTH_LOOP_REJECTIONS },
    });
  });

  it("lapse → wake → grant → exchange with no user action", async () => {
    const shop = mate("shop");
    const { driver, exchanges, start, reach } = rig([shop]);
    await start({ records: [shop], account: LAPSED });
    expect(exchanges).toHaveLength(0);
    expect(driver.machine(keyOf(shop))?.credential).toMatchObject({
      kind: "waiting",
      on: "access",
    });

    driver.wake(true);
    await flush();
    expect(exchanges).toHaveLength(0);

    driver.setAccount(GRANTED);
    await flush();
    expect(exchanges).toHaveLength(1);
    expect(reach(shop)).toEqual({ kind: "ready", notice: null });
  });

  it("an answer past its deadline is logged stale and never installed", async () => {
    const shop = mate("shop");
    const { driver, clock, exchanges, installs, logs, release, start } = rig([shop], {
      hold: true,
    });
    await start({ records: [shop] });
    await clock.advance(20_000);
    expect(exchanges[0]!.signal.aborted).toBe(true);
    expect(driver.machine(keyOf(shop))?.credential).toMatchObject({
      kind: "backoff",
      last: { kind: "timeout" },
    });

    await release();
    expect(installs).toEqual([]);
    expect(logs).toContainEqual({
      key: keyOf(shop),
      diagnostic: { kind: "stale-result", attempt: 1 },
    });
  });

  it("the background starts a bucket of exchanges at once, then one a gap (I12)", async () => {
    const mates = Array.from({ length: DOOR_MINT_BURST + 2 }, (_, index) => mate(`m${index}`));
    const { clock, exchanges, start } = rig(mates);
    await start({ demand: { reason: "recent", mates } });
    expect(exchanges).toHaveLength(DOOR_MINT_BURST);

    await clock.advance(GAP - 1);
    expect(exchanges).toHaveLength(DOOR_MINT_BURST);
    await clock.advance(1);
    expect(exchanges).toHaveLength(DOOR_MINT_BURST + 1);
    await clock.advance(GAP);
    expect(exchanges).toHaveLength(DOOR_MINT_BURST + 2);
    expect(exchanges.every((request) => request.reason === "restore")).toBe(true);
    expect(exchanges.every((request) => !request.asked)).toBe(true);
  });

  it("a Mate whose session was kept starts past the mint pace, and spends none of it", async () => {
    const restored = Array.from({ length: DOOR_MINT_BURST + 2 }, (_, index) => mate(`k${index}`));
    const fresh = Array.from({ length: DOOR_MINT_BURST }, (_, index) => mate(`f${index}`));
    const { driver, exchanges, start } = rig([...restored, ...fresh], {
      kept: new Set(restored.map(keyOf)),
    });
    await start({ records: restored });

    expect(exchanges).toHaveLength(restored.length);
    for (const each of restored) {
      expect(driver.machine(keyOf(each))?.credential).toMatchObject({ kind: "held" });
    }
    // The bucket is still full: a whole burst of Mates that need a throwaway starts at once.
    driver.setDemand("recent", [...restored, ...fresh].map(keyOf));
    await flush();
    expect(exchanges).toHaveLength(restored.length + DOOR_MINT_BURST);
  });

  // The owner, 2026-10-05: a transient failure heals on its own, its rate bounded — the ladder,
  // then five minutes for a Mate nobody looks at — and a wake asks again at once. Nothing of it
  // outlives the load.
  it("keeps healing a failing background Mate at the capped rate, and a wake asks at once", async () => {
    const old = mate("old");
    old.scriptDoor(...Array.from({ length: RETRY_CAP + 1 }, () => "500" as const));
    const { clock, driver, exchanges, start, reach } = rig([old]);
    await start({ demand: { reason: "recent", mates: [old] } });
    await clock.advance(2_000 + 4_000 + 8_000 + 15_000);
    expect(exchanges).toHaveLength(RETRY_CAP);
    expect(reach(old)).toMatchObject({ kind: "retrying", last: { kind: "server", status: 500 } });

    // At the cap: five minutes between tries.
    await clock.advance(CAPPED_RETRY_MS - 1);
    expect(exchanges).toHaveLength(RETRY_CAP);
    await clock.advance(1);
    expect(exchanges).toHaveLength(RETRY_CAP + 1);

    // A wake releases the pending wait at once, and the Mate heals.
    driver.wake(true);
    await flush();
    expect(exchanges).toHaveLength(RETRY_CAP + 2);
    expect(driver.machine(keyOf(old))?.credential).toMatchObject({ kind: "held" });
  });

  it("starts a failing Mate's ladder over in a new load: no cap outlives the load", async () => {
    const old = mate("old");
    old.scriptDoor(...Array.from({ length: RETRY_CAP }, () => "500" as const));
    const first = rig([old]);
    await first.start({ demand: { reason: "recent", mates: [old] } });
    await first.clock.advance(2_000 + 4_000 + 8_000 + 15_000);
    expect(first.exchanges).toHaveLength(RETRY_CAP);
    first.driver.dispose();

    const next = rig([old]);
    await next.start({ demand: { reason: "recent", mates: [old] } });
    expect(next.exchanges).toHaveLength(1);
  });

  // E2E 2026-10-03: the first write after a fresh load failed while the background minted and
  // deleted throwaways on the same token list the press reads.
  it("holds the background's mints while a press is in flight, never the person's or a kept one", async () => {
    const background = mate("bg");
    const routed = mate("route");
    const restored = mate("kept");
    const { driver, exchanges, start } = rig([background, routed, restored], {
      kept: new Set([keyOf(restored)]),
    });
    driver.holdBackground(true);
    await start({ records: [restored, background], route: routed });
    expect(exchanges.map((request) => request.key).sort()).toEqual(
      [keyOf(restored), keyOf(routed)].sort(),
    );

    driver.holdBackground(false);
    await flush();
    expect(exchanges.map((request) => request.key)).toContain(keyOf(background));
  });

  describe("a Mate the person asks for never waits on the mint budget", () => {
    const records = Array.from({ length: DOOR_MINT_BURST + 2 }, (_, index) => mate(`r${index}`));
    type Ask = (driver: ExchangeDriver, key: TargetKey) => void;
    const byRoute: Ask = (driver, key) => driver.setDemand("route", [key]);
    const byConnect: Ask = (driver, key) => {
      driver.hold(key, "user");
      void driver.connect(key, "user");
    };
    it.each([
      ["the route names it", byRoute],
      ["the person presses Connect", byConnect],
    ] as const)("%s", async (_name, ask) => {
      const asked = mate("asked");
      const { driver, clock, exchanges, start } = rig([...records, asked]);
      await start({ records });
      expect(exchanges).toHaveLength(DOOR_MINT_BURST);

      await clock.advance(1_000);
      ask(driver, keyOf(asked));
      await flush();

      expect(exchanges.map((request) => request.key)).toEqual([
        ...records.slice(0, DOOR_MINT_BURST).map(keyOf),
        keyOf(asked),
      ]);
      expect(exchanges.at(-1)?.asked).toBe(true);
      expect(driver.machine(keyOf(asked))?.credential).toMatchObject({ kind: "held" });

      // The background waits out its gap and the asked-for exchange's.
      await clock.advance(2 * GAP - 1_000 - 1);
      expect(exchanges).toHaveLength(DOOR_MINT_BURST + 1);
      await clock.advance(1);
      expect(exchanges).toHaveLength(DOOR_MINT_BURST + 2);
    });
  });

  it("a route target whose container turns ready exchanges at once after the records spent the bucket", async () => {
    const records = Array.from({ length: DOOR_MINT_BURST + 1 }, (_, index) => mate(`r${index}`));
    const route = mate("route");
    const { driver, clock, exchanges, start } = rig([...records, route]);
    const restarting: ContainerVerdict = { level: "restarting", by: "you", overdue: false };
    const routeTarget = (container: ContainerVerdict) => ({
      key: keyOf(route),
      presence: { kind: "present", origin: route.origin } as const,
      container,
      record: route.descriptor().environmentId,
    });
    // The reload finds our restart under way: the route's container is not ready yet.
    const started = start({ records: [...records, route], route });
    driver.setTargets([routeTarget(restarting)]);
    await started;
    expect(exchanges).toHaveLength(DOOR_MINT_BURST);

    await clock.advance(GAP / 2);
    driver.setTargets([routeTarget({ level: "ready" })]);
    await flush();
    expect(driver.machine(keyOf(route))?.credential).toMatchObject({ kind: "held" });
    expect(exchanges.map((request) => request.key)).toEqual([
      ...records.slice(0, DOOR_MINT_BURST).map(keyOf),
      keyOf(route),
    ]);
  });

  it("a mint the platform throttles holds the background, never the Mate the route names", async () => {
    const records = ["a", "b", "c"].map((id) => mate(id));
    const route = mate("route");
    const { driver, clock, exchanges, start, reach } = rig([...records, route], {
      throttledMints: 1,
    });
    await start({ demand: { reason: "recent", mates: [records[0]!] } });
    expect(exchanges).toHaveLength(1);
    expect(reach(records[0]!)).toMatchObject({
      kind: "retrying",
      last: { kind: "mint", status: 429 },
    });

    driver.setDemand("recent", records.map(keyOf));
    driver.setDemand("route", [keyOf(route)]);
    await flush();
    expect(exchanges.map((request) => request.key)).toEqual([keyOf(records[0]!), keyOf(route)]);

    // The hold ends from an empty bucket, owing the route's mint: then one a gap.
    await clock.advance(DOOR_MINT_THROTTLE_MS + 2 * GAP - 1);
    expect(exchanges).toHaveLength(2);
    await clock.advance(1);
    expect(exchanges.slice(2).map((request) => request.key)).toEqual([keyOf(records[0]!)]);
    await clock.advance(GAP);
    expect(exchanges.slice(2).map((request) => request.key)).toEqual(
      records.slice(0, 2).map(keyOf),
    );
  });

  it("a container turning ready kicks a link in backoff", async () => {
    const shop = mate("shop");
    const { driver, retriedLinks, start } = rig([shop]);
    await start({ records: [shop] });
    const environmentId = EnvironmentId.make("env-shop");
    driver.link(environmentId, { phase: "backoff", retryAtMs: null });
    const target = (container: ContainerVerdict) => ({
      key: keyOf(shop),
      presence: { kind: "present", origin: shop.origin } as const,
      container,
      record: environmentId,
    });
    driver.setTargets([target({ level: "booting", overdue: false })]);
    driver.setTargets([target({ level: "ready" })]);
    await flush();
    expect(retriedLinks).toEqual([environmentId]);
  });

  it("a target retired on absence starts over when the inventory names it again", async () => {
    const shop = mate("shop");
    const { driver, exchanges, start, reach } = rig([shop]);
    await start({ records: [shop] });
    const target = (presence: Presence) => ({
      key: keyOf(shop),
      presence,
      container: { level: "ready" } as const,
      record: EnvironmentId.make("env-shop"),
    });

    driver.setTargets([target({ kind: "gone", evidence: "complete-scope-omits-verified" })]);
    await flush();
    expect(reach(shop)).toEqual({ kind: "gone", because: "complete-scope-omits-verified" });

    driver.setTargets([target({ kind: "present", origin: shop.origin })]);
    await flush();
    expect(exchanges).toHaveLength(2);
    expect(reach(shop)).toEqual({ kind: "ready", notice: null });
  });

  it("an answer to an exchange started before the target was retired is never installed", async () => {
    const shop = mate("shop");
    const { driver, exchanges, installs, logs, release, start } = rig([shop], { hold: true });
    await start({ records: [shop] });
    const target = (presence: Presence) => ({
      key: keyOf(shop),
      presence,
      container: { level: "ready" } as const,
      record: EnvironmentId.make("env-shop"),
    });
    driver.setTargets([target({ kind: "gone", evidence: "complete-scope-omits-verified" })]);
    await flush();
    driver.setTargets([target({ kind: "present", origin: shop.origin })]);
    await flush();
    expect(exchanges).toHaveLength(2);

    // The first exchange's port did not honour the abort: its late answer is stale.
    await release();
    expect(installs).toEqual([]);
    expect(driver.machine(keyOf(shop))?.credential.kind).toBe("exchanging");
    expect(logs).toContainEqual({
      key: keyOf(shop),
      diagnostic: { kind: "stale-result", attempt: 1 },
    });

    await release();
    expect(installs).toHaveLength(1);
  });

  it("deletion ends a pending Connect visibly and discards its late exchange answer", async () => {
    const shop = mate("shop");
    const { driver, exchanges, installs, release, start } = rig([shop], { hold: true });
    await start({});
    let outcome: string | null = null;
    const answer = connectHeld(driver, keyOf(shop), "user").then((result) => {
      outcome = result._tag;
    });
    await flush();
    expect(exchanges).toHaveLength(1);
    driver.setDeleting(shop.projectId, true);
    await flush();
    expect(outcome).toBe("NotConnected");
    expect(exchanges[0]!.signal.aborted).toBe(true);
    await release();
    expect(installs).toEqual([]);
    await answer;
  });

  it("a link block queued after deletion starts no descriptor request", async () => {
    const shop = mate("shop");
    const { driver, exchanges, retriedLinks, start } = rig([shop]);
    await start({ route: shop });
    expect(exchanges).toHaveLength(1);
    const reads = shop.descriptorReads();
    driver.setDeleting(shop.projectId, true);
    driver.link(EnvironmentId.make("env-shop"), { phase: "blocked", reason: "configuration" });
    await flush();
    expect(shop.descriptorReads()).toBe(reads);
    expect(driver.machine(keyOf(shop))?.guards.want).toBe(false);
    await expect(connectHeld(driver, keyOf(shop), "user")).resolves.toMatchObject({
      _tag: "NotConnected",
    });
    expect(retriedLinks).toEqual([]);
    expect(shop.descriptorReads()).toBe(reads);
  });

  // The close-off gate (restores 0.12.3's closeOffGate): a Mate whose project is not closed off
  // takes no lease's demand and no Connect, until the gate lets it go.
  it("a Mate held for its close-off is wanted by nothing, and by its leases again once let go", async () => {
    const shop = mate("shop");
    const other = mate("other");
    const { driver, exchanges, start } = rig([shop, other], { hold: true });
    await start({ route: shop });
    expect(exchanges).toHaveLength(1);
    driver.setCloseOffHeld([shop.projectId]);
    await flush();
    expect(exchanges[0]!.signal.aborted).toBe(true);
    expect(driver.machine(keyOf(shop))?.guards.want).toBe(false);
    await expect(connectHeld(driver, keyOf(shop), "user")).resolves.toMatchObject({
      _tag: "NotConnected",
    });
    expect(exchanges).toHaveLength(1);
    driver.hold(keyOf(other), "action");
    await flush();
    expect(driver.machine(keyOf(other))?.guards.want).toBe(true);

    driver.setCloseOffHeld([]);
    await flush();
    expect(driver.machine(keyOf(shop))?.guards.want).toBe(true);
    expect(exchanges.filter((request) => request.key === keyOf(shop))).toHaveLength(2);
  });

  // A9 (krok-a-hub §3): a Mate is wanted while something holds a lease on it — the route, the one
  // left last, an action from the sidebar — and no longer once its last holder lets it go.
  it("an action lease ends its demand when released", async () => {
    const shop = mate("shop");
    const { driver, start } = rig([shop], { hold: true });
    await start({});
    const wanted = () => driver.machine(keyOf(shop))?.guards.want;
    expect(wanted()).toBe(false);

    const first = driver.hold(keyOf(shop), "action");
    const second = driver.hold(keyOf(shop), "action");
    await flush();
    expect(wanted()).toBe(true);

    first();
    first();
    await flush();
    expect(wanted()).toBe(true);
    second();
    await flush();
    expect(wanted()).toBe(false);
  });

  it("the user's Connect answers once the credential is installed, or with why it is not", async () => {
    const shop = mate("shop");
    const readOnly = mate("ro");
    readOnly.scriptDoor("read-only");
    const { driver, start } = rig([shop, readOnly]);
    await start({});

    await expect(connectHeld(driver, keyOf(shop), "user")).resolves.toEqual({
      _tag: "Connected",
      environmentId: EnvironmentId.make("env-shop"),
    });
    await expect(connectHeld(driver, keyOf(readOnly), "user")).resolves.toMatchObject({
      _tag: "NotConnected",
      reachability: { kind: "refused-role" },
    });
  });

  it("connect on a key no target names answers NotConnected(resolving) and exchanges once setTargets names it present", async () => {
    const shop = mate("shop");
    const { driver, exchanges, installs, reach } = rig([shop]);
    driver.setAccount(GRANTED);
    driver.setVisible(true);
    await flush();

    await expect(connectHeld(driver, keyOf(shop), "user")).resolves.toMatchObject({
      _tag: "NotConnected",
      reachability: { kind: "resolving" },
    });
    expect(exchanges).toEqual([]);

    driver.setTargets([
      {
        key: keyOf(shop),
        presence: { kind: "present", origin: shop.origin },
        container: { level: "ready" },
        record: null,
      },
    ]);
    await flush();
    expect(exchanges).toHaveLength(1);
    expect(installs).toHaveLength(1);
    expect(reach(shop)).toEqual({ kind: "ready", notice: null });
  });

  describe("a credential this tab could not install backs off, and the user's Connect says why", () => {
    it.each(["answers", "throws"] as const)("the install %s", async (failure) => {
      const shop = mate("shop");
      const { driver, clock, exchanges, installs, start, reach } = rig([shop], {
        failedInstalls: [failure],
      });
      await start({});

      await expect(connectHeld(driver, keyOf(shop), "user")).resolves.toMatchObject({
        _tag: "NotConnected",
        reachability: { kind: "retrying", last: { kind: "install" } },
      });
      expect(installs).toHaveLength(1);

      await clock.advance(2_000);
      expect(exchanges).toHaveLength(2);
      expect(installs).toHaveLength(2);
      expect(reach(shop)).toEqual({ kind: "ready", notice: null });
      // The registry took the second one: the ladder starts over.
      expect(driver.machine(keyOf(shop))).toMatchObject({
        credential: { kind: "held", installed: true },
        failures: 0,
      });
    });
  });

  it("drops every answer and timer once disposed", async () => {
    const shop = mate("shop");
    const { driver, clock, exchanges, installs, release, start } = rig([shop], { hold: true });
    await start({ records: [shop] });
    driver.dispose();
    expect(exchanges[0]!.signal.aborted).toBe(true);
    await release();
    await clock.advance(10 * 60_000);
    expect(installs).toEqual([]);
    expect(exchanges).toHaveLength(1);
  });
});
