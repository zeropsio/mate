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
        | "feed-error";
    }
  | { readonly kind: "observing"; readonly observation: Observation; readonly elapsedMs: number }
  /** The feed catches up: what it held stays, said to be not current. */
  | { readonly kind: "stale"; readonly observation: Observation };

export type ObservationOffReason = ReasonOf<ObservationState>;

const DEFAULT_CEILING_MS = 30 * 60 * 1000;

/**
 * How the account's feed of the project's processes stands: live, first connecting, or catching
 * up after it was read — the stream's own phase, never a timer.
 */
export type ObservationFeed = "live" | "connecting" | "catching-up";

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
   * is computed here and never needs to be passed in.
   */
  readonly unavailableReason?: ObservationOffReason;
  readonly feed: ObservationFeed;
  /** What the store holds for the operation, once it holds anything for it. */
  readonly attribution?: AttributionResult;
}

/** `undefined` appVersion.id + build.serviceStackId → no build log to offer. */
export function buildLogFor(stepSource: ActivityProcess | undefined): BuildLogQuery | undefined {
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
 * own terminal status instead, or it never settles.
 */
export function outcomeFor(
  process: ActivityProcess,
): "finished" | "failed" | "cancelled" | undefined {
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

function observationFor(attribution: AttributionResult): Observation {
  const stepSource = attribution.stepSource;
  const pipeline = pipelineFor(stepSource);
  const outcome = stepSource === undefined ? undefined : outcomeFor(stepSource);
  const buildLog = buildLogFor(stepSource);
  return {
    ...(pipeline === undefined ? {} : { pipeline }),
    chips: attribution.chips,
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

  const elapsedMs = Math.max(0, nowMs - input.startedAtMs);
  const observation =
    input.attribution === undefined ? { chips: [] } : observationFor(input.attribution);
  // A settled pipeline is the platform's word: it stands whether the feed is live or not.
  if (observation.outcome !== undefined || input.feed !== "catching-up")
    return { kind: "observing", observation, elapsedMs };
  return { kind: "stale", observation };
}

/**
 * How long after its start a card draws what the account store read of its operation. One its
 * result named by id, whatever its age: a running one — a build zcp stopped following — is read
 * by that handle until it ends, its card's phase being the build's answer; a settled one is read
 * once per open, so the same row shows the same details in any window and
 * after a reload. One known only by its service and start: up to the ceiling.
 */
export function operationReadCeilingMs(
  operation: { readonly running: boolean; readonly exact: boolean },
  ceilingMs: number = DEFAULT_CEILING_MS,
): number {
  return operation.exact ? Number.POSITIVE_INFINITY : ceilingMs;
}
