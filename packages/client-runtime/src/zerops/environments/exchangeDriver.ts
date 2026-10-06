/**
 * The exchange driver (DESIGN §4.4): one per account epoch, one environment machine per Mate
 * target, and the only place a door exchange starts.
 *
 * Repair and the leases — the route's, the Mate left last, an action, the user's Connect — are
 * demand on it, never connectors of their own (krok-a-hub §3): each publishes which targets it
 * wants, or holds one until it lets it go, and the machine for a target decides when an exchange
 * runs, reads its answer, backs off and waits for a named input.
 *
 * - One serialized queue feeds `transitionEnvironment`; the ops it asks for run through the
 *   ports, and their answers come back as events carrying the op's attempt (§6.5).
 * - A credential is installed only when its answer left the machine `held` for that
 *   environment; a late or superseded answer is logged by the machine and dropped.
 * - A target the person asked for — the route's, the one on screen, one an action of theirs
 *   holds, or one whose Connect they pressed — starts the moment it can, past every budget. The
 *   background — the Mates a page draws, the Mate left last — starts at most `EXCHANGE_CONCURRENCY` at once and at the
 *   door's mint pace (`DOOR_MINT_PACE`, I12), which every exchange that may mint spends; every
 *   other wanted target waits `on: budget`. A target with a session kept from an earlier load
 *   mints nothing while its Mate still holds it, so it neither waits on the pace nor spends it.
 *   A mint the platform answers 429 holds the background a while.
 * - An exchange whose attempt ends without it (its deadline, a retirement) is aborted.
 * - A transient failure keeps being retried, its rate bounded by the machine's ladder and cap, in
 *   this load only: a load starts each Mate's ladder over.
 * - While a press is in flight in this browser (`holdBackground`), the background starts no
 *   exchange that mints: the press reads the token list every throwaway is written to.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { Instant } from "../data/access/grant.ts";
import type { IdentityExchangeReason } from "../diagnostics.ts";
import { DOOR_MINT_PACE, makeMintPace } from "../doorThrowaway.ts";
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
import {
  EXCHANGE_CONCURRENCY,
  type AccountGuards,
  type ConnectOutcome,
  type DemandReason,
  type ExchangeClock,
  type ExchangeRequest,
  type InstallOutcome,
  type LeaseKind,
  type TargetKey,
} from "./exchange.ts";
import { selectReachability } from "./reachability.ts";
import { targetProject } from "./targets.ts";

/** One target as the inventory and the records describe it now. */
export interface ExchangeTarget {
  readonly key: TargetKey;
  /** Null while the inventory cannot say: presence holds its last value. */
  readonly presence: Presence | null;
  readonly container: ContainerVerdict;
  /** The registration record's environment (C1); read when the target is first seen. */
  readonly record: EnvironmentId | null;
}

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
  /**
   * Whether this target's exchange presents a session kept from an earlier load first
   * (`keptSessions.ts`): it starts past the mint pace and spends none of it.
   */
  readonly kept?: (key: TargetKey) => boolean;
  /** The supervisor's `retryNow` for a link in backoff. */
  readonly retryLink: (environmentId: EnvironmentId) => void;
  /**
   * `catalog.remove`; drafts keep their keys (AL-13). The record and the door's session stay: a
   * target found gone that the inventory names again is restored by its record.
   */
  readonly retire: (key: TargetKey, environmentId: EnvironmentId | null) => void;
  readonly log?: (key: TargetKey, diagnostic: EnvironmentDiagnostic) => void;
}

export interface ExchangeDriver {
  /** Every target the inventory or a record names, as they stand now. */
  readonly setTargets: (targets: ReadonlyArray<ExchangeTarget>) => void;
  /** A project being deleted takes no demand, while its leases remain available on failure. */
  readonly setDeleting: (projectId: string, deleting: boolean) => void;
  /**
   * The projects whose Mate is held for its close-off (`closeOff.ts`): like a project being
   * deleted, each takes no demand and no Connect, its leases standing for when it is let go.
   * Replaces the whole set.
   */
  readonly setCloseOffHeld: (projectIds: Iterable<string>) => void;
  /** Replaces the whole set of targets one emitter wants. */
  readonly setDemand: (reason: DemandReason, keys: Iterable<TargetKey>) => void;
  /** The target is wanted until the answer is called; calling it again does nothing. */
  readonly hold: (key: TargetKey, kind: LeaseKind) => () => void;
  /**
   * The user's Connect: a user retry of a target its caller holds (`hold`). Answers with the
   * installed environment, or with the verdict the machine settled on instead.
   */
  readonly connect: (key: TargetKey, reason: IdentityExchangeReason) => Promise<ConnectOutcome>;
  readonly setAccount: (guards: AccountGuards) => void;
  /**
   * A press is in flight in this browser: the background starts no exchange that mints until it
   * ends. The person's own and a kept session's still start.
   */
  readonly holdBackground: (held: boolean) => void;
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
   * The exchange attempt whose accepted credential is being installed: an older one's install
   * answers too late to count. Null while no install is pending.
   */
  installing: number | null;
  /** The reason the user's last Connect gave; the target's exchanges carry it. */
  userReason: IdentityExchangeReason | null;
}

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

const EXCHANGE_REASON: Record<DemandReason, IdentityExchangeReason> = {
  route: "restore",
  screen: "restore",
  drawn: "restore",
  recent: "restore",
};

const isLease = (reason: DemandReason | LeaseKind): reason is LeaseKind =>
  reason === "action" || reason === "user";

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
  const demands = new Map<DemandReason, ReadonlySet<TargetKey>>();
  const deleting = new Set<string>();
  let closeOffHeld: ReadonlySet<string> = new Set();
  /** A project being deleted, or held for its close-off: nothing connects its Mate. */
  const suppressed = (projectId: string): boolean =>
    deleting.has(projectId) || closeOffHeld.has(projectId);
  /** How many holders each lease kind has on each target (`hold`). */
  const holds = new Map<LeaseKind, Map<TargetKey, number>>([
    ["action", new Map()],
    ["user", new Map()],
  ]);
  const listeners = new Set<() => void>();
  let published: ReadonlyMap<TargetKey, EnvironmentMachine> = new Map();
  const connects = new Map<TargetKey, Array<(outcome: ConnectOutcome) => void>>();
  /** The door's mint pace, on the monotonic clock: every exchange started spends it. */
  const pace = makeMintPace(DOOR_MINT_PACE);
  let cancelMintTimer: (() => void) | null = null;
  let account: AccountGuards = {
    postGrant: false,
    identityMint: { allowed: false, reason: "access-unverified", waitable: true },
    zeropsFailing: false,
    grantVerifiedAtMs: null,
  };
  let visible = false;
  /** A press is in flight in this browser (`holdBackground`). */
  let holding = false;
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

  /** Ends everything an entry holds: its timer and its ops in flight. */
  const endOps = (entry: Entry): void => {
    entry.cancelTimer?.();
    entry.cancelTimer = null;
    for (const controller of entry.inFlight.values()) controller.abort();
    entry.inFlight.clear();
  };

  const wantedBy = (key: TargetKey): ReadonlyArray<DemandReason | LeaseKind> =>
    suppressed(targetProject(key))
      ? []
      : PRIORITY.filter((reason) =>
          isLease(reason)
            ? (holds.get(reason)?.get(key) ?? 0) > 0
            : demands.get(reason)?.has(key) === true,
        );

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
    return isLease(top) ? (entry.userReason ?? "user") : EXCHANGE_REASON[top];
  };

  // ── Effects ────────────────────────────────────────────────────────────────────────────────

  const arm = (key: TargetKey, entry: Entry, at: Instant) => {
    entry.cancelTimer?.();
    const now = clock.now();
    const delayMs = Math.max(0, Math.min(at.mono - now.mono, at.wall - now.wall));
    entry.cancelTimer = clock.setTimer(delayMs, () => enqueue(() => step(key, { type: "TICK" })));
  };

  /**
   * An op's answer counts only for the entry that started it: a target that started over keeps
   * its key but restarts its attempts, so an older entry's answer is stale.
   */
  const startedBy = (key: TargetKey, entry: Entry, attempt: number): boolean => {
    if (entries.get(key) === entry) return true;
    ports.log?.(key, { kind: "stale-result", attempt });
    return false;
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
        if (!kept(key)) pace.spend(clock.now().mono);
        ports
          .exchange({
            key,
            origin: op.origin,
            expected: op.expected,
            reason: reasonFor(key, entry),
            asked: asked(key),
            signal: controller.signal,
          })
          .then(
            (answer) => enqueue(() => answered(key, entry, attempt, answer)),
            () =>
              enqueue(() =>
                answered(key, entry, attempt, {
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
            if (startedBy(key, entry, attempt))
              step(key, { type: "DESCRIPTOR_READ", attempt, result });
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

  const answered = (
    key: TargetKey,
    entry: Entry,
    attempt: number,
    answer: ExchangeAnswer<C>,
  ): void => {
    if (!startedBy(key, entry, attempt)) return;
    if (!answer.ok) {
      const cause = answer.failure.class === "retryable" ? answer.failure.cause : null;
      if (cause?.kind === "mint" && cause.status === 429) pace.throttled(clock.now().mono);
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
        if (!startedBy(key, entry, attempt) || entry.installing !== attempt) return;
        entry.installing = null;
        step(key, {
          type: outcome.ok ? "INSTALLED" : "INSTALL_FAILED",
          environmentId: answer.environmentId,
        });
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

  function asked(key: TargetKey): boolean {
    return rank(key) <= ASKED_RANK;
  }

  /** Whether the target's exchange presents a kept session first (`ports.kept`). */
  function kept(key: TargetKey): boolean {
    return ports.kept?.(key) ?? false;
  }

  /** An exchange still reading a remembered Mate's descriptor: its mint is still to come (A16). */
  const probing = (machine: EnvironmentMachine): boolean =>
    machine.credential.kind === "exchanging" &&
    machine.probing?.attempt === machine.credential.attempt;

  /** The mints the descriptor probes in flight may still spend; a kept session's spends none. */
  const owedMints = (): number =>
    [...entries].filter(([key, entry]) => probing(entry.machine) && !kept(key)).length;

  /**
   * Hands the free slots, in priority order, to the targets a slot would start, and takes the
   * budget back from every other one — so a slot is never held by a target that waits on
   * something else. An asked-for target is handed one whenever it would start; the background
   * starts nothing past the concurrency or the mint pace, counting the mint each descriptor
   * probe in flight may still spend, and nothing that mints while a press is in flight.
   */
  const allocate = (): void => {
    const now = clock.now();
    const ordered = [...entries.keys()].sort((left, right) => rank(left) - rank(right));
    let paceBound = false;
    for (const key of ordered) {
      const entry = entries.get(key)!;
      const running = [...entries.values()].map((other) => other.machine);
      const exchanging = running.filter((other) => other.credential.kind === "exchanging").length;
      const owed = owedMints();
      const paced = pace.readyAt(now.mono, owed) <= now.mono;
      let budget = false;
      const held = holding && !asked(key) && !kept(key);
      if (entry.machine.credential.kind === "exchanging") {
        budget = entry.machine.guards.budget;
      } else if (
        !held &&
        (asked(key) || (exchanging < EXCHANGE_CONCURRENCY && (paced || kept(key))))
      ) {
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
      if (credential.kind === "waiting" && credential.on === "budget" && !paced) paceBound = true;
    }
    cancelMintTimer?.();
    cancelMintTimer = null;
    // A target held back by the pace gets its slot back when the pace has a mint for it.
    if (paceBound) {
      cancelMintTimer = clock.setTimer(pace.readyAt(now.mono, owedMints()) - now.mono, () =>
        enqueue(() => undefined),
      );
    }
  };

  // ── Publication ────────────────────────────────────────────────────────────────────────────

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
        // A Connect answers once the registry took the credential.
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

  const publish = (): void => {
    const changed =
      published.size !== entries.size ||
      [...entries].some(([key, entry]) => published.get(key) !== entry.machine);
    if (changed) published = new Map([...entries].map(([key, entry]) => [key, entry.machine]));
    for (const [key, resolvers] of connects) {
      const entry = entries.get(key);
      const outcome = entry === undefined ? null : outcomeOf(entry.machine);
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
          let entry = entryFor(target.key, target.record);
          // Retirement absorbs every event. A target found gone that the inventory names again
          // is a new target.
          if (
            entry.machine.credential.kind === "retired" &&
            entry.machine.presence.kind === "gone" &&
            target.presence !== null &&
            target.presence.kind !== "gone"
          ) {
            endOps(entry);
            entries.delete(target.key);
            entry = entryFor(target.key, target.record);
          }
          if (target.presence !== null && !sameJson(target.presence, entry.machine.presence)) {
            step(target.key, { type: "PRESENCE", presence: target.presence });
          }
          if (!sameJson(target.container, entry.machine.container)) {
            step(target.key, { type: "CONTAINER", container: target.container });
          }
        }
      }),
    setDeleting: (projectId, accepted) =>
      enqueue(() => {
        if (accepted) deleting.add(projectId);
        else deleting.delete(projectId);
        // Apply before the next queued link event can request a descriptor on the old guards.
        for (const [key, entry] of entries) {
          if (targetProject(key) === projectId)
            step(key, { type: "GUARDS", guards: guardsFor(key, entry.machine.guards.budget) });
        }
      }),
    setCloseOffHeld: (projectIds) => {
      const next = new Set(projectIds);
      enqueue(() => {
        const moved = new Set(
          [...next, ...closeOffHeld].filter((id) => next.has(id) !== closeOffHeld.has(id)),
        );
        closeOffHeld = next;
        if (moved.size === 0) return;
        for (const [key, entry] of entries) {
          if (moved.has(targetProject(key)))
            step(key, { type: "GUARDS", guards: guardsFor(key, entry.machine.guards.budget) });
        }
      });
    },
    setDemand: (reason, keys) =>
      enqueue(() => {
        // A key no target names yet is wanted once the inventory or a record names it.
        demands.set(reason, new Set(keys));
      }),
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
          if (!suppressed(targetProject(key))) step(key, { type: "USER_RETRY" });
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
      for (const entry of entries.values()) endOps(entry);
      for (const resolvers of connects.values()) {
        for (const resolve of resolvers) resolve({ _tag: "Closed" });
      }
      connects.clear();
      listeners.clear();
    },
  };
}
