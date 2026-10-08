/**
 * The Mate adapter: what this tab reads of each Mate from
 * the Mate itself — a probe of its container, its door's answer, the link the connection registry
 * reports — run by the two machines that stay the judges of it, and written to the account's store
 * as one `mateLink` fact per target after every batch. Readers read projections of those facts.
 *
 * - **One sampled link per Mate project**, `mate:<projectId>`, demanded while something waits on
 *   one of its Mates: the route, the screen, a page that draws it, the Mate left last, an action's
 *   lease, the person's Connect, or our verb's intent on its container. Nothing else is probed: a
 *   Mate nobody waits on reads its container from the platform's statuses alone (the services the
 *   listing holds), never from a probe of its own.
 * - The registration exchange runs inside its link: the environment machine decides when an
 *   exchange starts, reads its answer, backs off and waits for a named input (`environmentMachine`),
 *   and the adapter runs what it asks — the door, the install, a descriptor re-read, the registry's
 *   retry — and feeds every answer back. The container machine judges the container's level from
 *   the platform's statuses, the processes, the probes, the socket and our intents.
 * - A target the person asked for — the route's, the one on screen, one an action of theirs holds,
 *   or one whose Connect they pressed — starts the moment it can. The background — the Mates a page
 *   draws, the Mate left last — starts at most `EXCHANGE_CONCURRENCY` at once and at the door's mint
 *   pace, which every exchange that may mint spends. A session kept from an earlier load mints
 *   nothing, so it neither waits on the pace nor spends it. While a press is in flight in this
 *   browser, the background starts no exchange that mints.
 * - Our verbs' intents survive a reload in this tab's storage (C8): one restored for a target not
 *   listed yet waits for it.
 * - Everything that arrives in one turn of the event loop is taken in together, then the slots are
 *   handed out, the probes scheduled, the intents kept, and what changed is written — one reduction
 *   per Mate project.
 *
 * @module data/adapters/mate
 */
import type { EnvironmentId } from "@t3tools/contracts";

import {
  readZeropsContainer,
  readZeropsInitAt,
  type DescriptorRead,
  type FetchLike,
} from "../../zerops/containerHealth.ts";
import { DOOR_MINT_PACE, makeMintPace } from "../../zerops/doorThrowaway.ts";
import type { Instant } from "../../zerops/environments/exchange.ts";
import type { IdentityExchangeReason } from "../../zerops/diagnostics.ts";
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
} from "../../zerops/environments/containerMachine.ts";
import {
  initialEnvironment,
  transitionEnvironment,
  type DescriptorFacts,
  type EnvironmentDiagnostic,
  type EnvironmentEffect,
  type EnvironmentEvent,
  type EnvironmentGuards,
  type EnvironmentMachine,
  type LinkPhase,
  type Presence,
} from "../../zerops/environments/environmentMachine.ts";
import {
  EXCHANGE_CONCURRENCY,
  INIT_AT_READ_DEADLINE_MS,
  type AccountGuards,
  type ConnectOutcome,
  type DemandReason,
  type ExchangeClock,
  type ExchangeRequest,
  type InstallOutcome,
  type IntentRequest,
  type IntentStorage,
  type LeaseKind,
  type TargetKey,
} from "../../zerops/environments/exchange.ts";
import {
  HIDDEN_PROBE_PAUSE_MS,
  OVERDUE_POLL_INTERVALS_MS,
  POLL_INTERVALS_MS,
  PROBE_DEADLINE_MS,
  type ProbeAnswer,
  type ProbeAsk,
  type ProbeCadence,
  type ProbeRead,
  type ProbeReading,
} from "../../zerops/environments/probe.ts";
import { selectReachability } from "../../zerops/environments/reachability.ts";
import type { ExchangeAnswer } from "../../zerops/identityExchange.ts";
import { mateLinkScope, type MateLinkValue } from "../families/mateLink.ts";
import { linkKeys } from "../model.ts";
import type { Row } from "../reducer.ts";
import { streamOf } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";

// ── Ports ────────────────────────────────────────────────────────────────────────────────────

/** One Mate target as the listing — or the session kept for it — names it now. */
export interface MateTarget {
  readonly key: TargetKey;
  /** The organization that lists its project; null for a target only a kept session names. */
  readonly orgId: string | null;
  /** Null while the listing cannot say: presence holds its last value. */
  readonly presence: Presence | null;
  /** The Mate's public origin; null while the platform gives it none. */
  readonly origin: string | null;
  /** Its project's and service's statuses; null where the listing does not list its project. */
  readonly platform: PlatformStatus | null;
  /** The environment a session kept for it names (C1); read when the target is first seen. */
  readonly record: EnvironmentId | null;
}

export interface MateAdapterPorts<C> {
  /** The account's one writer. */
  readonly store: AccountStore;
  readonly clock: ExchangeClock;
  /** The descriptor, the mint, the door and the token exchange; installs nothing. */
  readonly exchange: (request: ExchangeRequest) => Promise<ExchangeAnswer<C>>;
  /**
   * Installs an accepted credential: registers the environment, or rotates the credential of one
   * already registered. A failed install sends the target's machine to backoff.
   */
  readonly install: (input: {
    readonly key: TargetKey;
    readonly environmentId: EnvironmentId;
    readonly credential: C;
  }) => Promise<InstallOutcome>;
  readonly readDescriptor: (origin: string, signal: AbortSignal) => Promise<DescriptorFacts>;
  /** Whether this target's exchange presents a session kept from an earlier load first. */
  readonly kept?: (key: TargetKey) => boolean;
  /** The supervisor's `retryNow` for a link in backoff. */
  readonly retryLink: (environmentId: EnvironmentId) => void;
  /** The Mate is gone where the platform lists it, or its person removed it. */
  readonly retire: (key: TargetKey, environmentId: EnvironmentId | null) => void;
  readonly log?: (key: TargetKey, diagnostic: EnvironmentDiagnostic) => void;
  /** Reads the origin's container: its descriptor and `/healthz`; rejects when aborted. */
  readonly probe: (origin: string, signal: AbortSignal, ask: ProbeRead) => Promise<ProbeAnswer>;
  /** The origin's `/healthz` `initAt`, read now; null when it serves none. */
  readonly readInitAt: (origin: string, signal: AbortSignal) => Promise<string | null>;
  /** `ZCP_MATE_ENABLED` for the target's service; `"unknown"` when it could not be read. */
  readonly readMateFlag: (key: TargetKey) => Promise<MateFlag>;
  /** This tab's container intents (C8). */
  readonly intents: IntentStorage;
}

/** One target's machines, as the adapter holds them now. */
export interface MateMachines {
  readonly environment: EnvironmentMachine;
  readonly container: ContainerMachine;
}

export interface MateAdapter {
  /** The current queue has been reduced and published; held port answers are separate producers. */
  readonly settled: () => Promise<void>;
  /** Every Mate target the listing or a kept session names now; one left out is no longer shown. */
  readonly setTargets: (targets: ReadonlyArray<MateTarget>) => void;
  /** A project being deleted takes no demand; its leases stand for when it fails. */
  readonly setDeleting: (projectId: string, deleting: boolean) => void;
  /** The projects whose Mate is held for its close-off: none takes demand. Replaces the set. */
  readonly setCloseOffHeld: (projectIds: Iterable<string>) => void;
  /** Replaces the whole set of targets one emitter wants. */
  readonly setDemand: (reason: DemandReason, keys: Iterable<TargetKey>) => void;
  /** The target is wanted until the answer is called; calling it again does nothing. */
  readonly hold: (key: TargetKey, kind: LeaseKind) => () => void;
  /**
   * The user's Connect: a user retry of a target its caller holds, whose container is read again
   * at once. Answers with the installed environment, or the verdict the machine settled on.
   */
  readonly connect: (key: TargetKey, reason: IdentityExchangeReason) => Promise<ConnectOutcome>;
  readonly setAccount: (guards: AccountGuards) => void;
  /** A press is in flight in this browser: the background mints nothing until it ends. */
  readonly holdBackground: (held: boolean) => void;
  readonly setVisible: (visible: boolean) => void;
  /** §6.4's coalesced wake: deadlines settle; a visible one retries and reads what is waited on. */
  readonly wake: (visible: boolean) => void;
  readonly online: () => void;
  /** What the supervisor of an environment publishes. */
  readonly link: (environmentId: EnvironmentId, phase: LinkPhase) => void;
  /** Whether a platform process runs against the target (the activity feed). */
  readonly process: (key: TargetKey, running: boolean) => void;
  /**
   * Our verb was accepted for this target: its container shows it until a read fact settles it.
   * False when no container took it — no such target, or the platform's facts overrule it.
   */
  readonly intend: (key: TargetKey, intent: IntentRequest) => boolean;
  /** The target's `/healthz` `initAt`, read now; null when it cannot say in time. */
  readonly initAt: (key: TargetKey) => Promise<string | null>;
  /** The target's container is read again, if something waits on it. */
  readonly request: (key: TargetKey, ask?: ProbeAsk) => void;
  /** The reading of a probe of this origin started from now on. */
  readonly next: (origin: string) => Promise<ProbeReading>;
  readonly machines: (key: TargetKey) => MateMachines | undefined;
  /** Every target's environment machine as last written; the same map until the next batch. */
  readonly environments: () => ReadonlyMap<TargetKey, EnvironmentMachine>;
  /** Every target's container machine as last written; the same map until the next batch. */
  readonly containers: () => ReadonlyMap<TargetKey, ContainerMachine>;
  /** Told after every batch that changed a machine. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The account closed: every probe, exchange, timer and waiting Connect ends. */
  readonly dispose: () => void;
}

/**
 * A Mate's container read over this page's `fetch`: its descriptor through the tab's one share of
 * it (`descriptor`), and its `/healthz`.
 */
export function mateContainerReads(
  descriptor: DescriptorRead,
): Pick<MateAdapterPorts<unknown>, "probe" | "readInitAt"> {
  // @effect-diagnostics-next-line globalFetch:off -- the Mate adapter's one reach of a Mate's container; plain promises, no Effect runtime.
  const fetch: FetchLike = (url, init) => globalThis.fetch(url, init);
  return {
    probe: (origin, signal, ask) => readZeropsContainer(origin, { descriptor, fetch }, signal, ask),
    readInitAt: (origin, signal) => readZeropsInitAt(origin, fetch, signal),
  };
}

// ── Intents (C8) ─────────────────────────────────────────────────────────────────────────────

/** One persisted intent; `since` is wall time, the one clock a reload keeps. */
interface IntentRecord {
  readonly target: TargetKey;
  readonly kind: IntentKind;
  readonly since: number;
  readonly from?: string | null;
  /** The `/healthz` `initAt` read before a restart verb was sent. */
  readonly initAt?: string;
}

const INTENT_KINDS: ReadonlySet<string> = new Set<IntentKind>([
  "restart",
  "enable",
  "upgrade-restart",
  "update",
]);

const isIntentRecord = (value: unknown): value is IntentRecord => {
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

const readIntents = (storage: IntentStorage): ReadonlyArray<IntentRecord> => {
  try {
    const parsed: unknown = JSON.parse(storage.read() ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isIntentRecord) : [];
  } catch {
    return [];
  }
};

const toIntentRecord = (target: TargetKey, intent: ContainerIntent): IntentRecord =>
  intent.kind === "update"
    ? { target, kind: intent.kind, since: intent.since.wall, from: intent.from }
    : intent.initAt === undefined
      ? { target, kind: intent.kind, since: intent.since.wall }
      : { target, kind: intent.kind, since: intent.since.wall, initAt: intent.initAt };

// ── Shared helpers ───────────────────────────────────────────────────────────────────────────

/** The demands in priority order (§4.4): the user's Connect ranks after the route's and the screen's. */
const PRIORITY: ReadonlyArray<DemandReason | LeaseKind> = [
  "route",
  "screen",
  "user",
  "action",
  "drawn",
  "recent",
];

/** The demands of the person's own asking: past every budget. */
const ASKED_RANK = PRIORITY.indexOf("action");

const isLease = (reason: DemandReason | LeaseKind): reason is LeaseKind =>
  reason === "action" || reason === "user";

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const projectOf = (key: TargetKey): string => key.split(":")[0] ?? key;

const after = (instant: Instant, ms: number): Instant => ({
  wall: instant.wall + ms,
  mono: instant.mono + ms,
});

/** True once either clock has passed `at`. */
const reached = (at: Instant, now: Instant): boolean => now.wall >= at.wall || now.mono >= at.mono;

const delayUntil = (at: Instant, now: Instant): number =>
  Math.max(0, Math.min(at.mono - now.mono, at.wall - now.wall));

/** A visible wake reads a container no socket holds once its last reading is this old. */
const WAKE_REREAD_MS = 60_000;

const unreadSince = (machine: ContainerMachine, now: Instant): boolean => {
  const sentAt = machine.reading?.sentAt;
  return (
    sentAt === undefined ||
    now.mono - sentAt.mono >= WAKE_REREAD_MS ||
    now.wall - sentAt.wall >= WAKE_REREAD_MS
  );
};

const inFlightAttempt = (machine: EnvironmentMachine): number | null => {
  const credential = machine.credential;
  if (credential.kind === "exchanging") return credential.attempt;
  if (credential.kind === "held") return credential.rereading?.attempt ?? null;
  return null;
};

const polls = (cadence: ProbeCadence): cadence is Extract<ProbeCadence, { kind: "poll" }> =>
  cadence.kind === "poll";

/** The platform or our verb says the container is on its way up: it is polled until it is. */
const comingUp = (machine: ContainerMachine): boolean =>
  (machine.state.level === "booting" && !machine.state.guessed) ||
  machine.state.level === "restarting" ||
  machine.state.level === "updating";

/** The platform's status as last read: a service the listing could not say keeps its last. */
interface KnownStatus {
  readonly project: string;
  readonly service: string | null;
}

const statusMoved = (known: KnownStatus, platform: PlatformStatus): boolean =>
  platform.project !== known.project ||
  (platform.service !== null && known.service !== null && platform.service !== known.service);

// ── Entries ──────────────────────────────────────────────────────────────────────────────────

interface Entry {
  readonly key: TargetKey;
  orgId: string | null;
  origin: string | null;
  shown: boolean;
  /** Listed now, by the listing or a kept session; one left out keeps its machines. */
  listed: boolean;
  environment: EnvironmentMachine;
  environmentTimer: (() => void) | null;
  /** The environment machine's ops in flight, by attempt. */
  readonly inFlight: Map<number, AbortController>;
  /** The exchange attempt whose accepted credential is being installed. */
  installing: number | null;
  /** The reason the user's last Connect gave; the target's exchanges carry it. */
  userReason: IdentityExchangeReason | null;
  container: ContainerMachine;
  containerTimer: (() => void) | null;
  known: KnownStatus;
  readingFlag: boolean;
  /** The target's Mate socket is connected. */
  socket: boolean;
  /** Whether the last probe found its Mate answering; undefined before one. */
  answering: boolean | undefined;
  /** Edges of the environment machine that read the container once as they rise. */
  readonly edges: { failing: boolean };
  /** The value last written to the store; null before the first. */
  written: MateLinkValue | null;
}

/** One origin's probe state. */
interface Origin {
  cadence: ProbeCadence;
  inFlight: AbortController | null;
  /** Asked for once more, after whatever is in flight. */
  requested: boolean;
  requestedFresh: boolean;
  /** One of those asks wants `/healthz` read beside the descriptor. */
  requestedHealth: boolean;
  /** When the cadence reads it next; null while it does not poll. */
  pollAt: Instant | null;
  rung: number;
  /** The last probe's `sentAt`; null before one. */
  lastSentAt: Instant | null;
  waiting: Array<(reading: ProbeReading) => void>;
  answering: Array<(reading: ProbeReading) => void>;
}

// ── The adapter ──────────────────────────────────────────────────────────────────────────────

export function makeMateAdapter<C>(ports: MateAdapterPorts<C>): MateAdapter {
  const { clock, store } = ports;
  const entries = new Map<TargetKey, Entry>();
  const origins = new Map<string, Origin>();
  const demands = new Map<DemandReason, ReadonlySet<TargetKey>>();
  const holds = new Map<LeaseKind, Map<TargetKey, number>>([
    ["action", new Map()],
    ["user", new Map()],
  ]);
  const deleting = new Set<string>();
  let closeOffHeld: ReadonlySet<string> = new Set();
  const connects = new Map<TargetKey, Array<(outcome: ConnectOutcome) => void>>();
  const listeners = new Set<() => void>();
  /** Intents restored from storage whose targets are not listed yet. */
  const restored = new Map<TargetKey, IntentRecord>(
    readIntents(ports.intents).map((record) => [record.target, record]),
  );
  let persisted = ports.intents.read();
  const pace = makeMintPace(DOOR_MINT_PACE);
  let cancelMintTimer: (() => void) | null = null;
  let cancelProbeWake: (() => void) | null = null;
  let account: AccountGuards = {
    verified: false,
    zeropsState: "unknown",
  };
  let visible = false;
  let hiddenSince: number | null = null;
  let holding = false;
  let disposed = false;
  let sequence = 0;
  /** The projects whose link is demanded, as the store was last told. */
  let demandedProjects: ReadonlySet<string> = new Set();
  let publishedEnvironments: ReadonlyMap<TargetKey, EnvironmentMachine> = new Map();
  let publishedContainers: ReadonlyMap<TargetKey, ContainerMachine> = new Map();
  const queue: Array<() => void> = [];
  const settlements = new Set<() => void>();
  let scheduled = false;

  const context = () => ({ now: clock.now(), random: clock.random });
  const suppressed = (projectId: string): boolean =>
    deleting.has(projectId) || closeOffHeld.has(projectId);

  const entryFor = (key: TargetKey, record: EnvironmentId | null): Entry => {
    const existing = entries.get(key);
    if (existing !== undefined) return existing;
    const created: Entry = {
      key,
      orgId: null,
      origin: null,
      shown: false,
      listed: false,
      environment: initialEnvironment({ record }),
      environmentTimer: null,
      inFlight: new Map(),
      installing: null,
      userReason: null,
      container: initialContainer(),
      containerTimer: null,
      known: { project: "", service: null },
      readingFlag: false,
      socket: false,
      answering: undefined,
      edges: { failing: false },
      written: null,
    };
    entries.set(key, created);
    return created;
  };

  const endOps = (entry: Entry): void => {
    entry.environmentTimer?.();
    entry.environmentTimer = null;
    entry.containerTimer?.();
    entry.containerTimer = null;
    for (const controller of entry.inFlight.values()) controller.abort();
    entry.inFlight.clear();
  };

  // ── Demand ─────────────────────────────────────────────────────────────────────────────────

  const wantedBy = (key: TargetKey): ReadonlyArray<DemandReason | LeaseKind> =>
    suppressed(projectOf(key))
      ? []
      : PRIORITY.filter((reason) =>
          isLease(reason)
            ? (holds.get(reason)?.get(key) ?? 0) > 0
            : demands.get(reason)?.has(key) === true,
        );

  const rank = (key: TargetKey): number => {
    const top = wantedBy(key)[0];
    return top === undefined ? PRIORITY.length : PRIORITY.indexOf(top);
  };
  const asked = (key: TargetKey): boolean => rank(key) <= ASKED_RANK;
  const kept = (key: TargetKey): boolean => ports.kept?.(key) ?? false;
  /** Something waits on the target's container: a demand, a lease, or our verb's intent. */
  const watched = (entry: Entry): boolean =>
    wantedBy(entry.key).length > 0 || entry.container.intent !== null;

  /** The person waits on it: the route, the screen, their action or Connect, or our verb. */
  const personWaits = (entry: Entry): boolean =>
    asked(entry.key) || entry.container.intent !== null;

  const reasonFor = (entry: Entry): IdentityExchangeReason => {
    const credential = entry.environment.credential;
    if (
      (credential.kind === "none" ||
        credential.kind === "waiting" ||
        credential.kind === "exchanging") &&
      credential.reconnect
    )
      return "repair";
    const top = wantedBy(entry.key)[0];
    if (top === undefined || !isLease(top)) return "restore";
    return entry.userReason ?? "user";
  };

  // ── The environment machine ────────────────────────────────────────────────────────────────

  const startedBy = (entry: Entry, attempt: number): boolean => {
    if (entries.get(entry.key) === entry) return true;
    ports.log?.(entry.key, { kind: "stale-result", attempt });
    return false;
  };

  const runEnvironment = (entry: Entry, effect: EnvironmentEffect) => {
    const { key } = entry;
    switch (effect.kind) {
      case "schedule": {
        entry.environmentTimer?.();
        entry.environmentTimer = clock.setTimer(delayUntil(effect.at, clock.now()), () =>
          enqueue(() => step(entry, { type: "TICK" })),
        );
        return;
      }
      case "cancel":
        entry.environmentTimer?.();
        entry.environmentTimer = null;
        return;
      case "log":
        ports.log?.(key, effect.diagnostic);
        return;
      case "run":
        break;
    }
    const { attempt, op } = effect;
    switch (op.kind) {
      case "exchange": {
        const controller = new AbortController();
        entry.inFlight.set(attempt, controller);
        const sentAt = clock.now();
        if (!kept(key)) pace.spend(sentAt.mono);
        ports
          .exchange({
            key,
            origin: op.origin,
            expected: op.expected,
            reason: reasonFor(entry),
            asked: asked(key),
            signal: controller.signal,
          })
          .then(
            (answer) => enqueue(() => answered(entry, attempt, sentAt, answer)),
            () =>
              enqueue(() =>
                answered(entry, attempt, sentAt, {
                  ok: false,
                  failure: { class: "retryable", cause: { kind: "network" } },
                  descriptor: null,
                }),
              ),
          );
        return;
      }
      case "read-descriptor": {
        const controller = new AbortController();
        entry.inFlight.set(attempt, controller);
        const read = (result: Extract<EnvironmentEvent, { type: "DESCRIPTOR_READ" }>["result"]) =>
          enqueue(() => {
            if (startedBy(entry, attempt))
              step(entry, { type: "DESCRIPTOR_READ", attempt, result });
          });
        ports.readDescriptor(op.origin, controller.signal).then(
          (descriptor) => read({ ok: true, descriptor }),
          () => read({ ok: false }),
        );
        return;
      }
      case "retry-link":
        ports.retryLink(op.environmentId);
        return;
      case "retire":
        ports.retire(key, op.environmentId);
        return;
    }
  };

  /** Feeds one event to one target's environment machine, then runs its effects. */
  const step = (entry: Entry, event: EnvironmentEvent): void => {
    if (entries.get(entry.key) !== entry) return;
    let { state, effects } = transitionEnvironment(entry.environment, event, context());
    // A slot is held only by the exchange it started: one that ended gives it back at once.
    if (state.credential.kind !== "exchanging" && state.guards.budget) {
      const returned = transitionEnvironment(
        state,
        { type: "GUARDS", guards: { ...state.guards, budget: false } },
        context(),
      );
      state = returned.state;
      effects = [...effects, ...returned.effects];
    }
    entry.environment = state;
    const current = inFlightAttempt(state);
    for (const [attempt, controller] of entry.inFlight) {
      if (attempt === current) continue;
      controller.abort();
      entry.inFlight.delete(attempt);
    }
    for (const effect of effects) runEnvironment(entry, effect);
  };

  const answered = (
    entry: Entry,
    attempt: number,
    sentAt: Instant,
    answer: ExchangeAnswer<C>,
  ): void => {
    if (!startedBy(entry, attempt)) return;
    // An exchange its attempt let go of read nothing of the container.
    if (entry.inFlight.has(attempt)) readAtDoor(entry, sentAt, answer);
    if (!answer.ok) {
      const cause = answer.failure.class === "retryable" ? answer.failure.cause : null;
      if (cause?.kind === "mint" && cause.status === 429) pace.throttled(clock.now().mono);
      step(entry, {
        type: "EXCHANGE_FAILED",
        attempt,
        failure: answer.failure,
        descriptor: answer.descriptor,
      });
      return;
    }
    const before = entry.environment.credential;
    step(entry, {
      type: "EXCHANGE_SUCCEEDED",
      attempt,
      environmentId: answer.environmentId,
      descriptor: answer.descriptor,
    });
    const now = entry.environment.credential;
    const accepted =
      before.kind === "exchanging" &&
      before.attempt === attempt &&
      now.kind === "held" &&
      now.environmentId === answer.environmentId;
    if (!accepted) return;
    entry.installing = attempt;
    const installed = (outcome: InstallOutcome) =>
      enqueue(() => {
        if (!startedBy(entry, attempt) || entry.installing !== attempt) return;
        entry.installing = null;
        step(entry, {
          type: outcome.ok ? "INSTALLED" : "INSTALL_FAILED",
          environmentId: answer.environmentId,
        });
      });
    ports
      .install({
        key: entry.key,
        environmentId: answer.environmentId,
        credential: answer.credential,
      })
      .then(installed, () => installed({ ok: false }));
  };

  /**
   * The door read the Mate's descriptor as its exchange began: that read is its container's
   * reading too — one read of a Mate per connection attempt. A door whose descriptor did not
   * answer found the container unreachable.
   */
  const readAtDoor = (entry: Entry, sentAt: Instant, answer: ExchangeAnswer<C>) => {
    const reading: ProbeReading | null =
      answer.descriptor !== null
        ? {
            kind: "ready",
            descriptor: answer.descriptor,
            projectId: projectOf(entry.key),
            initAt: null,
          }
        : !answer.ok &&
            answer.failure.class === "retryable" &&
            (answer.failure.cause.kind === "descriptor-unreachable" ||
              answer.failure.cause.kind === "network" ||
              answer.failure.cause.kind === "timeout")
          ? { kind: "unreachable" }
          : null;
    if (reading === null) return;
    transition(entry, { type: "PROBED", reading, sentAt });
    entry.answering = reading.kind === "ready";
    // A Mate the person waits on whose door did not answer is read once more, `/healthz` beside
    // its descriptor: up but not answering, or still coming up, is said at once.
    if (reading.kind === "unreachable" && personWaits(entry))
      requestFor(entry, { fresh: true }, { health: true });
  };

  const guardsFor = (key: TargetKey, budget: boolean): EnvironmentGuards => {
    const wanted = wantedBy(key);
    return {
      want: wanted.length > 0,
      routeTarget: wanted.includes("route"),
      visible,
      verified: account.verified,
      zeropsState: account.zeropsState,
      budget,
    };
  };

  /** An exchange still reading a remembered Mate's descriptor: its mint is still to come (A16). */
  const probingDescriptor = (machine: EnvironmentMachine): boolean =>
    machine.credential.kind === "exchanging" &&
    machine.probing?.attempt === machine.credential.attempt;

  const owedMints = (): number =>
    [...entries.values()].filter(
      (entry) => probingDescriptor(entry.environment) && !kept(entry.key),
    ).length;

  /**
   * Hands the free slots, in priority order, to the targets a slot would start, and takes the
   * budget back from every other one. An asked-for target is handed one whenever it would start;
   * the background starts nothing past the concurrency or the mint pace, and nothing that mints
   * while a press is in flight.
   */
  const allocate = (): void => {
    const now = clock.now();
    const ordered = [...entries.values()].sort((left, right) => rank(left.key) - rank(right.key));
    let paceBound = false;
    for (const entry of ordered) {
      const { key } = entry;
      const exchanging = [...entries.values()].filter(
        (other) => other.environment.credential.kind === "exchanging",
      ).length;
      const paced = pace.readyAt(now.mono, owedMints()) <= now.mono;
      let budget = false;
      const held = holding && !asked(key) && !kept(key);
      if (entry.environment.credential.kind === "exchanging") {
        budget = entry.environment.guards.budget;
      } else if (
        !held &&
        (asked(key) || (exchanging < EXCHANGE_CONCURRENCY && (paced || kept(key))))
      ) {
        const trial = transitionEnvironment(
          entry.environment,
          { type: "GUARDS", guards: guardsFor(key, true) },
          context(),
        );
        budget = trial.state.credential.kind === "exchanging";
      }
      const guards = guardsFor(key, budget);
      if (!sameJson(guards, entry.environment.guards)) step(entry, { type: "GUARDS", guards });
      const credential = entry.environment.credential;
      if (credential.kind === "waiting" && credential.on === "budget" && !paced) paceBound = true;
    }
    cancelMintTimer?.();
    cancelMintTimer = null;
    if (paceBound) {
      cancelMintTimer = clock.setTimer(pace.readyAt(now.mono, owedMints()) - now.mono, () =>
        enqueue(() => undefined),
      );
    }
  };

  // ── The container machine ──────────────────────────────────────────────────────────────────

  const settleFlag = (entry: Entry, flag: MateFlag) => {
    entry.readingFlag = false;
    if (disposed || entries.get(entry.key) !== entry) return;
    enqueue(() => transition(entry, { type: "MATE_FLAG", flag }));
  };

  const runContainer = (entry: Entry, effect: ContainerEffect) => {
    switch (effect.kind) {
      case "schedule":
        entry.containerTimer?.();
        entry.containerTimer = clock.setTimer(delayUntil(effect.at, clock.now()), () =>
          enqueue(() => transition(entry, { type: "TICK" })),
        );
        return;
      case "cancel":
        entry.containerTimer?.();
        entry.containerTimer = null;
        return;
      case "read-mate-flag":
        if (entry.readingFlag) return;
        entry.readingFlag = true;
        ports.readMateFlag(entry.key).then(
          (flag) => settleFlag(entry, flag),
          () => settleFlag(entry, "unknown"),
        );
        return;
    }
  };

  /** Feeds one event to one target's container machine, then runs its effects. */
  const transition = (entry: Entry, event: ContainerEvent) => {
    if (entries.get(entry.key) !== entry) return;
    const next = transitionContainer(entry.container, event, { now: clock.now() });
    entry.container = next.state;
    for (const effect of next.effects) runContainer(entry, effect);
    prove(entry);
  };

  /** Its socket proves the container up; a proof lost reads it again. */
  const prove = (entry: Entry) => {
    if (entry.socket === (entry.container.connectedSince !== null)) return;
    const next = transitionContainer(
      entry.container,
      { type: "LINK", connected: entry.socket },
      { now: clock.now() },
    );
    entry.container = next.state;
    for (const effect of next.effects) runContainer(entry, effect);
    if (!entry.socket) requestFor(entry, { fresh: true });
  };

  /**
   * Reads the container once this batch ends — only one something waits on, with an address, no
   * socket proving it up, and no platform status saying it is down.
   */
  const requestFor = (entry: Entry, ask: ProbeAsk, options: { readonly health?: boolean } = {}) => {
    if (entry.origin === null || entry.container.connectedSince !== null) return;
    if (platformSaysDown(entry.container) || !watched(entry)) return;
    const origin = originFor(entry.origin);
    origin.requested = true;
    origin.requestedFresh ||= ask.fresh;
    origin.requestedHealth ||= options.health === true;
  };

  // ── Probes ─────────────────────────────────────────────────────────────────────────────────

  const originFor = (at: string): Origin => {
    const existing = origins.get(at);
    if (existing !== undefined) return existing;
    const created: Origin = {
      cadence: { kind: "none" },
      inFlight: null,
      requested: false,
      requestedFresh: false,
      requestedHealth: false,
      pollAt: null,
      rung: 0,
      lastSentAt: null,
      waiting: [],
      answering: [],
    };
    origins.set(at, created);
    return created;
  };

  /** The next poll on the cadence's backoff ladder; each poll climbs it, a status push resets it. */
  const nextPollAt = (origin: Origin, from: Instant): Instant | null => {
    if (!polls(origin.cadence)) return null;
    const ladder = origin.cadence.overdue ? OVERDUE_POLL_INTERVALS_MS : POLL_INTERVALS_MS;
    const last = ladder.length - 1;
    const interval = ladder[Math.min(origin.rung, last)] ?? 0;
    origin.rung = Math.min(origin.rung + 1, last);
    return after(from, interval);
  };

  /** Each origin's cadence: the most demanding of the watched targets it serves. */
  const cadences = (): ReadonlyMap<string, ProbeCadence> => {
    const order = (cadence: ProbeCadence): number =>
      cadence.kind === "poll" ? (cadence.overdue ? 2 : 3) : cadence.kind === "on-demand" ? 1 : 0;
    const byOrigin = new Map<string, ProbeCadence>();
    for (const entry of entries.values()) {
      if (entry.origin === null || !watched(entry)) continue;
      // A container that does not answer is read on the overdue ladder, the route's too — but
      // only while it comes up, or the person waits on it: the background is read by its door.
      const own = probeCadence(entry.container, true);
      const cadence: ProbeCadence =
        own.kind === "poll" && !comingUp(entry.container) && !personWaits(entry)
          ? { kind: "none" }
          : own;
      const held = byOrigin.get(entry.origin);
      if (held === undefined || order(cadence) > order(held)) byOrigin.set(entry.origin, cadence);
    }
    return byOrigin;
  };

  /** Applies the cadences, then starts every probe due and arms the wake for the next poll. */
  const scheduleProbes = () => {
    const wanted = cadences();
    for (const [at, origin] of origins) {
      if (wanted.has(at)) continue;
      if (origin.waiting.length > 0 || origin.answering.length > 0) {
        origin.cadence = { kind: "none" };
        origin.pollAt = null;
        origin.requested = false;
        origin.requestedHealth = false;
        continue;
      }
      origin.inFlight?.abort();
      origins.delete(at);
    }
    for (const [at, cadence] of wanted) {
      const origin = originFor(at);
      const before = origin.cadence;
      origin.cadence = cadence;
      if (!polls(cadence)) {
        origin.pollAt = null;
        continue;
      }
      if (!polls(before)) {
        // A container that starts coming up is read at once; one only failed probes say is, at
        // the backing-off intervals from the probe that said so.
        origin.rung = 0;
        origin.pollAt =
          cadence.overdue && origin.lastSentAt !== null && origin.inFlight === null
            ? nextPollAt(origin, origin.lastSentAt)
            : clock.now();
      } else if (cadence.overdue !== before.overdue) {
        origin.rung = 0;
        if (!cadence.overdue && origin.pollAt !== null && origin.lastSentAt !== null) {
          const timely = after(origin.lastSentAt, POLL_INTERVALS_MS[0] ?? 0);
          if (timely.mono < origin.pollAt.mono) origin.pollAt = timely;
        }
      }
    }
    dispatchProbes();
  };

  const pausedProbes = (): boolean =>
    hiddenSince !== null && clock.now().mono - hiddenSince >= HIDDEN_PROBE_PAUSE_MS;

  function dispatchProbes(): void {
    if (disposed) return;
    cancelProbeWake?.();
    cancelProbeWake = null;
    if (pausedProbes()) return;
    const now = clock.now();
    for (const [at, origin] of origins) {
      if (origin.inFlight !== null) continue;
      const due =
        origin.requested ||
        origin.waiting.length > 0 ||
        (origin.pollAt !== null && reached(origin.pollAt, now));
      if (due) startProbe(at, origin);
    }
    let earliest: number | null = null;
    for (const origin of origins.values()) {
      if (origin.inFlight !== null || origin.pollAt === null || reached(origin.pollAt, now))
        continue;
      const wait = delayUntil(origin.pollAt, now);
      earliest = earliest === null ? wait : Math.min(earliest, wait);
    }
    if (earliest !== null) cancelProbeWake = clock.setTimer(earliest, dispatchProbes);
  }

  const startProbe = (at: string, origin: Origin) => {
    const controller = new AbortController();
    const sentAt = clock.now();
    const initAt = polls(origin.cadence) || origin.waiting.length > 0 || origin.requestedHealth;
    const ask: ProbeRead = { fresh: initAt || origin.requestedFresh, initAt };
    origin.inFlight = controller;
    origin.requested = false;
    origin.requestedFresh = false;
    origin.requestedHealth = false;
    origin.answering = [...origin.answering, ...origin.waiting];
    origin.waiting = [];
    let settled = false;
    const settle = (answer: ProbeAnswer) => {
      if (settled || disposed || origins.get(at) !== origin) return;
      settled = true;
      cancelDeadline();
      origin.inFlight = null;
      origin.lastSentAt = answer.sentAt;
      origin.pollAt = nextPollAt(origin, clock.now());
      const answering = origin.answering;
      origin.answering = [];
      for (const resolve of answering) resolve(answer.reading);
      enqueue(() => landed(at, answer));
    };
    const cancelDeadline = clock.setTimer(PROBE_DEADLINE_MS, () => {
      controller.abort();
      settle({ reading: { kind: "unreachable" }, sentAt });
    });
    ports
      .probe(at, controller.signal, ask)
      .then(settle, () => settle({ reading: { kind: "unreachable" }, sentAt }));
  };

  /** A reading lands on every target served at its origin. */
  const landed = (at: string, answer: ProbeAnswer) => {
    for (const entry of entries.values()) {
      if (entry.origin !== at) continue;
      transition(entry, { type: "PROBED", reading: answer.reading, sentAt: answer.sentAt });
      // A Mate found answering again after its reads went unanswered, while its exchange or its
      // link waits out a backoff, is tried at once rather than at the ladder's next rung.
      const answering = answer.reading.kind === "ready";
      const before = entry.answering;
      entry.answering = answering;
      if (
        before === false &&
        answering &&
        (entry.environment.credential.kind === "backoff" ||
          entry.environment.link.phase === "backoff")
      )
        step(entry, { type: "USER_RETRY" });
    }
  };

  // ── Joining the machines ───────────────────────────────────────────────────────────────────

  /**
   * Each container's verdict reaches its environment machine (region C), and each environment
   * machine's link and edges reach its container: a socket proves it up, and an exchange starting,
   * a connect failing or an exchange backing off reads it again.
   */
  const join = () => {
    for (const entry of entries.values()) {
      const verdict = containerVerdict(entry.container);
      if (!sameJson(verdict, entry.environment.container))
        step(entry, { type: "CONTAINER", container: verdict });
      const socket = entry.environment.link.phase === "connected";
      if (socket !== entry.socket) {
        entry.socket = socket;
        prove(entry);
      }
      const edge = (name: keyof Entry["edges"], now: boolean, ask: ProbeAsk) => {
        if (now && !entry.edges[name]) requestFor(entry, ask);
        entry.edges[name] = now;
      };
      // A link the person waits on that drops reads its container once: its exchange, if it
      // backs off, reads the door again on its own next attempt.
      edge("failing", entry.environment.link.phase === "backoff" && personWaits(entry), {
        fresh: true,
      });
    }
  };

  // ── Writing ────────────────────────────────────────────────────────────────────────────────

  const persistIntents = () => {
    const records = [
      ...[...entries.values()].flatMap((entry) =>
        entry.container.intent === null ? [] : [toIntentRecord(entry.key, entry.container.intent)],
      ),
      ...restored.values(),
    ];
    const value = records.length === 0 ? null : JSON.stringify(records);
    if (value === persisted) return;
    persisted = value;
    ports.intents.write(value);
  };

  const outcomeOf = (machine: EnvironmentMachine): ConnectOutcome | null => {
    const credential = machine.credential;
    if (!machine.guards.want)
      return {
        _tag: "NotConnected",
        reachability: selectReachability(machine, null),
        descriptor: machine.descriptor,
      };
    switch (credential.kind) {
      case "held":
        if (!credential.installed) return null;
        return { _tag: "Connected", environmentId: credential.environmentId };
      case "none":
      case "exchanging":
        return null;
      case "waiting":
        if (credential.on === "budget" || credential.on === "access") return null;
        break;
      case "backoff":
      case "refused":
      case "retired":
        break;
    }
    return {
      _tag: "NotConnected",
      reachability: selectReachability(machine, null),
      descriptor: machine.descriptor,
    };
  };

  const streamEvent = (projectId: string, event: StreamEvent) =>
    store.dispatch({ kind: "stream", key: linkKeys.mate(projectId), now: clock.now().wall, event });

  /**
   * Each Mate project's link: demanded while one of its Mates is watched; past its handshake once
   * a probe or a socket found its Mate answering, and live once its credential is installed — or
   * refused when the door refused it, until the person's Connect.
   */
  const followLinks = () => {
    const watchedProjects = new Set(
      [...entries.values()].filter(watched).map((entry) => projectOf(entry.key)),
    );
    for (const projectId of demandedProjects)
      if (!watchedProjects.has(projectId))
        streamEvent(projectId, { kind: "demand", demanded: false });
    for (const projectId of watchedProjects) {
      if (!demandedProjects.has(projectId))
        streamEvent(projectId, { kind: "demand", demanded: true });
      const targets = [...entries.values()].filter((entry) => projectOf(entry.key) === projectId);
      const phase = streamOf(store.state(), linkKeys.mate(projectId)).phase;
      const refused = targets.some((entry) => entry.environment.credential.kind === "refused");
      const installed = targets.some(
        (entry) =>
          entry.environment.credential.kind === "held" && entry.environment.credential.installed,
      );
      const answering = targets.some(
        (entry) => entry.answering === true || entry.environment.link.phase === "connected",
      );
      if (refused && phase !== "refused")
        streamEvent(projectId, {
          kind: "fault",
          jitter: 0,
          fault: {
            outcome: "definitive-refusal",
            message: "The Mate's door refused this account.",
          },
        });
      else if (!refused && phase === "refused") streamEvent(projectId, { kind: "manual-retry" });
      if (phase === "connecting" && (answering || installed))
        streamEvent(projectId, { kind: "handshake" });
      if (installed && streamOf(store.state(), linkKeys.mate(projectId)).phase === "baselining")
        streamEvent(projectId, { kind: "baseline-committed" });
    }
    demandedProjects = watchedProjects;
  };

  /** Writes every target whose reading changed, one reduction per Mate project. */
  const write = () => {
    const byProject = new Map<string, Array<Row>>();
    for (const entry of entries.values()) {
      const value: MateLinkValue = {
        key: entry.key,
        projectId: projectOf(entry.key),
        orgId: entry.orgId,
        origin: entry.origin,
        shown: entry.shown,
        watched: watched(entry),
        environment: entry.environment,
        container: entry.container,
      };
      const held = entry.written;
      if (
        held !== null &&
        held.environment === value.environment &&
        held.container === value.container &&
        held.orgId === value.orgId &&
        held.origin === value.origin &&
        held.shown === value.shown &&
        held.watched === value.watched
      )
        continue;
      entry.written = value;
      sequence += 1;
      const rows = byProject.get(value.projectId) ?? [];
      rows.push({
        family: "mateLink",
        id: entry.key,
        value,
        revision: { kind: "mate-link", sequence },
      });
      byProject.set(value.projectId, rows);
    }
    for (const [projectId, rows] of byProject) {
      const scope = mateLinkScope(projectId);
      store.dispatch({
        kind: "rows",
        scope,
        generation: streamOf(store.state(), scope).generation,
        method: "read",
        via: "mate-direct",
        rows,
      });
    }
    return byProject.size > 0;
  };

  const publish = () => {
    const environments = new Map([...entries].map(([key, entry]) => [key, entry.environment]));
    const containers = new Map([...entries].map(([key, entry]) => [key, entry.container]));
    const moved =
      environments.size !== publishedEnvironments.size ||
      [...environments].some(([key, machine]) => publishedEnvironments.get(key) !== machine) ||
      [...containers].some(([key, machine]) => publishedContainers.get(key) !== machine);
    if (moved) {
      publishedEnvironments = environments;
      publishedContainers = containers;
    }
    for (const [key, resolvers] of connects) {
      const entry = entries.get(key);
      const outcome = entry === undefined ? null : outcomeOf(entry.environment);
      if (outcome === null) continue;
      connects.delete(key);
      for (const resolve of resolvers) resolve(outcome);
    }
    return moved;
  };

  /**
   * Everything that arrives in one turn of the event loop is taken in together; then the machines
   * are joined, the slots handed out, the probes scheduled, the intents kept and what changed
   * written and told.
   */
  function enqueue(work: () => void): void {
    if (disposed) return;
    queue.push(work);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }

  function flush(): void {
    scheduled = false;
    if (disposed) return;
    do {
      while (queue.length > 0) queue.shift()!();
      join();
      allocate();
      join();
    } while (queue.length > 0);
    scheduleProbes();
    persistIntents();
    write();
    followLinks();
    if (publish()) for (const listener of listeners) listener();
  }

  const everyTarget = (event: EnvironmentEvent) => () => {
    for (const entry of entries.values()) step(entry, event);
  };

  const restore = (record: IntentRecord): ContainerIntent => {
    const now = clock.now();
    const since: Instant = { wall: record.since, mono: now.mono - (now.wall - record.since) };
    if (record.kind === "update") return { kind: "update", since, from: record.from ?? null };
    return record.initAt === undefined
      ? { kind: record.kind, since }
      : { kind: record.kind, since, initAt: record.initAt };
  };

  const stampIntent = (intent: IntentRequest): ContainerIntent => {
    const since = clock.now();
    return intent.kind === "update"
      ? { kind: "update", since, from: intent.from }
      : typeof intent.initAt === "string"
        ? { kind: intent.kind, since, initAt: intent.initAt }
        : { kind: intent.kind, since };
  };

  return {
    settled: () =>
      new Promise<void>((resolve) => {
        if (disposed) resolve();
        else {
          const done = () => {
            settlements.delete(done);
            resolve();
          };
          settlements.add(done);
          enqueue(done);
        }
      }),
    setTargets: (targets) =>
      enqueue(() => {
        const listed = new Set(targets.map((target) => target.key));
        for (const entry of entries.values()) {
          if (listed.has(entry.key)) continue;
          entry.listed = false;
          entry.shown = false;
        }
        for (const target of targets) {
          let entry = entries.get(target.key);
          // Retirement absorbs every event. A target found gone that the listing names again is
          // a new target.
          if (
            entry !== undefined &&
            entry.environment.credential.kind === "retired" &&
            entry.environment.presence.kind === "gone" &&
            target.presence !== null &&
            target.presence.kind !== "gone"
          ) {
            endOps(entry);
            entries.delete(target.key);
            entry = undefined;
          }
          const fresh = entry === undefined;
          entry ??= entryFor(target.key, target.record);
          entry.orgId = target.orgId ?? entry.orgId;
          entry.shown = true;
          const moved = entry.origin !== target.origin;
          entry.origin = target.origin;
          entry.listed = true;
          const listedStatus = target.platform;
          const pushed = !fresh && listedStatus !== null && statusMoved(entry.known, listedStatus);
          if (listedStatus !== null) {
            const platform =
              listedStatus.service === null && entry.known.service !== null
                ? { ...listedStatus, service: entry.known.service }
                : listedStatus;
            entry.known = {
              project: listedStatus.project,
              service: listedStatus.service ?? entry.known.service,
            };
            transition(entry, { type: "PLATFORM", status: platform });
          }
          if (fresh) {
            const record = restored.get(target.key);
            if (record !== undefined) {
              restored.delete(target.key);
              transition(entry, { type: "INTENT", intent: restore(record) });
            }
          } else if (pushed || moved) {
            // A status that moved, or a new address, reads a watched container again: ready is
            // never terminal.
            requestFor(entry, { fresh: true });
          }
          if (target.presence !== null && !sameJson(target.presence, entry.environment.presence))
            step(entry, { type: "PRESENCE", presence: target.presence });
        }
      }),
    setDeleting: (projectId, accepted) =>
      enqueue(() => {
        if (accepted) deleting.add(projectId);
        else deleting.delete(projectId);
        for (const entry of entries.values())
          if (projectOf(entry.key) === projectId)
            step(entry, {
              type: "GUARDS",
              guards: guardsFor(entry.key, entry.environment.guards.budget),
            });
      }),
    setCloseOffHeld: (projectIds) => {
      const next = new Set(projectIds);
      enqueue(() => {
        const moved = new Set(
          [...next, ...closeOffHeld].filter((id) => next.has(id) !== closeOffHeld.has(id)),
        );
        closeOffHeld = next;
        for (const entry of entries.values())
          if (moved.has(projectOf(entry.key)))
            step(entry, {
              type: "GUARDS",
              guards: guardsFor(entry.key, entry.environment.guards.budget),
            });
      });
    },
    setDemand: (reason, keys) => {
      const next = new Set(keys);
      enqueue(() => {
        // A target that starts to be waited on is read by the door its exchange goes through,
        // or proven up by its socket: nothing reads it besides.
        demands.set(reason, next);
      });
    },
    hold: (key, kind) => {
      const held = holds.get(kind)!;
      enqueue(() => {
        held.set(key, (held.get(key) ?? 0) + 1);
      });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        enqueue(() => {
          const count = (held.get(key) ?? 1) - 1;
          if (count > 0) held.set(key, count);
          else held.delete(key);
        });
      };
    },
    connect: (key, reason) =>
      new Promise<ConnectOutcome>((resolve) => {
        if (disposed) {
          resolve({ _tag: "Closed" });
          return;
        }
        enqueue(() => {
          const entry = entryFor(key, null);
          entry.userReason = reason;
          connects.set(key, [...(connects.get(key) ?? []), resolve]);
          // The person's Try now reads the container too: a level past its cap, or a server that
          // stopped answering, is read again at once.
          requestFor(entry, { fresh: true });
          if (!suppressed(projectOf(key))) step(entry, { type: "USER_RETRY" });
        });
      }),
    setAccount: (guards) =>
      enqueue(() => {
        account = guards;
      }),
    holdBackground: (held) =>
      enqueue(() => {
        holding = held;
      }),
    setVisible: (next) =>
      enqueue(() => {
        visible = next;
        if (!next) hiddenSince ??= clock.now().mono;
        else hiddenSince = null;
      }),
    wake: (wakeVisible) =>
      enqueue(() => {
        if (wakeVisible) hiddenSince = null;
        everyTarget({ type: "WAKE", visible: wakeVisible })();
        const now = clock.now();
        for (const entry of entries.values()) {
          transition(entry, { type: "TICK" });
          // A container the person waits on, read on demand, is read again once its last reading
          // says nothing any more.
          if (
            wakeVisible &&
            personWaits(entry) &&
            probeCadence(entry.container).kind === "on-demand" &&
            unreadSince(entry.container, now)
          )
            requestFor(entry, { fresh: false });
        }
      }),
    online: () => enqueue(everyTarget({ type: "ONLINE" })),
    link: (environmentId, phase) =>
      enqueue(() => {
        for (const entry of entries.values()) {
          const credential = entry.environment.credential;
          const holdsIt =
            entry.environment.record === environmentId ||
            (credential.kind === "held" && credential.environmentId === environmentId);
          if (holdsIt) step(entry, { type: "LINK", link: phase });
        }
      }),
    process: (key, running) =>
      enqueue(() => {
        const entry = entries.get(key);
        if (entry !== undefined) transition(entry, { type: "PROCESS", running });
      }),
    intend: (key, intent) => {
      const entry = entries.get(key);
      if (entry === undefined || disposed) return false;
      const stamped = stampIntent(intent);
      // Whether the container takes it is the machine's to say, now: the platform's facts may
      // already overrule it.
      const trial = transitionContainer(
        entry.container,
        { type: "INTENT", intent: stamped },
        { now: clock.now() },
      );
      if (trial.state.intent === null) return false;
      enqueue(() => {
        transition(entry, { type: "INTENT", intent: stamped });
        requestFor(entry, { fresh: true });
      });
      return true;
    },
    initAt: async (key) => {
      const at = entries.get(key)?.origin ?? null;
      if (at === null || disposed) return null;
      const controller = new AbortController();
      const cancel = clock.setTimer(INIT_AT_READ_DEADLINE_MS, () => controller.abort());
      try {
        return await ports.readInitAt(at, controller.signal);
      } catch {
        return null;
      } finally {
        cancel();
      }
    },
    request: (key, ask = { fresh: true }) =>
      enqueue(() => {
        const entry = entries.get(key);
        if (entry !== undefined) requestFor(entry, ask);
      }),
    next: (at) =>
      new Promise((resolve) => {
        if (disposed) {
          resolve({ kind: "unreachable" });
          return;
        }
        originFor(at).waiting.push(resolve);
        enqueue(() => undefined);
      }),
    machines: (key) => {
      const entry = entries.get(key);
      return entry === undefined
        ? undefined
        : { environment: entry.environment, container: entry.container };
    },
    environments: () => publishedEnvironments,
    containers: () => publishedContainers,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      for (const done of settlements) done();
      cancelMintTimer?.();
      cancelProbeWake?.();
      for (const entry of entries.values()) endOps(entry);
      for (const origin of origins.values()) {
        origin.inFlight?.abort();
        for (const resolve of [...origin.waiting, ...origin.answering])
          resolve({ kind: "unreachable" });
      }
      origins.clear();
      for (const resolvers of connects.values())
        for (const resolve of resolvers) resolve({ _tag: "Closed" });
      connects.clear();
      for (const projectId of demandedProjects)
        streamEvent(projectId, { kind: "demand", demanded: false });
      listeners.clear();
    },
  };
}
