import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  CONTAINER_CAPS_MS,
  initialContainer,
  transitionContainer,
  type ContainerEffect,
  type ContainerEvent,
  type ContainerMachine,
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

const hq = (online: boolean): ContainerEvent => ({ type: "HQ", online });

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
