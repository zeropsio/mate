/**
 * The exchange driver (DESIGN §4.4): one per account epoch, one environment machine per Mate
 * target, and the only place a door exchange starts.
 *
 * Restore, auto-connect, repair and the user's Connect are demand on it, never connectors of
 * their own: each publishes which targets it wants, and the machine for a target decides when
 * an exchange runs, reads its answer, backs off and waits for a named input.
 *
 * - One serialized queue feeds `transitionEnvironment`; the ops it asks for run through the
 *   ports, and their answers come back as events carrying the op's attempt (§6.5).
 * - A credential is installed only when its answer left the machine `held` for that
 *   environment; a late or superseded answer is logged by the machine and dropped.
 * - At most `EXCHANGE_CONCURRENCY` exchanges run at once and at most `DOOR_MINTS_PER_MINUTE`
 *   start in any minute of this tab (I12). Slots go in priority order — the route's target,
 *   the user's Connect, remembered targets, auto-connect — to a target the slot would start;
 *   every other wanted target waits `on: budget`.
 * - An exchange whose attempt ends without it (its deadline, a retirement) is aborted.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { GrantCapability, Instant } from "../data/access/grant.ts";
import type { IdentityExchangeReason } from "../diagnostics.ts";
import { DOOR_MINTS_PER_MINUTE } from "../doorThrowaway.ts";
import type { ExchangeAnswer } from "../identityExchange.ts";
import {
  initialEnvironment,
  transitionEnvironment,
  type ContainerVerdict,
  type DescriptorFacts,
  type EnvironmentDiagnostic,
  type EnvironmentEffect,
  type EnvironmentEvent,
  type EnvironmentGuards,
  type EnvironmentMachine,
  type LinkPhase,
  type Presence,
} from "./environmentMachine.ts";
import { selectReachability, type Reachability } from "./reachability.ts";

/** `projectId:serviceId` (AL-05). */
export type TargetKey = string;

/** What an emitter publishes the whole of: the route's target, remembered targets, auto-connect. */
export type DemandReason = "route" | "record" | "auto-connect";

/** Exchanges in flight at once, across every target (§4.4). */
export const EXCHANGE_CONCURRENCY = 3;

const MINT_WINDOW_MS = 60_000;

/** One target as the inventory and the records describe it now. */
export interface ExchangeTarget {
  readonly key: TargetKey;
  /** Null while the inventory cannot say: presence holds its last value. */
  readonly presence: Presence | null;
  readonly container: ContainerVerdict;
  /** The registration record's environment (C1); read when the target is first seen. */
  readonly record: EnvironmentId | null;
}

/** The account's half of the guards (§4.4 CAN). */
export interface AccountGuards {
  /** The epoch's first grant is admitted. */
  readonly postGrant: boolean;
  readonly identityMint: GrantCapability;
  /** The grant's rounds are failing with a transport or server cause. */
  readonly zeropsFailing: boolean;
  readonly grantVerifiedAtMs: number | null;
}

export interface ExchangeRequest {
  readonly key: TargetKey;
  readonly origin: string;
  /** The remembered environment the exchange expects; null without a record. */
  readonly expected: EnvironmentId | null;
  readonly reason: IdentityExchangeReason;
  /** Aborted when the attempt ends without this answer. */
  readonly signal: AbortSignal;
}

export interface ExchangeClock {
  readonly now: () => Instant;
  /** The jitter source for the backoff ladder. */
  readonly random: () => number;
  /** Arms a timer; returns what disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

/** The tab's own clocks and timers. */
export const systemExchangeClock: ExchangeClock = {
  // @effect-diagnostics-next-line globalDate:off -- the driver's one clock port; plain promises, no Effect runtime.
  now: () => ({ wall: Date.now(), mono: performance.now() }),
  // @effect-diagnostics-next-line globalRandom:off -- the backoff jitter's one source, behind the same port.
  random: () => Math.random(),
  setTimer: (delayMs, fire) => {
    // @effect-diagnostics-next-line globalTimers:off -- the driver's one timer port; plain promises, no Effect runtime.
    const handle = setTimeout(fire, delayMs);
    return () => clearTimeout(handle);
  },
};

/** Whether an install registered or rotated the credential; a rejection reads as `ok: false`. */
export type InstallOutcome = { readonly ok: true } | { readonly ok: false };

export interface ExchangeDriverPorts<C> {
  readonly clock: ExchangeClock;
  /** The descriptor, the mint, the door and the token exchange; installs nothing. */
  readonly exchange: (request: ExchangeRequest) => Promise<ExchangeAnswer<C>>;
  /**
   * Installs an accepted credential: registers the environment, or rotates the credential of
   * one already registered (`registry.rotateCredential`), and remembers the target. A failed
   * install sends the target's machine to backoff, and it is exchanged again.
   */
  readonly install: (input: {
    readonly key: TargetKey;
    readonly environmentId: EnvironmentId;
    readonly credential: C;
  }) => Promise<InstallOutcome>;
  readonly readDescriptor: (origin: string, signal: AbortSignal) => Promise<DescriptorFacts>;
  /** The supervisor's `retryNow` for a link in backoff. */
  readonly retryLink: (environmentId: EnvironmentId) => void;
  /** The inventory re-reads this target's presence. */
  readonly refreshPresence: (key: TargetKey) => void;
  /** `catalog.remove` and the door's logout; drafts keep their keys (AL-13). */
  readonly retire: (key: TargetKey, environmentId: EnvironmentId | null) => void;
  readonly log?: (key: TargetKey, diagnostic: EnvironmentDiagnostic) => void;
}

/** What the user's Connect ends in. */
export type ConnectOutcome =
  | { readonly _tag: "Connected"; readonly environmentId: EnvironmentId }
  | {
      readonly _tag: "NotConnected";
      readonly reachability: Reachability;
      readonly descriptor: DescriptorFacts | null;
    }
  /** The account closed before the Connect ended. */
  | { readonly _tag: "Closed" };

export interface ExchangeDriver {
  /** Every target the inventory or a record names, as they stand now. */
  readonly setTargets: (targets: ReadonlyArray<ExchangeTarget>) => void;
  /** Replaces the whole set of targets one emitter wants. */
  readonly setDemand: (reason: DemandReason, keys: Iterable<TargetKey>) => void;
  /**
   * The user's Connect: the target is wanted from now on, and this is a user retry. Answers
   * with the installed environment, or with the verdict the machine settled on instead.
   */
  readonly connect: (key: TargetKey, reason: IdentityExchangeReason) => Promise<ConnectOutcome>;
  readonly setAccount: (guards: AccountGuards) => void;
  readonly setVisible: (visible: boolean) => void;
  /** §6.4's coalesced wake; a visible one fires pending retries now. */
  readonly wake: (visible: boolean) => void;
  readonly online: () => void;
  /** What the supervisor of an environment publishes. */
  readonly link: (environmentId: EnvironmentId, phase: LinkPhase) => void;
  /** "Try now". */
  readonly retry: (key: TargetKey) => void;
  readonly machine: (key: TargetKey) => EnvironmentMachine | undefined;
  /** Every target's machine as last published; the same map until the next publication. */
  readonly machines: () => ReadonlyMap<TargetKey, EnvironmentMachine>;
  /** Told after every batch of events, once the machines are published. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The account closed: every timer, exchange and waiting Connect ends. */
  readonly dispose: () => void;
}

interface Entry {
  machine: EnvironmentMachine;
  cancelTimer: (() => void) | null;
  /** The ops in flight, by attempt. */
  readonly inFlight: Map<number, AbortController>;
  /**
   * The exchange attempt whose accepted credential is being installed; a Connect answers after
   * it. Null while no install is pending.
   */
  installing: number | null;
  /** The reason the user's last Connect gave; the target's exchanges carry it. */
  userReason: IdentityExchangeReason | null;
}

/** The demands in priority order (§4.4): the user's Connect ranks after the route's target. */
const PRIORITY: ReadonlyArray<DemandReason | "user"> = ["route", "user", "record", "auto-connect"];

const EXCHANGE_REASON: Record<DemandReason, IdentityExchangeReason> = {
  route: "restore",
  record: "restore",
  "auto-connect": "auto-connect",
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const inFlightAttempt = (machine: EnvironmentMachine): number | null => {
  const credential = machine.credential;
  if (credential.kind === "exchanging") return credential.attempt;
  if (credential.kind === "held") return credential.rereading?.attempt ?? null;
  return null;
};

export function makeExchangeDriver<C>(ports: ExchangeDriverPorts<C>): ExchangeDriver {
  const { clock } = ports;
  const entries = new Map<TargetKey, Entry>();
  const demands = new Map<DemandReason | "user", ReadonlySet<TargetKey>>(
    PRIORITY.map((reason) => [reason, new Set<TargetKey>()]),
  );
  const listeners = new Set<() => void>();
  let published: ReadonlyMap<TargetKey, EnvironmentMachine> = new Map();
  const connects = new Map<TargetKey, Array<(outcome: ConnectOutcome) => void>>();
  /** Monotonic times of the exchanges started in the last minute. */
  const minted: Array<number> = [];
  let cancelMintTimer: (() => void) | null = null;
  let account: AccountGuards = {
    postGrant: false,
    identityMint: { allowed: false, reason: "access-unverified", waitable: true },
    zeropsFailing: false,
    grantVerifiedAtMs: null,
  };
  let visible = false;
  let disposed = false;
  const queue: Array<() => void> = [];
  let scheduled = false;

  const context = () => ({ now: clock.now(), random: clock.random });

  const entryFor = (key: TargetKey, record: EnvironmentId | null): Entry => {
    const existing = entries.get(key);
    if (existing !== undefined) return existing;
    const created: Entry = {
      machine: initialEnvironment({ record }),
      cancelTimer: null,
      inFlight: new Map(),
      installing: null,
      userReason: null,
    };
    entries.set(key, created);
    return created;
  };

  const wantedBy = (key: TargetKey): ReadonlyArray<DemandReason | "user"> =>
    PRIORITY.filter((reason) => demands.get(reason)?.has(key) === true);

  const reasonFor = (key: TargetKey, entry: Entry): IdentityExchangeReason => {
    const credential = entry.machine.credential;
    if (
      (credential.kind === "none" ||
        credential.kind === "waiting" ||
        credential.kind === "exchanging") &&
      credential.reconnect
    ) {
      return "repair";
    }
    const top = wantedBy(key)[0];
    if (top === undefined) return "restore";
    return top === "user" ? (entry.userReason ?? "user") : EXCHANGE_REASON[top];
  };

  // ── Effects ────────────────────────────────────────────────────────────────────────────────

  const arm = (key: TargetKey, entry: Entry, at: Instant) => {
    entry.cancelTimer?.();
    const now = clock.now();
    const delayMs = Math.max(0, Math.min(at.mono - now.mono, at.wall - now.wall));
    entry.cancelTimer = clock.setTimer(delayMs, () => enqueue(() => step(key, { type: "TICK" })));
  };

  const run = (key: TargetKey, entry: Entry, effect: EnvironmentEffect) => {
    switch (effect.kind) {
      case "schedule":
        arm(key, entry, effect.at);
        return;
      case "cancel":
        entry.cancelTimer?.();
        entry.cancelTimer = null;
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
        minted.push(clock.now().mono);
        ports
          .exchange({
            key,
            origin: op.origin,
            expected: op.expected,
            reason: reasonFor(key, entry),
            signal: controller.signal,
          })
          .then(
            (answer) => enqueue(() => answered(key, attempt, answer)),
            () =>
              enqueue(() =>
                answered(key, attempt, {
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
        ports.readDescriptor(op.origin, controller.signal).then(
          (descriptor) =>
            enqueue(() =>
              step(key, {
                type: "DESCRIPTOR_READ",
                attempt,
                result: { ok: true, descriptor },
              }),
            ),
          () =>
            enqueue(() => step(key, { type: "DESCRIPTOR_READ", attempt, result: { ok: false } })),
        );
        return;
      }
      case "retry-link":
        ports.retryLink(op.environmentId);
        return;
      case "refresh-presence":
        ports.refreshPresence(key);
        return;
      case "retire":
        ports.retire(key, op.environmentId);
        return;
    }
  };

  /** Feeds one event to one target's machine, publishes its state, then runs its effects. */
  const step = (key: TargetKey, event: EnvironmentEvent): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    let { state, effects } = transitionEnvironment(entry.machine, event, context());
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
    entry.machine = state;
    // An op whose attempt ended without its answer is abandoned.
    const current = inFlightAttempt(state);
    for (const [attempt, controller] of entry.inFlight) {
      if (attempt !== current) {
        controller.abort();
        entry.inFlight.delete(attempt);
      }
    }
    for (const effect of effects) run(key, entry, effect);
  };

  const answered = (key: TargetKey, attempt: number, answer: ExchangeAnswer<C>): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    if (!answer.ok) {
      step(key, {
        type: "EXCHANGE_FAILED",
        attempt,
        failure: answer.failure,
        descriptor: answer.descriptor,
      });
      return;
    }
    const before = entry.machine.credential;
    step(key, {
      type: "EXCHANGE_SUCCEEDED",
      attempt,
      environmentId: answer.environmentId,
      descriptor: answer.descriptor,
    });
    const after = entry.machine.credential;
    const accepted =
      before.kind === "exchanging" &&
      before.attempt === attempt &&
      after.kind === "held" &&
      after.environmentId === answer.environmentId;
    if (!accepted) return;
    entry.installing = attempt;
    const installed = (outcome: InstallOutcome) =>
      enqueue(() => {
        // A newer accepted credential's install owns the entry now.
        if (entries.get(key) !== entry || entry.installing !== attempt) return;
        entry.installing = null;
        if (!outcome.ok) {
          step(key, { type: "INSTALL_FAILED", environmentId: answer.environmentId });
        }
      });
    ports
      .install({ key, environmentId: answer.environmentId, credential: answer.credential })
      .then(installed, () => installed({ ok: false }));
  };

  // ── Slots ──────────────────────────────────────────────────────────────────────────────────

  const guardsFor = (key: TargetKey, budget: boolean): EnvironmentGuards => {
    const wanted = wantedBy(key);
    return {
      want: wanted.length > 0,
      routeTarget: wanted.includes("route"),
      visible,
      postGrant: account.postGrant,
      identityMint: account.identityMint,
      zeropsFailing: account.zeropsFailing,
      grantVerifiedAtMs: account.grantVerifiedAtMs,
      budget,
    };
  };

  const rank = (key: TargetKey): number => {
    const top = wantedBy(key)[0];
    return top === undefined ? PRIORITY.length : PRIORITY.indexOf(top);
  };

  /**
   * Hands the free slots, in priority order, to the targets a slot would start, and takes the
   * budget back from every other one — so a slot is never held by a target that waits on
   * something else, and nothing starts past the concurrency or the minute's mints.
   */
  const allocate = (): void => {
    const now = clock.now();
    while (minted.length > 0 && now.mono - minted[0]! >= MINT_WINDOW_MS) minted.shift();
    const ordered = [...entries.keys()].sort((left, right) => rank(left) - rank(right));
    let starved = false;
    for (const key of ordered) {
      const entry = entries.get(key)!;
      const exchanging = [...entries.values()].filter(
        (other) => other.machine.credential.kind === "exchanging",
      ).length;
      let budget = false;
      if (entry.machine.credential.kind === "exchanging") {
        budget = entry.machine.guards.budget;
      } else if (exchanging < EXCHANGE_CONCURRENCY && minted.length < DOOR_MINTS_PER_MINUTE) {
        const trial = transitionEnvironment(
          entry.machine,
          { type: "GUARDS", guards: guardsFor(key, true) },
          context(),
        );
        budget = trial.state.credential.kind === "exchanging";
      }
      const guards = guardsFor(key, budget);
      if (!sameJson(guards, entry.machine.guards)) step(key, { type: "GUARDS", guards });
      const credential = entry.machine.credential;
      if (credential.kind === "waiting" && credential.on === "budget") starved = true;
    }
    cancelMintTimer?.();
    cancelMintTimer = null;
    // A target held back by the minute's mints gets its slot back when the oldest one ages out.
    if (starved && minted.length >= DOOR_MINTS_PER_MINUTE) {
      cancelMintTimer = clock.setTimer(minted[0]! + MINT_WINDOW_MS - now.mono, () =>
        enqueue(() => undefined),
      );
    }
  };

  // ── Publication ────────────────────────────────────────────────────────────────────────────

  const outcomeOf = (entry: Entry): ConnectOutcome | null => {
    if (entry.installing !== null) return null;
    const machine = entry.machine;
    const credential = machine.credential;
    switch (credential.kind) {
      case "held":
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

  const publish = (): void => {
    const changed =
      published.size !== entries.size ||
      [...entries].some(([key, entry]) => published.get(key) !== entry.machine);
    if (changed) published = new Map([...entries].map(([key, entry]) => [key, entry.machine]));
    for (const [key, resolvers] of connects) {
      const entry = entries.get(key);
      const outcome = entry === undefined ? null : outcomeOf(entry);
      if (outcome === null) continue;
      connects.delete(key);
      for (const resolve of resolvers) resolve(outcome);
    }
    if (!changed) return;
    for (const listener of listeners) listener();
  };

  /**
   * Everything that arrives in one turn of the event loop — a render's emitters, say — is taken
   * in together before the slots are handed out, so the route's target is first however the
   * emitters were ordered.
   */
  function enqueue(work: () => void): void {
    if (disposed) return;
    queue.push(work);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      do {
        while (queue.length > 0) queue.shift()!();
        allocate();
      } while (queue.length > 0);
      publish();
    });
  }

  const everyTarget = (event: EnvironmentEvent) => () => {
    for (const key of entries.keys()) step(key, event);
  };

  return {
    setTargets: (targets) =>
      enqueue(() => {
        for (const target of targets) {
          const entry = entryFor(target.key, target.record);
          if (target.presence !== null && !sameJson(target.presence, entry.machine.presence)) {
            step(target.key, { type: "PRESENCE", presence: target.presence });
          }
          if (!sameJson(target.container, entry.machine.container)) {
            step(target.key, { type: "CONTAINER", container: target.container });
          }
        }
      }),
    setDemand: (reason, keys) =>
      enqueue(() => {
        // A key no target names yet is wanted once the inventory or a record names it.
        demands.set(reason, new Set(keys));
      }),
    connect: (key, reason) =>
      new Promise<ConnectOutcome>((resolve) => {
        if (disposed) {
          resolve({ _tag: "Closed" });
          return;
        }
        enqueue(() => {
          const entry = entryFor(key, null);
          entry.userReason = reason;
          demands.set("user", new Set([...demands.get("user")!, key]));
          connects.set(key, [...(connects.get(key) ?? []), resolve]);
          step(key, { type: "USER_RETRY" });
        });
      }),
    setAccount: (guards) =>
      enqueue(() => {
        account = guards;
      }),
    setVisible: (next) =>
      enqueue(() => {
        visible = next;
      }),
    wake: (wakeVisible) => enqueue(everyTarget({ type: "WAKE", visible: wakeVisible })),
    online: () => enqueue(everyTarget({ type: "ONLINE" })),
    link: (environmentId, phase) =>
      enqueue(() => {
        for (const [key, entry] of entries) {
          const credential = entry.machine.credential;
          const holds =
            entry.machine.record === environmentId ||
            (credential.kind === "held" && credential.environmentId === environmentId);
          if (holds) step(key, { type: "LINK", link: phase });
        }
      }),
    retry: (key) => enqueue(() => step(key, { type: "USER_RETRY" })),
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
      cancelMintTimer?.();
      for (const entry of entries.values()) {
        entry.cancelTimer?.();
        for (const controller of entry.inFlight.values()) controller.abort();
        entry.inFlight.clear();
      }
      for (const resolvers of connects.values()) {
        for (const resolve of resolvers) resolve({ _tag: "Closed" });
      }
      connects.clear();
      listeners.clear();
    },
  };
}
