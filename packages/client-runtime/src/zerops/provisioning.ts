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
 *
 * A birth's one closing-off (`../projectIsolation.ts`, spec-mate §3
 * B-1/B-2/B-3) happens here, in a `hardening` phase gated on a READ proof
 * that the platform is done creating — never a timer — and BEFORE anyone is
 * admitted: `awaiting-settled` (R1) waits for the container's own boot
 * process to report itself finished, so the harden step never races the
 * recipe that is still opening the project up; `hardening` (R2) is where it
 * runs. The Mate's own container is never restarted by it (server commit
 * 7d544119b: the Mate reads its own key live from the platform store, with
 * a retry on 401/403), so `awaiting-health` needs no proof a `ready`
 * verdict postdates anything — the container this wait is about was never
 * touched.
 */

import type { ZeropsProject, ZeropsService } from "./api.ts";

import { deriveZeropsCandidates } from "./candidates.ts";

/** What a `/healthz` probe concluded about a container. */
export type ZeropsContainerHealth =
  | "ready"
  | "initializing"
  | "predates-mate"
  | "unreachable"
  /** The container is up but Mate never answered. */
  | "stalled";

export type ProvisioningPhase =
  | "awaiting-project"
  | "awaiting-container"
  /** The container exists; waiting for its own boot process to finish before hardening it. */
  | "awaiting-settled"
  /** Closing the project's shared environment off — the birth's one restart. */
  | "hardening"
  | "awaiting-health"
  | "needs-enable"
  | "ready"
  | "pool-exhausted"
  /**
   * A restart was already tried and the container still predates Zerops
   * Code: the zcp release running there simply does not carry it yet, so
   * offering Enable again would only restart it into the same state.
   */
  | "not-yet-available";

/**
 * How long each capped wait is given. The container cap matches the
 * platform GUI's own provisioning timeout. The health cap is measured from
 * when the container's own restart/start process finishes running — not
 * from an arbitrary moment mid-boot — and gives Mate 90 s to answer from
 * there; while a process is still running against the container, this cap
 * does not elapse at all (`advanceProvisioning`'s "process" event resets
 * the clock).
 *
 * `awaiting-settled` and `hardening` carry no cap of their own (R1/R2): a
 * cap only changes the words a wait uses, never whether it may act — the
 * READ proof that the platform is done, not a clock, is what lets either
 * one move on.
 */
export const PROVISIONING_CAPS = {
  "awaiting-project": 60_000,
  "awaiting-container": 300_000,
  "awaiting-health": 90_000,
} as const;

type CappedWaitingPhase = keyof typeof PROVISIONING_CAPS;
/** Waiting phases with no cap: worth polling, but never time out on their own. */
type UncappedWaitingPhase = "awaiting-settled" | "hardening";
type WaitingPhase = CappedWaitingPhase | UncappedWaitingPhase;

const UNCAPPED_WAITING_PHASES: ReadonlySet<UncappedWaitingPhase> = new Set([
  "awaiting-settled",
  "hardening",
]);

function isWaitingPhase(phase: ProvisioningPhase): phase is WaitingPhase {
  return phase in PROVISIONING_CAPS || UNCAPPED_WAITING_PHASES.has(phase as UncappedWaitingPhase);
}

function capFor(phase: WaitingPhase): number | null {
  return phase in PROVISIONING_CAPS ? PROVISIONING_CAPS[phase as CappedWaitingPhase] : null;
}

/** Whether this state is still waiting on something, and so worth polling. */
export function isProvisioningWaiting(state: ProvisioningState): boolean {
  return isWaitingPhase(state.phase);
}

/** One label per phase this state machine can be in while waiting or acting. */
export const PROVISIONING_PHASE_LABELS: Readonly<Record<WaitingPhase, string>> = {
  "awaiting-project": "Waiting for your project to appear",
  "awaiting-container": "Waiting for the Zerops Mate container to start",
  "awaiting-settled": "Waiting for the container to finish coming up",
  hardening: "Closing the project off",
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
  /**
   * True once this phase's own cap has run out (B-2): words, not a stop.
   * The wait stays in its phase and keeps polling — a missed push still
   * resumes it — and "Keep waiting" only clears the flag and restarts the
   * cap's clock; "Stop waiting" is the caller cancelling outright.
   */
  readonly overdue: boolean;
  /** Why the current wait is still going, when the platform said something useful. */
  readonly detail: string | null;
  /** True once the user has asked for the container to be restarted this wait. */
  readonly enabled: boolean;
  /**
   * True while a platform process (a restart or a start) is known to be
   * running against the container. Only meaningful in `awaiting-health`: the
   * cap does not elapse while this is true, and finishing resets its clock.
   */
  readonly processRunning: boolean;
}

export type ProvisioningEvent =
  | { readonly kind: "projects"; readonly projects: ReadonlyArray<ZeropsProject> }
  | {
      readonly kind: "services";
      readonly project: ZeropsProject;
      readonly services: ReadonlyArray<ZeropsService>;
    }
  | {
      readonly kind: "health";
      readonly health: ZeropsContainerHealth;
      /**
       * Whether `ZCP_MATE_ENABLED` reads as on for this container — a read
       * fact (`ZeropsApiClient.isZeropsMateEnabled`), never inferred from
       * `health` alone: a browser cannot tell a pre-Mate container from one
       * merely away (spec-mate §4.5, H9). Consulted only when `health` is
       * `predates-mate`; absent is read the conservative way, as off, so a
       * caller that has not wired the read yet keeps today's behavior.
       */
      readonly mateEnabled?: boolean;
    }
  | { readonly kind: "tick" }
  | { readonly kind: "retry" }
  /** The user asked for the older container to be restarted into Zerops Mate. */
  | { readonly kind: "enable" }
  /**
   * The runtime's own knowledge of a process running against the container.
   * `observed` marks a reading actually backed by the activity feed — an
   * `awaiting-settled` wait leaves only on one, never on the mere absence of
   * a running process, which a feed that has not caught up would report the
   * same way as one that never started at all.
   */
  | { readonly kind: "process"; readonly running: boolean; readonly observed?: boolean }
  /** The harden step finished. */
  | { readonly kind: "hardened" }
  /** The harden step failed outright — not the retryable "read hasn't caught up" case. */
  | { readonly kind: "harden-failed"; readonly message: string };

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
    processRunning: false,
    overdue: false,
    ...carry,
    phase,
    waitingFor: PROVISIONING_PHASE_LABELS[phase],
    capMs: capFor(phase),
    phaseStartedAtMs: nowMs,
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
    overdue: false,
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
      overdue: false,
      detail: null,
      enabled: false,
      processRunning: false,
    };
  }
  return waiting("awaiting-project", input.nowMs);
}

/**
 * Starts at the health wait for a container the caller already knows about —
 * the picker path, where a project and its container exist and the only
 * question is whether Zerops Mate answers on it. This container has already
 * been through its birth (it is being picked from the projects list, not
 * just created), so it starts past hardening rather than repeating it.
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
    if (state.phase === "hardening") {
      // Not a wait that ran out — a real harden failure. Retrying re-enters
      // the same phase so the hook's harden effect, keyed on when the phase
      // began, tries again; it never re-runs `awaiting-settled`, whose READ
      // proof already stands.
      return { ...state, detail: null, phaseStartedAtMs: nowMs };
    }
    if (state.phase === "not-yet-available") {
      // A verdict this wait settled on, not a cap that ran out. "Keep
      // waiting" (H4/H5) asks the same question again rather than
      // restarting from scratch: the container it was about, and the
      // restart already tried against it, both survive.
      return waiting("awaiting-health", nowMs, {
        projectId: state.projectId,
        containerServiceId: state.containerServiceId,
        containerOrigin: state.containerOrigin,
        enabled: state.enabled,
      });
    }
    if (isWaitingPhase(state.phase)) {
      // B-2: a cap running out is words, never a stop. "Keep waiting" only
      // clears the flag and restarts this phase's own clock — the phase
      // itself, and everything it already knows, is untouched.
      return { ...state, overdue: false, phaseStartedAtMs: nowMs };
    }
    return state;
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

  if (event.kind === "process") {
    if (state.phase === "awaiting-settled") {
      // Leaves only on a proof the boot is over — never on the mere absence
      // of a running process, which an activity feed that has not caught up
      // reports the same way (R1).
      if (event.running === false && event.observed === true) {
        return {
          ...state,
          phase: "hardening",
          waitingFor: PROVISIONING_PHASE_LABELS.hardening,
          capMs: null,
          phaseStartedAtMs: nowMs,
          overdue: false,
          detail: null,
        };
      }
      return state;
    }
    if (state.phase !== "awaiting-health") return state;
    if (event.running) return { ...state, processRunning: true };
    // The window has not started until the process finishes: reset the
    // clock so the cap is measured from here, not from an arbitrary moment
    // mid-restart.
    if (!state.processRunning) return state;
    return { ...state, processRunning: false, phaseStartedAtMs: nowMs };
  }

  if (event.kind === "hardened") {
    if (state.phase !== "hardening") return state;
    return waiting("awaiting-health", nowMs, {
      projectId: state.projectId,
      containerServiceId: state.containerServiceId,
      containerOrigin: state.containerOrigin,
    });
  }

  if (event.kind === "harden-failed") {
    if (state.phase !== "hardening") return state;
    return { ...state, detail: event.message };
  }

  if (event.kind === "tick") {
    if (!isWaitingPhase(state.phase)) return state;
    if (state.phase === "awaiting-health" && state.processRunning) return state;
    if (state.overdue) return state;
    const cap = capFor(state.phase);
    if (cap === null) return state;
    if (nowMs - state.phaseStartedAtMs <= cap) return state;
    return { ...state, overdue: true };
  }

  if (event.kind === "projects" && state.phase === "awaiting-project") {
    const project = newestProject(event.projects);
    if (!project) return state;
    return waiting("awaiting-container", nowMs, { projectId: project.id });
  }

  if (
    event.kind === "services" &&
    (state.phase === "awaiting-container" || state.phase === "awaiting-settled")
  ) {
    // The candidate derivation already knows how to find a zcp container by
    // type and how to build its origin — including every reason it is not
    // usable yet, which becomes the wait's detail line.
    const candidates = deriveZeropsCandidates(event.project, event.services, new Map());
    const usable = candidates.find((candidate) => candidate.containerOrigin);
    if (!usable?.containerOrigin) {
      // A container already settling does not regress on a stale read: its
      // origin is kept, and only `awaiting-container` still waits bare.
      if (state.phase === "awaiting-settled") return state;
      return { ...state, detail: candidates[0]?.reason ?? null };
    }
    if (state.phase === "awaiting-settled") {
      return {
        ...state,
        projectId: event.project.id,
        containerServiceId: usable.service?.id ?? null,
        containerOrigin: usable.containerOrigin,
      };
    }
    return waiting("awaiting-settled", nowMs, {
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
      // The flag reads as on: this container is not a stale one waiting on
      // Enable, it is one mid-init — `ZCP_MATE_ENABLED` is the input zcp
      // keys every mate-shaped effect off, so an install that has not
      // finished yet answers exactly like a container that never had the
      // flag at all. Never a restart from this, only more waiting.
      if (event.mateEnabled === true) {
        return { ...state, detail: "Almost there." };
      }
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
 * poll unconditionally. `hardening` also reads nothing here: it acts through
 * a command the caller runs itself and reports back with `hardened` /
 * `harden-failed`, never through this function.
 */
export async function readProvisioning(input: {
  readonly state: ProvisioningState;
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly project: ZeropsProject | undefined;
  readonly services: ReadonlyArray<ZeropsService> | undefined;
  readonly probeHealth: (origin: string) => Promise<ZeropsContainerHealth>;
}): Promise<ProvisioningEvent> {
  const { state, probeHealth } = input;

  if (state.phase === "awaiting-project") {
    return { kind: "projects", projects: input.projects };
  }

  if (
    (state.phase === "awaiting-container" || state.phase === "awaiting-settled") &&
    state.projectId &&
    input.project?.id === state.projectId &&
    input.services !== undefined
  ) {
    return { kind: "services", project: input.project, services: input.services };
  }

  if (state.phase === "awaiting-health" && state.containerOrigin) {
    return { kind: "health", health: await probeHealth(state.containerOrigin) };
  }

  return { kind: "tick" };
}
