/**
 * The birth worker (DESIGN §4.5, §2.C C9): one per account, driving every birth the store holds
 * through `tags → registry → harden → health`, whatever view is mounted and whichever
 * organization a tab has open. The record carries everything a step needs; the worker reads the
 * birth's own project directly, so a missed inventory push never stalls it.
 *
 * - `tags` and `registry` are the group writes a creation used to make from its component. Each
 *   is tried on the retry ladder while it answers "not yet"; one that fails, or is still not
 *   through at the top of the ladder, is said (`outstanding`) and the birth goes on — a Mate the
 *   registry does not name yet is one the card and the half-made reconcile finish (MB-24), never
 *   one left unhardened.
 * - `harden` and `health` are `provisioning.ts`'s wait: the container found and its own boot over
 *   (a read, never a timer), the project closed off, the Mate answering. A harden that answers
 *   "not yet" is tried on the retry ladder; one that fails waits for "Try again". A cap past its
 *   budget sets `overdue` on the step and changes nothing else (MC-13) but the wait's cadence:
 *   every 2 s, and once overdue 10 s rising to 60 s.
 * - A birth ends without a Mate when its project was removed or its creation failed — read while
 *   the container is waited on, and every 30 s while the Mate is — or when its container import
 *   failed (`container` false).
 * - A birth whose Mate answered is read no more by the tab that saw it: that tab holds the birth
 *   until the connect promotes it. A tab that takes a birth up after a reload reads its health
 *   again once. Nothing connects to a Mate on its own before its step is `health`
 *   (`unhardenedBirths`).
 * - One tab drives a birth: its driver holds Web Lock `mate:birth:<projectId>` (§6.7) for as long
 *   as the record is there, and a tab that gets the lock after another let it go reads the record
 *   first and goes on from its step.
 */
import type { ZeropsProject, ZeropsService } from "../api.ts";
import type { ExchangeClock } from "../environments/exchangeDriver.ts";
import {
  INITIAL_BACKOFF,
  RETRY_RUNGS_MS,
  scheduleRetry,
  type Backoff,
} from "../knowledge/retryPolicy.ts";
import {
  advanceProvisioning,
  readProvisioning,
  startProvisioningForContainer,
  startProvisioningForProject,
  type ProvisioningEvent,
  type ProvisioningState,
  type ZeropsContainerHealth,
} from "../provisioning.ts";
import type { BirthRecord, BirthStep, BirthStore } from "./birthStore.ts";

/** How often a birth's wait reads what it waits on. */
export const BIRTH_POLL_MS = 2_000;

/** How often the health wait reads its project again, to hear that it was removed. */
export const BIRTH_PROJECT_RECHECK_MS = 30_000;

/** Once overdue, the wait reads this far apart, doubling up to the last (DESIGN §4.5 probes). */
export const BIRTH_OVERDUE_POLL_MS = { first: 10_000, last: 60_000 } as const;

/** What a group write or the harden answered. */
export type BirthStepOutcome =
  | { readonly kind: "done" }
  /** Not this person's to decide yet — the account mid-verification, a registry still catching up. */
  | { readonly kind: "not-yet"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/** The birth's own project as a direct read gave it. */
export interface BirthProjectReading {
  readonly project: ZeropsProject;
  readonly services: ReadonlyArray<ZeropsService>;
}

/** The page's exclusive locks (`navigator.locks`): `hold` runs once the lock is this tab's. */
export interface BirthLocks {
  readonly request: (name: string, hold: () => Promise<void>) => Promise<void>;
}

export const birthLockName = (projectId: string): string => `mate:birth:${projectId}`;

export interface BirthWorkerPorts {
  readonly store: BirthStore;
  readonly locks: BirthLocks;
  readonly clock: Pick<ExchangeClock, "now" | "setTimer" | "random">;
  /** Writes the birth's registry entry on the account's Gitea project. */
  readonly writeTags: (birth: BirthRecord) => Promise<BirthStepOutcome>;
  /** The rest of its group registration: the broker's grant, a stage's key and declaration. */
  readonly writeRegistry: (birth: BirthRecord) => Promise<BirthStepOutcome>;
  /**
   * The project and its services by a direct read; `gone` once the platform no longer has it,
   * `creation-failed` once the platform failed or canceled its creation.
   */
  readonly readProject: (
    birth: BirthRecord,
  ) => Promise<BirthProjectReading | "gone" | "creation-failed">;
  /** Whether the activity feed reads a process running on the container; null before it answered. */
  readonly processRunning: (birth: BirthRecord, serviceId: string | null) => boolean | null;
  /** Closes the birth's project off (`projectIsolation.ts`); safe to run again. */
  readonly harden: (birth: BirthRecord) => Promise<BirthStepOutcome>;
  readonly probeHealth: (origin: string) => Promise<ZeropsContainerHealth>;
  /** `ZCP_MATE_ENABLED` on the Mate's service. */
  readonly readMateFlag: (birth: BirthRecord, serviceId: string) => Promise<boolean | "unknown">;
  /** A group write the birth went on without, in words. */
  readonly outstanding: (birth: BirthRecord, reason: string) => void;
}

export interface BirthWorker {
  /** Each birth this tab drives, by project: where its wait stands. */
  readonly waits: () => ReadonlyMap<string, ProvisioningState>;
  readonly subscribe: (listener: () => void) => () => void;
  /** "Keep waiting" / "Try again": the wait's clock starts over, a group write is tried again. */
  readonly retry: (projectId: string) => void;
  /** The Enable command landed: the wait follows the restart it asked for. */
  readonly enabled: (projectId: string) => void;
  /** The account closed: every wait ends. */
  readonly dispose: () => void;
}

interface Driver {
  /** The birth this driver drives; a birth begun again gets a driver of its own. */
  readonly startedAt: number;
  /** The wait of the step `step` names; a step moved by anyone else starts its wait over. */
  state: ProvisioningState | null;
  step: BirthStep | null;
  /** Where a write that answered "not yet" is on the retry ladder; null before one did. */
  backoff: Backoff | null;
  /** When the health wait last read its project, or began; null before it began. */
  projectReadAtMs: number | null;
  /** How many reads this wait has made since it went overdue. */
  overdueReads: number;
  /** Ends the current pause early. */
  wake: (() => void) | null;
  stopped: boolean;
}

/** Read again after a pause; rest until "Try again" or the record moves; or let the birth go. */
type Next = { readonly after: number } | "rest" | "finished";

const AGAIN: Next = { after: 0 };
const POLL: Next = { after: BIRTH_POLL_MS };

export function makeBirthWorker(ports: BirthWorkerPorts): BirthWorker {
  const { store, clock } = ports;
  const drivers = new Map<string, Driver>();
  const listeners = new Set<() => void>();
  let published: ReadonlyMap<string, ProvisioningState> = new Map();
  let disposed = false;

  const publish = () => {
    const next = new Map<string, ProvisioningState>();
    for (const [projectId, driver] of drivers) {
      if (driver.state !== null) next.set(projectId, driver.state);
    }
    const same =
      next.size === published.size &&
      [...next].every(([projectId, state]) => published.get(projectId) === state);
    if (same) return;
    published = next;
    for (const listener of listeners) listener();
  };

  const nowMs = () => clock.now().wall;

  /** Waits `ms`, or with null until woken: by "Try again", or by the record moving on. */
  const pause = (driver: Driver, ms: number | null) =>
    new Promise<void>((resolve) => {
      const cancel =
        ms === null
          ? () => undefined
          : clock.setTimer(ms, () => {
              driver.wake = null;
              resolve();
            });
      driver.wake = () => {
        cancel();
        driver.wake = null;
        resolve();
      };
    });

  /** The next read of a wait: every 2 s, and once overdue 10 s rising to 60 s. */
  const poll = (driver: Driver, state: ProvisioningState): Next => {
    if (!state.overdue) {
      driver.overdueReads = 0;
      return POLL;
    }
    const after = Math.min(
      BIRTH_OVERDUE_POLL_MS.first * 2 ** driver.overdueReads,
      BIRTH_OVERDUE_POLL_MS.last,
    );
    driver.overdueReads += 1;
    return { after };
  };

  /** The next attempt of a write that answered "not yet", on the retry ladder. */
  const backOff = (driver: Driver): Next => {
    const retry = scheduleRetry(driver.backoff ?? INITIAL_BACKOFF, nowMs(), clock.random);
    driver.backoff = retry.backoff;
    return { after: retry.retryAtMs - nowMs() };
  };

  /** The wait moved: published, and its `overdue` carried onto the record. */
  const commit = (birth: BirthRecord, driver: Driver, state: ProvisioningState) => {
    driver.state = state;
    if (state.overdue !== birth.overdue) store.update(birth.projectId, { overdue: state.overdue });
    publish();
  };

  /** Nothing is born of the birth: its project failed or was removed, or it has no container. */
  const end = (birth: BirthRecord): Next => {
    store.forget(birth.projectId);
    return "finished";
  };

  const groupStep = async (
    birth: BirthRecord,
    driver: Driver,
    write: (birth: BirthRecord) => Promise<BirthStepOutcome>,
    next: BirthStep | null,
  ): Promise<Next> => {
    if (birth.registration !== null) {
      const outcome = await write(birth).catch((cause: unknown): BirthStepOutcome => ({
        kind: "not-yet",
        reason: String(cause),
      }));
      if (outcome.kind === "not-yet") {
        const backoff = driver.backoff ?? { rung: 0 };
        if (backoff.rung < RETRY_RUNGS_MS.length) {
          const retry = scheduleRetry(backoff, nowMs(), clock.random);
          driver.backoff = { rung: backoff.rung + 1 };
          return { after: retry.retryAtMs - nowMs() };
        }
      }
      if (outcome.kind !== "done") ports.outstanding(birth, outcome.reason);
    }
    driver.backoff = null;
    // Nothing to bring up: a stage or a production without an agent is born with its writes.
    if (next === null) return end(birth);
    store.update(birth.projectId, { step: next });
    return AGAIN;
  };

  const harden = async (birth: BirthRecord, driver: Driver): Promise<Next> => {
    let state =
      driver.state ?? startProvisioningForProject({ projectId: birth.projectId, nowMs: nowMs() });
    if (state.phase === "hardening") {
      const outcome = await ports
        .harden(birth)
        .catch((cause: unknown): BirthStepOutcome => ({ kind: "not-yet", reason: String(cause) }));
      if (outcome.kind === "done") {
        state = advanceProvisioning(state, { kind: "hardened" }, nowMs());
        store.update(birth.projectId, {
          step: "health",
          overdue: false,
          serviceId: state.containerServiceId,
          origin: state.containerOrigin,
        });
        driver.step = "health";
        driver.state = state;
        driver.projectReadAtMs = nowMs();
        publish();
        return AGAIN;
      }
      if (outcome.kind === "failed") {
        // An answer, not a delay: asked again only when the person says "Try again".
        commit(
          birth,
          driver,
          advanceProvisioning(state, { kind: "harden-failed", message: outcome.reason }, nowMs()),
        );
        return "rest";
      }
      commit(birth, driver, state);
      return backOff(driver);
    }
    const reading = await ports.readProject(birth);
    if (reading === "gone" || reading === "creation-failed") return end(birth);
    state = advanceProvisioning(
      state,
      await readProvisioning({
        state,
        project: reading.project,
        services: reading.services,
        probeHealth: ports.probeHealth,
      }),
      nowMs(),
    );
    if (state.phase === "awaiting-settled") {
      const running = ports.processRunning(birth, state.containerServiceId);
      if (running !== null) {
        state = advanceProvisioning(state, { kind: "process", running, observed: true }, nowMs());
      }
    }
    state = advanceProvisioning(state, { kind: "tick" }, nowMs());
    commit(birth, driver, state);
    return state.phase === "hardening" ? AGAIN : poll(driver, state);
  };

  const health = async (birth: BirthRecord, driver: Driver): Promise<Next> => {
    if (birth.origin === null) {
      // No container was ever named: harden finds it again, and harden is safe to repeat.
      store.update(birth.projectId, { step: "harden" });
      return AGAIN;
    }
    if (driver.projectReadAtMs === null) {
      driver.projectReadAtMs = nowMs();
    } else if (nowMs() - driver.projectReadAtMs >= BIRTH_PROJECT_RECHECK_MS) {
      driver.projectReadAtMs = nowMs();
      const reading = await ports.readProject(birth);
      if (reading === "gone" || reading === "creation-failed") return end(birth);
    }
    let state =
      driver.state ??
      startProvisioningForContainer({
        projectId: birth.projectId,
        serviceId: birth.serviceId,
        containerOrigin: birth.origin,
        nowMs: nowMs(),
      });
    const running = ports.processRunning(birth, birth.serviceId);
    if (running !== null) {
      state = advanceProvisioning(state, { kind: "process", running }, nowMs());
    }
    let event: ProvisioningEvent = await readProvisioning({
      state,
      project: undefined,
      services: undefined,
      probeHealth: ports.probeHealth,
    });
    if (event.kind === "health" && event.health === "predates-mate" && birth.serviceId !== null) {
      // Mid-install answers like a container that never had the flag: the flag tells them apart.
      if ((await ports.readMateFlag(birth, birth.serviceId)) === true) {
        event = { ...event, mateEnabled: true };
      }
    }
    state = advanceProvisioning(
      advanceProvisioning(state, event, nowMs()),
      { kind: "tick" },
      nowMs(),
    );
    commit(birth, driver, state);
    // A Mate that answered is read no more; its tab keeps the lock until the connect promotes it.
    return state.phase === "ready" ? "rest" : poll(driver, state);
  };

  const step = async (birth: BirthRecord, driver: Driver): Promise<Next> => {
    if (driver.step !== birth.step) {
      driver.step = birth.step;
      driver.state = null;
      driver.backoff = null;
      driver.projectReadAtMs = null;
    }
    switch (birth.step) {
      case "tags":
        return groupStep(birth, driver, ports.writeTags, "registry");
      case "registry":
        return groupStep(birth, driver, ports.writeRegistry, birth.container ? "harden" : null);
      case "harden":
        return birth.container ? harden(birth, driver) : end(birth);
      case "health":
        return birth.container ? health(birth, driver) : end(birth);
    }
  };

  const drive = async (projectId: string, driver: Driver) => {
    // Another tab may have moved the birth on while this one waited for the lock.
    store.reload();
    // Disposal stops every driver.
    while (!driver.stopped) {
      const birth = store.birth(projectId);
      if (birth === undefined || birth.startedAt !== driver.startedAt) return;
      let next: Next;
      try {
        next = await step(birth, driver);
      } catch {
        // A read that failed is no verdict: the wait reads again on its own cadence.
        next = POLL;
      }
      if (next === "finished" || driver.stopped) return;
      await pause(driver, next === "rest" ? null : next.after);
    }
  };

  const sync = () => {
    if (disposed) return;
    const births = store.ledger().births;
    for (const [projectId, driver] of drivers) {
      const birth = births.find((entry) => entry.projectId === projectId);
      if (birth !== undefined && birth.startedAt === driver.startedAt) continue;
      driver.stopped = true;
      driver.wake?.();
      drivers.delete(projectId);
    }
    for (const birth of births) {
      if (drivers.has(birth.projectId)) continue;
      const driver: Driver = {
        startedAt: birth.startedAt,
        state: null,
        step: null,
        backoff: null,
        projectReadAtMs: null,
        overdueReads: 0,
        wake: null,
        stopped: false,
      };
      drivers.set(birth.projectId, driver);
      void ports.locks.request(birthLockName(birth.projectId), () =>
        driver.stopped ? Promise.resolve() : drive(birth.projectId, driver),
      );
    }
    publish();
  };

  const unsubscribe = store.subscribe(sync);
  sync();

  const nudge = (projectId: string, event: ProvisioningEvent) => {
    const driver = drivers.get(projectId);
    if (driver === undefined) return;
    driver.backoff = null;
    if (driver.state !== null) {
      driver.state = advanceProvisioning(driver.state, event, nowMs());
      publish();
    }
    driver.wake?.();
  };

  return {
    waits: () => published,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retry: (projectId) => nudge(projectId, { kind: "retry" }),
    enabled: (projectId) => nudge(projectId, { kind: "enable" }),
    dispose: () => {
      disposed = true;
      unsubscribe();
      for (const driver of drivers.values()) {
        driver.stopped = true;
        driver.wake?.();
      }
      drivers.clear();
      listeners.clear();
    },
  };
}
