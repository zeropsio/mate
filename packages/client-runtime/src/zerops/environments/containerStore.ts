/**
 * The container store (DESIGN §4.5): one container machine per Mate target, the probe store that
 * reads their origins, and the intents our own verbs created (C8). One per account epoch.
 *
 * - Facts arrive as calls — the platform's statuses (`setTargets`), its processes (`process`),
 *   the link (`link`), the Mate flag's read — and every probe reading lands on each target whose
 *   origin it read. Each target's machine decides its level; the store runs its effects.
 * - Probes follow each machine's cadence. A ready container is read again on a status push, on
 *   its socket failing, on a visible wake and whenever someone asks (`request`): ready is never
 *   terminal.
 * - Intents are persisted in this tab's storage as `{target, kind, since, from?}`, so a reload
 *   inside an intent's budget shows `restarting(you)` or `updating` again instead of guesses. An
 *   intent restored for a target not yet listed waits for it.
 */
import type { Instant } from "../data/access/grant.ts";
import {
  containerVerdict,
  initialContainer,
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
import type { ExchangeClock, ExchangeDriver, TargetKey } from "./exchangeDriver.ts";
import {
  makeProbeStore,
  type ProbeCadence,
  type ProbeFact,
  type ProbeReading,
} from "./probeStore.ts";

/** One target as the platform describes it now. */
export interface ContainerTarget {
  readonly key: TargetKey;
  /** The Mate's public origin; null while the platform gives it none. */
  readonly origin: string | null;
  readonly platform: PlatformStatus;
}

/** Where this tab keeps its intents (`sessionStorage` under the account key). */
export interface IntentStorage {
  readonly read: () => string | null;
  /** Null forgets them. */
  readonly write: (value: string | null) => void;
}

/** One persisted intent; `since` is wall time, the one clock a reload keeps. */
interface IntentRecord {
  readonly target: TargetKey;
  readonly kind: IntentKind;
  readonly since: number;
  readonly from?: string | null;
}

export interface ContainerStorePorts {
  readonly clock: Pick<ExchangeClock, "now" | "setTimer">;
  /** Reads the origin's descriptor and `/healthz`; rejects when the signal aborts it. */
  readonly probe: (origin: string, signal: AbortSignal) => Promise<ProbeReading>;
  /** `ZCP_MATE_ENABLED` for the target's service; `"unknown"` when it could not be read. */
  readonly readMateFlag: (key: TargetKey) => Promise<MateFlag>;
  readonly intents: IntentStorage;
}

/** What our verb asks: the store stamps it with the time it was accepted. */
export type IntentRequest =
  | { readonly kind: "restart" | "enable" | "upgrade-restart" }
  | { readonly kind: "update"; readonly from: string | null };

export interface ContainerStore {
  /** Every target the platform lists, as it stands now; a target left out is forgotten. */
  readonly setTargets: (targets: ReadonlyArray<ContainerTarget>) => void;
  /** Whether a platform process runs against the target (the activity feed). */
  readonly process: (key: TargetKey, running: boolean) => void;
  /** Whether the target's Mate socket is connected; a drop reads the container again. */
  readonly link: (key: TargetKey, connected: boolean) => void;
  /** Our verb was accepted: its level holds until a read fact settles it. */
  readonly intend: (key: TargetKey, intent: IntentRequest) => void;
  /** Reads the target's container once more. */
  readonly request: (key: TargetKey) => void;
  /** The reading of a probe of this origin started from now on. */
  readonly next: (origin: string) => Promise<ProbeReading>;
  readonly setVisible: (visible: boolean) => void;
  /** §6.4's coalesced wake: deadlines settle, and a visible one reads what no socket proves. */
  readonly wake: (visible: boolean) => void;
  readonly verdict: (key: TargetKey) => ContainerVerdict;
  readonly machine: (key: TargetKey) => ContainerMachine | undefined;
  /** The origin's descriptor and `/healthz` as last read (C6). */
  readonly fact: (origin: string) => ProbeFact;
  /** Every target's machine as last published; the same map until the next publication. */
  readonly machines: () => ReadonlyMap<TargetKey, ContainerMachine>;
  readonly subscribe: (listener: () => void) => () => void;
  /** The account closed: every probe, read and timer ends. */
  readonly dispose: () => void;
}

interface Entry {
  machine: ContainerMachine;
  origin: string | null;
  cancelTimer: (() => void) | null;
  /** A Mate flag read is in flight. */
  readingFlag: boolean;
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
    (record.from === undefined || record.from === null || typeof record.from === "string")
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
    : { target, kind: intent.kind, since: intent.since.wall };

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

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

  const step = (key: TargetKey, entry: Entry, event: ContainerEvent) => {
    if (entries.get(key) !== entry) return;
    const next = transitionContainer(entry.machine, event, { now: clock.now() });
    entry.machine = next.state;
    for (const effect of next.effects) run(key, entry, effect);
  };

  // ── Publication ──────────────────────────────────────────────────────────────────────────

  /** Each origin polls on the most demanding cadence any of its targets asks for. */
  const cadences = (): ReadonlyMap<string, ProbeCadence> => {
    const rank = (cadence: ProbeCadence): number =>
      cadence.kind === "poll" ? (cadence.overdue ? 2 : 3) : cadence.kind === "on-demand" ? 1 : 0;
    const byOrigin = new Map<string, ProbeCadence>();
    for (const entry of entries.values()) {
      if (entry.origin === null) continue;
      const cadence = probeCadence(entry.machine);
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
    probes.setCadences(cadences());
    persist();
    const machines = new Map([...entries].map(([key, entry]) => [key, entry.machine] as const));
    if (sameJson([...machines], [...published])) return;
    published = machines;
    for (const listener of listeners) listener();
  }

  const requestFor = (entry: Entry) => {
    if (entry.origin !== null) probes.request(entry.origin);
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
    return record.kind === "update"
      ? { kind: "update", since, from: record.from ?? null }
      : { kind: record.kind, since };
  };

  return {
    setTargets: (targets) =>
      batch(() => {
        const listed = new Set(targets.map((target) => target.key));
        for (const [key, entry] of entries) {
          if (listed.has(key)) continue;
          entry.cancelTimer?.();
          entries.delete(key);
        }
        for (const target of targets) {
          const existing = entries.get(target.key);
          if (existing === undefined) {
            const entry: Entry = {
              machine: initialContainer(),
              origin: target.origin,
              cancelTimer: null,
              readingFlag: false,
            };
            entries.set(target.key, entry);
            step(target.key, entry, { type: "PLATFORM", status: target.platform });
            const record = restored.get(target.key);
            if (record !== undefined) {
              restored.delete(target.key);
              step(target.key, entry, { type: "INTENT", intent: restore(record) });
            }
            requestFor(entry);
            continue;
          }
          const moved = existing.origin !== target.origin;
          existing.origin = target.origin;
          const pushed = !sameJson(existing.machine.platform, target.platform);
          step(target.key, existing, { type: "PLATFORM", status: target.platform });
          // A status push, or a new address, reads the container again: ready is never terminal.
          if (pushed || moved) requestFor(existing);
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
        const dropped = !connected && entry.machine.connectedSince !== null;
        step(key, entry, { type: "LINK", connected });
        if (dropped) requestFor(entry);
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
              : { kind: intent.kind, since },
        });
      }),
    request: (key) =>
      batch(() => {
        const entry = entries.get(key);
        if (entry !== undefined) requestFor(entry);
      }),
    next: (origin) => probes.next(origin),
    setVisible: (visible) => probes.setVisible(visible),
    wake: (visible) =>
      batch(() => {
        if (visible) probes.setVisible(true);
        for (const [key, entry] of entries) {
          step(key, entry, { type: "TICK" });
          if (visible && probeCadence(entry.machine).kind === "on-demand") requestFor(entry);
        }
      }),
    verdict: (key) => {
      const machine = entries.get(key)?.machine;
      return machine === undefined ? { level: "unknown" } : containerVerdict(machine);
    },
    machine: (key) => entries.get(key)?.machine,
    fact: (origin) => probes.fact(origin),
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
      probes.dispose();
      for (const entry of entries.values()) entry.cancelTimer?.();
      entries.clear();
      listeners.clear();
    },
  };
}

/**
 * Joins the store to the exchange driver of the same epoch: each target's container verdict
 * reaches its environment machine (region C, whose `ready` kicks a link in backoff), and each
 * machine's link and wanted exchange reach the store. Returns what unbinds them.
 */
export function bindContainerStore(store: ContainerStore, driver: ExchangeDriver): () => void {
  const toDriver = () => {
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
  const toStore = () => {
    for (const [key, machine] of driver.machines()) {
      store.link(key, machine.link.phase === "connected");
      // An exchange starting reads the container it is about to meet.
      const wants = machine.credential.kind === "exchanging";
      if (wants && !exchanging.has(key)) store.request(key);
      if (wants) exchanging.add(key);
      else exchanging.delete(key);
    }
  };
  const unsubscribeStore = store.subscribe(toDriver);
  const unsubscribeDriver = driver.subscribe(toStore);
  return () => {
    unsubscribeStore();
    unsubscribeDriver();
  };
}
