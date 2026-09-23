/**
 * The probe store (DESIGN §2.C C6, §4.5 probes): one fact per Mate origin — its descriptor and
 * its `/healthz` as last read — and the tab's one pool of probes that reads them.
 *
 * - An origin is `unread` until its first probe answers. A descriptor's `zerops.identity` keeps
 *   `unknown` apart from `failed`: `failed` means the Mate could not check, never a refusal.
 * - Reads are pulled: on the cadence each container's level asks for (every 2 s while it comes
 *   up, 10 s rising to 60 s once that is overdue or while only failed probes say it is coming
 *   up), and once more whenever a push, a connect failure or a wake asks (`request`).
 * - The pool runs at most `PROBE_POOL_SIZE` probes at once, each ending by its
 *   `PROBE_DEADLINE_MS` as `unreachable`. The route's Mate goes first (`setFirst`), then a
 *   request or a timely poll before an overdue poll and, within one, slots round-robin to the
 *   origin started least recently; overdue origins share at most `OVERDUE_PROBE_SLOTS`, so one
 *   that never answers cannot starve the others.
 * - A tab hidden for `HIDDEN_PROBE_PAUSE_MS` probes nothing until it is shown again.
 */
import type { Instant } from "../data/access/grant.ts";
import type { DescriptorFacts } from "./environmentMachine.ts";
import type { ExchangeClock } from "./exchangeDriver.ts";

/** What one probe of an origin concluded (`containerHealth.ts` reads it). */
export type ProbeReading =
  /**
   * The descriptor answered: Mate is up. `projectId` is the project it states, null outside
   * Zerops mode; `initAt` is `/healthz`'s, read beside it.
   */
  | {
      readonly kind: "ready";
      readonly descriptor: DescriptorFacts;
      readonly projectId: string | null;
      readonly initAt: string | null;
    }
  /** `/healthz` answered and the descriptor did not: Mate is still coming up. */
  | { readonly kind: "initializing"; readonly initAt: string | null }
  /** Neither route is served: an older zcp, or one with `ZCP_MATE_ENABLED` off. */
  | { readonly kind: "predates-mate" }
  /** No usable answer before the deadline: the container is away, or restarting. */
  | { readonly kind: "unreachable" };

/**
 * How often a container's level asks for its origin to be read. An `overdue` poll backs off
 * (`OVERDUE_POLL_INTERVALS_MS`) within the pool's overdue share: the level ran past its cap, or
 * nothing but failed probes says the container is coming up.
 */
export type ProbeCadence =
  | { readonly kind: "poll"; readonly overdue: boolean }
  | { readonly kind: "on-demand" }
  | { readonly kind: "none" };

/** An origin's fact (C6). */
export type ProbeFact =
  | { readonly status: "unread" }
  | { readonly status: "read"; readonly reading: ProbeReading; readonly sentAt: Instant };

export const PROBE_POOL_SIZE = 4;
export const PROBE_DEADLINE_MS = 8_000;
/** Overdue origins never hold more of the pool than this. */
export const OVERDUE_PROBE_SLOTS = 2;
export const POLL_INTERVAL_MS = 2_000;
/** An overdue poll reads at these intervals, staying on the last. */
export const OVERDUE_POLL_INTERVALS_MS: ReadonlyArray<number> = [10_000, 20_000, 40_000, 60_000];
export const HIDDEN_PROBE_PAUSE_MS = 60_000;

export interface ProbeStorePorts {
  readonly clock: Pick<ExchangeClock, "now" | "setTimer">;
  /** Reads the origin's descriptor and `/healthz`; rejects when the signal aborts it. */
  readonly probe: (origin: string, signal: AbortSignal) => Promise<ProbeReading>;
}

export interface ProbeStore {
  /**
   * Every origin's cadence as its container stands now; an origin left out is forgotten once no
   * `next` caller waits on it.
   */
  readonly setCadences: (cadences: ReadonlyMap<string, ProbeCadence>) => void;
  /** The origins read ahead of every other due one from the next free slot: the route's Mate. */
  readonly setFirst: (origins: ReadonlySet<string>) => void;
  /** Reads the origin once more, as soon as the pool gives it a slot. */
  readonly request: (origin: string) => void;
  /** The reading of a probe of this origin started from now on, held by a target or not. */
  readonly next: (origin: string) => Promise<ProbeReading>;
  readonly fact: (origin: string) => ProbeFact;
  readonly setVisible: (visible: boolean) => void;
  /** Told each reading as it lands. */
  readonly subscribe: (
    listener: (origin: string, reading: ProbeReading, sentAt: Instant) => void,
  ) => () => void;
  /** The account closed: every probe and timer ends. */
  readonly dispose: () => void;
}

interface Origin {
  cadence: ProbeCadence;
  fact: ProbeFact;
  /** The probe in flight; null while none is. */
  inFlight: { readonly controller: AbortController; readonly overdue: boolean } | null;
  /** Asked for once more, after whatever is in flight. */
  requested: boolean;
  /** When the cadence reads it next; null while it does not poll. */
  pollAt: Instant | null;
  /** How far up `OVERDUE_POLL_INTERVALS_MS` its next overdue read sits. */
  overdueRung: number;
  /** Monotonic time its last probe started; the round-robin's order. */
  startedAt: number;
  /** `next` callers waiting on a probe that has not started yet. */
  waiting: Array<(reading: ProbeReading) => void>;
  /** `next` callers waiting on the probe in flight. */
  answering: Array<(reading: ProbeReading) => void>;
}

const after = (instant: Instant, ms: number): Instant => ({
  wall: instant.wall + ms,
  mono: instant.mono + ms,
});

/** True once either clock has passed `at`. */
const reached = (at: Instant, now: Instant): boolean => now.wall >= at.wall || now.mono >= at.mono;

const polls = (cadence: ProbeCadence): cadence is Extract<ProbeCadence, { kind: "poll" }> =>
  cadence.kind === "poll";

export function makeProbeStore(ports: ProbeStorePorts): ProbeStore {
  const { clock } = ports;
  const origins = new Map<string, Origin>();
  const listeners = new Set<(origin: string, reading: ProbeReading, sentAt: Instant) => void>();
  let first: ReadonlySet<string> = new Set();
  let hiddenSince: number | null = null;
  let cancelWake: (() => void) | null = null;
  let disposed = false;

  const originFor = (origin: string): Origin => {
    const existing = origins.get(origin);
    if (existing !== undefined) return existing;
    const created: Origin = {
      cadence: { kind: "none" },
      fact: { status: "unread" },
      inFlight: null,
      requested: false,
      pollAt: null,
      overdueRung: 0,
      startedAt: Number.NEGATIVE_INFINITY,
      waiting: [],
      answering: [],
    };
    origins.set(origin, created);
    return created;
  };

  const paused = (): boolean =>
    hiddenSince !== null && clock.now().mono - hiddenSince >= HIDDEN_PROBE_PAUSE_MS;

  const due = (entry: Origin): boolean =>
    entry.inFlight === null &&
    (entry.requested ||
      entry.waiting.length > 0 ||
      (entry.pollAt !== null && reached(entry.pollAt, clock.now())));

  /** A request or a timely poll outranks an overdue poll. */
  const overdueOnly = (entry: Origin): boolean =>
    !entry.requested && entry.waiting.length === 0 && polls(entry.cadence) && entry.cadence.overdue;

  const nextPollAt = (entry: Origin, from: Instant): Instant | null => {
    if (!polls(entry.cadence)) return null;
    if (!entry.cadence.overdue) return after(from, POLL_INTERVAL_MS);
    const last = OVERDUE_POLL_INTERVALS_MS.length - 1;
    const interval = OVERDUE_POLL_INTERVALS_MS[Math.min(entry.overdueRung, last)] ?? 0;
    entry.overdueRung = Math.min(entry.overdueRung + 1, last);
    return after(from, interval);
  };

  const land = (origin: string, entry: Origin, reading: ProbeReading, sentAt: Instant) => {
    entry.inFlight = null;
    entry.fact = { status: "read", reading, sentAt };
    entry.pollAt = nextPollAt(entry, clock.now());
    const answering = entry.answering;
    entry.answering = [];
    for (const resolve of answering) resolve(reading);
    for (const listener of listeners) listener(origin, reading, sentAt);
  };

  const start = (origin: string, entry: Origin) => {
    const controller = new AbortController();
    const sentAt = clock.now();
    const overdue = overdueOnly(entry);
    entry.inFlight = { controller, overdue };
    entry.requested = false;
    entry.startedAt = sentAt.mono;
    entry.answering = [...entry.answering, ...entry.waiting];
    entry.waiting = [];
    let settled = false;
    const settle = (reading: ProbeReading) => {
      if (settled || disposed || origins.get(origin) !== entry) return;
      settled = true;
      cancelDeadline();
      land(origin, entry, reading, sentAt);
      dispatch();
    };
    const cancelDeadline = clock.setTimer(PROBE_DEADLINE_MS, () => {
      controller.abort();
      settle({ kind: "unreachable" });
    });
    ports.probe(origin, controller.signal).then(settle, () => settle({ kind: "unreachable" }));
  };

  /** Fills the free slots, then arms the one timer for the earliest poll still ahead. */
  function dispatch(): void {
    if (disposed) return;
    cancelWake?.();
    cancelWake = null;
    if (paused()) return;
    const running = [...origins.values()].filter((entry) => entry.inFlight !== null);
    let free = PROBE_POOL_SIZE - running.length;
    let overdueFree =
      OVERDUE_PROBE_SLOTS - running.filter((entry) => entry.inFlight?.overdue === true).length;
    const ready = [...origins]
      .filter(([, entry]) => due(entry))
      .sort(
        ([leftOrigin, left], [rightOrigin, right]) =>
          Number(first.has(rightOrigin)) - Number(first.has(leftOrigin)) ||
          Number(overdueOnly(left)) - Number(overdueOnly(right)) ||
          left.startedAt - right.startedAt,
      );
    for (const [origin, entry] of ready) {
      if (free <= 0) break;
      const overdue = overdueOnly(entry);
      if (overdue && overdueFree <= 0) continue;
      start(origin, entry);
      free -= 1;
      if (overdue) overdueFree -= 1;
    }
    const now = clock.now();
    let earliest: number | null = null;
    for (const entry of origins.values()) {
      if (entry.inFlight !== null || entry.pollAt === null || reached(entry.pollAt, now)) continue;
      const wait = Math.min(entry.pollAt.mono - now.mono, entry.pollAt.wall - now.wall);
      earliest = earliest === null ? wait : Math.min(earliest, wait);
    }
    if (earliest !== null) cancelWake = clock.setTimer(earliest, dispatch);
  }

  return {
    setCadences: (cadences) => {
      if (disposed) return;
      for (const [origin, entry] of origins) {
        if (cadences.has(origin)) continue;
        // A `next` caller still waits on it: it stays, uncadenced, until its probe answers.
        if (entry.waiting.length > 0 || entry.answering.length > 0) {
          entry.cadence = { kind: "none" };
          entry.pollAt = null;
          continue;
        }
        entry.inFlight?.controller.abort();
        origins.delete(origin);
      }
      for (const [origin, cadence] of cadences) {
        const entry = originFor(origin);
        const before = entry.cadence;
        entry.cadence = cadence;
        if (!polls(cadence)) {
          entry.pollAt = null;
          continue;
        }
        if (!polls(before)) {
          // A container that starts coming up is read at once; one only failed probes say is,
          // at the backing-off intervals from the probe that said so.
          entry.overdueRung = 0;
          const fact = entry.fact;
          entry.pollAt =
            cadence.overdue && fact.status === "read" && entry.inFlight === null
              ? nextPollAt(entry, fact.sentAt)
              : clock.now();
        } else if (cadence.overdue !== before.overdue) {
          entry.overdueRung = 0;
          // Evidence that it is coming up reads it on the 2 s cadence from its last probe, not
          // at the rung the overdue poll had backed off to.
          const fact = entry.fact;
          if (!cadence.overdue && entry.pollAt !== null && fact.status === "read") {
            const timely = after(fact.sentAt, POLL_INTERVAL_MS);
            if (timely.mono < entry.pollAt.mono) entry.pollAt = timely;
          }
        }
      }
      dispatch();
    },
    setFirst: (origins) => {
      first = origins;
    },
    request: (origin) => {
      if (disposed) return;
      originFor(origin).requested = true;
      dispatch();
    },
    next: (origin) =>
      new Promise((resolve) => {
        if (disposed) {
          resolve({ kind: "unreachable" });
          return;
        }
        originFor(origin).waiting.push(resolve);
        dispatch();
      }),
    fact: (origin) => origins.get(origin)?.fact ?? { status: "unread" },
    setVisible: (visible) => {
      if (disposed) return;
      if (!visible) {
        hiddenSince ??= clock.now().mono;
        return;
      }
      hiddenSince = null;
      dispatch();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelWake?.();
      for (const entry of origins.values()) {
        entry.inFlight?.controller.abort();
        for (const resolve of [...entry.waiting, ...entry.answering])
          resolve({ kind: "unreachable" });
      }
      origins.clear();
      listeners.clear();
    },
  };
}
