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
 * hardening's `stack.updateProjectEnvs` RUNNING (+100s) → FINISHED (+103s);
 * Mate listening (+109s), first connect (+160s). `stack.create`,
 * `stack.build` and `stack.enableSubdomainAccess` all begin at the
 * container's own T0, so `public-access`'s own active condition is gated on
 * `container` being done — not stated as a separate clause in the source
 * rules, but required to keep true the invariant that at most one step is
 * ever active. `hardening` is gated the same way: `awaiting-settled` begins
 * the moment the container merely exists (measured: the build still queued),
 * so only the `hardening` phase itself, or `awaiting-settled`/no phase once
 * public access is done, makes it active. Three more
 * `stack.updateUserData` show up ~90s after hardening is already done
 * (+187…+202s) — that is the Git broker writing GITEA_TOKEN/MATE_BROKER_URL
 * ("Setting up its repositories…"), not hardening, so hardening keys only
 * off `stack.updateProjectEnvs`.
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
 * `hardening`'s own evidence (`provisioningPhase`, `stack.updateProjectEnvs`)
 * is absent whenever this tab's wait slot is not on the project — a second
 * tab, or a reload before the resume seeds one. Without a fallback, that
 * leaves both `hardening` and `mate` sitting on `waiting` once `public-access`
 * is done and before health answers: no step reads as active at all. So with
 * `provisioningPhase` null and `public-access` done, `hardening` reads
 * `active` on the absence of evidence rather than `waiting` on it.
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

import type { ProcessStatus } from "./data/types.ts";
import type { ActivityAppVersion } from "./activity/dto.ts";
import { type ObservedStep, observedSteps } from "./activity/observedSteps.ts";
import type { ProvisioningPhase, ZeropsContainerHealth } from "./provisioning.ts";

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
  /** The provisioning wait's phase, when this client's wait slot is on this project; null otherwise. */
  readonly provisioningPhase: ProvisioningPhase | null;
  /** The hardening's failure message, when provisioning reported one. */
  readonly hardenError?: string | undefined;
  readonly connection: "none" | "connecting" | "connected" | "failed";
  /** When this client started the creation (the hand-off), ISO — the fallback start. */
  readonly requestedAt?: string | undefined;
}

export type BirthStepId =
  | "project"
  | "container"
  | "public-access"
  | "hardening"
  | "mate"
  | "connect";
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
}

const STEP_LABEL: Readonly<Record<BirthStepId, string>> = {
  project: "Project",
  container: "Container",
  "public-access": "Public access",
  hardening: "Closing off",
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

function oldestByCreatedAt(
  processes: ReadonlyArray<BirthProcessFact>,
): BirthProcessFact | undefined {
  return [...processes].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
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
  "stack.deploy",
]);

const CONTAINER_ACTION_DETAIL: Readonly<Record<string, string>> = {
  "stack.create": "Creating the container",
  "stack.build": "Building the container",
  "stack.deploy": "Deploying the container",
  "stack.start": "Starting the container",
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
  const firstCreate = oldestByCreatedAt(
    relevant.filter((process) => process.actionName === "stack.create"),
  );
  const timestamps = tsOf(firstCreate);

  const failedProcess = relevant.find((process) => isFailedOrCanceled(process.status));
  const serviceFailed =
    facts.container !== undefined && CONTAINER_FAILED_STATUSES.has(facts.container.status);
  if (failedProcess !== undefined || serviceFailed) {
    return {
      state: "failed",
      detail: failedProcess?.failReason ?? "Could not be created.",
      ...timestamps,
    };
  }

  const newestBuild = newestByCreatedAt(
    relevant.filter(
      (process) => process.actionName === "stack.build" && process.appVersion !== undefined,
    ),
  );
  const substeps =
    newestBuild?.appVersion !== undefined
      ? observedSteps(newestBuild.appVersion, nowMs)
      : undefined;
  const substepsField = substeps !== undefined && substeps.length > 0 ? { substeps } : {};

  const running = relevant.filter((process) => isPendingOrRunning(process.status));
  if (facts.container?.status === "ACTIVE" && running.length === 0) {
    return { state: "done", ...timestamps, ...substepsField };
  }

  if (!projectDone) {
    return { state: "waiting" };
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

const HARDENING_DONE_PHASES: ReadonlySet<ProvisioningPhase> = new Set([
  "awaiting-health",
  "needs-enable",
  "ready",
]);

function deriveHardeningStep(facts: BirthFacts, publicAccessDone: boolean): StepDraft {
  // stack.updateUserData is NOT this step: measured live, the Git broker
  // fires three of them ~90s after hardening's own updateProjectEnvs has
  // already finished (GITEA_TOKEN/MATE_BROKER_URL, the group's "Setting up
  // its repositories…"). Keying hardening off it would reopen this step long
  // after it is actually done.
  const updateEnvs = findNewest(facts.processes, "stack.updateProjectEnvs");
  const timestamps = tsOf(updateEnvs);

  if (facts.hardenError !== undefined) {
    return { state: "failed", detail: facts.hardenError, ...timestamps };
  }

  const phase = facts.provisioningPhase;
  const updateEnvsFinished = updateEnvs !== undefined && isFinished(updateEnvs.status);
  if ((phase !== null && HARDENING_DONE_PHASES.has(phase)) || updateEnvsFinished) {
    return { state: "done", ...timestamps };
  }

  const processActive = updateEnvs !== undefined && isPendingOrRunning(updateEnvs.status);
  if (phase === "hardening" || processActive) {
    return { state: "active", detail: "Closing the project off", ...timestamps };
  }

  // `awaiting-settled` starts as soon as the container exists — its build
  // may not have begun — so it is this step only once public access is done;
  // before that the container and public-access steps carry the birth. The
  // same holds with no wait slot on this tab (a second tab, or a reload
  // before the resume seeds one): once public access is done the platform is
  // already into hardening, so absent evidence still reads as active rather
  // than leaving neither hardening nor mate showing anything.
  if ((phase === null || phase === "awaiting-settled") && publicAccessDone) {
    return { state: "active", detail: "Closing the project off" };
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
 * is open runs in a container that is up, reachable and closed off (B-1:
 * hardening precedes admission). Public access and closing off prove
 * nothing about the container — measured 2026-09-22, hardening finished at
 * +38 s while the container was still deploying — so they never backfill.
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

export function deriveBirthProgress(facts: BirthFacts, nowMs: number): BirthProgress {
  const project = deriveProjectStep(facts);
  const container = deriveContainerStep(facts, project.state === "done", nowMs);
  const publicAccess = derivePublicAccessStep(facts, container.state === "done");
  const hardening = deriveHardeningStep(facts, publicAccess.state === "done");
  // The steps before it finish in no fixed order (closing off can end before
  // the container is up), so the Mate is waited on only once all of them are.
  const mate = deriveMateStep(
    facts,
    container.state === "done" && publicAccess.state === "done" && hardening.state === "done",
  );
  const connect = deriveConnectStep(facts, mate.state === "done");

  const raw: BirthStep[] = [
    toStep("project", project),
    toStep("container", container),
    toStep("public-access", publicAccess),
    toStep("hardening", hardening),
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
  };
}
