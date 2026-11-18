import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  CONTAINER_CAPS_MS,
  containerVerdict,
  initialContainer,
  probeCadence,
  transitionContainer,
  type ContainerEffect,
  type ContainerEvent,
  type ContainerMachine,
  type HqPresence,
} from "./containerMachine.ts";
import { containerHealthOf } from "./containerRows.ts";
import type { Instant } from "./exchange.ts";
import type { ProbeReading } from "./probe.ts";

const START_MS = 1_800_000_000_000;

const instant = (ms: number): Instant => ({ wall: ms, mono: ms - START_MS });

const READY: ProbeReading = {
  kind: "ready",
  descriptor: {
    environmentId: EnvironmentId.make("env-a"),
    serverVersion: "0.11.40",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId: "project-1",
  initAt: null,
};

const platform = (service: string): ContainerEvent => ({
  type: "PLATFORM",
  status: { project: "ACTIVE", service },
});

const hq = (online: boolean): ContainerEvent => ({
  type: "HQ",
  presence: online ? "live" : "offline",
});

const hqSays = (presence: HqPresence | null): ContainerEvent => ({ type: "HQ", presence });

const ZCP_INIT_AT = "2026-11-18T08:00:00Z";

/** zcp's init is done and no Mate answers: what a probe reads while a Mate's unit restarts. */
const silent = (sentMs: number): ContainerEvent => ({
  type: "PROBED",
  reading: { kind: "not-answering", initAt: ZCP_INIT_AT },
  sentAt: instant(sentMs),
});

const answered = (sentMs: number): ContainerEvent => ({
  type: "PROBED",
  reading: { ...READY, initAt: ZCP_INIT_AT },
  sentAt: instant(sentMs),
});

const dropped = (mateRestarting: boolean): ContainerEvent =>
  mateRestarting
    ? { type: "LINK", connected: false, mateRestarting: true }
    : { type: "LINK", connected: false };

/** A tab whose socket holds a ready Mate HQ says is live. */
const connected = (watched: boolean): Step =>
  feed(
    [platform("ACTIVE"), answered(START_MS + 500), hq(true), { type: "LINK", connected: true }],
    watched,
  );

/** A tab with no socket to a Mate HQ says is restarting, opened on it and read for a minute. */
const announcedUnanswered = (): Step => {
  let step = feed([platform("ACTIVE"), hqSays("restarting")], true);
  for (let ms = 2_000; ms <= 60_000; ms += 2_000) {
    step = at(step, silent(step.nowMs + 1), step.nowMs + 2_000, true);
  }
  return step;
};

interface Step {
  readonly machine: ContainerMachine;
  readonly effects: ReadonlyArray<ContainerEffect>;
  readonly nowMs: number;
}

/** Feeds events one second apart, each with the same `watched`; returns the last step. */
const feed = (
  events: ReadonlyArray<ContainerEvent>,
  watched: boolean,
  from: Step = { machine: initialContainer(), effects: [], nowMs: START_MS },
): Step => {
  let step = from;
  for (const event of events) {
    const nowMs = step.nowMs + 1_000;
    const next = transitionContainer(step.machine, event, { now: instant(nowMs), watched });
    step = { machine: next.state, effects: next.effects, nowMs };
  }
  return step;
};

/** One event at `nowMs`. */
const at = (step: Step, event: ContainerEvent, nowMs: number, watched: boolean): Step => {
  const next = transitionContainer(step.machine, event, { now: instant(nowMs), watched });
  return { machine: next.state, effects: next.effects, nowMs };
};

const kinds = (effects: ReadonlyArray<ContainerEffect>) => effects.map((effect) => effect.kind);

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | hqSaysOnlineComingUp(next) && !read → hqSaysOnlineComingUp(next) && read
it("EN1: A Mate HQ says is online, in a tab that reads nothing of it, is never said to be starting or late there: its container reads as not read yet, as in a tab loaded since", () => {
  const booting = feed([platform("CREATING"), platform("ACTIVE")], false);
  expect(booting.machine.state.level).toBe("booting");

  const online = feed([hq(true)], false, booting);
  expect(online.machine.state).toEqual({ level: "unknown" });
  expect(online.machine.overdue).toBe(false);
  expect(online.machine.reading).toBeNull();
  expect(kinds(online.effects)).not.toContain("probe");

  const past = at(online, { type: "TICK" }, booting.nowMs + CONTAINER_CAPS_MS.booting + 1, false);
  expect(past.machine.state).toEqual({ level: "unknown" });
  expect(past.machine.overdue).toBe(false);
  expect(past.machine.reading).toBeNull();
  expect(kinds(past.effects)).not.toContain("probe");
  expect(containerHealthOf(past.machine)).toBeUndefined();
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | probeCadence(machine).kind === "poll" || hqSaysOnlineComingUp(machine); → probeCadence(machine).kind === "poll";
it("EN2: A Mate coming up that HQ says is online and somebody waits on is read when its cap runs out, and is late only once a reading sent since then finds it still not up", () => {
  const booting = feed([platform("CREATING"), platform("ACTIVE")], true);
  const online = feed([hq(true)], true, booting);
  expect(kinds(online.effects)).toEqual(["probe"]);
  expect(online.machine.state.level).toBe("booting");

  const capEndMs = online.machine.timer!.wall;
  const lapsed = at(online, { type: "TICK" }, capEndMs, true);
  expect(lapsed.machine.state.level).toBe("booting");
  expect(lapsed.machine.overdue).toBe(false);
  expect(kinds(lapsed.effects)).toContain("probe");

  const read = at(
    lapsed,
    {
      type: "PROBED",
      reading: { kind: "initializing", initAt: null },
      sentAt: instant(capEndMs + 1),
    },
    capEndMs + 500,
    true,
  );
  expect(read.machine.state.level).toBe("booting");
  expect(read.machine.overdue).toBe(true);
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | const read = ctx.watched || next.intent !== null; → const read = ctx.watched;
it("EN3: A restart this tab asked for is ended only by a reading or a connect, never by HQ's word that its Mate is online", () => {
  const ready = feed(
    [
      platform("ACTIVE"),
      { type: "PROBED", reading: READY, sentAt: instant(START_MS + 1_500) },
      hq(true),
    ],
    false,
  );
  expect(ready.machine.state.level).toBe("ready");

  const restart = feed(
    [
      { type: "INTENT", intent: { kind: "restart", since: instant(ready.nowMs + 1_000) } },
      hq(false),
      hq(true),
    ],
    false,
    ready,
  );
  expect(restart.machine.state.level).toBe("restarting");
  expect(restart.machine.intent?.kind).toBe("restart");
  expect(kinds(restart.effects)).toEqual(["probe"]);
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | next = withTimer({ ...moveTo(next, { level: "unknown" }), reading: null }); → next = withTimer(moveTo(next, { level: "unknown" }));
it("EN4: A Mate somebody else restarted, in a tab that reads nothing of it, is not said to be restarting once HQ says it is online again, and nothing read before the restart speaks for it after", () => {
  const ready = feed(
    [
      platform("ACTIVE"),
      { type: "PROBED", reading: READY, sentAt: instant(START_MS + 1_500) },
      hq(true),
    ],
    false,
  );
  const restarting = feed([platform("RESTARTING"), hq(false), platform("ACTIVE")], false, ready);
  expect(restarting.machine.state.level).toBe("restarting");

  const online = feed([hq(true)], false, restarting);
  expect(online.machine.state).toEqual({ level: "unknown" });
  expect(online.machine.reading).toBeNull();

  const process = feed([{ type: "PROCESS", running: true }], false, online);
  expect(process.machine.state).toEqual({ level: "unknown" });
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | return presence === "restarting" ? settleLevel(announce(next, now), now) : next; → return next;
it("EN5: A Mate HQ says is restarting is said to be restarting in a tab with no socket to it, though every probe of it goes unanswered: never that it isn't answering", () => {
  const step = announcedUnanswered();
  expect(containerVerdict(step.machine)).toEqual({
    level: "restarting",
    by: "announced",
    overdue: false,
  });
  // HQ's word reads it, never a poll.
  expect(probeCadence(step.machine, true)).toEqual({ kind: "on-demand" });
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | (event.mateRestarting === true || linked.hq === "restarting") → (linked.hq === "restarting")
it("EN6: A socket its Mate closed as a planned restart starts that restart before HQ has said anything", () => {
  const planned = feed([dropped(true)], true, connected(true));
  expect(containerVerdict(planned.machine)).toEqual({
    level: "restarting",
    by: "announced",
    overdue: false,
  });

  const lost = feed([dropped(false)], true, connected(true));
  expect(containerVerdict(lost.machine)).toEqual({ level: "ready" });
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | ? settleLevel(moveTo(next, { ...state, platformEnded: now }), now) → ? next
it("EN7: An announced restart ends on a connect, or on a reading sent after HQ goes from restarting to live, and that change asks for the reading once; HQ's word alone never says the Mate is ready, and a live word HQ held before the restart began ends nothing", () => {
  const restarting = announcedUnanswered();

  const reconnected = feed([{ type: "LINK", connected: true }], true, restarting);
  expect(containerVerdict(reconnected.machine)).toEqual({ level: "ready" });

  const live = feed([hqSays("live")], true, restarting);
  expect(kinds(live.effects)).toEqual(["probe"]);
  expect(containerVerdict(live.machine)).toEqual({
    level: "restarting",
    by: "announced",
    overdue: false,
  });
  const again = feed([hqSays("live")], true, live);
  expect(kinds(again.effects)).toEqual([]);
  const back = at(live, answered(live.nowMs + 100), live.nowMs + 600, true);
  expect(containerVerdict(back.machine)).toEqual({ level: "ready" });

  // A tab that reads nothing of it, its socket closed as a planned restart while HQ says live.
  const held = feed([dropped(true), silent(START_MS + 6_000)], false, connected(false));
  expect(containerVerdict(held.machine)).toEqual({
    level: "restarting",
    by: "announced",
    overdue: false,
  });
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | return settleLevel(moveTo(next, { level: "unknown" }), now); → return next;
it("EN8: When HQ says a restarting Mate is offline, the tab says what its readings say, as if no restart had been announced", () => {
  const offline = feed([hqSays("offline")], true, announcedUnanswered());

  let unannounced = feed([platform("ACTIVE"), hqSays("offline")], true);
  for (let ms = 2_000; ms <= 60_000; ms += 2_000) {
    unannounced = at(unannounced, silent(unannounced.nowMs + 1), unannounced.nowMs + 2_000, true);
  }
  expect(containerVerdict(unannounced.machine)).toEqual({
    level: "booting",
    overdue: false,
    guessed: true,
  });
  expect(containerVerdict(offline.machine)).toEqual(containerVerdict(unannounced.machine));
});

// witness: packages/client-runtime/src/zerops/environments/containerMachine.ts | if (machine.connectedSince !== null || machine.hq === "offline") return machine; → if (machine.hq === "offline") return machine;
it("EN9: HQ saying restarting changes nothing while this tab's socket to the Mate is connected, and a restart the platform or this tab's own verb holds keeps its own name", () => {
  const linked = feed([hqSays("restarting")], true, connected(true));
  expect(containerVerdict(linked.machine)).toEqual({ level: "ready" });

  const ready = feed([platform("ACTIVE"), answered(START_MS + 500), hq(true)], true);
  const platformRestart = feed([platform("RESTARTING"), hqSays("restarting")], true, ready);
  expect(containerVerdict(platformRestart.machine)).toEqual({
    level: "restarting",
    by: "platform",
    overdue: false,
  });
  const ours = feed(
    [
      { type: "INTENT", intent: { kind: "restart", since: instant(ready.nowMs + 1_000) } },
      hqSays("restarting"),
    ],
    true,
    ready,
  );
  expect(containerVerdict(ours.machine)).toEqual({
    level: "restarting",
    by: "you",
    overdue: false,
  });
});
