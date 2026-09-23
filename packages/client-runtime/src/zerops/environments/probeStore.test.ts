import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ExchangeClock } from "./exchangeDriver.ts";
import {
  makeProbeStore,
  OVERDUE_PROBE_SLOTS,
  PROBE_DEADLINE_MS,
  PROBE_POOL_SIZE,
  type ProbeCadence,
  type ProbeReading,
} from "./probeStore.ts";

/** Answers settle across a few promise hops; this lets every one of them land. */
const flush = async (): Promise<void> => {
  for (let hop = 0; hop < 50; hop += 1) await Promise.resolve();
};

/**
 * Wall and monotonic time moving together; what is already settled lands first, then timers fire
 * in order, each followed by a flush.
 */
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
  };
}

const READY: ProbeReading = {
  kind: "ready",
  descriptor: {
    environmentId: EnvironmentId.make("env-a"),
    serverVersion: "0.11.40",
    update: null,
    identity: "unknown",
    identityCheckedAt: null,
  },
  projectId: "project-1",
  initAt: null,
};

interface Rig {
  readonly clock: ReturnType<typeof manualClock>;
  readonly store: ReturnType<typeof makeProbeStore>;
  /** Every probe started, by origin, in order. */
  readonly started: Array<string>;
  /** The probes in flight right now, by origin. */
  readonly inFlight: Map<string, number>;
  readonly peak: { overdue: number; all: number };
}

/** A pool whose `hanging` origins never answer; every other origin answers ready at once. */
function rig(input: {
  readonly hanging?: ReadonlySet<string>;
  readonly overdue?: ReadonlySet<string>;
}): Rig {
  const clock = manualClock();
  const started: Array<string> = [];
  const inFlight = new Map<string, number>();
  const peak = { overdue: 0, all: 0 };
  const count = (origin: string, delta: number) => {
    inFlight.set(origin, (inFlight.get(origin) ?? 0) + delta);
    const all = [...inFlight.values()].reduce((sum, value) => sum + value, 0);
    const overdue = [...inFlight]
      .filter(([key]) => input.overdue?.has(key) === true)
      .reduce((sum, [, value]) => sum + value, 0);
    peak.all = Math.max(peak.all, all);
    peak.overdue = Math.max(peak.overdue, overdue);
  };
  const store = makeProbeStore({
    clock,
    probe: (origin, signal) => {
      started.push(origin);
      count(origin, 1);
      if (input.hanging?.has(origin) !== true) {
        count(origin, -1);
        return Promise.resolve(READY);
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          count(origin, -1);
          reject(new Error("aborted"));
        });
      });
    },
  });
  return { clock, store, started, inFlight, peak };
}

const poll = (overdue: boolean): ProbeCadence => ({ kind: "poll", overdue });

describe("probe store (DESIGN §4.5 probes)", () => {
  it("an overdue origin cannot starve the pool", async () => {
    const overdue = new Set(["o1", "o2", "o3", "o4", "o5"]);
    const { clock, store, started, peak } = rig({ hanging: overdue, overdue });
    store.setCadences(
      new Map([...[...overdue].map((origin) => [origin, poll(true)] as const), ["b", poll(false)]]),
    );
    await clock.advance(20_000);

    // The booting origin is read on its 2 s cadence the whole time.
    expect(started.filter((origin) => origin === "b").length).toBeGreaterThanOrEqual(10);
    // Overdue origins share at most their slots, and each of them still gets its turn.
    expect(peak.overdue).toBeLessThanOrEqual(OVERDUE_PROBE_SLOTS);
    expect(peak.all).toBeLessThanOrEqual(PROBE_POOL_SIZE);
    for (const origin of overdue) expect(started).toContain(origin);
    expect(PROBE_DEADLINE_MS).toBe(8_000);
    store.dispose();
  });

  it("an origin is unread until a probe answers, and a probe ends by its deadline", async () => {
    const { clock, store } = rig({ hanging: new Set(["a"]) });
    expect(store.fact("a")).toEqual({ status: "unread" });
    store.request("a");
    await clock.advance(PROBE_DEADLINE_MS - 1);
    expect(store.fact("a")).toEqual({ status: "unread" });
    await clock.advance(1);
    expect(store.fact("a")).toEqual({
      status: "read",
      reading: { kind: "unreachable" },
      sentAt: { wall: 1_800_000_000_000, mono: 0 },
    });
    store.dispose();
  });

  it("polls every 2 s, and once overdue at 10 s rising to 60 s", async () => {
    const { clock, store, started } = rig({});
    store.setCadences(new Map([["a", poll(false)]]));
    await clock.advance(6_000);
    expect(started).toEqual(["a", "a", "a", "a"]);

    started.length = 0;
    store.setCadences(new Map([["a", poll(true)]]));
    await clock.advance(10_000 + 20_000 + 40_000 + 60_000 + 60_000);
    expect(started).toEqual(["a", "a", "a", "a", "a"]);

    // An origin that stops polling is read only when asked.
    started.length = 0;
    store.setCadences(new Map([["a", { kind: "on-demand" }]]));
    await clock.advance(120_000);
    expect(started).toEqual([]);
    store.request("a");
    await clock.advance(0);
    expect(started).toEqual(["a"]);
    store.dispose();
  });

  it("an overdue poll that begins on a fresh reading backs off from that reading", async () => {
    const { clock, store, started } = rig({});
    store.setCadences(new Map([["a", { kind: "on-demand" }]]));
    store.request("a");
    await clock.advance(0);
    expect(started).toEqual(["a"]);

    // The reading just landed turns the container's cadence to an overdue poll: no second probe.
    store.setCadences(new Map([["a", poll(true)]]));
    await clock.advance(10_000 - 1);
    expect(started).toEqual(["a"]);
    await clock.advance(1 + 20_000);
    expect(started).toEqual(["a", "a", "a"]);

    // A timely poll still reads at once.
    started.length = 0;
    store.setCadences(new Map([["b", { kind: "on-demand" }]]));
    store.request("b");
    await clock.advance(0);
    store.setCadences(new Map([["b", poll(false)]]));
    await clock.advance(0);
    expect(started).toEqual(["b", "b"]);
    store.dispose();
  });

  it("a tab hidden for a minute probes nothing until it is shown", async () => {
    const { clock, store, started } = rig({});
    store.setCadences(new Map([["a", poll(false)]]));
    store.setVisible(false);
    await clock.advance(60_000);
    started.length = 0;
    await clock.advance(60_000);
    store.request("a");
    await clock.advance(0);
    expect(started).toEqual([]);

    store.setVisible(true);
    await clock.advance(0);
    expect(started).toEqual(["a"]);
    store.dispose();
  });

  it("next answers with a probe started after it was asked", async () => {
    const { clock, store, started } = rig({});
    store.setCadences(new Map([["a", { kind: "on-demand" }]]));
    const answer = store.next("a");
    await clock.advance(0);
    expect(started).toEqual(["a"]);
    expect(await answer).toEqual(READY);
    store.dispose();
  });

  it("next on an origin no target holds is answered across a change of targets", async () => {
    const clock = manualClock();
    const answers = new Map<string, (reading: ProbeReading) => void>();
    const store = makeProbeStore({
      clock,
      probe: (origin) => new Promise((resolve) => answers.set(origin, resolve)),
    });
    const targets = new Map<string, ProbeCadence>([["a", { kind: "on-demand" }]]);
    const settled = new Map<string, ProbeReading>();
    const track = (origin: string) => {
      void store.next(origin).then((reading) => settled.set(origin, reading));
    };

    // In flight when the targets change: its own reading answers it.
    track("b");
    await clock.advance(0);
    store.setCadences(targets);
    answers.get("b")?.(READY);
    await clock.advance(0);
    expect(settled.get("b")).toEqual(READY);

    // Nobody waits on it any more: the next change of targets lets it go.
    store.setCadences(targets);
    expect(store.fact("b")).toEqual({ status: "unread" });

    // Not started yet (the tab is hidden) when the targets change: the account closing answers it.
    store.setVisible(false);
    await clock.advance(60_000);
    track("c");
    store.setCadences(targets);
    await clock.advance(0);
    expect(settled.has("c")).toBe(false);
    store.dispose();
    await clock.advance(0);
    expect(settled.get("c")).toEqual({ kind: "unreachable" });
  });
});
