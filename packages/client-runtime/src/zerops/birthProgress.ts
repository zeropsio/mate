/**
 * "Coming up. A few minutes." — the one static line the projects screen shows
 * for 2–3 minutes while a freshly created project comes to life. This turns
 * the facts the client already holds about that birth into an ordered
 * **checklist**, the way the Zerops web app shows a service's own creation
 * (per-entity statuses, running/finished processes) and a build's five-step
 * pipeline, instead of one sentence.
 *
 * Measured platform order, a real wizard birth (2026-09-22): the project
 * reads ACTIVE at +25s; the zcp service goes NEW → READY_TO_DEPLOY (+25s) →
 * CREATING (+53s) → ACTIVE with an origin (+97s); `stack.build` RUNNING
 * (+93s) → FINISHED (+95s); `stack.enableSubdomainAccess` FINISHED (+100s);
 * Mate listening (+109s), first connect (+160s). `stack.create`,
 * `stack.build` and `stack.enableSubdomainAccess` all begin at the
 * container's own T0, so `public-access`'s own active condition is gated on
 * `container` being done — required to keep true the invariant that at most
 * one step is ever active. The project is closed off in the press, before any
 * of these begins, so no step waits on it.
 *
 * A project's build helper service (named `build<serviceName>...`) is not
 * the Mate's own container; a caller resolving `BirthFacts.container` from a
 * raw service list must exclude it before handing facts here. This module
 * only ever sees the one already-resolved container, so a process fact
 * naming the build helper's id alongside the container's own in
 * `serviceIds` (measured: `stack.build` carries both) is harmless — matching
 * "targets the container" only ever requires the container's id to be one of
 * the ids listed, extra ids or not.
 *
 * A step's `done`/`failed` never requires its predecessor's state — the
 * inventory flaps a creating project between buckets, so a later step can be
 * true on its own facts before an earlier one's read has caught up.
 * `deriveBirthProgress` backfills for that (earlier steps forced `done` once
 * a later one is `done`/`active`) and then truncates forward from the first
 * `failed` step (later steps forced back to `waiting`) — never a clock, never
 * I/O, `nowMs` used only for the sub-step durations `observedSteps` derives.
 *
 * @module birthProgress
 */

import type { ZeropsService } from "./api.ts";
import type { ProcessStatus } from "./data/types.ts";
import type { ActivityAppVersion } from "./activity/dto.ts";
import { type ObservedStep, observedSteps } from "./activity/observedSteps.ts";
import type { MateSetupRuntimesState } from "./mateSetup.ts";
import type { ZeropsContainerHealth } from "./containerHealth.ts";
import type { RecipeRuntime, RecipeRuntimeRole } from "./recipeTier.ts";
import { isManagedDataService, isRuntimeService } from "./topology.ts";

export interface BirthProcessFact {
  readonly actionName: string;
  readonly status: ProcessStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly serviceIds: ReadonlyArray<string>;
  readonly appVersion?: ActivityAppVersion | undefined;
  readonly failReason?: string | undefined;
}

export interface BirthFacts {
  /** undefined = the project is not in the inventory yet. */
  readonly project: { readonly status: string; readonly createdAt?: string } | undefined;
  /** The platform said it could not create the project (candidate.creationFailed). */
  readonly creationFailed?: { readonly message?: string } | undefined;
  /** The Mate's zcp service, once it exists. */
  readonly container:
    | {
        readonly serviceId: string;
        readonly status: string;
        readonly hasOrigin: boolean;
      }
    | undefined;
  /** Every process of the project the client has seen: running and finished. */
  readonly processes: ReadonlyArray<BirthProcessFact>;
  /** The container's health probe; undefined = not probed/answered yet. */
  readonly health: ZeropsContainerHealth | undefined;
  readonly connection: "none" | "connecting" | "connected" | "failed";
  /** When this client started the creation (the hand-off), ISO — the fallback start. */
  readonly requestedAt?: string | undefined;
  /** The tier's runtimes, for a Mate that brings some up ({@link birthRuntimesFacts}). */
  readonly runtimes?: BirthRuntimesFacts | undefined;
}

/** One runtime a Mate brings up after closing its project off. */
export interface BirthRuntimeFact {
  readonly hostname: string;
  readonly role: RecipeRuntimeRole;
  /** The service, once the project lists it. */
  readonly service?: { readonly id: string; readonly status: string };
}

export interface BirthRuntimesFacts {
  /**
   * Where zcp's import of them stands: `waiting` until it begins, `importing` while
   * the birth asks for it, `imported` once the platform took it, or the platform's words for why
   * it did not.
   */
  readonly import: "waiting" | "importing" | "imported" | { readonly failed: string };
  /** By hostname. */
  readonly runtimes: ReadonlyArray<BirthRuntimeFact>;
}

export type BirthStepId = "project" | "container" | "public-access" | "mate" | "connect";
export type BirthStepState = "waiting" | "active" | "done" | "failed";

export interface BirthStep {
  readonly id: BirthStepId;
  readonly label: string;
  readonly state: BirthStepState;
  /** A person-readable sentence for the active or failed step. */
  readonly detail?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** The container's build pipeline sub-steps, when a `stack.build` with an appVersion is known. */
  readonly substeps?: ReadonlyArray<ObservedStep>;
}

export interface BirthProgress {
  readonly steps: ReadonlyArray<BirthStep>;
  readonly active: BirthStep | null;
  readonly failed: BirthStep | null;
  readonly doneCount: number;
  readonly total: number;
  readonly complete: boolean;
  /** Earliest known start: project.create's createdAt, else project.createdAt, else requestedAt. */
  readonly startedAt?: string;
  /**
   * The Mate's runtimes, a track of their own beside the six steps: they come up while the Mate
   * answers and is signed in, so nothing in the steps waits on them. Absent for a Mate that
   * brings none up.
   */
  readonly runtimes?: BirthRuntimesProgress;
}

export interface BirthRuntimeProgress {
  readonly hostname: string;
  readonly role: RecipeRuntimeRole;
  /** `done` once up: running, or — a stage half — waiting for its first deploy. */
  readonly state: BirthStepState;
}

export interface BirthRuntimesProgress {
  readonly state: BirthStepState;
  /** A person-readable sentence for the active or failed track. */
  readonly detail?: string;
  /** How many are up, of `total`. */
  readonly up: number;
  readonly total: number;
  readonly runtimes: ReadonlyArray<BirthRuntimeProgress>;
}

const STEP_LABEL: Readonly<Record<BirthStepId, string>> = {
  project: "Project",
  container: "Container",
  "public-access": "Public access",
  mate: "Zerops Mate",
  connect: "Opening",
};

function isPendingOrRunning(status: ProcessStatus): boolean {
  return status === "PENDING" || status === "RUNNING";
}

function isFailedOrCanceled(status: ProcessStatus): boolean {
  return status === "FAILED" || status === "CANCELED";
}

function isFinished(status: ProcessStatus): boolean {
  return status === "FINISHED";
}

function newestByCreatedAt(
  processes: ReadonlyArray<BirthProcessFact>,
): BirthProcessFact | undefined {
  return [...processes].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function findNewest(
  processes: ReadonlyArray<BirthProcessFact>,
  actionName: string,
): BirthProcessFact | undefined {
  return newestByCreatedAt(processes.filter((process) => process.actionName === actionName));
}

function tsOf(process: BirthProcessFact | undefined): { startedAt?: string; endedAt?: string } {
  return {
    ...(process?.startedAt ? { startedAt: process.startedAt } : {}),
    ...(process?.finishedAt ? { endedAt: process.finishedAt } : {}),
  };
}

/** One step's own facts, before the chain-wide backfill/truncation pass. */
interface StepDraft {
  readonly state: BirthStepState;
  readonly detail?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly substeps?: ReadonlyArray<ObservedStep>;
}

function toStep(id: BirthStepId, draft: StepDraft): BirthStep {
  return {
    id,
    label: STEP_LABEL[id],
    state: draft.state,
    ...(draft.detail !== undefined ? { detail: draft.detail } : {}),
    ...(draft.startedAt !== undefined ? { startedAt: draft.startedAt } : {}),
    ...(draft.endedAt !== undefined ? { endedAt: draft.endedAt } : {}),
    ...(draft.substeps !== undefined ? { substeps: draft.substeps } : {}),
  };
}

const NOT_DONE_PROJECT_STATUSES: ReadonlySet<string> = new Set(["NEW", "CREATING"]);

function deriveProjectStep(facts: BirthFacts): StepDraft {
  const create = findNewest(facts.processes, "project.create");
  const timestamps = tsOf(create);

  if (
    facts.creationFailed !== undefined ||
    (create !== undefined && isFailedOrCanceled(create.status))
  ) {
    return {
      state: "failed",
      detail: facts.creationFailed?.message ?? create?.failReason ?? "Could not be created.",
      ...timestamps,
    };
  }

  const projectDone =
    (facts.project !== undefined && !NOT_DONE_PROJECT_STATUSES.has(facts.project.status)) ||
    (create !== undefined && isFinished(create.status));
  if (projectDone) {
    return { state: "done", ...timestamps };
  }

  return { state: "active", detail: "Creating the project", ...timestamps };
}

const CONTAINER_ACTIONS: ReadonlySet<string> = new Set([
  "stack.create",
  "stack.build",
  "stack.start",
  "stack.restart",
  "stack.deploy",
]);

const CONTAINER_ACTION_DETAIL: Readonly<Record<string, string>> = {
  "stack.create": "Creating the container",
  "stack.build": "Building the container",
  "stack.deploy": "Deploying the container",
  "stack.start": "Starting the container",
  "stack.restart": "Restarting the container",
};

/**
 * When nothing is actively running against the container, the service's own
 * status still says what it is doing — measured live: `READY_TO_DEPLOY` sits
 * between `NEW` and `CREATING` with no process behind it at all, and
 * `CREATING` itself runs for tens of seconds before `stack.create` ever
 * shows up as a process fact.
 */
const CONTAINER_STATUS_DETAIL: Readonly<Record<string, string>> = {
  READY_TO_DEPLOY: "Preparing the container",
  CREATING: "Starting the container",
};

const CONTAINER_FAILED_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "ACTION_FAILED",
  "CONTAINER_FAILED",
]);

function containerRelevantProcesses(facts: BirthFacts): ReadonlyArray<BirthProcessFact> {
  const serviceId = facts.container?.serviceId;
  return facts.processes.filter(
    (process) =>
      CONTAINER_ACTIONS.has(process.actionName) &&
      (serviceId === undefined || process.serviceIds.includes(serviceId)),
  );
}

function deriveContainerStep(facts: BirthFacts, projectDone: boolean, nowMs: number): StepDraft {
  const relevant = containerRelevantProcesses(facts);
  const current = newestByCreatedAt(relevant);
  const timestamps = tsOf(current);
  const terminal =
    current !== undefined && (isFinished(current.status) || isFailedOrCanceled(current.status));
  // A terminal process cannot keep a stale pipeline slot running. Completed slots remain facts;
  // a slot with no terminal evidence is omitted rather than assigned an invented outcome.
  const substeps =
    current?.appVersion === undefined
      ? undefined
      : observedSteps(current.appVersion, nowMs).filter(
          (step) => !terminal || step.state !== "running",
        );
  const substepsField = substeps !== undefined && substeps.length > 0 ? { substeps } : {};

  const failedProcess =
    current !== undefined &&
    (isFailedOrCanceled(current.status) || substeps?.some((step) => step.state === "failed"))
      ? current
      : undefined;
  const serviceFailed =
    facts.container !== undefined && CONTAINER_FAILED_STATUSES.has(facts.container.status);
  if (
    failedProcess !== undefined ||
    (serviceFailed && (current === undefined || !isPendingOrRunning(current.status)))
  ) {
    return {
      state: "failed",
      detail: failedProcess?.failReason ?? "Could not be created.",
      ...timestamps,
      ...substepsField,
    };
  }

  const running = relevant.filter((process) => isPendingOrRunning(process.status));
  if (facts.container?.status === "ACTIVE" && running.length === 0) {
    return { state: "done", ...timestamps, ...substepsField };
  }

  if (!projectDone) {
    return { state: "waiting" };
  }

  if (current !== undefined && isFinished(current.status)) {
    return { state: "waiting", ...timestamps, ...substepsField };
  }

  const newestRunning = newestByCreatedAt(running);
  const detail =
    newestRunning !== undefined
      ? (CONTAINER_ACTION_DETAIL[newestRunning.actionName] ?? "Waiting for the container")
      : (CONTAINER_STATUS_DETAIL[facts.container?.status ?? ""] ?? "Waiting for the container");

  return { state: "active", detail, ...timestamps, ...substepsField };
}

function derivePublicAccessStep(facts: BirthFacts, containerDone: boolean): StepDraft {
  const serviceId = facts.container?.serviceId;
  const enable = newestByCreatedAt(
    facts.processes.filter(
      (process) =>
        process.actionName === "stack.enableSubdomainAccess" &&
        (serviceId === undefined || process.serviceIds.includes(serviceId)),
    ),
  );
  const timestamps = tsOf(enable);

  if (enable !== undefined && isFailedOrCanceled(enable.status)) {
    return {
      state: "failed",
      detail: enable.failReason ?? "Could not open public access.",
      ...timestamps,
    };
  }

  const enableRunning = enable !== undefined && isPendingOrRunning(enable.status);
  if (facts.container?.hasOrigin === true && !enableRunning) {
    return { state: "done", ...timestamps };
  }

  if (!containerDone) {
    return { state: "waiting" };
  }

  if (
    enableRunning ||
    (facts.container?.status === "ACTIVE" && facts.container.hasOrigin === false)
  ) {
    return { state: "active", detail: "Opening public access", ...timestamps };
  }

  return { state: "waiting" };
}

function deriveMateStep(facts: BirthFacts, predecessorsDone: boolean): StepDraft {
  const health = facts.health;

  if (health === "stalled") {
    return { state: "failed", detail: "Zerops Mate never answered" };
  }

  if (health === "ready" || facts.connection === "connecting" || facts.connection === "connected") {
    return { state: "done" };
  }

  if (!predecessorsDone) {
    return { state: "waiting" };
  }

  return {
    state: "active",
    detail:
      health === "predates-mate"
        ? "This container predates Zerops Mate"
        : "Waiting for Zerops Mate to answer",
  };
}

function deriveConnectStep(facts: BirthFacts, mateDone: boolean): StepDraft {
  if (facts.connection === "failed") {
    return { state: "failed", detail: "Could not open the Mate." };
  }
  if (facts.connection === "connected") {
    return { state: "done" };
  }
  if (!mateDone) {
    return { state: "waiting" };
  }
  return { state: "active", detail: "Opening the Mate" };
}

/**
 * The steps whose being done proves every step before it is done too: a
 * container runs only in a project that exists, and a Mate that answers or
 * is open runs in a container that is up and reachable. Public access proves
 * nothing about the container, so it never backfills.
 */
const PROOF_STEPS: ReadonlySet<BirthStepId> = new Set(["container", "mate", "connect"]);

/**
 * Forces every step before a proving `done` one to `done` — the inventory
 * flaps a creating project between buckets, and progress must never go
 * backwards. A later step merely `active` proves nothing (a wait phase can
 * run ahead of the processes), so it never backfills either.
 */
function backfill(steps: ReadonlyArray<BirthStep>): BirthStep[] {
  const next = [...steps];
  for (let i = next.length - 2; i >= 0; i--) {
    const step = next[i]!;
    if (step.state === "failed" || step.state === "done") continue;
    const laterDone = next
      .slice(i + 1)
      .some((later) => later.state === "done" && PROOF_STEPS.has(later.id));
    if (laterDone) {
      const { detail: _detail, ...rest } = step;
      next[i] = { ...rest, state: "done" };
    }
  }
  return next;
}

/** A failed step stops the chain: everything after it goes back to `waiting`. */
function truncateAfterFailure(steps: ReadonlyArray<BirthStep>): BirthStep[] {
  const failedIndex = steps.findIndex((step) => step.state === "failed");
  if (failedIndex === -1) return [...steps];
  return steps.map((step, index) =>
    index <= failedIndex ? step : { id: step.id, label: step.label, state: "waiting" as const },
  );
}

function governingStartedAt(facts: BirthFacts): string | undefined {
  const create = findNewest(facts.processes, "project.create");
  return create?.createdAt ?? facts.project?.createdAt ?? facts.requestedAt;
}

/** The actions whose failure leaves a runtime without what it runs. */
const RUNTIME_ACTIONS: ReadonlySet<string> = new Set([
  "stack.create",
  "stack.build",
  "stack.deploy",
  "stack.start",
]);

const RUNTIME_FAILED_STATUSES: ReadonlySet<string> = new Set([
  ...CONTAINER_FAILED_STATUSES,
  "REPAIR_FAILED",
]);

function runtimeState(
  runtime: BirthRuntimeFact,
  imported: boolean,
  processes: ReadonlyArray<BirthProcessFact>,
): BirthStepState {
  const service = runtime.service;
  if (service === undefined) return imported ? "active" : "waiting";
  // A stage half rests at READY_TO_DEPLOY until its first deploy; everything else runs.
  if (
    service.status === "ACTIVE" ||
    (runtime.role === "stage" && service.status === "READY_TO_DEPLOY")
  ) {
    return "done";
  }
  // A build that fails leaves its service waiting at READY_TO_DEPLOY for good: the process says so.
  const newest = newestByCreatedAt(
    processes.filter(
      (process) =>
        RUNTIME_ACTIONS.has(process.actionName) && process.serviceIds.includes(service.id),
    ),
  );
  if (
    RUNTIME_FAILED_STATUSES.has(service.status) ||
    (newest !== undefined && isFailedOrCanceled(newest.status))
  ) {
    return "failed";
  }
  return "active";
}

function deriveRuntimes(
  facts: BirthRuntimesFacts,
  processes: ReadonlyArray<BirthProcessFact>,
): BirthRuntimesProgress {
  const imported = facts.import === "imported";
  const runtimes = facts.runtimes.map((runtime) => ({
    hostname: runtime.hostname,
    role: runtime.role,
    state: runtimeState(runtime, imported, processes),
  }));
  const counts = { up: runtimes.filter((runtime) => runtime.state === "done").length };
  const base = { ...counts, total: runtimes.length, runtimes };
  if (typeof facts.import === "object") {
    return { ...base, state: "failed", detail: facts.import.failed };
  }
  if (facts.import === "waiting") return { ...base, state: "waiting" };
  if (facts.import === "importing") {
    return { ...base, state: "active", detail: "Adding the runtimes" };
  }
  const failed = runtimes.filter((runtime) => runtime.state === "failed");
  if (failed.length > 0) {
    const names = failed.map((runtime) => runtime.hostname).join(", ");
    return { ...base, state: "failed", detail: `${names} did not come up.` };
  }
  if (counts.up === runtimes.length) return { ...base, state: "done" };
  return { ...base, state: "active", detail: "Bringing the runtimes up" };
}

/** Where zcp's import of the runtimes stands, as the Mate's setup says it. */
const IMPORT_BY_SETUP: Readonly<
  Record<
    Exclude<MateSetupRuntimesState, "none" | "unknown" | "failed">,
    BirthRuntimesFacts["import"]
  >
> = {
  waiting: "waiting",
  running: "importing",
  done: "imported",
};

/** The setup says no more than that it failed: the words are the app's. */
export const RUNTIMES_IMPORT_FAILED = "The runtimes could not be added.";

/**
 * The runtimes' facts, from what the Mate's view holds: the runtimes the press planned, where zcp's
 * import of them stands (`/mate/setup.json`'s `runtimes`), and the project's services as the
 * inventory lists them. Without a plan — another browser, a reload, a Mate made before — they are
 * read off the project's own runtimes, a stage half by zcp's `stage` suffix. Undefined for a Mate
 * that brings none up, or a project not read yet.
 */
export function birthRuntimesFacts(input: {
  /** What this tab's press planned; undefined where it holds no press. */
  readonly planned?: ReadonlyArray<RecipeRuntime> | undefined;
  /** zcp's import as the Mate's setup reports it; undefined before the Mate answers it. */
  readonly setup?: MateSetupRuntimesState | undefined;
  readonly services: ReadonlyArray<ZeropsService> | undefined;
}): BirthRuntimesFacts | undefined {
  const services = input.services ?? [];
  if (input.setup === "none") return undefined;
  const serviceOf = (hostname: string): Pick<BirthRuntimeFact, "service"> => {
    const listed = services.find((service) => service.name === hostname);
    return listed === undefined ? {} : { service: { id: listed.id, status: listed.status } };
  };
  const reported: BirthRuntimesFacts["import"] | undefined =
    input.setup === undefined || input.setup === "unknown"
      ? undefined
      : input.setup === "failed"
        ? { failed: RUNTIMES_IMPORT_FAILED }
        : IMPORT_BY_SETUP[input.setup];
  if (input.planned !== undefined && input.planned.length > 0) {
    return {
      import: reported ?? "waiting",
      // By hostname, as its project's own read gives them after it: one order on every surface.
      runtimes: [...input.planned]
        .sort((left, right) => left.hostname.localeCompare(right.hostname))
        .map((runtime) => ({ ...runtime, ...serviceOf(runtime.hostname) })),
    };
  }
  // The listing's order is its own and changes between reads: by hostname, it reads the same.
  const runtimes = services
    .filter((service) => service.isSystem !== true && isRuntimeService(service))
    .sort(byName);
  if (runtimes.length === 0) return undefined;
  return {
    import: reported ?? "imported",
    runtimes: runtimes.map((service) => ({
      hostname: service.name,
      role: service.name.endsWith("stage") ? "stage" : "dev",
      service: { id: service.id, status: service.status },
    })),
  };
}

const byName = (left: { readonly name: string }, right: { readonly name: string }) =>
  left.name.localeCompare(right.name);

/** One managed service of a Mate's copy of the project, as far as it has come. */
export interface BirthCopyService {
  readonly hostname: string;
  readonly state: BirthStepState;
}

function copyServiceState(service: { readonly status: string } | undefined): BirthStepState {
  if (service === undefined) return "waiting";
  if (service.status === "ACTIVE" || service.status === "RUNNING") return "done";
  return RUNTIME_FAILED_STATUSES.has(service.status) ? "failed" : "active";
}

/**
 * The managed services a Mate's copy of the project brings — what the project's first import
 * waits on: the ones its birth planned, in the tier's order, from the press; once its birth is
 * over, its project's own, by hostname. Undefined where it brings none, or the project is not
 * read yet.
 */
export function birthCopyServices(input: {
  /** The hostnames its birth planned (`BirthRecord.managed`); undefined where no birth is held. */
  readonly planned: ReadonlyArray<string> | undefined;
  readonly services: ReadonlyArray<ZeropsService> | undefined;
}): ReadonlyArray<BirthCopyService> | undefined {
  const services = input.services ?? [];
  const copy =
    input.planned !== undefined
      ? input.planned.map((hostname) => ({
          hostname,
          state: copyServiceState(services.find((service) => service.name === hostname)),
        }))
      : services
          .filter((service) => service.isSystem !== true && isManagedDataService(service))
          .sort(byName)
          .map((service) => ({ hostname: service.name, state: copyServiceState(service) }));
  return copy.length === 0 ? undefined : copy;
}

export function deriveBirthProgress(facts: BirthFacts, nowMs: number): BirthProgress {
  const project = deriveProjectStep(facts);
  const container = deriveContainerStep(facts, project.state === "done", nowMs);
  const publicAccess = derivePublicAccessStep(facts, container.state === "done");
  // The steps before it finish in no fixed order, so the Mate is waited on only once all of them
  // are. The project is closed off in the press, before any of them begins.
  const mate = deriveMateStep(facts, container.state === "done" && publicAccess.state === "done");
  const connect = deriveConnectStep(facts, mate.state === "done");

  const raw: BirthStep[] = [
    toStep("project", project),
    toStep("container", container),
    toStep("public-access", publicAccess),
    toStep("mate", mate),
    toStep("connect", connect),
  ];

  const steps = truncateAfterFailure(backfill(raw));

  const active = steps.find((step) => step.state === "active") ?? null;
  const failed = steps.find((step) => step.state === "failed") ?? null;
  const doneCount = steps.filter((step) => step.state === "done").length;
  const startedAt = governingStartedAt(facts);

  return {
    steps,
    active,
    failed,
    doneCount,
    total: steps.length,
    complete: steps[steps.length - 1]!.state === "done",
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(facts.runtimes === undefined
      ? {}
      : { runtimes: deriveRuntimes(facts.runtimes, facts.processes) }),
  };
}
