import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsThrowawayPlatform } from "../../authorization/zeropsThrowaway.ts";
import { DOOR_MINTS_PER_MINUTE } from "../doorThrowaway.ts";
import { descriptorFacts, exchangeAtDoor } from "../identityExchange.ts";
import { makeFakeMate, type FakeMate, type FakeMateCredential } from "../testing/fakeMate.ts";
import {
  AUTH_LOOP_REJECTIONS,
  type ContainerVerdict,
  type EnvironmentDiagnostic,
  type Presence,
} from "./environmentMachine.ts";
import {
  EXCHANGE_CONCURRENCY,
  makeExchangeDriver,
  type AccountGuards,
  type DemandReason,
  type ExchangeClock,
  type ExchangeDriver,
  type ExchangeRequest,
  type TargetKey,
} from "./exchangeDriver.ts";
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

const platform: ZeropsThrowawayPlatform = {
  mint: async () => ({ id: "token", token: "throwaway" }),
  remove: async () => undefined,
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
  } = {},
): Rig {
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
        },
        request.origin,
        { reason: request.reason, expectedProjectId: mate.projectId },
      );
    },
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
    refreshPresence: () => undefined,
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
      driver.setDemand("record", (input.records ?? []).map(keyOf));
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
    driver.setDemand("auto-connect", [keyOf(cafe)]);
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

  it("a revoked session re-exchanges with backoff, repeatedly", async () => {
    const shop = mate("shop");
    const { driver, clock, exchanges, installs, logs, start, reach } = rig([shop]);
    await start({ records: [shop] });
    const environmentId = EnvironmentId.make("env-shop");
    expect(reach(shop)).toEqual({ kind: "ready", notice: null });

    // Revoked every 30 s: from the third rejection on, the loop window holds three of them.
    for (let revocation = 1; revocation <= 6; revocation += 1) {
      shop.revokeSessions();
      driver.link(environmentId, { phase: "blocked", reason: "authentication" });
      // The supervisor re-attempts with the revoked credential while the new one is exchanged.
      driver.link(environmentId, { phase: "blocked", reason: "authentication" });
      await flush();
      if (revocation >= AUTH_LOOP_REJECTIONS) {
        expect(exchanges).toHaveLength(revocation);
        expect(reach(shop)).toMatchObject({ kind: "retrying", last: { kind: "rejected" } });
        await clock.advance(2_000);
      }
      expect(exchanges).toHaveLength(1 + revocation);
      expect(installs).toHaveLength(1 + revocation);
      expect(reach(shop)).toEqual({ kind: "ready", notice: null });
      await clock.advance(30_000);
    }
    expect(exchanges.slice(1).every((request) => request.reason === "repair")).toBe(true);
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

  it("this tab mints at most ten exchanges a minute (I12)", async () => {
    const mates = Array.from({ length: 12 }, (_, index) => mate(`m${index}`));
    const { clock, exchanges, start } = rig(mates);
    await start({ demand: { reason: "auto-connect", mates } });
    expect(exchanges).toHaveLength(DOOR_MINTS_PER_MINUTE);

    await clock.advance(59_000);
    expect(exchanges).toHaveLength(DOOR_MINTS_PER_MINUTE);
    await clock.advance(1_000);
    expect(exchanges).toHaveLength(12);
    expect(exchanges.every((request) => request.reason === "auto-connect")).toBe(true);
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

  it("the user's Connect answers once the credential is installed, or with why it is not", async () => {
    const shop = mate("shop");
    const readOnly = mate("ro");
    readOnly.scriptDoor("read-only");
    const { driver, start } = rig([shop, readOnly]);
    await start({});

    await expect(driver.connect(keyOf(shop), "user")).resolves.toEqual({
      _tag: "Connected",
      environmentId: EnvironmentId.make("env-shop"),
    });
    await expect(driver.connect(keyOf(readOnly), "user")).resolves.toMatchObject({
      _tag: "NotConnected",
      reachability: { kind: "refused-role" },
    });
  });

  describe("a credential this tab could not install backs off, and the user's Connect says why", () => {
    it.each(["answers", "throws"] as const)("the install %s", async (failure) => {
      const shop = mate("shop");
      const { driver, clock, exchanges, installs, start, reach } = rig([shop], {
        failedInstalls: [failure],
      });
      await start({});

      await expect(driver.connect(keyOf(shop), "user")).resolves.toMatchObject({
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
