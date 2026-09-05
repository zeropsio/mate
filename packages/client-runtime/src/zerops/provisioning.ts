/**
 * "Preparing your project" — the wait between a pool claim and a container
 * that answers.
 *
 * A pure state machine plus one read function, so the whole wait is testable
 * against a fake clock. Three rules it exists to enforce:
 *
 * 1. Prefer direct reads. `GET /client/{id}/project` and
 *    `GET /project/{id}/service-stack` are lag-free. A restricted
 *    Developer/Guest membership cannot call the client-wide read, so
 *    `listAccessibleClientProjects` falls back to the GUI's permission-filtered
 *    search and the poll naturally absorbs its short indexing delay.
 * 2. Absence is never a verdict. A just-claimed project's service list is
 *    briefly empty; that is a reason to keep waiting, not "there is no
 *    container".
 * 3. Every wait says what it is waiting for and how long it will wait, and a
 *    cap that runs out leaves a retryable state rather than an error.
 */

import type { ZeropsApiClient, ZeropsProject, ZeropsService } from "./api.ts";

import { deriveZeropsCandidates } from "./candidates.ts";

/** What a `/healthz` probe concluded about a container. */
export type ZeropsContainerHealth = "ready" | "initializing" | "predates-mate" | "unreachable";

export type ProvisioningPhase =
  | "awaiting-project"
  | "awaiting-container"
  | "awaiting-health"
  | "needs-enable"
  | "ready"
  | "timed-out"
  | "pool-exhausted"
  /**
   * A restart was already tried and the container still predates Zerops
   * Code: the zcp release running there simply does not carry it yet, so
   * offering Enable again would only restart it into the same state.
   */
  | "not-yet-available";

/**
 * How long each wait is given. The container cap matches the platform GUI's
 * own provisioning timeout; the health cap covers a restart's ~19 s to
 * `mateUp` with room to spare.
 */
export const PROVISIONING_CAPS = {
  "awaiting-project": 60_000,
  "awaiting-container": 300_000,
  "awaiting-health": 30_000,
} as const;

type WaitingPhase = keyof typeof PROVISIONING_CAPS;

function isWaitingPhase(phase: ProvisioningPhase): phase is WaitingPhase {
  return phase in PROVISIONING_CAPS;
}

/** Whether this state is still waiting on something, and so worth polling. */
export function isProvisioningWaiting(state: ProvisioningState): boolean {
  return isWaitingPhase(state.phase);
}

const WAITING_LABELS: Readonly<Record<WaitingPhase, string>> = {
  "awaiting-project": "Waiting for your project to appear",
  "awaiting-container": "Waiting for the Zerops Mate container to start",
  "awaiting-health": "Waiting for Zerops Mate to answer",
};

export interface ProvisioningState {
  readonly phase: ProvisioningPhase;
  /** What this state is waiting for, in the words the panel shows. */
  readonly waitingFor: string;
  /** How long this wait is given, or null when nothing is being waited on. */
  readonly capMs: number | null;
  /** When the current phase began, so each cap is measured from its own start. */
  readonly phaseStartedAtMs: number;
  readonly projectId: string | null;
  readonly containerServiceId: string | null;
  readonly containerOrigin: string | null;
  /** Set on `timed-out`: which wait ran out. */
  readonly expiredPhase: WaitingPhase | null;
  /** Why the current wait is still going, when the platform said something useful. */
  readonly detail: string | null;
  /** True once the user has asked for the container to be restarted this wait. */
  readonly enabled: boolean;
}

export type ProvisioningEvent =
  | { readonly kind: "projects"; readonly projects: ReadonlyArray<ZeropsProject> }
  | {
      readonly kind: "services";
      readonly project: ZeropsProject;
      readonly services: ReadonlyArray<ZeropsService>;
    }
  | { readonly kind: "health"; readonly health: ZeropsContainerHealth }
  | { readonly kind: "tick" }
  | { readonly kind: "retry" }
  /** The user asked for the older container to be restarted into Zerops Mate. */
  | { readonly kind: "enable" };

function waiting(
  phase: WaitingPhase,
  nowMs: number,
  carry: Partial<ProvisioningState> = {},
): ProvisioningState {
  return {
    projectId: null,
    containerServiceId: null,
    containerOrigin: null,
    detail: null,
    enabled: false,
    ...carry,
    phase,
    waitingFor: WAITING_LABELS[phase],
    capMs: PROVISIONING_CAPS[phase],
    phaseStartedAtMs: nowMs,
    expiredPhase: null,
  };
}

function settled(
  state: ProvisioningState,
  phase: "needs-enable" | "ready" | "pool-exhausted" | "not-yet-available",
  waitingFor: string,
  nowMs: number,
): ProvisioningState {
  return {
    ...state,
    phase,
    waitingFor,
    capMs: null,
    phaseStartedAtMs: nowMs,
    expiredPhase: null,
  };
}

/**
 * `zcpClaimed` comes straight from the registration response. Absent means the
 * signup was not pool-aware — which for our own request cannot happen, and
 * which the platform documents as "claimed", so absence is not treated as a
 * refusal.
 */
export function startProvisioning(input: {
  readonly zcpClaimed?: boolean;
  readonly nowMs: number;
}): ProvisioningState {
  if (input.zcpClaimed === false) {
    return {
      phase: "pool-exhausted",
      waitingFor: "No ready project was available",
      capMs: null,
      phaseStartedAtMs: input.nowMs,
      projectId: null,
      containerServiceId: null,
      containerOrigin: null,
      expiredPhase: null,
      detail: null,
      enabled: false,
    };
  }
  return waiting("awaiting-project", input.nowMs);
}

/**
 * Starts at the health wait for a container the caller already knows about —
 * the picker path, where a project and its container exist and the only
 * question is whether Zerops Mate answers on it.
 */
export function startProvisioningForContainer(input: {
  readonly projectId: string;
  readonly serviceId: string | null;
  readonly containerOrigin: string;
  readonly nowMs: number;
}): ProvisioningState {
  return waiting("awaiting-health", input.nowMs, {
    projectId: input.projectId,
    containerServiceId: input.serviceId,
    containerOrigin: input.containerOrigin,
  });
}

/**
 * Starts at the container wait for a project the caller just created — the
 * environment-creation path, where the project id is known the moment the
 * platform answers, and following "the newest project on the account" would
 * be guessing at something already in hand.
 */
export function startProvisioningForProject(input: {
  readonly projectId: string;
  readonly nowMs: number;
}): ProvisioningState {
  return waiting("awaiting-container", input.nowMs, { projectId: input.projectId });
}

function newestProject(projects: ReadonlyArray<ZeropsProject>): ZeropsProject | undefined {
  // A claim hands over a brand-new project, so on an account that already had
  // one the newest row is the one to follow.
  return [...projects].sort((left, right) =>
    (right.created ?? "").localeCompare(left.created ?? ""),
  )[0];
}

export function advanceProvisioning(
  state: ProvisioningState,
  event: ProvisioningEvent,
  nowMs: number,
): ProvisioningState {
  if (event.kind === "retry") {
    const phase = state.expiredPhase ?? "awaiting-project";
    return waiting(phase, nowMs, {
      projectId: state.projectId,
      containerServiceId: state.containerServiceId,
      containerOrigin: state.containerOrigin,
      // A retry must not forget an enable already tried this wait — otherwise
      // a retry-into-predates-mate loop would offer Enable again forever.
      enabled: state.enabled,
    });
  }

  if (event.kind === "enable") {
    if (state.phase !== "needs-enable") return state;
    // A restart re-runs the container's install step, so the wait that follows
    // is the ordinary health wait with its clock started again.
    return waiting("awaiting-health", nowMs, {
      projectId: state.projectId,
      containerServiceId: state.containerServiceId,
      containerOrigin: state.containerOrigin,
      detail: "The container is restarting",
      enabled: true,
    });
  }

  if (event.kind === "tick") {
    if (!isWaitingPhase(state.phase)) return state;
    if (nowMs - state.phaseStartedAtMs <= PROVISIONING_CAPS[state.phase]) return state;
    return { ...state, phase: "timed-out", expiredPhase: state.phase };
  }

  if (event.kind === "projects" && state.phase === "awaiting-project") {
    const project = newestProject(event.projects);
    if (!project) return state;
    return waiting("awaiting-container", nowMs, { projectId: project.id });
  }

  if (event.kind === "services" && state.phase === "awaiting-container") {
    // The candidate derivation already knows how to find a zcp container by
    // type and how to build its origin — including every reason it is not
    // usable yet, which becomes the wait's detail line.
    const candidates = deriveZeropsCandidates(event.project, event.services, new Map());
    const usable = candidates.find((candidate) => candidate.containerOrigin);
    if (!usable?.containerOrigin) {
      return { ...state, detail: candidates[0]?.reason ?? null };
    }
    return waiting("awaiting-health", nowMs, {
      projectId: event.project.id,
      containerServiceId: usable.service?.id ?? null,
      containerOrigin: usable.containerOrigin,
    });
  }

  if (event.kind === "health" && state.phase === "awaiting-health") {
    if (event.health === "ready") {
      return settled(state, "ready", "Zerops Mate is ready", nowMs);
    }
    if (event.health === "predates-mate") {
      // A restart was already tried this wait and the container still
      // predates Zerops Mate: it is not a stale container, it is a zcp
      // release that does not carry mate yet — restarting again changes nothing.
      if (state.enabled) {
        return settled(
          state,
          "not-yet-available",
          "Zerops Mate is not part of this container's zcp release yet",
          nowMs,
        );
      }
      return settled(state, "needs-enable", "This container is not serving Zerops Mate", nowMs);
    }
    // `initializing` and `unreachable` both mean "not yet" — an unreachable
    // container mid-restart answers 502 through the platform balancer.
    return {
      ...state,
      detail: event.health === "unreachable" ? "The container is restarting" : null,
    };
  }

  return state;
}

/**
 * Issues the one read the current phase needs, and returns it as an event.
 * A settled phase reads nothing and answers with a bare tick, so a caller can
 * poll unconditionally.
 */
export async function readProvisioning(input: {
  readonly client: ZeropsApiClient;
  readonly clientId: string;
  readonly state: ProvisioningState;
  readonly probeHealth: (origin: string) => Promise<ZeropsContainerHealth>;
}): Promise<ProvisioningEvent> {
  const { client, clientId, state, probeHealth } = input;

  if (state.phase === "awaiting-project") {
    return { kind: "projects", projects: await client.listAccessibleClientProjects(clientId) };
  }

  if (state.phase === "awaiting-container" && state.projectId) {
    // The project is re-read too: its own status and subdomain host decide
    // whether a container origin can be built at all.
    const [project, services] = await Promise.all([
      client.fetchProject(state.projectId),
      client.listProjectServices(state.projectId),
    ]);
    return { kind: "services", project, services };
  }

  if (state.phase === "awaiting-health" && state.containerOrigin) {
    return { kind: "health", health: await probeHealth(state.containerOrigin) };
  }

  return { kind: "tick" };
}
