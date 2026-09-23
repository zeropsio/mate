/**
 * Hosts the birth store and its worker (DESIGN §4.5, §2.C C9) in today's account tree: one per
 * account epoch, beside the container store. A creation begins a birth here the moment the
 * platform accepts it, and the worker brings the Mate up whatever page the person is on and
 * whichever organization their tab has open; the connect promotes the birth, and the chat reads
 * the opening job it left.
 *
 * Every port acts on the birth's own record — its organization, its Gitea project, its container
 * — never on what a tab has open now. An interim host: the account runtime's post-grant stage
 * constructs the store and the worker (3.4).
 */
import {
  planGroupMembership,
  ZeropsApiError,
  type ZeropsApiClient,
  type ZeropsCreationHandoff,
} from "@t3tools/client-runtime/zerops";
import {
  BIRTHS_KEY,
  makeBirthStore,
  makeBirthWorker,
  type BeginBirth,
  type BirthLedger,
  type BirthLocks,
  type BirthRecord,
  type BirthStepOutcome,
  type BirthStore,
  type BirthWorker,
  type BirthWorkerPorts,
} from "@t3tools/client-runtime/zerops/birth";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  ZeropsServiceId,
  type ProjectRef,
  type ProjectActivityRead,
} from "@t3tools/client-runtime/zerops/data";
import { systemExchangeClock } from "@t3tools/client-runtime/zerops/environments";
import type { ProvisioningState } from "@t3tools/client-runtime/zerops/provisioning";
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { useMemo, useSyncExternalStore } from "react";

import { invalidateZerops } from "./accountInvalidations";
import {
  accountLocalStorage,
  accountStorageKey,
  currentAccountEpoch,
  currentAccountId,
  onAccountLifetimeClose,
} from "./accountLifetime";
import { addGroupEnvironment } from "./addGroupEnvironment";
import { grantBrokerProject } from "./brokerGrant";
import { giteaClientFor } from "./accountGiteaSessions";
import { readZeropsResourceOnce } from "./useZeropsDeployedVersion";
import { registryGroupSlug } from "./useZeropsRegistry";
import { nextContainerReading } from "./zeropsContainers";
import { runZeropsCommand, type ZeropsDataContextValue } from "./zeropsDataContext";

// ── Outcomes ─────────────────────────────────────────────────────────────────────────────────

/** The API's own failures that a later attempt can get past. */
const PASSING_API_FAILURES: ReadonlySet<string> = new Set([
  "network",
  "access-unverified",
  "uncertain",
  "server",
  "expired-session",
]);

/** The runtime's admission refusals that the account's next grant or a free slot ends. */
const PASSING_ADMISSIONS: ReadonlySet<string> = new Set([
  "access-unverified",
  "access-expired",
  "command-capacity",
]);

const hasTag = (cause: unknown, tag: string): cause is Record<string, unknown> =>
  typeof cause === "object" && cause !== null && "_tag" in cause && cause._tag === tag;

/**
 * What a failed write means to a birth: "not yet" for what a later attempt can get past — the
 * account mid-verification or between grants, the platform not caught up, the network — and
 * "failed" for an answer.
 */
export function birthStepFailure(cause: unknown): BirthStepOutcome {
  const reason = zeropsErrorMessage(cause);
  if (cause instanceof ZeropsApiError) {
    return { kind: PASSING_API_FAILURES.has(cause.kind) ? "not-yet" : "failed", reason };
  }
  if (hasTag(cause, "ZeropsCommandAdmissionError")) {
    return {
      kind: PASSING_ADMISSIONS.has(String(cause.reason)) ? "not-yet" : "failed",
      reason,
    };
  }
  if (hasTag(cause, "ZeropsDataAdapterError")) {
    return {
      kind: cause.retryable === true || cause.kind === "uncertain" ? "not-yet" : "failed",
      reason,
    };
  }
  return { kind: "not-yet", reason };
}

const DONE: BirthStepOutcome = { kind: "done" };

// ── Ports ────────────────────────────────────────────────────────────────────────────────────

/** What the ports act through: the newest the account tree committed. */
export interface BirthInputs {
  readonly client: ZeropsApiClient;
  readonly runtime: ZeropsDataContextValue["runtime"];
  readonly organizationRef: ZeropsDataContextValue["organizationRef"];
  readonly projectRef: ZeropsDataContextValue["projectRef"];
  /** The registry the data runtime publishes to: the activity feed is read from it. */
  readonly atoms: AtomRegistry.AtomRegistry;
}

const NOT_BOUND: BirthStepOutcome = {
  kind: "not-yet",
  reason: "The account is still starting.",
};

/** A process the activity feed reads as running on the container, once the feed observes. */
function runningOn(activity: ProjectActivityRead, serviceId: string | null): boolean | null {
  const required = activity.running.observation.required;
  if (required.length === 0 || required.some((interest) => interest.status !== "observing")) {
    return null;
  }
  return activity.running.value.some((entry) => {
    if (entry.knowledge !== "observed") return false;
    const identity = entry.record.identity;
    if (identity.knowledge !== "observed") return false;
    return (
      serviceId === null ||
      (identity.fields.serviceIds ?? []).includes(ZeropsServiceId.make(serviceId))
    );
  });
}

/**
 * The worker's ports over the account tree's inputs. The activity feed of a birth's project is
 * demanded from the first read of it until the birth ends (`release`).
 */
export function webBirthPorts(read: () => BirthInputs | null): Omit<
  BirthWorkerPorts,
  "store" | "clock" | "locks" | "outstanding"
> & {
  readonly release: (projectId: string) => void;
} {
  const leases = new Map<string, AbortController>();
  const refOf = (inputs: BirthInputs, birth: BirthRecord): ProjectRef =>
    inputs.projectRef(birth.organizationId, birth.projectId);

  return {
    writeTags: async (birth) => {
      const inputs = read();
      const registration = birth.registration;
      if (inputs === null) return NOT_BOUND;
      if (registration === null) return DONE;
      try {
        const registry = await inputs.client.readGroupRegistry(registration.giteaProjectId);
        const group = registry.groups.find((entry) => entry.groupId === registration.groupId);
        // A group written a moment ago may not read back yet.
        if (group === undefined) {
          return { kind: "not-yet", reason: "That project is not in the registry yet." };
        }
        if (
          group.projects.some(
            (entry) => entry.projectId === birth.projectId && entry.kind === registration.kind,
          )
        ) {
          return DONE;
        }
        const membership = planGroupMembership({
          registry,
          groupId: registration.groupId,
          projectId: birth.projectId,
          kind: registration.kind,
        });
        if (!membership.ok) return { kind: "failed", reason: membership.reason };
        await inputs.client.writeGroupRegistry({
          giteaProjectId: registration.giteaProjectId,
          tagList: membership.tagList,
        });
        return DONE;
      } catch (cause) {
        return birthStepFailure(cause);
      }
    },
    writeRegistry: async (birth) => {
      const inputs = read();
      const registration = birth.registration;
      if (inputs === null) return NOT_BOUND;
      if (registration === null) return DONE;
      if (registration.kind === "mate") {
        const grant = await grantBrokerProject({
          client: inputs.client,
          clientId: birth.organizationId,
          projectId: birth.projectId,
        });
        // An account minted before it had a Gitea has no broker: a Mate is registered either way.
        return grant.kind === "failed" ? { kind: "not-yet", reason: grant.reason } : DONE;
      }
      try {
        const registry = await inputs.client.readGroupRegistry(registration.giteaProjectId);
        const written = await addGroupEnvironment({
          client: inputs.client,
          gitea:
            registration.giteaOrigin === null ? null : giteaClientFor(registration.giteaOrigin),
          clientId: birth.organizationId,
          giteaProjectId: registration.giteaProjectId,
          registry,
          groupId: registration.groupId,
          slug: registryGroupSlug(registry, registration.groupId),
          environment: {
            displayName: registration.displayName,
            tier: registration.kind,
            project: birth.projectId,
          },
        });
        // Every write it makes is safe to make again: it declares nothing twice and reuses what
        // an earlier attempt left.
        return written.failed === undefined
          ? DONE
          : { kind: "not-yet", reason: written.failed.reason };
      } catch (cause) {
        return birthStepFailure(cause);
      }
    },
    readProject: async (birth) => {
      const inputs = read();
      if (inputs === null) throw new Error("The account is still starting.");
      try {
        const [project, services] = await Promise.all([
          inputs.client.fetchProject(birth.projectId),
          inputs.client.listProjectServices(birth.projectId),
        ]);
        return { project, services };
      } catch (cause) {
        if (cause instanceof ZeropsApiError && cause.kind === "not-found") return "gone";
        throw cause;
      }
    },
    processRunning: (birth, serviceId) => {
      const inputs = read();
      if (inputs === null) return null;
      const project = refOf(inputs, birth);
      if (!leases.has(birth.projectId)) {
        const controller = new AbortController();
        leases.set(birth.projectId, controller);
        void Effect.runPromise(
          Effect.scoped(
            inputs.runtime
              .acquire({ kind: "project-activity", project })
              .pipe(Effect.andThen(Effect.never)),
          ),
          { signal: controller.signal },
        ).catch(() => undefined);
      }
      return runningOn(inputs.atoms.get(inputs.runtime.reads.activity(project)), serviceId);
    },
    harden: async (birth) => {
      const inputs = read();
      if (inputs === null) return NOT_BOUND;
      try {
        await runZeropsCommand(inputs.runtime.commands.isolateProjectEnv(refOf(inputs, birth)));
        return DONE;
      } catch (cause) {
        return birthStepFailure(cause);
      }
    },
    // Through the tab's one probe pool (DESIGN §4.5), never a probe of its own.
    probeHealth: async (origin) => (await nextContainerReading(origin)).kind,
    readMateFlag: async (birth, serviceId) => {
      const inputs = read();
      if (inputs === null) return "unknown";
      const value = await readZeropsResourceOnce(inputs.runtime.resources, {
        kind: "service-mate-flag",
        account: inputs.runtime.scope,
        service: {
          kind: "service",
          project: refOf(inputs, birth),
          serviceId: ZeropsServiceId.make(serviceId),
        },
      });
      return value === undefined ? "unknown" : value.enabled;
    },
    release: (projectId) => {
      leases.get(projectId)?.abort();
      leases.delete(projectId);
    },
  };
}

// ── One store and one worker per account epoch ───────────────────────────────────────────────

/** The page's exclusive locks; a browser without them has one tab to itself. */
const pageLocks: BirthLocks = {
  request: (name, hold) => {
    const locks: LockManager | undefined = globalThis.navigator?.locks;
    return locks === undefined ? hold() : locks.request(name, () => hold());
  },
};

interface Hosted {
  readonly epoch: number;
  /** The account whose storage the store reads: a host from before sign-in is not its. */
  readonly account: string | null;
  readonly store: BirthStore;
  readonly worker: BirthWorker;
  readonly live: {
    inputs: BirthInputs | null;
    /** The newest group write a birth went on without, in words. */
    outstanding: string | null;
  };
  readonly listeners: Set<() => void>;
  readonly stop: () => void;
}

let hosted: Hosted | null = null;

onAccountLifetimeClose(() => {
  hosted?.stop();
  hosted = null;
});

function host(): Hosted {
  const epoch = currentAccountEpoch();
  const account = currentAccountId();
  if (hosted !== null && hosted.epoch === epoch && hosted.account === account) return hosted;
  hosted?.stop();
  const live: Hosted["live"] = { inputs: null, outstanding: null };
  const listeners = new Set<() => void>();
  const store = makeBirthStore({
    storage: accountLocalStorage,
    now: () => systemExchangeClock.now().wall,
  });
  const ports = webBirthPorts(() => live.inputs);
  const worker = makeBirthWorker({
    ...ports,
    store,
    clock: systemExchangeClock,
    locks: pageLocks,
    outstanding: (_birth, reason) => {
      live.outstanding = reason;
      for (const listener of listeners) listener();
    },
  });
  // A birth that ended — promoted, forgotten, gone — no longer needs its project's activity. One
  // whose harden found its container asks for its organization's inventory once: the connect
  // finds the Mate there, and a missed push must not keep it from being listed (§6.2).
  const stepOf = (ledger: BirthLedger) =>
    new Map(ledger.births.map((birth) => [birth.projectId, birth.step] as const));
  let known = stepOf(store.ledger());
  const follow = store.subscribe(() => {
    const births = store.ledger().births;
    const steps = stepOf(store.ledger());
    for (const projectId of known.keys()) if (!steps.has(projectId)) ports.release(projectId);
    for (const birth of births) {
      if (birth.step !== "health" || known.get(birth.projectId) === "health") continue;
      const inputs = live.inputs;
      if (inputs === null) continue;
      invalidateZerops({
        topic: "inventory",
        organization: inputs.organizationRef(birth.organizationId),
      });
    }
    known = steps;
  });
  // Another tab began, moved or ended a birth.
  const heard = (event: StorageEvent) => {
    if (event.key === accountStorageKey(BIRTHS_KEY)) store.reload();
  };
  globalThis.addEventListener?.("storage", heard);
  hosted = {
    epoch,
    account,
    store,
    worker,
    live,
    listeners,
    stop: () => {
      globalThis.removeEventListener?.("storage", heard);
      follow();
      worker.dispose();
      for (const projectId of known.keys()) ports.release(projectId);
    },
  };
  return hosted;
}

/** Starts the account's births, if they are not running yet, and hands them the account tree. */
export function bindBirthInputs(inputs: BirthInputs): void {
  host().live.inputs = inputs;
}

/** The platform accepted a creation: its birth starts now. */
export function beginBirth(input: BeginBirth): void {
  const current = host();
  current.live.outstanding = null;
  for (const listener of current.listeners) listener();
  current.store.begin(input);
}

/** The connect named the environment: the birth is over, and its opening job waits there. */
export function promoteBirth(projectId: string, environmentId: string): void {
  host().store.promote(projectId, environmentId);
}

/** The project failed or was removed: nothing is born of it. */
export function forgetBirth(projectId: string): void {
  host().store.forget(projectId);
}

export function creationJobFor(environmentId: string): ZeropsCreationHandoff | undefined {
  return host().store.job(environmentId);
}

export function forgetCreationJob(environmentId: string): void {
  host().store.forgetJob(environmentId);
}

/** "Keep waiting" / "Try again" on a birth this tab drives. */
export function retryBirth(projectId: string): void {
  host().worker.retry(projectId);
}

/** The Enable command landed for a birth's container. */
export function birthEnabled(projectId: string): void {
  host().worker.enabled(projectId);
}

// ── What surfaces read ───────────────────────────────────────────────────────────────────────

export interface BirthsSnapshot {
  readonly births: ReadonlyArray<BirthRecord>;
  /** Each birth this tab drives, by project: where its wait stands. */
  readonly waits: ReadonlyMap<string, ProvisioningState>;
  /** The newest group write a birth went on without, in words. */
  readonly outstanding: string | null;
}

/** The account's births and this tab's waits on them. */
export function useZeropsBirths(): BirthsSnapshot {
  const current = host();
  const subscribe = useMemo(
    () => (listener: () => void) => {
      const stops = [current.store.subscribe(listener), current.worker.subscribe(listener)];
      current.listeners.add(listener);
      return () => {
        for (const stop of stops) stop();
        current.listeners.delete(listener);
      };
    },
    [current],
  );
  const ledger = useSyncExternalStore(subscribe, current.store.ledger);
  const waits = useSyncExternalStore(subscribe, current.worker.waits);
  const outstanding = useSyncExternalStore(subscribe, () => current.live.outstanding);
  return useMemo(
    () => ({ births: ledger.births, waits, outstanding }),
    [ledger.births, outstanding, waits],
  );
}
