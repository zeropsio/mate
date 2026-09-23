/**
 * One Mate container — keyed by its target, `projectId:serviceId` — as one pure machine (DESIGN
 * §4.5): `transitionContainer(state, event, ctx) → { state, effects }`.
 *
 * - **Levels change only on read facts**: a platform status push, a process the activity feed
 *   reports, a probe reading, a link connect, the Mate flag's read, or an intent our own verb
 *   created. A cap past its budget sets `overdue` on the current level and changes nothing else
 *   (MC-13, I13).
 * - A reading counts for a level only if its probe was sent after the level began: the old server
 *   answering before a restart takes it down never ends that restart.
 * - Our restart shows `restarting(you)` and our update `updating`, from the verb's acceptance
 *   until a read fact proves the container back: a link connect after the intent, a changed
 *   `/healthz` `initAt`, a reading sent after the platform's own restart process ended, or — for
 *   an update — a descriptor on another version.
 * - A live socket outranks every guess but `inactive`: a connect ends booting at once.
 */
import type { Instant } from "../data/access/grant.ts";
import type { ContainerVerdict } from "./environmentMachine.ts";
import type { ProbeCadence, ProbeReading } from "./probeStore.ts";

// ── Facts ─────────────────────────────────────────────────────────────────────────────────────

/** The platform's statuses for the target's project and its zcp service; null service = unread. */
export interface PlatformStatus {
  readonly project: string;
  readonly service: string | null;
}

/** `ZCP_MATE_ENABLED` as read; `"unknown"` when the read could not say. */
export type MateFlag = boolean | "unknown";

/** A local, time-boxed expectation our own verb created (C8). */
export type ContainerIntent =
  | { readonly kind: "restart" | "enable" | "upgrade-restart"; readonly since: Instant }
  /** `from` is the server version the update started on; null when it was not known. */
  | { readonly kind: "update"; readonly since: Instant; readonly from: string | null };

export type IntentKind = ContainerIntent["kind"];

// ── Levels ────────────────────────────────────────────────────────────────────────────────────

export type ContainerLevel =
  | { readonly level: "unknown" }
  | { readonly level: "ready" }
  | { readonly level: "creating"; readonly since: Instant }
  | { readonly level: "provisioning"; readonly since: Instant }
  | { readonly level: "booting"; readonly since: Instant }
  | {
      readonly level: "restarting";
      readonly by: "platform" | "you";
      readonly since: Instant;
      /** The `/healthz` `initAt` held when the restart began: a different one is a re-init. */
      readonly initAt: string | null;
      /** When the platform reported its restart process over; null while it has not. */
      readonly platformEnded: Instant | null;
    }
  | { readonly level: "updating"; readonly since: Instant; readonly from: string | null }
  | { readonly level: "needs-enable" }
  | { readonly level: "needs-update" }
  | { readonly level: "not-yet-available" }
  | { readonly level: "inactive"; readonly status: string };

export interface ContainerMachine {
  readonly state: ContainerLevel;
  /** The current level's cap ran out; only a level change clears it. */
  readonly overdue: boolean;
  readonly platform: PlatformStatus | null;
  /** A platform process (a start, a restart) is running against the container. */
  readonly processRunning: boolean;
  /** When the last running process was seen ending; null while none has. */
  readonly processEndedAt: Instant | null;
  /** The newest probe reading and when its probe was sent; null before one. */
  readonly reading: { readonly reading: ProbeReading; readonly sentAt: Instant } | null;
  /** When the link connected; null while it is not connected. */
  readonly connectedSince: Instant | null;
  /** Read only for a container that predates Mate; null before the read. */
  readonly mateFlag: MateFlag | null;
  /** Our verb's expectation while its level holds; null once a read fact settled it. */
  readonly intent: ContainerIntent | null;
  /** A restart of ours already ended with the container still predating Mate. */
  readonly restartTried: boolean;
  /** When the current cap runs out; null when no cap is running. */
  readonly timer: Instant | null;
}

export type ContainerEvent =
  | { readonly type: "PLATFORM"; readonly status: PlatformStatus }
  | { readonly type: "PROCESS"; readonly running: boolean }
  | { readonly type: "PROBED"; readonly reading: ProbeReading; readonly sentAt: Instant }
  | { readonly type: "LINK"; readonly connected: boolean }
  | { readonly type: "MATE_FLAG"; readonly flag: MateFlag }
  | { readonly type: "INTENT"; readonly intent: ContainerIntent }
  | { readonly type: "TICK" };

export const CONTAINER_TIMER_KEY = "container";

export type ContainerEffect =
  | {
      readonly kind: "schedule";
      readonly key: typeof CONTAINER_TIMER_KEY;
      readonly at: Instant;
      readonly event: { readonly type: "TICK" };
    }
  | { readonly kind: "cancel"; readonly key: typeof CONTAINER_TIMER_KEY }
  /** Read `ZCP_MATE_ENABLED`: a container predating Mate is Enable only when the flag is off. */
  | { readonly kind: "read-mate-flag" };

export interface ContainerContext {
  readonly now: Instant;
}

// ── Caps ──────────────────────────────────────────────────────────────────────────────────────

/**
 * How long each waiting level is given before it is `overdue`. Creation and provisioning match
 * `provisioning.ts`'s caps; booting's 90 s runs from the moment the last process ends; an intent's
 * budget is its level's cap, run from the verb's acceptance.
 */
export const CONTAINER_CAPS_MS = {
  creating: 60_000,
  provisioning: 300_000,
  booting: 90_000,
  /** The platform's own restart, and ours. */
  restarting: 180_000,
  updating: 120_000,
} as const;

export const initialContainer = (): ContainerMachine => ({
  state: { level: "unknown" },
  overdue: false,
  platform: null,
  processRunning: false,
  processEndedAt: null,
  reading: null,
  connectedSince: null,
  mateFlag: null,
  intent: null,
  restartTried: false,
  timer: null,
});

// ── Projections ───────────────────────────────────────────────────────────────────────────────

/** The verdict region C of the environment machine holds (§4.4). */
export const containerVerdict = (machine: ContainerMachine): ContainerVerdict => {
  const { state, overdue } = machine;
  switch (state.level) {
    case "unknown":
    case "ready":
    case "needs-enable":
    case "needs-update":
    case "not-yet-available":
      return { level: state.level };
    case "inactive":
      return { level: "inactive", status: state.status };
    case "creating":
    case "provisioning":
    case "booting":
    case "updating":
      return { level: state.level, overdue };
    case "restarting":
      return { level: "restarting", by: state.by, overdue };
  }
};

/**
 * How often the probe store reads this container (§4.5 probes): every 2 s while it comes up,
 * never while a socket proves it up, and otherwise only when a push, a failure or a wake asks.
 */
export const probeCadence = (machine: ContainerMachine): ProbeCadence => {
  switch (machine.state.level) {
    case "booting":
    case "restarting":
    case "updating":
      return { kind: "poll", overdue: machine.overdue };
    case "ready":
      return machine.connectedSince === null ? { kind: "on-demand" } : { kind: "none" };
    case "unknown":
    case "needs-enable":
    case "needs-update":
    case "not-yet-available":
      return { kind: "on-demand" };
    case "creating":
    case "provisioning":
    case "inactive":
      return { kind: "none" };
  }
};

// ── Transition ────────────────────────────────────────────────────────────────────────────────

const PROJECT_CREATING: ReadonlySet<string> = new Set(["NEW", "CREATING"]);
const SERVICE_PROVISIONING: ReadonlySet<string> = new Set(["NEW", "CREATING", "STARTING"]);
const SERVICE_RESTARTING: ReadonlySet<string> = new Set(["RESTARTING", "UPGRADING", "RELOADING"]);

const after = (instant: Instant, ms: number): Instant => ({
  wall: instant.wall + ms,
  mono: instant.mono + ms,
});

/** True once either clock has passed `at`. */
const reached = (at: Instant, now: Instant): boolean => now.wall >= at.wall || now.mono >= at.mono;

/** `a` is at or after `b` on both clocks. */
const notBefore = (a: Instant, b: Instant): boolean => a.wall >= b.wall && a.mono >= b.mono;

/** The link connected after `since`: a socket held from before proves nothing about it. */
const connectedAfter = (machine: ContainerMachine, since: Instant): boolean =>
  machine.connectedSince !== null &&
  notBefore(machine.connectedSince, since) &&
  machine.connectedSince.mono > since.mono;

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** The instant the current level's cap runs from; null for a level without a cap. */
const capStart = (machine: ContainerMachine): Instant | null => {
  const state = machine.state;
  switch (state.level) {
    case "creating":
    case "provisioning":
    case "restarting":
    case "updating":
      return state.since;
    case "booting": {
      if (machine.processRunning) return null;
      const ended = machine.processEndedAt;
      return ended !== null && notBefore(ended, state.since) ? ended : state.since;
    }
    default:
      return null;
  }
};

const capMs = (level: ContainerLevel["level"]): number | null =>
  level in CONTAINER_CAPS_MS ? CONTAINER_CAPS_MS[level as keyof typeof CONTAINER_CAPS_MS] : null;

/** The one timer: the cap's end while the level is not yet overdue. */
const withTimer = (machine: ContainerMachine): ContainerMachine => {
  const start = machine.overdue ? null : capStart(machine);
  const ms = capMs(machine.state.level);
  const timer = start === null || ms === null ? null : after(start, ms);
  return sameJson(timer, machine.timer) ? machine : { ...machine, timer };
};

/** Moves to `next`, clearing `overdue` when the level itself changes. */
const moveTo = (machine: ContainerMachine, next: ContainerLevel): ContainerMachine => {
  if (sameJson(machine.state, next)) return machine;
  const sameLevel = machine.state.level === next.level;
  return { ...machine, state: next, overdue: sameLevel ? machine.overdue : false };
};

/** A reading counts for the current level only if its probe left after the level began. */
const readingSince = (machine: ContainerMachine, since: Instant): ProbeReading | null =>
  machine.reading !== null && notBefore(machine.reading.sentAt, since)
    ? machine.reading.reading
    : null;

const heldInitAt = (machine: ContainerMachine): string | null => {
  const reading = machine.reading?.reading;
  return reading !== undefined && (reading.kind === "ready" || reading.kind === "initializing")
    ? reading.initAt
    : null;
};

/**
 * Where the facts put a running container that no restart or update holds. `reading` is the held
 * one, or null when none counts; a boot it starts runs from when its probe was sent.
 */
const fromReading = (machine: ContainerMachine, reading: ProbeReading | null): ContainerLevel => {
  if (machine.connectedSince !== null) return { level: "ready" };
  const current = machine.state;
  if (reading === null || machine.reading === null) return current;
  const booting: ContainerLevel =
    current.level === "booting" ? current : { level: "booting", since: machine.reading.sentAt };
  switch (reading.kind) {
    case "ready":
      return { level: "ready" };
    case "initializing":
    case "unreachable":
      return booting;
    case "predates-mate":
      // A restart of ours already came back to this: the zcp release there does not carry Mate.
      if (machine.restartTried) return { level: "not-yet-available" };
      // Unread or unreadable, the flag keeps the container booting: never Enable on a guess.
      if (machine.mateFlag === false) return { level: "needs-enable" };
      return machine.mateFlag === true ? { level: "needs-update" } : booting;
  }
};

/** A restart of ours or the platform's is over once a read fact proves the container back. */
const restartOver = (
  machine: ContainerMachine,
  state: Extract<ContainerLevel, { readonly level: "restarting" }>,
): ProbeReading | "connected" | null => {
  if (connectedAfter(machine, state.since)) return "connected";
  const reading = readingSince(machine, state.since);
  if (reading === null) return null;
  if (state.platformEnded !== null && notBefore(machine.reading!.sentAt, state.platformEnded)) {
    return reading;
  }
  if (reading.kind !== "ready" && reading.kind !== "initializing") return null;
  if (reading.initAt === null) return null;
  const reinitialized =
    state.initAt !== null
      ? reading.initAt !== state.initAt
      : Date.parse(reading.initAt) > state.since.wall;
  return reinitialized ? reading : null;
};

const updateOver = (
  machine: ContainerMachine,
  state: Extract<ContainerLevel, { readonly level: "updating" }>,
): boolean => {
  if (connectedAfter(machine, state.since)) return true;
  const reading = readingSince(machine, state.since);
  return (
    reading?.kind === "ready" &&
    state.from !== null &&
    reading.descriptor.serverVersion !== state.from
  );
};

/** The level the facts held now put the container at; an intent lives only on its own level. */
const settleLevel = (machine: ContainerMachine, now: Instant): ContainerMachine => {
  const next = settleFacts(machine, now);
  const holds = next.state.level === "restarting" || next.state.level === "updating";
  return next.intent === null || holds ? next : { ...next, intent: null };
};

const settleFacts = (machine: ContainerMachine, now: Instant): ContainerMachine => {
  const platform = machine.platform;
  const state = machine.state;
  if (platform !== null) {
    if (PROJECT_CREATING.has(platform.project)) {
      return moveTo(
        machine,
        state.level === "creating" ? state : { level: "creating", since: now },
      );
    }
    if (platform.project === "STARTING") {
      return moveTo(
        machine,
        state.level === "provisioning" ? state : { level: "provisioning", since: now },
      );
    }
    if (platform.project !== "ACTIVE") {
      return moveTo(machine, { level: "inactive", status: platform.project });
    }
    const service = platform.service;
    if (service !== null && SERVICE_PROVISIONING.has(service)) {
      return moveTo(
        machine,
        state.level === "provisioning" ? state : { level: "provisioning", since: now },
      );
    }
    if (service !== null && SERVICE_RESTARTING.has(service)) {
      if (state.level === "restarting") {
        return moveTo(
          machine,
          state.platformEnded === null ? state : { ...state, platformEnded: null },
        );
      }
      if (state.level === "updating") return machine;
      const intent = machine.intent;
      return moveTo(machine, {
        level: "restarting",
        by: intent === null ? "platform" : "you",
        since: intent === null ? now : intent.since,
        initAt: heldInitAt(machine),
        platformEnded: null,
      });
    }
    if (service !== null && service !== "ACTIVE") {
      return moveTo(machine, { level: "inactive", status: service });
    }
    if (service === null && (state.level === "creating" || state.level === "provisioning")) {
      return machine;
    }
    if (
      state.level === "creating" ||
      state.level === "provisioning" ||
      state.level === "inactive"
    ) {
      // The platform brought it up: only a probe sent from now on says how far Mate got.
      return moveTo(machine, { level: "booting", since: now });
    }
  }
  switch (state.level) {
    case "restarting": {
      const over = restartOver(machine, state);
      if (over === null) return machine;
      const settled: ContainerMachine = {
        ...machine,
        restartTried: machine.intent !== null || machine.restartTried,
      };
      return moveTo(
        settled,
        over === "connected" ? { level: "ready" } : fromReading(settled, over),
      );
    }
    case "updating":
      return updateOver(machine, state) ? moveTo(machine, { level: "ready" }) : machine;
    case "booting":
      return moveTo(machine, fromReading(machine, readingSince(machine, state.since)));
    default:
      return moveTo(machine, fromReading(machine, machine.reading?.reading ?? null));
  }
};

/** The intent our verb created: its level holds from `since` until a read fact settles it. */
const intend = (machine: ContainerMachine, intent: ContainerIntent): ContainerMachine => {
  // Enable writes the flag it would otherwise be read for: the held read no longer says.
  const next: ContainerMachine = {
    ...machine,
    intent,
    mateFlag: intent.kind === "enable" ? null : machine.mateFlag,
  };
  if (intent.kind === "update") {
    return moveTo(next, { level: "updating", since: intent.since, from: intent.from });
  }
  return moveTo(next, {
    level: "restarting",
    by: "you",
    since: intent.since,
    initAt: heldInitAt(machine),
    platformEnded: null,
  });
};

const apply = (
  machine: ContainerMachine,
  event: ContainerEvent,
  now: Instant,
): ContainerMachine => {
  switch (event.type) {
    case "PLATFORM": {
      if (sameJson(machine.platform, event.status)) return machine;
      const next = { ...machine, platform: event.status };
      // The platform's restart ending is ours to see only once it was seen running.
      const state = machine.state;
      const wasRestarting = SERVICE_RESTARTING.has(machine.platform?.service ?? "");
      if (
        state.level === "restarting" &&
        state.platformEnded === null &&
        wasRestarting &&
        event.status.service === "ACTIVE"
      ) {
        return settleLevel(moveTo(next, { ...state, platformEnded: now }), now);
      }
      return settleLevel(next, now);
    }
    case "PROCESS": {
      if (event.running === machine.processRunning) return machine;
      return settleLevel(
        {
          ...machine,
          processRunning: event.running,
          processEndedAt: event.running ? machine.processEndedAt : now,
        },
        now,
      );
    }
    case "PROBED":
      return settleLevel(
        { ...machine, reading: { reading: event.reading, sentAt: event.sentAt } },
        now,
      );
    case "LINK": {
      const connected = machine.connectedSince !== null;
      if (event.connected === connected) return machine;
      return settleLevel({ ...machine, connectedSince: event.connected ? now : null }, now);
    }
    case "MATE_FLAG":
      return event.flag === machine.mateFlag
        ? machine
        : settleLevel({ ...machine, mateFlag: event.flag }, now);
    case "INTENT": {
      // An intent the platform's facts already overrule (a project still creating, a service
      // stopped) has no level to hold, and changes nothing.
      const next = settleLevel(intend(machine, event.intent), now);
      return next.intent === null ? machine : next;
    }
    case "TICK":
      return machine;
  }
};

export function transitionContainer(
  machine: ContainerMachine,
  event: ContainerEvent,
  ctx: ContainerContext,
): { readonly state: ContainerMachine; readonly effects: ReadonlyArray<ContainerEffect> } {
  const { now } = ctx;
  // Timers are hints: whatever the event, a cap that has run out is overdue first.
  const due =
    machine.timer !== null && reached(machine.timer, now)
      ? { ...machine, overdue: true, timer: null }
      : machine;
  const next = withTimer(apply(due, event, now));
  const effects: Array<ContainerEffect> = [];
  if (!sameJson(next.timer, machine.timer)) {
    effects.push(
      next.timer === null
        ? { kind: "cancel", key: CONTAINER_TIMER_KEY }
        : { kind: "schedule", key: CONTAINER_TIMER_KEY, at: next.timer, event: { type: "TICK" } },
    );
  }
  const predates = next.reading?.reading.kind === "predates-mate";
  const predatedBefore = machine.reading?.reading.kind === "predates-mate";
  if (predates && next.mateFlag === null && !(predatedBefore && machine.mateFlag === null)) {
    effects.push({ kind: "read-mate-flag" });
  }
  return { state: next === machine ? machine : next, effects };
}
