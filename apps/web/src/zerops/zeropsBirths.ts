/**
 * Hosts the birth store and its worker (DESIGN §4.5, §2.C C9) in the web: one per account epoch,
 * whose inputs the host binds once the account runtime's post-grant stage stands, beside the
 * container store it reads through. A creation begins a birth here the moment the platform
 * accepts it, and the worker brings the Mate up whatever page the person is on and whichever
 * organization their tab has open; the connect promotes the birth.
 *
 * Every port acts on the birth's own record — its organization, its Gitea project, its container
 * — never on what a tab has open now. An interim host: the design has the account runtime's
 * post-grant stage construct the store and the worker.
 */
import {
  projectCreationOutcome,
  ZeropsApiError,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStep,
  type ZeropsApiClient,
  type ZeropsPlacedBirth,
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
  unhardenedBirths,
} from "@t3tools/client-runtime/zerops/birth";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  ZeropsServiceId,
  type ProjectRef,
  type ProjectActivityRead,
} from "@t3tools/client-runtime/zerops/data";
import type { AccountEnvironmentPorts } from "@t3tools/client-runtime/zerops/account/runtime";
import {
  readServiceMateFlag,
  systemExchangeClock,
} from "@t3tools/client-runtime/zerops/environments";
import type { ProvisioningState } from "@t3tools/client-runtime/zerops/provisioning";
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { useMemo, useSyncExternalStore } from "react";

import { invalidateZerops } from "./accountInvalidations";
import {
  accountLocalStorage,
  accountStorageKey,
  captureAccountLifetime,
  currentAccountEpoch,
  currentAccountId,
  onAccountLifetimeClose,
} from "./accountLifetime";
import { addGroupEnvironment } from "./addGroupEnvironment";
import { grantBrokerProject, projectTagsWrite } from "./brokerGrant";
import { giteaClientFor } from "./accountGiteaSessions";
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

/** A project the platform is still creating; one whose creation failed never leaves them. */
const NEW_PROJECT_STATUSES: ReadonlySet<string> = new Set(["NEW", "CREATING"]);

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
 * The tab's one client, for as long as the account the births belong to is the one signed in: the
 * client outlives an account, and a step already running when the person signs out must not carry
 * on under the next person's token.
 */
function accountBound(client: ZeropsApiClient, isCurrent: () => boolean): ZeropsApiClient {
  return new Proxy(client, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args: ReadonlyArray<unknown>): unknown => {
        if (!isCurrent()) throw new Error("This account session has ended.");
        return Reflect.apply(value, target, args);
      };
    },
  });
}

/**
 * The worker's ports over the account tree's inputs, for as long as `isCurrent` says the account
 * they were made for is signed in. The activity feed of a birth's project is demanded from the
 * first read of it until the birth ends (`release`).
 */
export function webBirthPorts(
  bound: () => BirthInputs | null,
  isCurrent: () => boolean,
): Omit<BirthWorkerPorts, "store" | "clock" | "locks" | "outstanding"> & {
  readonly release: (projectId: string) => void;
} {
  const leases = new Map<string, AbortController>();
  const read = (): BirthInputs | null => {
    const inputs = bound();
    if (inputs === null || !isCurrent()) return null;
    return { ...inputs, client: accountBound(inputs.client, isCurrent) };
  };
  const refOf = (inputs: BirthInputs, birth: BirthRecord): ProjectRef =>
    inputs.projectRef(birth.organizationId, birth.projectId);

  return {
    writeTags: async (birth) => {
      const inputs = read();
      const registration = birth.registration;
      if (inputs === null) return NOT_BOUND;
      if (registration === null) return DONE;
      try {
        const written = await projectTagsWrite(inputs, birth.organizationId)(
          registration.giteaProjectId,
          {
            kind: "registry-member",
            groupId: registration.groupId,
            projectId: birth.projectId,
            member: registration.kind,
          },
        );
        if (written.kind !== "refused") return DONE;
        // A group written a moment ago may not read back yet.
        return written.refusal.code === "group-unknown"
          ? { kind: "not-yet", reason: written.refusal.reason }
          : { kind: "failed", reason: written.refusal.reason };
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
        const written = await addGroupEnvironment({
          client: inputs.client,
          writeTags: projectTagsWrite(inputs, birth.organizationId),
          gitea:
            registration.giteaOrigin === null ? null : giteaClientFor(registration.giteaOrigin),
          clientId: birth.organizationId,
          giteaProjectId: registration.giteaProjectId,
          groupId: registration.groupId,
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
        // A project whose creation the platform failed stays new for good (`candidates.ts`).
        if (NEW_PROJECT_STATUSES.has(project.status)) {
          const creation = await inputs.client.readProjectCreation({
            clientId: birth.organizationId,
            projectId: birth.projectId,
          });
          if (projectCreationOutcome(creation).kind === "failed") return "creation-failed";
        }
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
      return readServiceMateFlag(inputs.runtime.resources, {
        kind: "service",
        project: refOf(inputs, birth),
        serviceId: ZeropsServiceId.make(serviceId),
      });
    },
    release: (projectId) => {
      leases.get(projectId)?.abort();
      leases.delete(projectId);
    },
  };
}

// ── A creation's birth ───────────────────────────────────────────────────────────────────────

/**
 * A creation's platform that says when the project was accepted: the birth begins there, not
 * after the creation's later steps — a reload or a closed tab during any of them leaves it behind.
 */
export function bornOnAccept(
  platform: EnvironmentCreationPlatform,
  accepted: (projectId: string) => void,
): EnvironmentCreationPlatform {
  return {
    ...platform,
    createProject: async (input) => {
      const project = await platform.createProject(input);
      accepted(project.id);
      return project;
    },
    importProject: async (input) => {
      const imported = await platform.importProject(input);
      accepted(imported.projectId);
      return imported;
    },
  };
}

/** Whether a creation's container import went through: one that stopped on it or before made none. */
export function importedContainer(
  steps: ReadonlyArray<EnvironmentCreationStep>,
  outcome: EnvironmentCreationOutcome,
): boolean {
  const importAt = steps.findIndex((step) => step.kind === "import-container");
  if (importAt === -1) return false;
  return outcome.ok || steps.indexOf(outcome.failedStep) > importAt;
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
  const ports = webBirthPorts(() => live.inputs, captureAccountLifetime());
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

/** The creation's container import failed: the birth owes its group writes and nothing more. */
export function birthWithoutContainer(projectId: string): void {
  host().store.update(projectId, { container: false });
}

/** The connect named the environment: the birth is over. */
export function promoteBirth(projectId: string): void {
  host().store.forget(projectId);
}

/** The project failed or was removed: nothing is born of it. */
export function forgetBirth(projectId: string): void {
  host().store.forget(projectId);
}

/**
 * The births as the account runtime's Mate environments read them: a Mate whose birth has not
 * closed its project off yet is never auto-connected, and the connect that names its environment
 * ends the birth.
 */
export const birthsForEnvironments: AccountEnvironmentPorts["births"] = {
  unhardened: () => unhardenedBirths(host().store.ledger().births),
  subscribe: (listener) => host().store.subscribe(listener),
  promote: promoteBirth,
};

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

/**
 * The creations under way in the organization in view that know their group, as the group tree
 * places them (`deriveZeropsGroups`' `births`) — the projects page and the left menu read this one
 * mapping, so the two draw the same pending members. A birth begun on a project already listed
 * (Set up Mate, a claim) places nothing: the listing places it.
 */
export function placedBirthsIn(
  births: ReadonlyArray<BirthRecord>,
  organizationId: string | undefined,
): ReadonlyArray<ZeropsPlacedBirth> {
  return births.flatMap(
    ({ projectId, organizationId: bornIn, startedAt, placement, step, overdue }) =>
      placement === null || organizationId === undefined || bornIn !== organizationId
        ? []
        : [{ projectId, startedAt, placement, step, overdue }],
  );
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
