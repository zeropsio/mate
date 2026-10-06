/**
 * The container store (DESIGN §4.5): one container machine per Mate target, the probe store that
 * reads their origins, and the intents our own verbs created (C8). One per account epoch.
 *
 * - Facts arrive as calls — the platform's statuses (`setTargets`), its processes (`process`),
 *   the link (`link`), the Mate flag's read — and every probe reading lands on each target whose
 *   origin it read. Each target's machine decides its level; the store runs its effects.
 * - Probes follow each machine's cadence, the route's target first. A ready container is read
 *   again when its service's status moves, on its socket dropping or a connect to it failing, on
 *   a visible wake that finds it unread for `WAKE_REREAD_MS` and whenever someone asks
 *   (`request`): ready is never terminal. A container behind a live socket is never read: the
 *   socket proves it up. Neither is one whose Mate HQ holds online (`setOnline`), unless it is the
 *   route's or holds an intent of ours: those are read whatever HQ says. A Mate first seen while
 *   HQ's word is awaited waits `HQ_WAIT_MS` at most for it before its first read.
 * - A project an official HQ's current word speaks for (`setHqScope`) that it does not hold
 *   online — no Mate of HQ's there, or one HQ holds offline — is quiet: not read at load, on a
 *   status push or a wake, nor polled, until a lease or our verb waits on it or someone asks.
 * - Intents are persisted in this tab's storage as `{target, kind, since, from?}`, so a reload
 *   inside an intent's budget shows `restarting(you)` or `updating` again instead of guesses. An
 *   intent restored for a target not yet listed waits for it.
 */
import type { Instant } from "../data/access/grant.ts";
import {
  containerVerdict,
  initialContainer,
  platformSaysDown,
  probeCadence,
  transitionContainer,
  type ContainerEffect,
  type ContainerEvent,
  type ContainerIntent,
  type ContainerMachine,
  type IntentKind,
  type MateFlag,
  type PlatformStatus,
} from "./containerMachine.ts";
import type { ContainerVerdict } from "./environmentMachine.ts";
import {
  INIT_AT_READ_DEADLINE_MS,
  type ExchangeClock,
  type IntentRequest,
  type IntentStorage,
  type TargetKey,
} from "./exchange.ts";
import type { ExchangeDriver } from "./exchangeDriver.ts";
import type { ProbeAsk, ProbeCadence, ProbeReading } from "./probe.ts";
import { makeProbeStore, type ProbeStorePorts } from "./probeStore.ts";
import { targetProject } from "./targets.ts";

/** One target as the platform describes it now. */
export interface ContainerTarget {
  readonly key: TargetKey;
  /** The Mate's public origin; null while the platform gives it none. */
  readonly origin: string | null;
  readonly platform: PlatformStatus;
}

/** One persisted intent; `since` is wall time, the one clock a reload keeps. */
interface IntentRecord {
  readonly target: TargetKey;
  readonly kind: IntentKind;
  readonly since: number;
  readonly from?: string | null;
  /** The `/healthz` `initAt` read before a restart verb was sent. */
  readonly initAt?: string;
}

export interface ContainerStorePorts {
  readonly clock: Pick<ExchangeClock, "now" | "setTimer">;
  /** Reads the origin's container (`readZeropsContainer`); rejects when the signal aborts it. */
  readonly probe: ProbeStorePorts["probe"];
  /**
   * The origin's `/healthz` `initAt`, read now; null when it serves none. Rejects when the signal
   * aborts it.
   */
  readonly readInitAt: (origin: string, signal: AbortSignal) => Promise<string | null>;
  /** `ZCP_MATE_ENABLED` for the target's service; `"unknown"` when it could not be read. */
  readonly readMateFlag: (key: TargetKey) => Promise<MateFlag>;
  readonly intents: IntentStorage;
}

export interface ContainerStore {
  /** Every target the platform lists, as it stands now; a target left out is forgotten. */
  readonly setTargets: (targets: ReadonlyArray<ContainerTarget>) => void;
  /** Whether a platform process runs against the target (the activity feed). */
  readonly process: (key: TargetKey, running: boolean) => void;
  /** Whether the target's Mate socket is connected; a drop reads the container again. */
  readonly link: (key: TargetKey, connected: boolean) => void;
  /**
   * The projects whose Mate HQ holds online now: each proves its container up as a socket does,
   * and HQ letting one go reads it again. Null while HQ's word is not current — not yet, or not
   * any more: what it last held online proves for `HQ_WAIT_MS` more, and a Mate first seen
   * meanwhile waits as long for its word before its first read. `"absent"` where no HQ will
   * answer at all — a client that runs no HQ flow: nothing waits for a word that never comes.
   */
  readonly setOnline: (projectIds: ReadonlySet<string> | null | "absent") => void;
  /** Our verb was accepted: its level holds until a read fact settles it. */
  readonly intend: (key: TargetKey, intent: IntentRequest) => void;
  /**
   * The target's `/healthz` `initAt`, read now: a restart verb reads it just before it is sent, and
   * its intent carries it as the baseline. Null when the target has no address, the container
   * serves none, or it does not answer within `INIT_AT_READ_DEADLINE_MS`.
   */
  readonly initAt: (key: TargetKey) => Promise<string | null>;
  /**
   * Reads the target's container once more, with a read started now — unless `fresh: false` lets
   * it take one another reader made a moment ago (an exchange about to read it anyway).
   */
  readonly request: (key: TargetKey, ask?: ProbeAsk) => void;
  /** The targets whose containers are read ahead of every other: the route's (§4.5). */
  readonly setFirst: (keys: ReadonlySet<TargetKey>) => void;
  /**
   * The projects an official HQ's current word speaks for — its organization's, as listed — or
   * null where no such word is: one it does not hold online is read only once something waits on
   * it (a lease, our verb, the route) or someone asks.
   */
  readonly setHqScope: (projectIds: ReadonlySet<string> | null) => void;
  /**
   * The targets a lease waits on — the screen's, an action's, a Connect's, the Mate left last:
   * each is read as one starts to, and a boot nothing vouches for is polled while one does.
   */
  readonly setWanted: (keys: ReadonlySet<TargetKey>) => void;
  /** The reading of a probe of this origin started from now on. */
  readonly next: (origin: string) => Promise<ProbeReading>;
  readonly setVisible: (visible: boolean) => void;
  /**
   * §6.4's coalesced wake: deadlines settle, and a visible one reads what no socket proves and no
   * reading of the last `WAKE_REREAD_MS` says.
   */
  readonly wake: (visible: boolean) => void;
  readonly verdict: (key: TargetKey) => ContainerVerdict;
  readonly machine: (key: TargetKey) => ContainerMachine | undefined;
  /** Every target's machine as last published; the same map until the next publication. */
  readonly machines: () => ReadonlyMap<TargetKey, ContainerMachine>;
  readonly subscribe: (listener: () => void) => () => void;
  /** The account closed: every probe, read and timer ends. */
  readonly dispose: () => void;
}

interface Entry {
  machine: ContainerMachine;
  origin: string | null;
  /**
   * The project's status and the service's as last read: a service the listing could not say
   * (its target held only by a record) keeps the status read before.
   */
  known: { readonly project: string; readonly service: string | null };
  cancelTimer: (() => void) | null;
  /** A Mate flag read is in flight. */
  readingFlag: boolean;
  /** The target's Mate socket is connected. */
  socket: boolean;
}

const INTENT_KINDS: ReadonlySet<string> = new Set<IntentKind>([
  "restart",
  "enable",
  "upgrade-restart",
  "update",
]);

const isRecord = (value: unknown): value is IntentRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.target === "string" &&
    typeof record.kind === "string" &&
    INTENT_KINDS.has(record.kind) &&
    typeof record.since === "number" &&
    (record.from === undefined || record.from === null || typeof record.from === "string") &&
    (record.initAt === undefined || typeof record.initAt === "string")
  );
};

const readRecords = (storage: IntentStorage): ReadonlyArray<IntentRecord> => {
  try {
    const parsed: unknown = JSON.parse(storage.read() ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
};

const toRecord = (target: TargetKey, intent: ContainerIntent): IntentRecord =>
  intent.kind === "update"
    ? { target, kind: intent.kind, since: intent.since.wall, from: intent.from }
    : intent.initAt === undefined
      ? { target, kind: intent.kind, since: intent.since.wall }
      : { target, kind: intent.kind, since: intent.since.wall, initAt: intent.initAt };

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** How long a Mate first seen while HQ has not answered waits for its word before it is read. */
export const HQ_WAIT_MS = 3_000;

/** A visible wake reads a container no socket holds once its last reading is this old. */
export const WAKE_REREAD_MS = 60_000;

/**
 * The platform moved the target's status: its project's, or its service's from one read before
 * to another. A service read for the first time, or one the listing could not say this time, is
 * no move.
 */
const statusMoved = (known: Entry["known"], platform: PlatformStatus): boolean =>
  platform.project !== known.project ||
  (platform.service !== null && known.service !== null && platform.service !== known.service);

const knownStatus = (known: Entry["known"] | null, platform: PlatformStatus): Entry["known"] => ({
  project: platform.project,
  service: platform.service ?? known?.service ?? null,
});

/** The target's status as the machine takes it: a service the listing could not say keeps its last. */
const platformOf = (entry: Entry, target: ContainerTarget): PlatformStatus =>
  target.platform.service === null && entry.known.service !== null
    ? { ...target.platform, service: entry.known.service }
    : target.platform;

/** Its last reading is `WAKE_REREAD_MS` old, or it has none. */
const unreadSince = (machine: ContainerMachine, now: Instant): boolean => {
  const sentAt = machine.reading?.sentAt;
  return (
    sentAt === undefined ||
    now.mono - sentAt.mono >= WAKE_REREAD_MS ||
    now.wall - sentAt.wall >= WAKE_REREAD_MS
  );
};

export function makeContainerStore(ports: ContainerStorePorts): ContainerStore {
  const { clock } = ports;
  const entries = new Map<TargetKey, Entry>();
  const listeners = new Set<() => void>();
  /** Intents restored from storage whose targets are not listed yet. */
  const restored = new Map<TargetKey, IntentRecord>(
    readRecords(ports.intents).map((record) => [record.target, record]),
  );
  let published: ReadonlyMap<TargetKey, ContainerMachine> = new Map();
  let persisted = ports.intents.read();
  let first: ReadonlySet<TargetKey> = new Set();
  let wanted: ReadonlySet<TargetKey> = new Set();
  /** Someone waits on the target's container: the route, or a lease. */
  const watched = (key: TargetKey): boolean => first.has(key) || wanted.has(key);
  let hqScope: ReadonlySet<string> | null = null;
  let online: ReadonlySet<string> = new Set();
  /**
   * HQ's word: `answered`; `awaited` — none yet, or none since its last — for `HQ_WAIT_MS` at
   * most, its last still holding; or `silent` past that, every container read as if no HQ held it.
   */
  let hq: "answered" | "awaited" | "silent" = "answered";
  let cancelHqWait: (() => void) | null = null;
  /** Mates first seen while HQ's answer was awaited, their first read held for it. */
  const held = new Set<TargetKey>();
  let disposed = false;

  const probes = makeProbeStore({ clock, probe: ports.probe });

  // ── Effects ──────────────────────────────────────────────────────────────────────────────

  const readFlag = (key: TargetKey, entry: Entry) => {
    if (entry.readingFlag) return;
    entry.readingFlag = true;
    ports.readMateFlag(key).then(
      (flag) => settleFlag(key, entry, flag),
      () => settleFlag(key, entry, "unknown"),
    );
  };

  const settleFlag = (key: TargetKey, entry: Entry, flag: MateFlag) => {
    entry.readingFlag = false;
    if (disposed || entries.get(key) !== entry) return;
    batch(() => step(key, entry, { type: "MATE_FLAG", flag }));
  };

  const run = (key: TargetKey, entry: Entry, effect: ContainerEffect) => {
    switch (effect.kind) {
      case "schedule": {
        entry.cancelTimer?.();
        const now = clock.now();
        const delayMs = Math.max(0, Math.min(effect.at.mono - now.mono, effect.at.wall - now.wall));
        entry.cancelTimer = clock.setTimer(delayMs, () =>
          batch(() => step(key, entry, { type: "TICK" })),
        );
        return;
      }
      case "cancel":
        entry.cancelTimer?.();
        entry.cancelTimer = null;
        return;
      case "read-mate-flag":
        readFlag(key, entry);
        return;
    }
  };

  const transition = (key: TargetKey, entry: Entry, event: ContainerEvent) => {
    const next = transitionContainer(entry.machine, event, { now: clock.now() });
    entry.machine = next.state;
    for (const effect of next.effects) run(key, entry, effect);
  };

  const step = (key: TargetKey, entry: Entry, event: ContainerEvent) => {
    if (entries.get(key) !== entry) return;
    transition(key, entry, event);
    prove(key, entry);
  };

  /**
   * Tells the machine whether anything proves the container up: its socket, or HQ holding its Mate
   * online — but not for the route's container, nor one our verb waits on: those are read whatever
   * HQ says. A proof lost reads the container again.
   */
  const prove = (key: TargetKey, entry: Entry) => {
    const proven =
      entry.socket ||
      (online.has(targetProject(key)) && !first.has(key) && entry.machine.intent === null);
    if (proven === (entry.machine.connectedSince !== null)) return;
    transition(key, entry, { type: "LINK", connected: proven });
    if (!proven) requestFor(entry, { fresh: true });
  };

  /**
   * HQ's word says nothing waits on the container being read: its project is one HQ speaks for
   * and does not hold online, and neither the route, a lease nor our verb waits on it.
   */
  const quiet = (key: TargetKey, entry: Entry): boolean => {
    const projectId = targetProject(key);
    return (
      hqScope !== null &&
      hqScope.has(projectId) &&
      !online.has(projectId) &&
      !watched(key) &&
      entry.machine.intent === null
    );
  };

  /** HQ's word, or its silence: proves what it holds online, and reads what waited for it. */
  const hear = (projectIds: ReadonlySet<string>, word: "answered" | "silent") => {
    cancelHqWait?.();
    cancelHqWait = null;
    hq = word;
    online = projectIds;
    proveAll();
    for (const key of held) {
      const entry = entries.get(key);
      if (entry !== undefined && !quiet(key, entry)) requestFor(entry, { fresh: false });
    }
    held.clear();
  };

  /** Every target's proof again, once what it is composed of moved. */
  const proveAll = () => {
    for (const [key, entry] of entries) prove(key, entry);
  };

  // ── Publication ──────────────────────────────────────────────────────────────────────────

  /** Each origin polls on the most demanding cadence any of its targets asks for. */
  const cadences = (): ReadonlyMap<string, ProbeCadence> => {
    const rank = (cadence: ProbeCadence): number =>
      cadence.kind === "poll" ? (cadence.overdue ? 2 : 3) : cadence.kind === "on-demand" ? 1 : 0;
    const byOrigin = new Map<string, ProbeCadence>();
    for (const [key, entry] of entries) {
      if (entry.origin === null) continue;
      const own: ProbeCadence = quiet(key, entry)
        ? { kind: "none" }
        : probeCadence(entry.machine, watched(key));
      // The route's Mate is never read on the overdue ladder: the person is looking at it, and the
      // read that finds it back is what sends its exchange again (`bindContainerStore`).
      const cadence: ProbeCadence =
        own.kind === "poll" && own.overdue && first.has(key)
          ? { kind: "poll", overdue: false }
          : own;
      const held = byOrigin.get(entry.origin);
      if (held === undefined || rank(cadence) > rank(held)) byOrigin.set(entry.origin, cadence);
    }
    return byOrigin;
  };

  const persist = () => {
    const records = [
      ...[...entries].flatMap(([key, entry]) =>
        entry.machine.intent === null ? [] : [toRecord(key, entry.machine.intent)],
      ),
      ...restored.values(),
    ];
    const value = records.length === 0 ? null : JSON.stringify(records);
    if (value === persisted) return;
    persisted = value;
    ports.intents.write(value);
  };

  let depth = 0;
  /** Runs `work`, then — once, after the outermost batch — publishes what it changed. */
  function batch(work: () => void): void {
    if (disposed) return;
    depth += 1;
    try {
      work();
    } finally {
      depth -= 1;
    }
    if (depth > 0) return;
    probes.setFirst(new Set([...first].flatMap((key) => entries.get(key)?.origin ?? [])));
    // Asked only now, so each probe reads by the cadence its container ended the batch on.
    const asked = new Map([...requests].map(([origin, fresh]) => [origin, { fresh }] as const));
    requests.clear();
    probes.setCadences(cadences(), asked);
    persist();
    const machines = new Map([...entries].map(([key, entry]) => [key, entry.machine] as const));
    if (sameJson([...machines], [...published])) return;
    published = machines;
    for (const listener of listeners) listener();
  }

  /** The reads this batch asked for, by origin, and whether one of them must be started now. */
  const requests = new Map<string, boolean>();

  /**
   * Reads the container once this batch ends, unless something proves it up (`prove`) or
   * the platform says it is down: its push back reads it. `fresh` unless the ask is content with a
   * descriptor another reader made a moment ago: a read after a status move, a drop or a failure
   * must be sent after it.
   */
  const requestFor = (entry: Entry, ask: ProbeAsk) => {
    if (entry.origin === null || entry.machine.connectedSince !== null) return;
    if (platformSaysDown(entry.machine)) return;
    requests.set(entry.origin, (requests.get(entry.origin) ?? false) || ask.fresh);
  };

  const unsubscribeProbes = probes.subscribe((origin, reading, sentAt) =>
    batch(() => {
      for (const [key, entry] of entries) {
        if (entry.origin === origin) step(key, entry, { type: "PROBED", reading, sentAt });
      }
    }),
  );

  const restore = (record: IntentRecord): ContainerIntent => {
    const now = clock.now();
    const since: Instant = { wall: record.since, mono: now.mono - (now.wall - record.since) };
    if (record.kind === "update") return { kind: "update", since, from: record.from ?? null };
    return record.initAt === undefined
      ? { kind: record.kind, since }
      : { kind: record.kind, since, initAt: record.initAt };
  };

  return {
    setTargets: (targets) =>
      batch(() => {
        const listed = new Set(targets.map((target) => target.key));
        for (const [key, entry] of entries) {
          if (listed.has(key)) continue;
          entry.cancelTimer?.();
          entries.delete(key);
          held.delete(key);
        }
        for (const target of targets) {
          const existing = entries.get(target.key);
          if (existing === undefined) {
            const entry: Entry = {
              machine: initialContainer(),
              origin: target.origin,
              known: knownStatus(null, target.platform),
              cancelTimer: null,
              readingFlag: false,
              socket: false,
            };
            entries.set(target.key, entry);
            transition(target.key, entry, { type: "PLATFORM", status: target.platform });
            const record = restored.get(target.key);
            if (record !== undefined) {
              restored.delete(target.key);
              transition(target.key, entry, { type: "INTENT", intent: restore(record) });
            }
            // Proven once its intent is back: a proof stepped first would read as its end.
            prove(target.key, entry);
            // A Mate seen for the first time: the read its connect makes will do. While HQ's answer
            // is awaited it waits for it, as that may prove it up — never the route's.
            if (hq === "awaited" && !first.has(target.key)) held.add(target.key);
            else if (!quiet(target.key, entry)) requestFor(entry, { fresh: false });
            continue;
          }
          const moved = existing.origin !== target.origin;
          existing.origin = target.origin;
          const pushed = statusMoved(existing.known, target.platform);
          existing.known = knownStatus(existing.known, target.platform);
          step(target.key, existing, { type: "PLATFORM", status: platformOf(existing, target) });
          // A status that moved, or a new address, reads the container again: ready is never
          // terminal. The same status listed again, or one the listing could not say, reads nothing.
          if ((pushed || moved) && !quiet(target.key, existing))
            requestFor(existing, { fresh: true });
        }
      }),
    process: (key, running) =>
      batch(() => {
        const entry = entries.get(key);
        if (entry !== undefined) step(key, entry, { type: "PROCESS", running });
      }),
    link: (key, connected) =>
      batch(() => {
        const entry = entries.get(key);
        if (entry === undefined) return;
        entry.socket = connected;
        prove(key, entry);
      }),
    setOnline: (projectIds) =>
      batch(() => {
        if (projectIds === "absent") {
          hear(new Set(), "silent");
          return;
        }
        if (projectIds !== null) {
          hear(projectIds, "answered");
          return;
        }
        if (hq !== "answered") return;
        hq = "awaited";
        cancelHqWait = clock.setTimer(HQ_WAIT_MS, () => batch(() => hear(new Set(), "silent")));
      }),
    intend: (key, intent) =>
      batch(() => {
        const entry = entries.get(key);
        if (entry === undefined) return;
        const since = clock.now();
        step(key, entry, {
          type: "INTENT",
          intent:
            intent.kind === "update"
              ? { kind: "update", since, from: intent.from }
              : typeof intent.initAt === "string"
                ? { kind: intent.kind, since, initAt: intent.initAt }
                : { kind: intent.kind, since },
        });
      }),
    initAt: async (key) => {
      const origin = entries.get(key)?.origin ?? null;
      if (origin === null || disposed) return null;
      const controller = new AbortController();
      const cancel = clock.setTimer(INIT_AT_READ_DEADLINE_MS, () => controller.abort());
      try {
        return await ports.readInitAt(origin, controller.signal);
      } catch {
        return null;
      } finally {
        cancel();
      }
    },
    request: (key, ask = { fresh: true }) =>
      batch(() => {
        const entry = entries.get(key);
        if (entry === undefined) return;
        held.delete(key);
        requestFor(entry, ask);
      }),
    setFirst: (keys) =>
      batch(() => {
        first = keys;
        proveAll();
        for (const key of keys) {
          const entry = entries.get(key);
          if (entry === undefined || !held.delete(key)) continue;
          requestFor(entry, { fresh: false });
        }
      }),
    setHqScope: (projectIds) =>
      batch(() => {
        hqScope = projectIds;
      }),
    setWanted: (keys) =>
      batch(() => {
        const before = wanted;
        wanted = keys;
        for (const key of keys) {
          const entry = entries.get(key);
          if (entry === undefined || before.has(key)) continue;
          held.delete(key);
          requestFor(entry, { fresh: false });
        }
      }),
    next: (origin) => probes.next(origin),
    setVisible: (visible) => probes.setVisible(visible),
    wake: (visible) =>
      batch(() => {
        if (visible) probes.setVisible(true);
        const now = clock.now();
        for (const [key, entry] of entries) {
          step(key, entry, { type: "TICK" });
          // A container on a poll is read on its own cadence; one read on demand, once its last
          // reading is old enough to say nothing any more and it does not wait for HQ's word.
          if (
            visible &&
            !held.has(key) &&
            !quiet(key, entry) &&
            probeCadence(entry.machine).kind === "on-demand" &&
            unreadSince(entry.machine, now)
          )
            requestFor(entry, { fresh: false });
        }
      }),
    verdict: (key) => {
      const machine = entries.get(key)?.machine;
      return machine === undefined ? { level: "unknown" } : containerVerdict(machine);
    },
    machine: (key) => entries.get(key)?.machine,
    machines: () => published,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeProbes();
      requests.clear();
      probes.dispose();
      cancelHqWait?.();
      for (const entry of entries.values()) entry.cancelTimer?.();
      entries.clear();
      listeners.clear();
    },
  };
}

/**
 * Joins the store to the exchange driver of the same epoch: each target's container verdict
 * reaches its environment machine (region C, whose `ready` kicks a link in backoff), and each
 * machine's link, wanted exchange and route demand reach the store. Returns what unbinds them.
 */
export function bindContainerStore(store: ContainerStore, driver: ExchangeDriver): () => void {
  const toDriver = () => {
    // A Mate found answering again after its reads went unanswered, while its exchange or its
    // link waits out a backoff, is tried at once rather than at the ladder's next rung.
    for (const [key, machine] of store.machines()) {
      const reading = machine.reading?.reading.kind;
      if (reading === undefined) continue;
      const now = reading === "ready";
      const before = answering.get(key);
      answering.set(key, now);
      const environment = driver.machine(key);
      if (
        before === false &&
        now &&
        environment !== undefined &&
        (environment.credential.kind === "backoff" || environment.link.phase === "backoff")
      )
        driver.retry(key);
    }
    // Only a target the driver already knows: its record is read when the driver first sees it.
    const targets = [...store.machines()]
      .filter(([key]) => driver.machine(key) !== undefined)
      .map(([key, machine]) => ({
        key,
        presence: null,
        container: containerVerdict(machine),
        record: null,
      }));
    if (targets.length > 0) driver.setTargets(targets);
  };
  const exchanging = new Set<TargetKey>();
  const failing = new Set<TargetKey>();
  const backingOff = new Set<TargetKey>();
  /** Whether each target's last read found its Mate answering. */
  const answering = new Map<TargetKey, boolean>();
  /** Reads the container once each time `now` turns true for the key. */
  const onEdge = (seen: Set<TargetKey>, key: TargetKey, now: boolean, ask: ProbeAsk) => {
    if (now && !seen.has(key)) store.request(key, ask);
    if (now) seen.add(key);
    else seen.delete(key);
  };
  const toStore = () => {
    const machines = [...driver.machines()];
    store.setFirst(
      new Set(machines.filter(([, machine]) => machine.guards.routeTarget).map(([key]) => key)),
    );
    store.setWanted(
      new Set(machines.filter(([, machine]) => machine.guards.want).map(([key]) => key)),
    );
    for (const [key, machine] of machines) {
      store.link(key, machine.link.phase === "connected");
      // An exchange starting reads the container it is about to meet.
      // It may take the descriptor the exchange itself reads.
      onEdge(exchanging, key, machine.credential.kind === "exchanging", { fresh: false });
      // A connect failing, connected before or not, reads it again: ready is never terminal.
      onEdge(failing, key, machine.link.phase === "backoff", { fresh: true });
      // So does an exchange backing off: the read that finds the Mate back ends the wait.
      onEdge(backingOff, key, machine.credential.kind === "backoff", { fresh: true });
    }
  };
  const unsubscribeStore = store.subscribe(toDriver);
  const unsubscribeDriver = driver.subscribe(toStore);
  return () => {
    unsubscribeStore();
    unsubscribeDriver();
  };
}
