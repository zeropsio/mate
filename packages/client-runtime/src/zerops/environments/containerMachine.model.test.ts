import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { Instant } from "../data/access/grant.ts";
import { explore } from "../testing/explore.ts";
import {
  CONTAINER_CAPS_MS,
  initialContainer,
  transitionContainer,
  type ContainerEvent,
  type ContainerMachine,
} from "./containerMachine.ts";
import type { ProbeReading } from "./probeStore.ts";

/**
 * DESIGN §11.3 I13 over every event sequence the container store can send one target, breadth
 * first to depth 6, deduplicated by state: no level changes on a timer, and a cap only sets
 * `overdue`. Time stands still between events, moves a few seconds on `LATER`, and jumps to the
 * machine's own timer on `TICK`.
 */
const DEPTH = 6;
const START_MS = 1_800_000_000_000;

const instant = (ms: number): Instant => ({ wall: ms, mono: ms - START_MS });

const ready = (serverVersion: string, initAt: string | null): ProbeReading => ({
  kind: "ready",
  descriptor: {
    environmentId: EnvironmentId.make("env-a"),
    serverVersion,
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  initAt,
});

const READINGS: ReadonlyArray<ProbeReading> = [
  ready("0.11.40", "2026-09-23T08:00:00Z"),
  ready("0.11.41", "2026-09-23T09:00:00Z"),
  { kind: "initializing", initAt: "2026-09-23T09:00:00Z" },
  { kind: "unreachable" },
  { kind: "predates-mate" },
];

type ModelEvent =
  | { readonly type: "LATER" }
  | { readonly type: "PROBED"; readonly reading: ProbeReading; readonly sentAgoMs: number }
  | Exclude<ContainerEvent, { readonly type: "PROBED" | "INTENT" }>
  | { readonly type: "INTENT"; readonly kind: "restart" | "enable" | "update" };

const EVENTS: ReadonlyArray<ModelEvent> = [
  { type: "LATER" },
  { type: "TICK" },
  { type: "PLATFORM", status: { project: "CREATING", service: null } },
  { type: "PLATFORM", status: { project: "ACTIVE", service: "STARTING" } },
  { type: "PLATFORM", status: { project: "ACTIVE", service: "ACTIVE" } },
  { type: "PLATFORM", status: { project: "ACTIVE", service: "RESTARTING" } },
  { type: "PLATFORM", status: { project: "STOPPED", service: null } },
  { type: "PROCESS", running: true },
  { type: "PROCESS", running: false },
  ...READINGS.flatMap((reading): ReadonlyArray<ModelEvent> => [
    { type: "PROBED", reading, sentAgoMs: 0 },
    { type: "PROBED", reading, sentAgoMs: 10_000 },
  ]),
  { type: "LINK", connected: true },
  { type: "LINK", connected: false },
  { type: "MATE_FLAG", flag: false },
  { type: "MATE_FLAG", flag: "unknown" },
  { type: "INTENT", kind: "restart" },
  { type: "INTENT", kind: "enable" },
  { type: "INTENT", kind: "update" },
];

interface ModelState {
  readonly machine: ContainerMachine;
  readonly nowMs: number;
}

const toEvent = (event: ModelEvent, nowMs: number): ContainerEvent | null => {
  switch (event.type) {
    case "LATER":
      return null;
    case "PROBED":
      return { type: "PROBED", reading: event.reading, sentAt: instant(nowMs - event.sentAgoMs) };
    case "INTENT":
      return {
        type: "INTENT",
        intent:
          event.kind === "update"
            ? { kind: "update", since: instant(nowMs), from: "0.11.40" }
            : { kind: event.kind, since: instant(nowMs) },
      };
    default:
      return event;
  }
};

const step = (state: ModelState, event: ModelEvent): { readonly state: ModelState } => {
  if (event.type === "LATER") return { state: { ...state, nowMs: state.nowMs + 5_000 } };
  const timer = state.machine.timer;
  const nowMs =
    event.type === "TICK" && timer !== null ? Math.max(state.nowMs, timer.wall) : state.nowMs;
  const next = transitionContainer(state.machine, toEvent(event, nowMs)!, {
    now: instant(nowMs),
  }).state;
  return {
    state: next === state.machine && nowMs === state.nowMs ? state : { machine: next, nowMs },
  };
};

/** Two states share a key when they differ only by a shift of the clock: instants key relative to now. */
const keyOf = ({ machine, nowMs }: ModelState): string =>
  JSON.stringify(machine, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null && "wall" in value && "mono" in value) {
      const at = value as Instant;
      return [at.wall - nowMs, at.mono - (nowMs - START_MS)];
    }
    return value;
  });

const CAPPED: ReadonlySet<string> = new Set(Object.keys(CONTAINER_CAPS_MS));

const violations = (before: ModelState, event: ModelEvent, after: ModelState): Array<string> => {
  const found: Array<string> = [];
  const was = before.machine;
  const is = after.machine;
  // I13: no level changes on a timer; the cap only sets `overdue`.
  if (event.type === "TICK" || event.type === "LATER") {
    if (JSON.stringify(was.state) !== JSON.stringify(is.state)) {
      found.push(`I13: ${event.type} moved ${was.state.level} to ${is.state.level}`);
    }
    if (JSON.stringify(was.intent) !== JSON.stringify(is.intent)) {
      found.push(`I13: ${event.type} changed the intent`);
    }
  }
  if (was.state.level === is.state.level && was.overdue && !is.overdue) {
    found.push(`I13: ${is.state.level} lost overdue without a level change`);
  }
  if (is.overdue && !CAPPED.has(is.state.level)) {
    found.push(`overdue on ${is.state.level}, which has no cap`);
  }
  // Every capped level that is not yet overdue has its cap armed, unless a process holds it.
  const held = is.state.level === "booting" && is.processRunning;
  if (CAPPED.has(is.state.level) && !is.overdue && !held && is.timer === null) {
    found.push(`I7: ${is.state.level} waits with no cap armed`);
  }
  if (is.intent !== null && is.state.level !== "restarting" && is.state.level !== "updating") {
    found.push(`an intent outlived its level (${is.state.level})`);
  }
  return found;
};

describe("container invariants (DESIGN §11.3 I13) over enumerated event sequences", () => {
  it(`holds for every sequence to depth ${DEPTH}`, { timeout: 30_000 }, () => {
    const report = explore({
      roots: [{ machine: initialContainer(), nowMs: START_MS }],
      depth: DEPTH,
      events: () => EVENTS,
      step,
      key: keyOf,
      check: (before, event, { state: after }) => violations(before, event, after),
    });
    expect(report.violations.slice(0, 3)).toEqual([]);
    expect(report.transitions).toBeGreaterThan(10_000);
  });
});
