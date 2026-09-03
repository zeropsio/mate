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
import type { ActivityProcess } from "./dto.ts";
import { type BuildLogQuery } from "./buildLog.ts";
import { type ObservedStep, observedSteps } from "./observedSteps.ts";
import { getPipelineState, pipelineTerminalOutcome } from "./pipelineState.ts";
import type { AttributionResult } from "./attribution.ts";

export interface Observation {
  /** From the step source's appVersion; `[]` when it has none (or there is no step source). */
  readonly steps: ReadonlyArray<ObservedStep>;
  /** Every attributed process, step source first. */
  readonly processes: ReadonlyArray<ActivityProcess>;
  /** The step source's pipeline outcome, once settled. */
  readonly outcome?: "finished" | "failed" | "cancelled";
  /** When this observation was read, epoch ms. */
  readonly readAtMs: number;
  /** Present once the step source's appVersion carries both an id and `build.serviceStackId`. */
  readonly buildLog?: BuildLogQuery;
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
    readonly atMs: number;
    /**
     * Forwarded by the caller for its own bookkeeping (e.g. a build-log access
     * cache key) — this layer never reads it.
     */
    readonly logAccessUrl?: string;
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

function observationFor(attribution: AttributionResult, atMs: number, nowMs: number): Observation {
  const stepSource = attribution.stepSource;
  const processes =
    stepSource === undefined ? attribution.chips : [stepSource, ...attribution.chips];
  const outcome = stepSource === undefined ? undefined : outcomeFor(stepSource);
  const buildLog = buildLogFor(stepSource);
  return {
    steps: observedSteps(stepSource?.appVersion, nowMs),
    processes,
    readAtMs: atMs,
    ...(outcome === undefined ? {} : { outcome }),
    ...(buildLog === undefined ? {} : { buildLog }),
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
      observation: { steps: [], processes: [], readAtMs: nowMs },
      elapsedMs: Math.max(0, nowMs - input.startedAtMs),
    };
  }

  const { attribution, atMs } = input.lastRead;
  const observation = observationFor(attribution, atMs, nowMs);
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
