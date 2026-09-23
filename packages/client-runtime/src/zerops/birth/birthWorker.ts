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
 *   (a read, never a timer), the project closed off, the Mate answering. A cap past its budget
 *   sets `overdue` on the step and changes nothing else (MC-13).
 * - A birth whose Mate answered is not driven again; its record stays until the connect promotes
 *   it, and nothing connects to it on its own before its step is `health` (`unhardenedBirths`).
 * - One tab drives a birth: its driver holds Web Lock `mate:birth:<projectId>` (§6.7), and a tab
 *   that gets the lock after another let it go reads the record first and goes on from its step.
 */
import type { ZeropsProject, ZeropsService } from "../api.ts";
import type { ExchangeClock } from "../environments/exchangeDriver.ts";
import { RETRY_RUNGS_MS, scheduleRetry, type Backoff } from "../knowledge/retryPolicy.ts";
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
  /** The project and its services by a direct read; `gone` once the platform no longer has it. */
  readonly readProject: (birth: BirthRecord) => Promise<BirthProjectReading | "gone">;
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
  /** Where a group write that answered "not yet" is on the retry ladder; null before one did. */
  backoff: Backoff | null;
  /** Ends the current pause early. */
  wake: (() => void) | null;
  stopped: boolean;
}

type Next = { readonly after: number } | "finished";

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

  const pause = (driver: Driver, ms: number) =>
    new Promise<void>((resolve) => {
      const cancel = clock.setTimer(ms, () => {
        driver.wake = null;
        resolve();
      });
      driver.wake = () => {
        cancel();
        driver.wake = null;
        resolve();
      };
    });

  /** The wait moved: published, and its `overdue` carried onto the record. */
  const commit = (birth: BirthRecord, driver: Driver, state: ProvisioningState) => {
    driver.state = state;
    if (state.overdue !== birth.overdue) store.update(birth.projectId, { overdue: state.overdue });
    publish();
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
    if (next === null) {
      // Nothing to bring up: a stage or a production without an agent is born with its writes.
      store.forget(birth.projectId);
      return "finished";
    }
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
        publish();
        return AGAIN;
      }
      if (outcome.kind === "failed") {
        state = advanceProvisioning(
          state,
          { kind: "harden-failed", message: outcome.reason },
          nowMs(),
        );
      }
    } else {
      const reading = await ports.readProject(birth);
      if (reading === "gone") {
        store.forget(birth.projectId);
        return "finished";
      }
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
    }
    commit(birth, driver, advanceProvisioning(state, { kind: "tick" }, nowMs()));
    return state.phase === "hardening" ? AGAIN : POLL;
  };

  const health = async (birth: BirthRecord, driver: Driver): Promise<Next> => {
    if (birth.origin === null) {
      // No container was ever named: harden finds it again, and harden is safe to repeat.
      store.update(birth.projectId, { step: "harden" });
      return AGAIN;
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
    return state.phase === "ready" ? "finished" : POLL;
  };

  const step = (birth: BirthRecord, driver: Driver): Promise<Next> => {
    if (driver.step !== birth.step) {
      driver.step = birth.step;
      driver.state = null;
    }
    switch (birth.step) {
      case "tags":
        return groupStep(birth, driver, ports.writeTags, "registry");
      case "registry":
        return groupStep(birth, driver, ports.writeRegistry, birth.container ? "harden" : null);
      case "harden":
        return harden(birth, driver);
      case "health":
        return health(birth, driver);
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
      await pause(driver, next.after);
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
