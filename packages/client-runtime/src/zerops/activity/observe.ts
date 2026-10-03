// @effect-diagnostics globalDate:off -- `new Date(ms).toISOString()` below formats an already-computed
// offset (pipelineStart − 5s), never a wall-clock read.
/**
 * What the platform says right now about a live operation — the
 * "Observation" layer of `../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md`
 * §3, §5. Computed fresh each time from one attribution read plus the
 * operation's own facts, so a reopened thread or a second client lands in
 * the right state on its first poll.
 *
 * Deliberately has no opinion about a landed tool result: "the result is the
 * verdict" is the card's rule, and whether to keep polling is the caller's
 * decision (`useOperationObservation.ts` §6) — this layer only ever answers
 * "what does the platform currently say".
 */
import type { ActivityAppVersion, ActivityProcess } from "./dto.ts";
import { type BuildLogQuery } from "./buildLog.ts";
import { type PipelineState, getPipelineState, pipelineTerminalOutcome } from "./pipelineState.ts";
import type { AttributionResult } from "./attribution.ts";

/**
 * The step source's pipeline as the platform last stated it. Its steps are
 * read where they are drawn, against that render's clock — a running step's
 * duration counts on between reads, and a quiet build goes minutes without
 * one.
 */
export interface ObservedPipeline {
  readonly appVersion: ActivityAppVersion;
  /** When the step source's process started — a deploy-only pipeline's deploy step starts there. */
  readonly startedAt?: string;
}

export interface Observation {
  /** Absent without a step source, or while its pipeline has no step to show. */
  readonly pipeline?: ObservedPipeline;
  /** Every attributed process but the step source — a secondary action in the same window (e.g. a subdomain toggle beside a deploy). */
  readonly chips: ReadonlyArray<ActivityProcess>;
  /** The step source's pipeline outcome, once settled. */
  readonly outcome?: "finished" | "failed" | "cancelled";
  /** When what this observation holds was last known current, epoch ms. */
  readonly readAtMs: number;
  /** Present once the step source's appVersion carries both an id and `build.serviceStackId`. */
  readonly buildLog?: BuildLogQuery;
  /** The services the step source names — which of a batch's services it is. */
  readonly serviceIds?: ReadonlyArray<string>;
}

/** Extracts the `off` variant's `reason` union, so both sides of the contract share one list. */
type ReasonOf<S> = S extends { readonly reason: infer R } ? R : never;

export type ObservationState =
  | {
      readonly kind: "off";
      readonly reason:
        | "no-session"
        | "no-target"
        | "ceiling"
        | "unauthorized"
        | "not-found"
        | "project-mismatch"
        | "feed-error"
        | "stale-timeout";
    }
  | { readonly kind: "observing"; readonly observation: Observation; readonly elapsedMs: number }
  | { readonly kind: "stale"; readonly observation: Observation; readonly ageMs: number };

export type ObservationOffReason = ReasonOf<ObservationState>;

const DEFAULT_CEILING_MS = 30 * 60 * 1000;
const STALE_AFTER_MS = 10_000;
const OFF_AFTER_MS = 60_000;

export interface ObservationInput {
  /** Session + target service id resolved. */
  readonly attributable: boolean;
  /** Server-stamped operation start time, epoch ms. */
  readonly startedAtMs: number;
  /** Per-operation ceiling, epoch ms since `startedAtMs`. Defaults to 30 minutes. */
  readonly ceilingMs?: number;
  /**
   * A reason supplied by the caller — why `attributable` is false
   * (`no-session`/`no-target`), or why the feed itself is off
   * (`unauthorized`/`not-found`/`project-mismatch`/`feed-error`). `ceiling`
   * and `stale-timeout` are computed here and never need to be passed in.
   */
  readonly unavailableReason?: ObservationOffReason;
  readonly lastRead?: {
    readonly attribution: AttributionResult;
    /**
     * When the attribution was last known current: the caller's now while the
     * feed observes (it pushes every change, so silence is news too), else
     * the last read — the age that turns an observation stale, then off.
     */
    readonly atMs: number;
  };
}

/** `undefined` appVersion.id + build.serviceStackId → no build log to offer. */
function buildLogFor(stepSource: ActivityProcess | undefined): BuildLogQuery | undefined {
  const appVersion = stepSource?.appVersion;
  const appVersionId = appVersion?.id;
  const buildServiceStackId = appVersion?.build?.serviceStackId;
  if (appVersionId === undefined || buildServiceStackId === undefined) {
    return undefined;
  }
  const pipelineStart = appVersion?.build?.pipelineStart;
  const pipelineStartMs = pipelineStart === undefined ? NaN : Date.parse(pipelineStart);
  const fromIso = Number.isNaN(pipelineStartMs)
    ? undefined
    : new Date(pipelineStartMs - 5_000).toISOString();
  return { buildServiceStackId, appVersionId, ...(fromIso === undefined ? {} : { fromIso }) };
}

/**
 * Terminal reading of one attributed process. A `deploy`/`import` step
 * source carries an appVersion, so its pipeline settles the outcome; a kind
 * with no appVersion at all (import's `stack.create`, subdomain, delete,
 * scale, manage) has no pipeline to read and must settle off the process's
 * own terminal status instead, or it never settles and ages into
 * `stale-timeout`.
 */
function outcomeFor(process: ActivityProcess): "finished" | "failed" | "cancelled" | undefined {
  if (process.status === "CANCELED") {
    return "cancelled";
  }
  const fromPipeline = pipelineTerminalOutcome(getPipelineState(process.appVersion));
  if (fromPipeline !== undefined) {
    return fromPipeline;
  }
  if (process.appVersion === undefined) {
    if (process.status === "FINISHED") {
      return "finished";
    }
    if (process.status === "FAILED") {
      return "failed";
    }
  }
  return undefined;
}

const PIPELINE_STEP_IDS: ReadonlyArray<keyof PipelineState> = [
  "INIT_BUILD_CONTAINER",
  "RUN_BUILD_COMMANDS",
  "INIT_PREPARE_CONTAINER",
  "RUN_PREPARE_COMMANDS",
  "DEPLOY",
];

/** A pipeline the platform reads as all `noop` (a status it has no step for) has nothing to show yet. */
function pipelineFor(stepSource: ActivityProcess | undefined): ObservedPipeline | undefined {
  const appVersion = stepSource?.appVersion;
  if (appVersion === undefined) {
    return undefined;
  }
  const state = getPipelineState(appVersion);
  if (PIPELINE_STEP_IDS.every((id) => state[id] === "noop")) {
    return undefined;
  }
  return {
    appVersion,
    ...(stepSource?.started === undefined ? {} : { startedAt: stepSource.started }),
  };
}

function observationFor(attribution: AttributionResult, atMs: number): Observation {
  const stepSource = attribution.stepSource;
  const pipeline = pipelineFor(stepSource);
  const outcome = stepSource === undefined ? undefined : outcomeFor(stepSource);
  const buildLog = buildLogFor(stepSource);
  return {
    ...(pipeline === undefined ? {} : { pipeline }),
    chips: attribution.chips,
    readAtMs: atMs,
    ...(outcome === undefined ? {} : { outcome }),
    ...(buildLog === undefined ? {} : { buildLog }),
    ...(stepSource === undefined ? {} : { serviceIds: stepSource.serviceStackIds }),
  };
}

export function observe(input: ObservationInput, nowMs: number): ObservationState {
  const ceilingMs = input.ceilingMs ?? DEFAULT_CEILING_MS;

  if (!input.attributable) {
    return { kind: "off", reason: input.unavailableReason ?? "no-target" };
  }

  if (nowMs - input.startedAtMs > ceilingMs) {
    return { kind: "off", reason: "ceiling" };
  }

  if (input.unavailableReason !== undefined) {
    return { kind: "off", reason: input.unavailableReason };
  }

  if (input.lastRead === undefined) {
    return {
      kind: "observing",
      observation: { chips: [], readAtMs: nowMs },
      elapsedMs: Math.max(0, nowMs - input.startedAtMs),
    };
  }

  const { attribution, atMs } = input.lastRead;
  const observation = observationFor(attribution, atMs);
  const elapsedMs = Math.max(0, nowMs - input.startedAtMs);

  // A settled pipeline never goes stale — the poller has already stopped
  // polling for exactly that reason, so the time-based rules below do not
  // apply once the outcome is known.
  if (observation.outcome !== undefined) {
    return { kind: "observing", observation, elapsedMs };
  }

  const ageMs = nowMs - atMs;
  if (ageMs > OFF_AFTER_MS) {
    return { kind: "off", reason: "stale-timeout" };
  }
  if (ageMs > STALE_AFTER_MS) {
    return { kind: "stale", observation, ageMs };
  }
  return { kind: "observing", observation, elapsedMs };
}

/**
 * How long after its start a card draws what the account store read of its operation: a
 * running one up to the ceiling; a settled one — read only by the ids its result named, once
 * per open (`readsOperation`) — whatever its age, so the same row shows the same details in any
 * window and after a reload.
 */
export function operationReadCeilingMs(
  operation: { readonly running: boolean; readonly exact: boolean },
  ceilingMs: number = DEFAULT_CEILING_MS,
): number {
  return !operation.running && operation.exact ? Number.POSITIVE_INFINITY : ceilingMs;
}

/**
 * What one open of a settled operation's card has read of it: its read of the project's newest
 * process history is pending, landed, or failed — then it says so and reads no more.
 */
export type SettledRead = "pending" | "read" | "failed";

/**
 * The next `SettledRead`, from where the project's newest process history read stands and
 * whether the store's read of the project failed. Once landed or failed it stays so for the
 * open: a failed read is never asked for again.
 */
export function settledReadAfter(
  previous: SettledRead,
  history: "unread" | "reading" | "read" | "failed",
  feedFailed: boolean,
): SettledRead {
  if (previous !== "pending") return previous;
  if (feedFailed || history === "failed") return "failed";
  return history === "read" ? "read" : "pending";
}

export interface OperationReadBound {
  readonly running: boolean;
  /** Settled only: what this open has read of it. */
  readonly settledRead: SettledRead;
  /** Settled only: the read named its process. */
  readonly found: boolean;
  /** Still inside the ceiling since its start, on a clock that moves. */
  readonly withinCeiling: boolean;
}

/**
 * Whether a card keeps the account store reading its operation. A running one: until its
 * outcome is read, and one only silent past its timeout too — it recovers only while somebody
 * still wants it. A settled one: one read of the project's history per open; past it, only one
 * whose process that read found, its outcome still unread, and only inside the ceiling — never
 * after a failed read, never once the store stopped answering.
 */
export function readsOperation(state: ObservationState, bound: OperationReadBound): boolean {
  if (state.kind === "off") return bound.running && state.reason === "stale-timeout";
  if (state.observation.outcome !== undefined) return false;
  if (bound.running) return true;
  switch (bound.settledRead) {
    case "pending":
      return true;
    case "failed":
      return false;
    case "read":
      return bound.found && bound.withinCeiling;
  }
}
